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

/** The core of this branch does not know the type yet (the contract branch adds it): the rows of the queue are written raw. */
const MEDIA_COMMAND = 'CreateMediaAsset' as unknown as QueueRecord['type'];

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
  setKeepScreenOn: NativeUpload['setKeepScreenOn'] = () => true;
  getVideoWifiOnly: NativeUpload['getVideoWifiOnly'] = () => true;
  setVideoWifiOnly: NativeUpload['setVideoWifiOnly'] = () => Promise.resolve(true);
  /** The number of arguments of every call of `reconcile` and `retryUpload`: EVM-110 - the network is decided natively, the caller passes nothing about it. */
  readonly arity: number[] = [];
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
  reconcile: NativeUpload['reconcile'] = (...args) => {
    const [items] = args;
    this.calls.push('reconcile');
    this.arity.push(args.length);
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
  importOriginal: NativeUpload['importOriginal'] = () => Promise.resolve('unavailable');
  sweepOriginals: NativeUpload['sweepOriginals'] = () => Promise.resolve(0);
  cancelUpload: NativeUpload['cancelUpload'] = () => Promise.resolve(true);
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
  readonly state: { signedIn: boolean; visible: boolean; contacts: number };
  setup(overrides?: Partial<MediaUploadsDeps>): MediaUploads;
}

