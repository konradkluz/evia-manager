// The queue of files of the phone (EVM-130 AC1, AC4, AC6; architect 6, 7): real SQLite stores of the queue and the replica, a scripted
// native module. The upload itself (parts, retries, the notification) is Kotlin; here: arming after `applied`, reconciliation after a
// kill, the verdict about the original, "Ponów", the view.
import type { EnqueueInput, QueueRecord } from '@evia/sync-core';
import type { ArmResultName, FileStateEvent, UploadProgressEvent, UploadStatus } from '../../modules/evia-upload/src';
import type { UnlockedStore } from '../../src/storage';
import type { Database } from '../../src/storage/database';
import { SqlMediaFileStore } from '../../src/storage/media-file-store';
import { SqlQueueStore } from '../../src/storage/queue-store';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import type { NativeUpload } from '../../src/upload/native-upload';
import { CLEAN_KEPT, MediaUploads, type MediaUploadsDeps } from '../../src/upload/media-uploads';
import { migratedDatabase } from '../storage/harness';
import { newDisk, removeDisk, type TestDisk } from '../storage/node-sqlite-engine';

let disk: TestDisk;
beforeEach(() => {
  disk = newDisk();
});
afterEach(() => {
  removeDisk(disk);
});

const USER = '90000000-0000-4000-8000-0000000000aa';
const DEVICE = '7a000000-0000-4000-8000-000000000001';
const WO = '10000000-0000-4000-8000-000000000001';
const asset = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'c'.repeat(64);

class FakeNativeUpload implements NativeUpload {
  originals = new Map<string, { sizeBytes: number; sha256: string }>();
  readonly calls: string[] = [];
  readonly armed: { assetId: string; workOrderId: string; userId: string; deviceId: string }[] = [];
  readonly deleted: string[] = [];
  readonly wifi: boolean[] = [];
  armResult: ArmResultName | Record<string, ArmResultName> = 'armed';
  statuses: UploadStatus[] = [];
  verdict: 'delete' | 'keep' | 'keep_and_retry' | 'keep_quarantined' | 'invalid' | 'unavailable' = 'delete';
  readonly completed: { assetId: string; state: string; reason: string | null }[] = [];
  permission: 'granted' | 'denied' = 'granted';
  requestAnswer: 'granted' | 'denied' = 'granted';
  retryResult: ArmResultName = 'armed';
  target: 'queue' | null = null;
  throwing = false;
  readonly listeners = new Map<string, ((event: never) => void)[]>();

  digestOriginal: NativeUpload['digestOriginal'] = (assetId) => {
    this.calls.push('digestOriginal');
    return Promise.resolve(this.originals.get(assetId) ?? null);
  };
  reconcile: NativeUpload['reconcile'] = (items, wifiOnly) => {
    this.calls.push('reconcile');
    this.wifi.push(wifiOnly);
    this.armed.push(...items);
    return Promise.resolve(
      Object.fromEntries(
        items.map((item) => [
          item.assetId,
          typeof this.armResult === 'string' ? this.armResult : (this.armResult[item.assetId] ?? 'armed'),
        ]),
      ),
    );
  };
  retryUpload: NativeUpload['retryUpload'] = (assetId) => {
    this.calls.push(`retry:${assetId}`);
    return this.throwing ? Promise.reject(new Error('synthetic')) : Promise.resolve(this.retryResult);
  };
  completeUpload: NativeUpload['completeUpload'] = (assetId, state, reason) => {
    this.calls.push('completeUpload');
    this.completed.push({ assetId, state, reason });
    if (this.verdict === 'delete') this.deleted.push(assetId);
    return Promise.resolve(this.verdict);
  };
  uploadStatuses: NativeUpload['uploadStatuses'] = () => {
    this.calls.push('uploadStatuses');
    return Promise.resolve(this.statuses);
  };
  wipeUploads: NativeUpload['wipeUploads'] = () => Promise.resolve(true);
  notificationPermission: NativeUpload['notificationPermission'] = () => {
    if (this.throwing) throw new Error('synthetic');
    return this.permission;
  };
  requestNotificationPermission: NativeUpload['requestNotificationPermission'] = () => {
    this.calls.push('requestNotificationPermission');
    this.permission = this.requestAnswer;
    return Promise.resolve(this.requestAnswer);
  };
  openNotificationSettings: NativeUpload['openNotificationSettings'] = () => {
    this.calls.push('openNotificationSettings');
    return this.throwing ? Promise.reject(new Error('synthetic')) : Promise.resolve(true);
  };
  launchTarget: NativeUpload['launchTarget'] = () => {
    if (this.throwing) throw new Error('synthetic');
    return this.target;
  };
  e2eInjectFile: NativeUpload['e2eInjectFile'] = () => Promise.resolve(null);
  addListener: NativeUpload['addListener'] = (name, listener) => {
    const list = this.listeners.get(name) ?? [];
    list.push(listener);
    this.listeners.set(name, list);
    return {
      remove: () => {
        this.listeners.set(
          name,
          (this.listeners.get(name) ?? []).filter((l) => l !== listener),
        );
      },
    };
  };
  emit(name: 'onUploadProgress' | 'onFileState' | 'onSessionState', event: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) (listener as (e: unknown) => void)(event);
  }
}

