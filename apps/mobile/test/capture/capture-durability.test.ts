// EVM-108 AC1, AC4, AC7: the pipeline of the capture over the REAL encrypted-database stores (node:sqlite engine) and a scripted native file system.
// "Kill" = the process disappears at a point: the pipeline is abandoned (its promise never resolves, no cleanup runs) and the service is built again
// over the SAME database and the SAME files, like a restart of the app.
import type { EnqueueInput, QueueRecord } from '@evia/sync-core';
import { CapturePipeline, type CapturePorts } from '../../src/capture/capture-pipeline';
import { BLOCK_BELOW_BYTES } from '../../src/capture/disk-space';
import type { UnlockedStore } from '../../src/storage';
import type { Database } from '../../src/storage/database';
import { SqlMediaFileStore } from '../../src/storage/media-file-store';
import { SqlQueueStore } from '../../src/storage/queue-store';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import type { NativeUpload } from '../../src/upload/native-upload';
import { MediaUploads, SWEEP_MIN_AGE_MS } from '../../src/upload/media-uploads';
import { migratedDatabase } from '../storage/harness';
import { newDisk, removeDisk, type TestDisk } from '../storage/node-sqlite-engine';
import type { NodeSqliteEngine } from '../storage/node-sqlite-engine';

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
const SHA = 'e'.repeat(64);
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** `add` and a sweep start reconciles of their own in the background: let them finish (single-flight, one more run when asked meanwhile). */
const settle = async (uploads: MediaUploads): Promise<void> => {
  await uploads.reconcile();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await uploads.reconcile();
};
const NEVER: Promise<never> = new Promise<never>(() => undefined);

/** The files of the phone as the native module keeps them: the cache of the camera and the private folder of the originals — they outlive a "kill". */
class PhoneFiles {
  readonly cache = new Map<string, number>();
  readonly originals = new Map<string, number>();
  /** When each original was made (the clock of the phone); the sweep leaves the young ones alone, like the native one. */
  readonly madeAt = new Map<string, number>();
  clock = 0;
  importResult: 'ok' | 'no_space' | 'io_error' = 'ok';
  digestNull = false;
  readonly sweeps: { keep: readonly string[]; olderThanMs: number }[] = [];
  #shot = 0;