async function rig(native = new FakeNativeUpload()): Promise<Rig> {
  const { db } = await migratedDatabase(disk);
  const queue = new SqlQueueStore(db);
  const replica = new SqlReplicaStore(db);
  const media = new SqlMediaFileStore(db, USER);
  const state = { signedIn: true, visible: true, contacts: 0 };
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
          type: MEDIA_COMMAND,
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

/** Every state the server announces is a newer version of the entity (the replica ignores an older or equal one). */
let announced = 0;
async function serverState(r: Rig, n: number, fileState: string, reason: string | null = null): Promise<void> {
  announced += 1;
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
          version: announced,
          fields: { workOrderId: WO, mediaType: 'photo', fileState, fileStateReasonCode: reason },
        },
      },
    ],
    cursor: `cursor-${String(announced).padStart(12, '0')}`,
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
    expect(r.enqueued[0]).toMatchObject({ type: MEDIA_COMMAND, commandVersion: 1, payload: { id: asset(1), workOrderId: WO } });
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
    // EVM-131: the MIME type of the row goes to the module, which declares it in the upload session
    expect(r.native.armed).toEqual([{ assetId: asset(1), workOrderId: WO, userId: USER, deviceId: DEVICE, contentType: 'image/jpeg' }]);
    expect(r.native.arity).toEqual([1]); // EVM-110 AC4: nothing about the network is passed (the native setting decides)
    // the process was killed and starts again: a new service over the same database arms the same file again
    const restarted = r.setup();
    await restarted.reconcile();
    expect(r.native.armed).toHaveLength(2);
    expect(await states(r)).toEqual(['01:applied']);
    r.native.arity.length = 0;
    await restarted.reconcile();
    expect(r.native.arity).toEqual([1]); // EVM-110 AC4: the same after the setting changed - the module reads its own store
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
        type: MEDIA_COMMAND,
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
      type: MEDIA_COMMAND,
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
    // a film that was repaired from its command has no stored length: the row shows type and size only (documented, not guessed)
    expect((await r.store.media.list())[0]).not.toHaveProperty('durationMs');
    expect(r.uploads.getSnapshot().files[0]?.durationMs ?? null).toBeNull();
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
    await idle(r);
    r.native.armResult = { [asset(1)]: 'missing_original', [asset(2)]: 'invalid', [asset(3)]: 'wipe_active' };
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:needs_attention', '02:needs_attention', '03:applied']);
    expect((await r.store.media.list()).map((row) => row.lastCode)).toEqual(['missing_original', 'invalid', null]);
    expect(r.uploads.getSnapshot().files.map((f) => [f.status, f.actions])).toEqual([
      ['attention', ['retry', 'discard']],
      ['attention', ['retry']],
      ['waiting', []],
    ]);
    // a file in "Wymaga uwagi" is not armed again at the next start
    r.native.armed.length = 0;
    await r.uploads.reconcile();
    expect(r.native.armed.map((item) => item.assetId)).toEqual([asset(3)]);
  });

  it('EVM-130 AC1: a build without storage hosts answers "upload_unavailable": nothing throws, every file stays queued ("oczekuje") and is not a failure', async () => {
    const r = await rig();
    for (const n of [1, 2]) {
      hold(r, n);
      await r.uploads.add(photo(n));
      await apply(r, n);
    }
    r.native.armResult = 'upload_unavailable';
    await expect(r.uploads.reconcile()).resolves.toBeUndefined();
    expect(await states(r)).toEqual(['01:applied', '02:applied']);
    expect((await r.store.media.list()).map((row) => row.lastCode)).toEqual([null, null]);
    expect(r.uploads.getSnapshot().files.map((f) => [f.status, f.actions])).toEqual([
      ['waiting', []],
      ['waiting', []],
    ]);
    // the next start arms them again (nothing was settled)
    r.native.armed.length = 0;
    await r.uploads.reconcile();
    expect(r.native.armed.map((item) => item.assetId)).toEqual([asset(1), asset(2)]);
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
      await new Promise((resolve) => setTimeout(resolve, 100));
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
    // the event is handled asynchronously: wait for the effect (not a fixed time - a loaded machine is slower)
    for (let waited = 0; waited < 3000 && r.uploads.getSnapshot().files[0]?.status !== 'attention'; waited += 20)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'attention', code: 'id_conflict', actions: ['retry', 'discard'] }]);
    await r.store.media.setState(asset(1), 'needs_attention', 'quarantined', 9);
    await r.uploads.refresh();
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'attention', code: 'quarantined', actions: ['discard'] }]);
  });

  it('EVM-130 AC4: a file the module finished while no JavaScript listened (a lost event) is found from the status', async () => {
    const r = await armed();
    r.native.statuses = [{ assetId: asset(1), state: 'uploaded', partsDone: 4, partCount: 4, percent: 100, sizeBytes: 1001 }];
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:uploaded']);
  });

  it('EVM-130 AC4: processing or ready in the replica without a clean ever seen removes the original exactly once (the row stays clean)', async () => {
    for (const fileState of ['processing', 'ready']) {
      const r = await armed();
      await r.store.media.setState(asset(1), 'uploaded', null, 5);
      await serverState(r, 1, fileState);
      await r.uploads.reconcile();
      await r.uploads.reconcile();
      await r.setup().reconcile();
      expect(r.native.completed).toEqual([{ assetId: asset(1), state: fileState, reason: null }]);
      expect(r.native.deleted).toEqual([asset(1)]);
      expect(await states(r)).toEqual(['01:clean']);
    }
  });

  it('EVM-130 AC4: sent and not confirmed in the replica — the original is untouched: nothing is asked of the module while the replica does not know the file, or says pending / uploading, also after a restart and after reconcile', async () => {
    const r = await armed();
    await r.store.media.setState(asset(1), 'uploaded', null, 5);
    await r.uploads.reconcile();
    expect(r.native.completed).toEqual([]);
    for (const fileState of ['pending', 'uploading']) {
      await serverState(r, 1, fileState);
      await r.uploads.reconcile();
      // the application of the app restarts: a new service over the same database
      await r.setup().reconcile();
      expect(r.native.completed).toEqual([]);
      expect(r.native.deleted).toEqual([]);
      expect(await states(r)).toEqual(['01:uploaded']);
      expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'sent' }]);
    }
  });

  it('EVM-130 AC4: the module reporting uploaded does not delete the original either — it is "sent, waiting for the confirmation" (the view says "Wysłano")', async () => {
    const r = await armed();
    r.uploads.start();
    r.native.emit('onFileState', { assetId: asset(1), state: 'uploaded', reason: null });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await states(r)).toEqual(['01:uploaded']);
    expect(r.native.completed).toEqual([]);
    expect(r.native.deleted).toEqual([]);
  });

  it('EVM-130 AC4: clean in the replica removes the original exactly once and the row stays as "Wysłano"', async () => {
    const r = await armed();
    await r.store.media.setState(asset(1), 'uploaded', null, 5);
    await serverState(r, 1, 'clean');
    await r.uploads.reconcile();
    await r.uploads.reconcile();
    await r.setup().reconcile();
    expect(r.native.completed).toEqual([{ assetId: asset(1), state: 'clean', reason: null }]);
    expect(r.native.deleted).toEqual([asset(1)]);
    expect(await states(r)).toEqual(['01:clean']);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'sent' }]);
  });

  it('EVM-130 AC4: the replica says clean BEFORE the event of the module (the row is still applied) — the original is removed, the late event changes nothing', async () => {
    const r = await armed();
    r.uploads.start();
    expect(await states(r)).toEqual(['01:applied']);
    await serverState(r, 1, 'clean');
    await r.uploads.reconcile();
    expect(r.native.deleted).toEqual([asset(1)]);
    expect(await states(r)).toEqual(['01:clean']);
    r.native.emit('onFileState', { assetId: asset(1), state: 'uploaded', reason: null });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await states(r)).toEqual(['01:clean']);
    expect(r.native.deleted).toEqual([asset(1)]);
  });

  it('EVM-130 AC4: a module that does not delete (unavailable, invalid) leaves the row uploaded — the next run asks again', async () => {
    const r = await armed();
    await r.store.media.setState(asset(1), 'uploaded', null, 5);
    await serverState(r, 1, 'clean');
    for (const verdict of ['unavailable', 'invalid', 'keep'] as const) {
      r.native.verdict = verdict;
      await r.uploads.reconcile();
      expect(await states(r)).toEqual(['01:uploaded']);
    }
    r.native.verdict = 'delete';
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:clean']);
  });

  it('EVM-130 AC4: failed + checksum_mismatch in the replica is "Ponów" (the original stays); a quarantine is "Wymaga uwagi" without a retry; neither calls the module', async () => {
    const r = await armed();
    await r.store.media.setState(asset(1), 'uploaded', null, 5);
    await serverState(r, 1, 'failed', 'checksum_mismatch');
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:failed']);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'error', code: 'checksum_mismatch', actions: ['retry'] }]);
    // "Ponów": the file goes to the system again; the replica still shows the old failure and does not undo the retry
    expect(await r.uploads.retry(asset(1))).toBe(true);
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:applied']);

    await r.store.media.setState(asset(1), 'uploaded', null, 6);
    await serverState(r, 1, 'quarantined');
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:needs_attention']);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'attention', code: 'quarantined', actions: ['discard'] }]);
    expect(r.native.completed).toEqual([]);
    expect(r.native.deleted).toEqual([]);
  });

  it('EVM-130 AC4: after "Ponów" the module says uploaded and the replica still shows the old failure — the row stays uploaded, until the replica moves on', async () => {
    const r = await armed();
    await r.store.media.setState(asset(1), 'uploaded', null, 5);
    await serverState(r, 1, 'failed', 'checksum_mismatch');
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:failed']);
    expect(await r.uploads.retry(asset(1))).toBe(true);
    r.uploads.start();
    r.native.emit('onFileState', { assetId: asset(1), state: 'uploaded', reason: null });
    for (let waited = 0; waited < 3000 && (await states(r))[0] !== '01:uploaded'; waited += 20)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await states(r)).toEqual(['01:uploaded']);
    await r.uploads.reconcile();
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:uploaded']);
    expect(r.native.deleted).toEqual([]);
    await serverState(r, 1, 'clean');
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:clean']);
  });

  it('EVM-130 AC4: a failure other than checksum_mismatch (processing_error, abandoned) changes nothing — the file stays sent', async () => {
    const r = await armed();
    await r.store.media.setState(asset(1), 'uploaded', null, 5);
    for (const reason of ['processing_error', 'abandoned']) {
      await serverState(r, 1, 'failed', reason);
      await r.uploads.reconcile();
      expect(await states(r)).toEqual(['01:uploaded']);
    }
  });

  it('EVM-130 AC4, AC5: in the hidden-data mode nothing is read from the replica (the upload goes on, the original waits for the confirmation)', async () => {
    const r = await armed();
    await r.store.media.setState(asset(1), 'uploaded', null, 5);
    await serverState(r, 1, 'clean');
    r.state.visible = false;
    await r.uploads.reconcile();
    expect(r.native.completed).toEqual([]);
    expect(await states(r)).toEqual(['01:uploaded']);
    r.state.visible = true;
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:clean']);
  });

  it('EVM-130 AC5: in the hidden-data mode the upload goes on — an applied file is armed and its progress is followed, only the replica is not read', async () => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(photo(1));
    await idle(r);
    await apply(r, 1);
    r.state.visible = false;
    r.native.armed.length = 0;
    r.native.statuses = [{ assetId: asset(1), state: 'uploading', partsDone: 1, partCount: 4, percent: 25, sizeBytes: 1001 }];
    await r.uploads.reconcile();
    expect(r.native.armed.map((item) => item.assetId)).toEqual([asset(1)]);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'uploading', percent: 25 }]);
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