interface Rig {
  readonly db: Database;
  readonly queue: SqlQueueStore;
  readonly replica: SqlReplicaStore;
  readonly native: FakeNativeUpload;
  readonly enqueued: EnqueueInput[];
  readonly uploads: MediaUploads;
  readonly store: UnlockedStore;
  readonly state: { signedIn: boolean; visible: boolean; contacts: number; wifiOnly: boolean };
  setup(overrides?: Partial<MediaUploadsDeps>): MediaUploads;
}

async function rig(native = new FakeNativeUpload()): Promise<Rig> {
  const { db } = await migratedDatabase(disk);
  const queue = new SqlQueueStore(db);
  const replica = new SqlReplicaStore(db);
  const media = new SqlMediaFileStore(db, USER);
  const state = { signedIn: true, visible: true, contacts: 0, wifiOnly: false };
  const store = {
    userId: USER,
    queue,
    replica,
    media,
    identity: { read: () => Promise.resolve({ deviceId: DEVICE, secret: 'secret-synthetic' }), write: () => Promise.resolve() },
    replicaExtras: { readMediaServerStates: (ids: readonly string[]) => replica.readMediaServerStates(ids) },
  } as unknown as UnlockedStore;
  const enqueued: EnqueueInput[] = [];
  let counter = 500;
  let clock = 1_000;
  const setup = (overrides: Partial<MediaUploadsDeps> = {}): MediaUploads =>
    new MediaUploads({
      native,
      store: () => (state.signedIn ? store : null),
      enqueue: async (input) => {
        enqueued.push(input);
        counter += 1;
        const payload = input.payload as { id: string; workOrderId: string };
        const record: QueueRecord = {
          mutationId: asset(counter),
          type: 'CreateMediaAsset',
          commandVersion: 1,
          payload: payload,
          objectId: payload.id,
          orderingKey: payload.workOrderId,
          createdAt: clock,
          ownerUserId: USER,
          state: 'pending',
          attempts: 0,
        };
        await queue.append(record);
        return { ok: true, mutationId: record.mutationId };
      },
      now: () => (clock += 1),
      wifiOnly: () => state.wifiOnly,
      dataVisible: () => state.visible,
      onNativeEvent: () => {
        state.contacts += 1;
      },
      ...overrides,
    });
  return { db, queue, replica, native, enqueued, uploads: setup(), store, state, setup };
}

/** `add` starts a reconcile of its own in the background: let it finish, so that the tests do not race it. */
const idle = async (r: Rig): Promise<void> => {
  await r.uploads.reconcile();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await r.uploads.reconcile();
};
const photo = (n: number) => ({ assetId: asset(n), workOrderId: WO, mediaType: 'photo' as const, category: 'other' as const });
const hold = (r: Rig, n: number): void => {
  r.native.originals.set(asset(n), { sizeBytes: 1000 + n, sha256: SHA });
};
/** The server applied the command of file `n` (the queue settles it, the row becomes `applied` in the same transaction). */
const apply = async (r: Rig, n: number): Promise<void> => {
  const row = (await r.store.media.list()).find((file) => file.assetId === asset(n));
  if (row === undefined) throw new Error('no row');
  await r.queue.settle(row.mutationId, { outcome: 'applied', warnings: [] });
};
const states = async (r: Rig): Promise<string[]> => (await r.store.media.list()).map((row) => `${row.assetId.slice(-2)}:${row.state}`);