  /** The camera wrote a picture into the cache. */
  shoot(): string {
    this.#shot += 1;
    const uri = `file:///cache/Camera/shot-${String(this.#shot)}.jpg`;
    this.cache.set(uri, 1000 + this.#shot);
    return uri;
  }

  native(): Pick<NativeUpload, 'importOriginal' | 'sweepOriginals' | 'cancelUpload' | 'digestOriginal'> {
    return {
      importOriginal: (assetId, uri) => {
        if (this.importResult !== 'ok') {
          this.cache.delete(uri);
          return Promise.resolve(this.importResult);
        }
        const size = this.cache.get(uri);
        if (size === undefined) return Promise.resolve('source_missing');
        this.originals.set(assetId, size);
        this.madeAt.set(assetId, this.clock);
        this.cache.delete(uri);
        return Promise.resolve('ok');
      },
      digestOriginal: (assetId) => {
        const size = this.originals.get(assetId);
        return Promise.resolve(size === undefined || this.digestNull ? null : { sizeBytes: size, sha256: SHA });
      },
      cancelUpload: (assetId, deleteOriginal) => {
        if (deleteOriginal) this.originals.delete(assetId);
        return Promise.resolve(true);
      },
      sweepOriginals: (keep, olderThanMs) => {
        this.sweeps.push({ keep, olderThanMs });
        let removed = 0;
        for (const assetId of [...this.originals.keys()]) {
          if (!keep.includes(assetId) && this.clock - (this.madeAt.get(assetId) ?? 0) >= olderThanMs) {
            this.originals.delete(assetId);
            removed += 1;
          }
        }
        return Promise.resolve(removed);
      },
    };
  }
}

const noopNative = (phone: PhoneFiles): NativeUpload => {
  const base = phone.native();
  return {
    ...base,
    reconcile: (items) => Promise.resolve(Object.fromEntries(items.map((item) => [item.assetId, 'armed' as const]))),
    retryUpload: () => Promise.resolve('armed'),
    completeUpload: () => Promise.resolve('keep'),
    uploadStatuses: () => Promise.resolve([]),
    wipeUploads: () => Promise.resolve(true),
    notificationPermission: () => 'granted',
    requestNotificationPermission: () => Promise.resolve('granted'),
    openNotificationSettings: () => Promise.resolve(true),
    launchTarget: () => null,
    e2eInjectFile: () => Promise.resolve(null),
    addListener: () => ({ remove: (): void => undefined }),
  };
};

interface World {
  readonly db: Database;
  readonly engine: NodeSqliteEngine;
  readonly queue: SqlQueueStore;
  readonly phone: PhoneFiles;
  readonly store: UnlockedStore;
  readonly enqueued: EnqueueInput[];
  /** Builds the service and the pipeline anew over the same database and files (a restart of the app). */
  boot(wrap?: (ports: CapturePorts) => CapturePorts): { uploads: MediaUploads; pipeline: CapturePipeline };
  state: { free: number | null; session: boolean; enqueueFails: boolean };
}

async function world(): Promise<World> {
  const { db, engine } = await migratedDatabase(disk);
  const queue = new SqlQueueStore(db);
  const replica = new SqlReplicaStore(db);
  const phone = new PhoneFiles();
  const state = { free: (10 * 1024 ** 3) as number | null, session: true, enqueueFails: false };
  const store = {
    userId: USER,
    queue,
    replica,
    media: new SqlMediaFileStore(db, USER),
    identity: { read: () => Promise.resolve({ deviceId: DEVICE, secret: 'secret-synthetic' }), write: () => Promise.resolve() },
    replicaExtras: { readMediaServerStates: (ids: readonly string[]) => replica.readMediaServerStates(ids) },
  } as unknown as UnlockedStore;
  const enqueued: EnqueueInput[] = [];
  let mutation = 0;
  let id = 0;
  let clock = Date.UTC(2026, 10, 15, 8, 0, 0);
  const boot: World['boot'] = (wrap = (ports) => ports) => {
    const uploads = new MediaUploads({
      native: noopNative(phone),
      store: () => (state.session ? store : null),
      enqueue: async (input) => {
        enqueued.push(input);
        if (state.enqueueFails) return { ok: false };
        mutation += 1;
        const payload = input.payload as { id: string; workOrderId: string };
        const record: QueueRecord = {
          mutationId: `0194c2a1-0000-7000-8000-${String(mutation).padStart(12, '0')}`,
          type: MEDIA_COMMAND,
          commandVersion: 1,
          payload,
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
      dataVisible: () => true,
    });
    const ports: CapturePorts = {
      takePicture: () => Promise.resolve({ uri: phone.shoot() }),
      native: phone.native(),
      disk: { freeBytes: () => state.free },
      registerAndEnqueue: (photo, digest) => uploads.addCaptured(photo, digest),
      now: () => (clock += 1000),
      // a UUIDv7-shaped id, unique per shot (the real one is `createUuidV7` of the session)
      newId: () => `0194c2a0-0000-7000-8000-${String((id += 1)).padStart(12, '0')}`,
    };
    return { uploads, pipeline: new CapturePipeline(wrap(ports)) };
  };
  return { db, engine, queue, phone, store, enqueued, boot, state };
}

const rows = (w: World) => w.store.media.list();
const entries = async (w: World): Promise<QueueRecord[]> => (await w.queue.readAll()) as QueueRecord[];
const request = { workOrderId: WO, category: 'defect' as const };

describe('a saved picture is a file, a command and a row together (EVM-108 AC1)', () => {
  it('EVM-108 AC1: file + command + row exist together; the payload has exactly the allowed keys, the id is a UUIDv7, the time an ISO instant', async () => {
    const w = await world();
    const { pipeline } = w.boot();
    const result = await pipeline.capture(request);
    expect(result).toMatchObject({ ok: true, assetId: '0194c2a0-0000-7000-8000-000000000001' });
    expect([...w.phone.originals.keys()]).toEqual(['0194c2a0-0000-7000-8000-000000000001']);
    expect(w.phone.cache.size).toBe(0);
    const [entry] = await entries(w);
    const payload = entry?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['capturedAt', 'category', 'id', 'mediaType', 'workOrderId']);
    expect(payload).toMatchObject({ workOrderId: WO, mediaType: 'photo', category: 'defect' });
    expect(String(payload['id'])).toMatch(UUID_V7);
    expect(new Date(String(payload['capturedAt'])).toISOString()).toBe(payload['capturedAt']);
    expect(await rows(w)).toMatchObject([
      {
        assetId: payload['id'],
        mutationId: entry?.mutationId,
        workOrderId: WO,
        fileName: payload['id'],
        mime: 'image/jpeg',
        category: 'defect',
        state: 'pending',
        sizeBytes: 1001,
        createdAt: Date.parse(String(payload['capturedAt'])),
      },
    ]);
    expect(JSON.stringify(entry)).not.toMatch(/description|procedureStageId|file:|Camera|cache/);
  });

  it('EVM-108 AC1: every point of failure leaves NO file and NO entry (import, digest, the command, the row)', async () => {
    const cases: { name: string; arrange: (w: World) => void }[] = [
      { name: 'import', arrange: (w) => (w.phone.importResult = 'io_error') },
      { name: 'digest', arrange: (w) => (w.phone.digestNull = true) },
      { name: 'enqueue refused', arrange: (w) => (w.state.enqueueFails = true) },
      {
        name: 'command write',
        arrange: (w) => {
          w.engine.failNext((sql) => sql.startsWith('INSERT INTO queue_entries'));
        },
      },
      {
        name: 'row write',
        arrange: (w) => {
          w.engine.failNext((sql) => sql.startsWith('INSERT INTO media_files'));
        },
      },
    ];
    for (const { arrange } of cases) {
      // every case has its own database file
      removeDisk(disk);
      disk = newDisk();
      const w = await world();
      const { pipeline } = w.boot();
      arrange(w);
      expect((await pipeline.capture(request)).ok).toBe(false);
      expect([...w.phone.originals.keys()]).toEqual([]);
      expect(await entries(w)).toEqual([]);
      expect(await rows(w)).toEqual([]);
      // the next picture works: a failure did not poison the registration or the queue
      w.phone.importResult = 'ok';
      w.phone.digestNull = false;
      w.state.enqueueFails = false;
      expect((await pipeline.capture(request)).ok).toBe(true);
      expect(await entries(w)).toHaveLength(1);
      expect(await rows(w)).toHaveLength(1);
    }
  });

  it('EVM-108 AC1: a kill after the import - the file is durable, the entry is not; after the restart the sweep takes the file (nobody was told it was saved)', async () => {
    const w = await world();
    const { pipeline } = w.boot((ports) => ({ ...ports, native: { ...ports.native, digestOriginal: () => NEVER } }));
    void pipeline.capture(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([...w.phone.originals.keys()]).toHaveLength(1);
    expect(await entries(w)).toEqual([]);
    const { uploads } = w.boot();
    // a young file is left alone (a picture of a service that is still saving it) ...
    await settle(uploads);
    expect([...w.phone.originals.keys()]).toHaveLength(1);
    // ... and taken once it is old enough
    w.phone.clock += SWEEP_MIN_AGE_MS;
    await settle(uploads);
    expect(w.phone.sweeps.at(-1)).toEqual({ keep: [], olderThanMs: SWEEP_MIN_AGE_MS });
    expect([...w.phone.originals.keys()]).toEqual([]);
    expect(await rows(w)).toEqual([]);
  });

  it('EVM-108 AC1: a kill after the digest, before the transaction - same: no entry, the sweep takes the file', async () => {
    const w = await world();
    const { pipeline } = w.boot((ports) => ({ ...ports, registerAndEnqueue: () => NEVER }));
    void pipeline.capture(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([...w.phone.originals.keys()]).toHaveLength(1);
    expect(await entries(w)).toEqual([]);
    expect(await rows(w)).toEqual([]);
    w.phone.clock += SWEEP_MIN_AGE_MS;
    await settle(w.boot().uploads);
    expect([...w.phone.originals.keys()]).toEqual([]);
  });

  it('EVM-108 AC1: a kill right after the COMMIT - file, command and row are all there after the restart and the sweep keeps the file', async () => {
    const w = await world();
    const { pipeline } = w.boot((ports) => ({
      ...ports,
      registerAndEnqueue: async (photo, digest) => {
        await ports.registerAndEnqueue(photo, digest);
        return NEVER;
      },
    }));
    void pipeline.capture(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const restarted = w.boot();
    w.phone.clock += SWEEP_MIN_AGE_MS;
    await settle(restarted.uploads);
    expect([...w.phone.originals.keys()]).toHaveLength(1);
    expect(await entries(w)).toHaveLength(1);
    expect(await rows(w)).toMatchObject([{ state: 'pending', category: 'defect' }]);
    expect(w.phone.sweeps.at(-1)?.keep).toEqual([(await rows(w))[0]?.assetId]);
    // the restarted service goes on: a new picture is saved next to the old one
    expect((await restarted.pipeline.capture(request)).ok).toBe(true);
    expect(await rows(w)).toHaveLength(2);
  });

  it('EVM-108 AC1: no session - nothing is written and the file is removed again', async () => {
    const w = await world();
    const { pipeline } = w.boot();
    w.state.session = false;
    expect(await pipeline.capture(request)).toEqual({ ok: false, code: 'save_failed' });
    expect([...w.phone.originals.keys()]).toEqual([]);
    expect(await entries(w)).toEqual([]);
  });

  it('EVM-108 AC1: a command that cannot be built (a category outside the list) is refused before anything is registered', async () => {
    const w = await world();
    const { pipeline } = w.boot();
    expect(await pipeline.capture({ workOrderId: WO, category: 'holiday' as never })).toEqual({ ok: false, code: 'save_failed' });
    expect(w.enqueued).toEqual([]);
    expect([...w.phone.originals.keys()]).toEqual([]);
  });

  it('EVM-108 AC1: a registration that the queue did not use up does not wait for a later command of the same asset (no stale row)', async () => {
    const w = await world();
    const { uploads } = w.boot();
    w.state.enqueueFails = true;
    expect(
      await uploads.addCaptured(
        { assetId: '0194c2a0-0000-7000-8000-000000000042', workOrderId: WO, category: 'other', capturedAt: '2026-11-15T08:00:00.000Z' },
        { sizeBytes: 5, sha256: SHA },
      ),
    ).toEqual({ ok: false, code: 'enqueue_failed' });
    await w.queue.append({
      mutationId: '0194c2a1-0000-7000-8000-000000000099',
      type: MEDIA_COMMAND,
      commandVersion: 1,
      payload: { id: '0194c2a0-0000-7000-8000-000000000042', workOrderId: WO, mediaType: 'photo', category: 'other' },
      objectId: '0194c2a0-0000-7000-8000-000000000042',
      orderingKey: WO,
      createdAt: 1,
      ownerUserId: USER,
      state: 'pending',
      attempts: 0,
    });
    expect(await rows(w)).toEqual([]);
  });

  it('EVM-108 AC1: an enqueue that throws is a failed save and clears the registration too', async () => {
    const w = await world();
    const throwing = new MediaUploads({
      native: noopNative(w.phone),
      store: () => w.store,
      enqueue: () => Promise.reject(new Error('synthetic')),
      now: () => 1,
      dataVisible: () => true,
    });
    const photo = {
      assetId: '0194c2a0-0000-7000-8000-000000000043',
      workOrderId: WO,
      category: 'other' as const,
      capturedAt: '2026-11-15T08:00:00.000Z',
    };
    expect(await throwing.addCaptured(photo, { sizeBytes: 5, sha256: SHA })).toEqual({ ok: false, code: 'enqueue_failed' });
    expect(await throwing.addCaptured({ ...photo, capturedAt: 'later' }, { sizeBytes: 5, sha256: SHA })).toEqual({
      ok: false,
      code: 'invalid',
    });
  });
});

describe('space and a series (EVM-108 AC4, AC7)', () => {
  it('EVM-108 AC4: not enough space - nothing is written, the queue and the rows are untouched', async () => {
    const w = await world();
    const { pipeline } = w.boot();
    w.state.free = BLOCK_BELOW_BYTES - 1;
    expect(await pipeline.capture(request)).toEqual({ ok: false, code: 'no_space' });
    expect(w.phone.cache.size).toBe(0);
    expect([...w.phone.originals.keys()]).toEqual([]);
    expect(await entries(w)).toEqual([]);
    expect(await rows(w)).toEqual([]);
  });

  it('EVM-108 AC4: the native import finds no space - nothing is registered, no partial file, no row', async () => {
    const w = await world();
    const { pipeline } = w.boot();
    w.phone.importResult = 'no_space';
    expect(await pipeline.capture(request)).toEqual({ ok: false, code: 'no_space' });
    expect([...w.phone.originals.keys()]).toEqual([]);
    expect(await entries(w)).toEqual([]);
    expect(await rows(w)).toEqual([]);
    expect(w.enqueued).toEqual([]);
  });

  it('EVM-108 AC7: a shot starts a run of the files WITHOUT the sweep - 5 shots, no sweep; the start or the return to the foreground sweeps once, and a request of a sweep that comes while a run is on is not lost', async () => {
    const w = await world();
    const { pipeline, uploads } = w.boot();
    for (let i = 0; i < 5; i += 1) expect((await pipeline.capture(request)).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(w.phone.sweeps).toEqual([]);
    expect(await rows(w)).toHaveLength(5);
    await uploads.reconcile();
    expect(w.phone.sweeps).toHaveLength(1);
    // a run without the sweep is on, a run with it is asked for meanwhile: it follows
    const quiet = uploads.reconcile({ sweep: false });
    const asked = uploads.reconcile();
    await Promise.all([quiet, asked]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(w.phone.sweeps).toHaveLength(2);
    // and a plain run after a plain run is not asked for again by itself
    await uploads.reconcile({ sweep: false });
    expect(w.phone.sweeps).toHaveLength(2);
  });

  it('EVM-108 AC7: a series of 30 pictures - 30 files, 30 commands, 30 rows, no duplicate asset id - and all of it survives a restart', async () => {
    const w = await world();
    const { pipeline } = w.boot();
    for (let i = 0; i < 30; i += 1)
      expect((await pipeline.capture({ workOrderId: WO, category: i % 2 === 0 ? 'defect' : 'other' })).ok).toBe(true);
    const restarted = w.boot();
    w.phone.clock += SWEEP_MIN_AGE_MS;
    await settle(restarted.uploads);
    const list = await rows(w);
    expect(list).toHaveLength(30);
    expect(new Set(list.map((row) => row.assetId)).size).toBe(30);
    expect(await entries(w)).toHaveLength(30);
    expect(w.phone.originals.size).toBe(30);
    expect(list.every((row) => row.state === 'pending')).toBe(true);
  });
});

describe('the sweep of the module is part of every reconcile (EVM-108 AC1)', () => {
  it("EVM-108 AC1: the list to keep is every row that is not clean; a clean row's file is not kept", async () => {
    const w = await world();
    const { pipeline, uploads } = w.boot();
    for (let i = 0; i < 3; i += 1) await pipeline.capture(request);
    const list = await rows(w);
    await w.store.media.setState(list[0]?.assetId ?? '', 'clean', null, 9);
    await w.store.media.setState(list[1]?.assetId ?? '', 'needs_attention', 'quarantined', 9);
    await settle(uploads);
    expect(w.phone.sweeps.at(-1)).toEqual({ keep: [list[1]?.assetId, list[2]?.assetId], olderThanMs: 600_000 });
  });

  it('EVM-108 AC1: without a session nothing is swept, and a sweep that fails does not stop the reconcile', async () => {
    const w = await world();
    const { uploads } = w.boot();
    w.state.session = false;
    await uploads.reconcile();
    expect(w.phone.sweeps).toEqual([]);
    w.state.session = true;
    const failing = noopNative(w.phone);
    const broken = new MediaUploads({
      native: { ...failing, sweepOriginals: () => Promise.reject(new Error('synthetic')) },
      store: () => w.store,
      enqueue: () => Promise.resolve({ ok: false }),
      now: () => 1,
      dataVisible: () => true,
    });
    await expect(broken.reconcile()).resolves.toBeUndefined();
  });
});