describe('"Usuń z telefonu" (EVM-108 AC6, security 19)', () => {
  const attention = async (code: string, state: 'failed' | 'needs_attention' = 'needs_attention'): Promise<Rig> => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(photo(1));
    await apply(r, 1);
    await r.store.media.setState(asset(1), state, code, 5);
    await r.uploads.refresh();
    return r;
  };

  it.each(['quarantined', 'id_conflict', 'missing_original'])(
    'EVM-108 AC6: a file in "Wymaga uwagi" with the code %s offers "discard" (and keeps "retry" where EVM-130 had it)',
    async (code) => {
      const r = await attention(code);
      const [view] = r.uploads.getSnapshot().files;
      expect(view?.actions).toEqual(code === 'quarantined' ? ['discard'] : ['retry', 'discard']);
    },
  );

  it('EVM-108 AC6: a file that can only be retried ("Wymaga uwagi" with another code, "Ponów" after a checksum error) has no "discard"', async () => {
    expect((await attention('unknown')).uploads.getSnapshot().files[0]?.actions).toEqual(['retry']);
    expect((await attention('checksum_mismatch', 'failed')).uploads.getSnapshot().files[0]?.actions).toEqual(['retry']);
  });

  it('EVM-108 AC6 (security 19): the native file goes FIRST (the job and the original), the row after; nothing of the file stays', async () => {
    const r = await attention('quarantined');
    const order: string[] = [];
    r.native.cancelUpload = (assetId, deleteOriginal) => {
      order.push(`native:${assetId}:${String(deleteOriginal)}`);
      return Promise.resolve(true);
    };
    const original = r.store.media.discard.bind(r.store.media);
    r.store.media.discard = async (assetId) => {
      order.push('row');
      await original(assetId);
    };
    expect(await r.uploads.discard(asset(1))).toBe(true);
    expect(order).toEqual([`native:${asset(1)}:true`, 'row']);
    expect(await r.store.media.list()).toEqual([]);
    expect(r.uploads.getSnapshot().files).toEqual([]);
  });

  it('EVM-108 AC6 (security 19): when the native file cannot be removed (or the module throws) the row STAYS and the answer is false', async () => {
    const r = await attention('quarantined');
    r.native.cancelUpload = () => Promise.resolve(false);
    expect(await r.uploads.discard(asset(1))).toBe(false);
    expect(await states(r)).toEqual(['01:needs_attention']);
    r.native.cancelUpload = () => Promise.reject(new Error('synthetic'));
    expect(await r.uploads.discard(asset(1))).toBe(false);
    expect(await states(r)).toEqual(['01:needs_attention']);
    expect(r.uploads.getSnapshot().files).toHaveLength(1);
  });

  it('EVM-108 AC6: a failing row removal after the native file is gone answers false (the next try finds nothing to remove natively and ends)', async () => {
    const r = await attention('missing_original');
    r.store.media.discard = () => Promise.reject(new Error('synthetic'));
    expect(await r.uploads.discard(asset(1))).toBe(false);
    expect(await states(r)).toEqual(['01:needs_attention']);
  });

  it('EVM-108 AC6: only a file of "Wymaga uwagi" that cannot be retried is discarded - not a waiting one, not one with "Ponów" only, not an unknown id, not without a session', async () => {
    const waiting = await rig();
    hold(waiting, 1);
    await waiting.uploads.add(photo(1));
    const cancelled: string[] = [];
    waiting.native.cancelUpload = (assetId) => {
      cancelled.push(assetId);
      return Promise.resolve(true);
    };
    expect(await waiting.uploads.discard(asset(1))).toBe(false);
    expect(await waiting.uploads.discard(asset(404))).toBe(false);
    const retryable = await attention('unknown');
    retryable.native.cancelUpload = (assetId) => {
      cancelled.push(assetId);
      return Promise.resolve(true);
    };
    expect(await retryable.uploads.discard(asset(1))).toBe(false);
    const failedFile = await attention('checksum_mismatch', 'failed');
    expect(await failedFile.uploads.discard(asset(1))).toBe(false);
    const gone = await attention('quarantined');
    gone.state.signedIn = false;
    expect(await gone.uploads.discard(asset(1))).toBe(false);
    expect(cancelled).toEqual([]);
  });
});