async function serverState(r: Rig, n: number, fileState: string, reason: string | null = null): Promise<void> {
  const { active } = await r.replica.loadState();
  await r.replica.applyPage({
    generation: active.generation,
    ownerUserId: USER,
    ops: [
      { op: 'upsert', entity: { type: 'work_order', id: WO, version: 1, fields: { siteId: null } } },
      {
        op: 'upsert',
        entity: {
          type: 'media_asset',
          id: asset(n),
          version: 1,
          fields: { workOrderId: WO, mediaType: 'photo', fileState, fileStateReasonCode: reason },
        },
      },
    ],
    cursor: `cursor-${String(n).padStart(12, '0')}`,
    phase: 'changes',
    complete: true,
    serverTime: 1,
    hydrationAdd: [],
    hydrationRemove: [],
  });
}

describe('adding a file and arming it after applied (EVM-130 AC1; architect 7)', () => {
  it('EVM-130 AC1: a file becomes a command and a row; NOTHING is armed before the server applied the command', async () => {
    const r = await rig();
    hold(r, 1);
    expect(await r.uploads.add(photo(1))).toEqual({ ok: true });
    expect(r.enqueued).toHaveLength(1);
    expect(r.enqueued[0]).toMatchObject({ type: 'CreateMediaAsset', commandVersion: 1, payload: { id: asset(1), workOrderId: WO } });
    expect(await r.store.media.list()).toMatchObject([
      { assetId: asset(1), state: 'pending', sizeBytes: 1001, sha256: SHA, fileName: asset(1), mime: 'image/jpeg' },
    ]);
    await r.uploads.reconcile();
    expect(r.native.armed).toEqual([]);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ assetId: asset(1), status: 'waiting', percent: null, actions: [] }]);
  });

  it('EVM-130 AC1: after applied the file is armed with the ids of the work order, the user and the device; again after a restart (idempotent)', async () => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(photo(1));
    await idle(r);
    r.native.armed.length = 0;
    await apply(r, 1);
    await r.uploads.reconcile();
    expect(r.native.armed).toEqual([{ assetId: asset(1), workOrderId: WO, userId: USER, deviceId: DEVICE }]);
    expect(r.native.wifi).toEqual([false]);
    // the process was killed and starts again: a new service over the same database arms the same file again
    const restarted = r.setup();
    await restarted.reconcile();
    expect(r.native.armed).toHaveLength(2);
    expect(await states(r)).toEqual(['01:applied']);
    r.state.wifiOnly = true;
    r.native.wifi.length = 0;
    await restarted.reconcile();
    expect(r.native.wifi).toEqual([true]);
  });

  it('EVM-130 AC1: add refuses what the server would refuse, a missing original, a missing session and a queue that does not take it — and writes no row', async () => {
    const r = await rig();
    expect(await r.uploads.add({ ...photo(1), category: 'nope' as never })).toEqual({ ok: false, code: 'invalid' });
    expect(await r.uploads.add(photo(2))).toEqual({ ok: false, code: 'missing_original' });
    hold(r, 3);
    r.state.signedIn = false;
    expect(await r.uploads.add(photo(3))).toEqual({ ok: false, code: 'no_session' });
    r.state.signedIn = true;
    const refusing = r.setup({ enqueue: () => Promise.resolve({ ok: false }) });
    expect(await refusing.add(photo(3))).toEqual({ ok: false, code: 'enqueue_failed' });
    const noId = r.setup({ enqueue: () => Promise.resolve({ ok: true }) });
    expect(await noId.add(photo(3))).toEqual({ ok: false, code: 'enqueue_failed' });
    const throwing = r.setup({ enqueue: () => Promise.reject(new Error('synthetic')) });
    expect(await throwing.add(photo(3))).toEqual({ ok: false, code: 'enqueue_failed' });
    expect(await r.store.media.list()).toEqual([]);
  });

  it('EVM-130 AC1: a kill between the command and the row leaves a command that the next reconcile repairs from its payload and the original — nothing is lost', async () => {
    const r = await rig();
    hold(r, 1);
    hold(r, 2);
    // the command of file 1 reached the queue, its row did not; file 2 has a command but its original is gone
    for (const n of [1, 2]) {
      await r.queue.append({
        mutationId: asset(600 + n),
        type: 'CreateMediaAsset',
        commandVersion: 1,
        payload: { id: asset(n), workOrderId: WO, mediaType: n === 1 ? 'video' : 'photo', category: 'other' },
        objectId: asset(n),
        orderingKey: WO,
        createdAt: 77,
        ownerUserId: USER,
        state: 'pending',
        attempts: 0,
      });
    }
    r.native.originals.delete(asset(2));
    await r.queue.append({
      mutationId: asset(700),
      type: 'CreateNote',
      commandVersion: 1,
      payload: { id: asset(9), workOrderId: WO, body: 'x' },
      objectId: asset(9),
      orderingKey: WO,
      createdAt: 1,
      ownerUserId: USER,
      state: 'pending',
      attempts: 0,
    });
    await r.queue.append({
      mutationId: asset(701),
      type: 'CreateMediaAsset',
      commandVersion: 1,
      payload: { id: asset(8), workOrderId: WO, mediaType: 'photo', category: 'other' },
      objectId: asset(8),
      orderingKey: WO,
      createdAt: 1,
      ownerUserId: 'someone-else',
      state: 'pending',
      attempts: 0,
    });
    await r.queue.rewrite([], []);
    await r.uploads.reconcile();
    expect(await r.store.media.list()).toMatchObject([
      { assetId: asset(1), mutationId: asset(601), state: 'pending', mime: 'video/mp4', createdAt: 77, sizeBytes: 1001 },
    ]);
    // the command is applied later: the repaired row follows
    await r.queue.settle(asset(601), { outcome: 'applied', warnings: [] });
    await r.uploads.reconcile();
    expect(r.native.armed.map((item) => item.assetId)).toEqual([asset(1)]);
  });

  it('EVM-130 AC1: a row that cannot be written after the command is repaired by the reconcile that add starts itself', async () => {
    const r = await rig();
    hold(r, 1);
    const failing = r.setup({
      store: () => ({
        ...r.store,
        media: { ...r.store.media, register: () => Promise.reject(new Error('synthetic')), list: () => r.store.media.list() },
      }),
    });
    expect(await failing.add(photo(1))).toEqual({ ok: true });
    expect(await r.store.media.list()).toEqual([]);
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:pending']);
  });

  it('EVM-130 AC1: a file the module cannot arm (the original is gone, the ids are refused) goes to "Wymaga uwagi" — nothing is deleted; the others are armed', async () => {
    const r = await rig();
    for (const n of [1, 2, 3]) {
      hold(r, n);
      await r.uploads.add(photo(n));
      await apply(r, n);
    }
    r.native.armResult = { [asset(1)]: 'missing_original', [asset(2)]: 'invalid', [asset(3)]: 'wipe_active' };
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:needs_attention', '02:needs_attention', '03:applied']);
    expect((await r.store.media.list()).map((row) => row.lastCode)).toEqual(['missing_original', 'invalid', null]);
    expect(r.uploads.getSnapshot().files.map((f) => [f.status, f.actions])).toEqual([
      ['attention', ['retry']],
      ['attention', ['retry']],
      ['waiting', []],
    ]);
    // a file in "Wymaga uwagi" is not armed again at the next start
    r.native.armed.length = 0;
    await r.uploads.reconcile();
    expect(r.native.armed.map((item) => item.assetId)).toEqual([asset(3)]);
  });

  it('EVM-130 AC1: without an identity (nothing to arm with) or a session nothing is armed and nothing fails', async () => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(photo(1));
    await idle(r);
    r.native.armed.length = 0;
    await apply(r, 1);
    const anonymous = r.setup({
      store: () => ({ ...r.store, identity: { read: () => Promise.resolve(null) } }) as unknown as UnlockedStore,
    });
    await anonymous.reconcile();
    expect(r.native.armed).toEqual([]);
    r.state.signedIn = false;
    await r.uploads.reconcile();
    expect(r.uploads.getSnapshot()).toEqual({ files: [], notifications: 'granted' });
  });

  it('EVM-130 AC1: a store or a module that throws leaves the rows as they are (the next run starts again)', async () => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(photo(1));
    await apply(r, 1);
    r.native.reconcile = () => Promise.reject(new Error('synthetic'));
    await expect(r.uploads.reconcile()).resolves.toBeUndefined();
    expect(await states(r)).toEqual(['01:applied']);
  });

  it('EVM-130 AC1: concurrent reconciles are one run and one more (single-flight)', async () => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(photo(1));
    await apply(r, 1);
    r.native.calls.length = 0;
    await Promise.all([r.uploads.reconcile(), r.uploads.reconcile(), r.uploads.reconcile()]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(r.native.calls.filter((call) => call === 'reconcile')).toHaveLength(2);
  });
});

describe('the state of a file in the view (EVM-130 AC4)', () => {
  const armed = async (): Promise<Rig> => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(photo(1));
    await idle(r);
    await apply(r, 1);
    await r.uploads.reconcile();
    return r;
  };

  it('EVM-130 AC4: the progress comes from the status of the module and its events and is never written to the database', async () => {
    const r = await armed();
    const writes: string[] = [];
    r.uploads.start();
    r.native.statuses = [{ assetId: asset(1), state: 'uploading', partsDone: 1, partCount: 4, percent: 25, sizeBytes: 1001 }];
    await r.uploads.reconcile();
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'uploading', percent: 25 }]);
    const before = JSON.stringify(await r.db.read((tx) => tx.all('SELECT * FROM media_files')));
    const event: UploadProgressEvent = { assetId: asset(1), state: 'uploading', partsDone: 2, partCount: 4, percent: 50, sizeBytes: 1001 };
    let heard = 0;
    r.uploads.subscribe(() => {
      heard += 1;
    });
    r.native.emit('onUploadProgress', event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'uploading', percent: 50 }]);
    expect(heard).toBeGreaterThan(0);
    expect(JSON.stringify(await r.db.read((tx) => tx.all('SELECT * FROM media_files')))).toBe(before);
    expect(writes).toEqual([]);
    r.native.emit('onUploadProgress', { ...event, percent: 250 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.uploads.getSnapshot().files[0]?.percent).toBe(100);
  });

  it('EVM-130 AC4: events of a file — uploaded is "Wysłano", needs_attention keeps its reason, checksum_mismatch is "Ponów"; each one tells the contact to merge', async () => {
    const r = await armed();
    r.uploads.start();
    const fire = async (event: FileStateEvent): Promise<void> => {
      r.native.emit('onFileState', event);
      await new Promise((resolve) => setTimeout(resolve, 30));
    };
    await fire({ assetId: asset(1), state: 'queued', reason: null });
    expect(await states(r)).toEqual(['01:applied']);
    await fire({ assetId: asset(1), state: 'uploaded', reason: null });
    expect(await states(r)).toEqual(['01:uploaded']);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'sent', actions: [] }]);
    await fire({ assetId: asset(1), state: 'queued', reason: 'checksum_mismatch' });
    expect(await states(r)).toEqual(['01:failed']);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'error', code: 'checksum_mismatch', actions: ['retry'] }]);
    // a late event never undoes a later decision: the row is not in applied/uploaded any more
    await fire({ assetId: asset(1), state: 'uploaded', reason: null });
    await fire({ assetId: asset(1), state: 'needs_attention', reason: 'id_conflict' });
    expect(await states(r)).toEqual(['01:failed']);
    await fire({ assetId: asset(404), state: 'uploaded', reason: null });
    expect(r.state.contacts).toBe(6);
    for (const state of ['paused_revoked', 'paused_update', 'wrong_owner', 'wiped', 'dropped'] as const)
      await fire({ assetId: asset(1), state, reason: null });
    expect(await states(r)).toEqual(['01:failed']);
    r.native.emit('onSessionState', { state: 'paused_revoked' });
    expect(r.state.contacts).toBe(12);
  });

  it('EVM-130 AC4: needs_attention from the module is "Wymaga uwagi" with "Ponów"; a quarantine has no retry', async () => {
    const r = await armed();
    r.uploads.start();
    r.native.emit('onFileState', { assetId: asset(1), state: 'needs_attention', reason: 'id_conflict' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'attention', code: 'id_conflict', actions: ['retry'] }]);
    await r.store.media.setState(asset(1), 'needs_attention', 'quarantined', 9);
    await r.uploads.refresh();
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'attention', code: 'quarantined', actions: [] }]);
  });

  it('EVM-130 AC4: a file the module finished while no JavaScript listened (a lost event) is found from the status', async () => {
    const r = await armed();
    r.native.statuses = [{ assetId: asset(1), state: 'uploaded', partsDone: 4, partCount: 4, percent: 100, sizeBytes: 1001 }];
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:uploaded']);
  });

  it('EVM-130 AC4: the original stays until the replica shows the file confirmed — nothing is asked while the replica does not know it', async () => {
    const r = await armed();
    await r.store.media.setState(asset(1), 'uploaded', null, 5);
    await r.uploads.reconcile();
    expect(r.native.completed).toEqual([]);
    expect(r.native.deleted).toEqual([]);
    await serverState(r, 1, 'uploading');
    r.native.verdict = 'keep';
    await r.uploads.reconcile();
    expect(r.native.completed).toEqual([{ assetId: asset(1), state: 'uploading', reason: null }]);
    expect(r.native.deleted).toEqual([]);
    expect(await states(r)).toEqual(['01:uploaded']);
  });

  it.each(['processing', 'ready'])(
    'EVM-130 AC4: the server state %s (the file is clean) removes the original and the row stays as "Wysłano"',
    async (fileState) => {
      const r = await armed();
      await r.store.media.setState(asset(1), 'uploaded', null, 5);
      await serverState(r, 1, fileState);
      r.native.verdict = 'delete';
      await r.uploads.reconcile();
      expect(r.native.deleted).toEqual([asset(1)]);
      expect(await states(r)).toEqual(['01:clean']);
      expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'sent' }]);
      // a clean file is not asked about again
      r.native.completed.length = 0;
      await r.uploads.reconcile();
      expect(r.native.completed).toEqual([]);
    },
  );

  it('EVM-130 AC4: failed + checksum_mismatch is "Ponów" (the original stays); a quarantine is "Wymaga uwagi" without a retry', async () => {
    const r = await armed();
    await r.store.media.setState(asset(1), 'uploaded', null, 5);
    await serverState(r, 1, 'failed', 'checksum_mismatch');
    r.native.verdict = 'keep_and_retry';
    await r.uploads.reconcile();
    expect(r.native.completed).toEqual([{ assetId: asset(1), state: 'failed', reason: 'checksum_mismatch' }]);
    expect(await states(r)).toEqual(['01:failed']);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'error', code: 'checksum_mismatch', actions: ['retry'] }]);
    expect(r.native.deleted).toEqual([]);

    await r.store.media.setState(asset(1), 'uploaded', null, 6);
    r.native.verdict = 'keep_quarantined';
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:needs_attention']);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'attention', code: 'quarantined', actions: [] }]);
    expect(r.native.deleted).toEqual([]);

    await r.store.media.setState(asset(1), 'uploaded', null, 7);
    for (const verdict of ['invalid', 'unavailable'] as const) {
      r.native.verdict = verdict;
      await r.uploads.reconcile();
      expect(await states(r)).toEqual(['01:uploaded']);
    }
  });

  it('EVM-130 AC4, AC5: in the hidden-data mode nothing is read from the replica (the upload goes on, the original waits for the confirmation)', async () => {
    const r = await armed();
    await r.store.media.setState(asset(1), 'uploaded', null, 5);
    await serverState(r, 1, 'ready');
    r.state.visible = false;
    await r.uploads.reconcile();
    expect(r.native.completed).toEqual([]);
    expect(await states(r)).toEqual(['01:uploaded']);
    r.state.visible = true;
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:clean']);
  });

  it('EVM-130 AC4, AC5: the view carries no order, path, digest or description — the same in the hidden-data mode', async () => {
    const r = await armed();
    r.native.statuses = [{ assetId: asset(1), state: 'uploading', partsDone: 1, partCount: 2, percent: 50, sizeBytes: 1001 }];
    r.state.visible = false;
    await r.uploads.reconcile();
    const text = JSON.stringify(r.uploads.getSnapshot());
    for (const secret of [WO, SHA, 'image/jpeg', USER, DEVICE, 'originals']) expect(text).not.toContain(secret);
  });

  it('EVM-130 AC4: the files confirmed by the server stay as "Wysłano", the newest first and no more than the limit; the open ones come first', async () => {
    const r = await rig();
    for (let n = 1; n <= CLEAN_KEPT + 3; n += 1) {
      await r.store.media.register({
        assetId: asset(n),
        mutationId: asset(n + 1000),
        workOrderId: WO,
        ownerUserId: USER,
        fileName: asset(n),
        sizeBytes: 5,
        sha256: SHA,
        mime: 'image/jpeg',
        createdAt: n,
      });
      await r.store.media.setState(asset(n), 'clean', null, n);
    }
    await r.store.media.register({
      assetId: asset(99),
      mutationId: asset(1099),
      workOrderId: WO,
      ownerUserId: USER,
      fileName: asset(99),
      sizeBytes: 5,
      sha256: SHA,
      mime: 'image/jpeg',
      createdAt: 99,
    });
    await r.uploads.reconcile();
    const files = r.uploads.getSnapshot().files;
    expect(files).toHaveLength(CLEAN_KEPT + 1);
    expect(files[0]).toMatchObject({ assetId: asset(99), status: 'waiting' });
    expect(files[1]).toMatchObject({ assetId: asset(CLEAN_KEPT + 3), status: 'sent' });
  });
});