describe('what a file in the view tells (EVM-108 AC6)', () => {
  it('EVM-108 AC6: the category, the type and the time of the capture come from the row; a row without a category has none, an unknown code is "unknown", a video is a video', async () => {
    const r = await rig();
    await r.store.media.register({
      assetId: asset(1),
      mutationId: asset(11),
      workOrderId: WO,
      ownerUserId: USER,
      fileName: asset(1),
      sizeBytes: 10,
      sha256: SHA,
      mime: 'image/jpeg',
      createdAt: 1_700_000_000_000,
      category: 'defect',
    });
    await r.store.media.register({
      assetId: asset(2),
      mutationId: asset(12),
      workOrderId: WO,
      ownerUserId: USER,
      fileName: asset(2),
      sizeBytes: 10,
      sha256: SHA,
      mime: 'video/mp4',
      createdAt: 1_700_000_001_000,
    });
    await r.db.transaction((tx) => tx.run("UPDATE media_files SET category = 'from_the_future' WHERE asset_id = ?", [asset(2)]));
    await r.uploads.refresh();
    expect(r.uploads.getSnapshot().files).toMatchObject([
      { assetId: asset(1), category: 'defect', mediaType: 'photo', capturedAt: 1_700_000_000_000 },
      { assetId: asset(2), category: 'unknown', mediaType: 'video', capturedAt: 1_700_000_001_000 },
    ]);
    // a row that has no category at all (before v3, the hook of the e2e variant)
    await r.db.transaction((tx) => tx.run('UPDATE media_files SET category = NULL WHERE asset_id = ?', [asset(2)]));
    await r.uploads.refresh();
    expect(r.uploads.getSnapshot().files[1]?.category).toBeNull();
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

describe('films that wait for Wi-Fi (EVM-110 AC4, AC5)', () => {
  const video = (n: number) => ({ assetId: asset(n), workOrderId: WO, mediaType: 'video' as const, category: 'defect' as const });
  const waiting = (n: number): UploadStatus => ({
    assetId: asset(n),
    state: 'queued',
    partsDone: 0,
    partCount: 0,
    percent: 0,
    sizeBytes: 1000 + n,
    waitingForWifi: true,
  });

  it('EVM-110 AC4: a film the module says waits for a network without charges is "Czeka na Wi-Fi" - not an error, not "Wymaga uwagi", no action', async () => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(video(1));
    await apply(r, 1);
    r.native.statuses = [waiting(1)];
    await idle(r);
    expect(r.uploads.getSnapshot().files).toMatchObject([
      { assetId: asset(1), mediaType: 'video', status: 'waiting_wifi', percent: null, actions: [] },
    ]);
    expect(await states(r)).toEqual(['01:applied']);
  });

  it('EVM-110 AC5: Wi-Fi taken away in the middle of a part - the last progress ("Wysyła się 37%") does not outlive the stopped job: the row becomes "Czeka na Wi-Fi" at the event of the module, with no move of the user', async () => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(video(1));
    await apply(r, 1);
    r.uploads.start();
    const uploading: UploadStatus = {
      assetId: asset(1),
      state: 'uploading',
      partsDone: 1,
      partCount: 3,
      percent: 37,
      sizeBytes: 1001,
      waitingForWifi: false,
    };
    r.native.statuses = [uploading];
    r.native.emit('onUploadProgress', uploading);
    await idle(r);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'uploading', percent: 37 }]);
    // the engine met the gate of the network before the next part: the job ends, the module reports "queued / waiting_wifi", its status says it waits
    r.native.statuses = [{ ...uploading, state: 'queued', waitingForWifi: true }];
    r.native.emit('onFileState', { assetId: asset(1), state: 'queued', reason: 'waiting_wifi' });
    await idle(r);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ assetId: asset(1), status: 'waiting_wifi', percent: null, actions: [] }]);
    expect(await states(r)).toEqual(['01:applied']);
    // Wi-Fi is back: the module sends again, the new progress is shown
    r.native.emit('onUploadProgress', { ...uploading, partsDone: 2, percent: 67 });
    await idle(r);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ status: 'uploading', percent: 67 }]);
  });

  it('EVM-110 AC4: only a film waits for Wi-Fi - a picture never does, and a film that is sending shows its percentage', async () => {
    const r = await rig();
    hold(r, 1);
    hold(r, 2);
    await r.uploads.add(photo(1));
    await r.uploads.add(video(2));
    await apply(r, 1);
    await apply(r, 2);
    // a status of the module that says so for a picture is not believed (the policy is for films only)
    r.native.statuses = [waiting(1), { ...waiting(2), state: 'uploading', percent: 40, waitingForWifi: false }];
    await idle(r);
    expect(r.uploads.getSnapshot().files).toMatchObject([
      { assetId: asset(1), mediaType: 'photo', status: 'waiting' },
      { assetId: asset(2), mediaType: 'video', status: 'uploading', percent: 40 },
    ]);
  });

  it('EVM-110 AC5: a film that waited over 7 days (the server marked the file without a session failed / abandoned) stays "Czeka na Wi-Fi" and goes as the SAME medium - no "Ponów", no attention, no second row', async () => {
    const r = await rig();
    hold(r, 1);
    await r.uploads.add(video(1));
    await apply(r, 1);
    r.native.statuses = [waiting(1)];
    await idle(r);
    r.native.armed.length = 0;
    await serverState(r, 1, 'failed', 'abandoned');
    await r.uploads.reconcile();
    expect(await states(r)).toEqual(['01:applied']);
    expect(r.uploads.getSnapshot().files).toMatchObject([{ assetId: asset(1), status: 'waiting_wifi', actions: [], code: null }]);
    // the same asset is handed to the module again (it opens a new session for it; JVM test of the engine)
    expect(r.native.armed.map((item) => item.assetId)).toEqual([asset(1)]);
    expect(r.native.calls.filter((call) => call.startsWith('retry:'))).toEqual([]);
    // Wi-Fi comes: the module sends it; the row is the same row and nothing was queued twice
    r.native.statuses = [{ ...waiting(1), state: 'uploading', percent: 10, waitingForWifi: false }];
    await r.uploads.reconcile();
    expect(r.uploads.getSnapshot().files).toMatchObject([{ assetId: asset(1), status: 'uploading', percent: 10 }]);
    expect(r.enqueued).toHaveLength(1);
    expect(await r.store.media.list()).toHaveLength(1);
  });

  it('EVM-110 AC4: the setting is read from the module (on when it fails) and a change is stored by the module and the rows are read again', async () => {
    const r = await rig();
    expect(r.uploads.videoWifiOnly()).toBe(true);
    r.native.getVideoWifiOnly = () => {
      throw new Error('synthetic');
    };
    expect(r.uploads.videoWifiOnly()).toBe(true);
    const seen: boolean[] = [];
    r.native.setVideoWifiOnly = (value) => {
      seen.push(value);
      return Promise.resolve(true);
    };
    r.native.calls.length = 0;
    expect(await r.uploads.setVideoWifiOnly(false)).toBe(true);
    await idle(r);
    expect(seen).toEqual([false]);
    expect(r.native.calls).toContain('uploadStatuses');
    r.native.setVideoWifiOnly = () => Promise.reject(new Error('synthetic'));
    expect(await r.uploads.setVideoWifiOnly(true)).toBe(false);
  });
});