describe('"Ponów" (EVM-130 AC4)', () => {
  const failed = async (code: string, state: 'failed' | 'needs_attention' = 'failed'): Promise<Rig> => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(photo(1));
    await apply(r, 1);
    await r.store.media.setState(asset(1), state, code, 5);
    await r.uploads.refresh();
    r.native.armed.length = 0;
    return r;
  };

  it('EVM-130 AC4: the same job is handed to the system again and the row goes back to applied', async () => {
    const r = await failed('checksum_mismatch');
    expect(await r.uploads.retry(asset(1))).toBe(true);
    expect(r.native.calls).toContain(`retry:${asset(1)}`);
    expect(await states(r)).toEqual(['01:applied']);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'waiting', actions: [] }]);
  });

  it('EVM-130 AC4: "Ponów" of a file in "Wymaga uwagi" works; a quarantined file, an unknown file, a file in another state and a refusing module do not', async () => {
    const attention = await failed('id_conflict', 'needs_attention');
    expect(await attention.uploads.retry(asset(1))).toBe(true);
    const quarantined = await failed('quarantined', 'needs_attention');
    expect(await quarantined.uploads.retry(asset(1))).toBe(false);
    expect(quarantined.native.calls).not.toContain(`retry:${asset(1)}`);
    expect(await quarantined.uploads.retry(asset(404))).toBe(false);
    const waiting = await rig();
    hold(waiting, 1);
    await waiting.uploads.add(photo(1));
    expect(await waiting.uploads.retry(asset(1))).toBe(false);
    const refusing = await failed('checksum_mismatch');
    refusing.native.retryResult = 'missing_original';
    expect(await refusing.uploads.retry(asset(1))).toBe(false);
    expect(await states(refusing)).toEqual(['01:failed']);
    refusing.native.throwing = true;
    expect(await refusing.uploads.retry(asset(1))).toBe(false);
    refusing.state.signedIn = false;
    expect(await refusing.uploads.retry(asset(1))).toBe(false);
  });
});

describe('notifications and the target of a notification (EVM-130 AC6)', () => {
  it('EVM-130 AC6: the view carries the permission of the system; the request and the settings go to the module; the view follows the answer', async () => {
    const r = await rig();
    r.native.permission = 'denied';
    await r.uploads.refresh();
    expect(r.uploads.getSnapshot().notifications).toBe('denied');
    r.native.requestAnswer = 'granted';
    expect(await r.uploads.requestNotifications()).toBe('granted');
    expect(r.uploads.getSnapshot().notifications).toBe('granted');
    expect(await r.uploads.openNotificationSettings()).toBe(true);
    r.native.throwing = true;
    expect(await r.uploads.openNotificationSettings()).toBe(false);
    r.native.requestNotificationPermission = () => Promise.reject(new Error('synthetic'));
    expect(await r.uploads.requestNotifications()).toBe('denied');
    // a module that cannot tell is "granted": no Banner for a state nobody knows
    expect(r.uploads.getSnapshot().notifications).toBe('granted');
  });

  it('EVM-130 AC6: the target of the notification is a value of a fixed set, read once; a failing module is "nowhere"', async () => {
    const r = await rig();
    expect(r.uploads.consumeLaunchTarget()).toBeNull();
    r.native.target = 'queue';
    expect(r.uploads.consumeLaunchTarget()).toBe('queue');
    r.native.throwing = true;
    expect(r.uploads.consumeLaunchTarget()).toBeNull();
  });

  it('EVM-130 AC6: stop removes the listeners of the module; start twice listens once', async () => {
    const r = await rig();
    r.uploads.start();
    r.uploads.start();
    expect(r.native.listeners.get('onFileState')).toHaveLength(1);
    r.uploads.stop();
    expect(r.native.listeners.get('onFileState')).toHaveLength(0);
  });
});
