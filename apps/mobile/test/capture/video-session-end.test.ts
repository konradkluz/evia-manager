// EVM-110 AC3, SEC-110-12: the end of the session while a film is recorded - with the REAL owner of the session, the REAL `SyncHost`, the REAL `MediaUploads` and the
// REAL stores of the encrypted database. Only the camera, the files of the phone and the service of the synchronization behind the host are scripted. The film is stopped
// and SAVED first (the save writes to the queue of the synchronization, so it must happen before the host stops it), then the session ends and the cleaning runs.
import type { QueueRecord } from '@evia/sync-core';
import { MobileSessionOwner } from '../../src/auth/session-owner';
import { SyncHost } from '../../src/sync/sync-host';
import type { SyncService } from '../../src/sync/sync-service';
import type { UnlockedStore } from '../../src/storage';
import { SqlMediaFileStore } from '../../src/storage/media-file-store';
import { SqlQueueStore } from '../../src/storage/queue-store';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import { MediaUploads } from '../../src/upload/media-uploads';
import { newPhone, signedIn, type Phone } from '../auth/fakes';
import { migratedDatabase } from '../storage/harness';
import { newDisk, removeDisk, type TestDisk } from '../storage/node-sqlite-engine';
import { MB, PhoneFiles, ScriptedCamera, nativeOf } from './video-harness';

const MEDIA_COMMAND = 'CreateMediaAsset' as unknown as QueueRecord['type'];
const WO = '10000000-0000-4000-8000-000000000001';
const request = { workOrderId: WO, category: 'defect' as const };

let disk: TestDisk;
beforeEach(() => {
  disk = newDisk();
});
afterEach(() => {
  removeDisk(disk);
});

async function world() {
  const { db } = await migratedDatabase(disk);
  const authPhone: Phone = newPhone();
  const rig = await signedIn(authPhone);
  const owner: MobileSessionOwner = rig.owner;
  const userId = owner.syncStore()?.userId ?? '';
  const queue = new SqlQueueStore(db);
  const replica = new SqlReplicaStore(db);
  const media = new SqlMediaFileStore(db, userId);
  const store = {
    userId,
    queue,
    replica,
    media,
    identity: { read: () => Promise.resolve({ deviceId: 'd', secret: 's' }), write: () => Promise.resolve() },
    replicaExtras: { readMediaServerStates: (ids: readonly string[]) => replica.readMediaServerStates(ids) },
  } as unknown as UnlockedStore;
  const events: string[] = [];
  let mutation = 0;
  // the REAL host over a scripted service: `enqueue` writes the command to the real queue, like the service does
  const host = new SyncHost(
    () =>
      ({
        subscribe: () => () => undefined,
        dispose: () => undefined,
        start: () => Promise.resolve(),
        setOnline: () => undefined,
        trigger: () => undefined,
        getSnapshot: () => ({}),
        enqueue: async (input: { payload: unknown }) => {
          events.push('enqueue');
          mutation += 1;
          const payload = input.payload as { id: string; workOrderId: string };
          const record: QueueRecord = {
            mutationId: `0194c2a1-0000-7000-8000-${String(mutation).padStart(12, '0')}`,
            type: MEDIA_COMMAND,
            commandVersion: 1,
            payload,
            objectId: payload.id,
            orderingKey: payload.workOrderId,
            createdAt: 1,
            ownerUserId: userId,
            state: 'pending',
            attempts: 0,
          };
          await queue.append(record);
          return { ok: true, mutationId: record.mutationId };
        },
      }) as unknown as SyncService,
  );
  host.start({} as never);
  const phone = new PhoneFiles();
  let clock = Date.UTC(2026, 10, 15, 8, 0, 0);
  let id = 0;
  const uploads = new MediaUploads({
    native: nativeOf(phone),
    // the store exists only while the owner has the session (like `owner.syncStore()` in the composition)
    store: () => (owner.syncStore() === null ? null : store),
    enqueue: (input) => host.enqueue(input),
    now: () => (clock += 1000),
    dataVisible: () => true,
    capture: { disk: { freeBytes: () => 10 * 1024 ** 3 }, newId: () => `0194c2a0-0000-7000-8000-${String((id += 1)).padStart(12, '0')}` },
  });
  // the composition of `session.ts`: the stop of the recording is a task that must finish, the host is stopped by the plain listener
  owner.onBeforeSessionEnd(() => {
    events.push('host.stop');
    host.stop();
  });
  owner.onBeforeSessionEndAsync(async () => {
    events.push('recording.stop');
    await uploads.stopRecording();
    events.push('recording.stopped');
  });
  const camera = new ScriptedCamera();
  const pipeline = uploads.capturePipeline(() => Promise.resolve(null), camera);
  const result = pipeline.startVideo(request);
  if (!result.ok) throw new Error(`not started: ${result.code}`);
  result.recording.progress({ duration: 44, fileSize: 12 * MB });
  return { db, rig, owner, authPhone, phone, camera, recording: result.recording, queue, media, events, host };
}

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

/** The film is in the queue: a row, a command, an original - written BEFORE the synchronization was stopped and the session ended. */
async function expectSaved(w: Awaited<ReturnType<typeof world>>): Promise<void> {
  expect(await w.media.list()).toHaveLength(1);
  expect(await w.queue.readAll()).toHaveLength(1);
  expect([...w.phone.originals.keys()]).toHaveLength(1);
  expect(w.phone.imports).toHaveLength(1);
}

describe('the end of the session while a film is recorded (EVM-110 AC3; SEC-110-12)', () => {
  it('EVM-110 AC3: the sign-out stops the recording and SAVES the film (file, command, row) before the synchronization is stopped and the session ends', async () => {
    const w = await world();
    await w.owner.signOut({ online: false });
    await settle();
    await expectSaved(w);
    expect(w.camera.stops).toBeGreaterThanOrEqual(1);
    expect(await w.recording.done).toMatchObject({ ok: true, end: 'interrupted', durationMs: 44_000 });
    // the ORDER: the film is saved (enqueue) before the host stops the synchronization and before the cleaning of the capture cache
    expect(w.events).toEqual(['recording.stop', 'enqueue', 'recording.stopped', 'host.stop']);
    expect(w.authPhone.native.cacheCalls).toBe(1);
    expect(w.owner.syncStore()).toBeNull();
  });

  it('EVM-110 AC3: a session that is revoked (session_revoked) in the middle of a recording does the same - the film is saved first', async () => {
    const w = await world();
    w.authPhone.native.accessScript.push({ status: 'blocked', state: 'paused_revoked' });
    await w.rig.owner.refresh();
    await settle();
    await expectSaved(w);
    expect(w.events).toEqual(['recording.stop', 'enqueue', 'recording.stopped', 'host.stop']);
  });

  it('EVM-110 AC3: "Wyczyść dane firmowe" stops the recording and saves the film, and THEN everything is cleaned - no file in the cache of the camera and none in the originals', async () => {
    const w = await world();
    // the cleaning of the module (the first step of the wipe): what it finds is judged at the moment it runs
    const found: { originals: number; film: number } = { originals: -1, film: -1 };
    const wipe = (): void => {
      found.originals = w.phone.originals.size;
      found.film = w.phone.imports.length;
      w.phone.originals.clear();
      w.phone.cache.clear();
    };
    await w.owner.endSessionForWipe({ online: false });
    expect(w.events).toEqual(['recording.stop', 'enqueue', 'recording.stopped', 'host.stop']);
    wipe();
    // at the start of the cleaning the film was already saved (the recording was stopped first); after it nothing is left
    expect(found).toEqual({ originals: 1, film: 1 });
    expect(w.phone.originals.size).toBe(0);
    expect(w.phone.cache.size).toBe(0);
    expect(w.camera.stops).toBeGreaterThanOrEqual(1);
  });

  it('EVM-110 AC3 SEC-110-12: a recording that does not stop in 3 seconds is not waited for - the session ends, and the film that finishes LATER is not imported and leaves nothing', async () => {
    const w = await world();
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    try {
      w.camera.endsOnStop = false;
      const ended = w.owner.signOut({ online: false });
      await jest.advanceTimersByTimeAsync(2900);
      expect(w.owner.syncStore()).not.toBeNull();
      await jest.advanceTimersByTimeAsync(300);
      await ended;
      expect(w.owner.syncStore()).toBeNull();
      expect(w.authPhone.native.cacheCalls).toBe(1);
      // the library ends the file now - after the end of the session
      jest.useRealTimers();
      w.camera.end();
      expect(await w.recording.done).toEqual({ ok: false, code: 'no_session', reason: 'session_changed' });
      expect(w.phone.imports).toEqual([]);
      expect([...w.phone.originals.keys()]).toEqual([]);
      expect(await w.media.list()).toEqual([]);
      expect(await w.queue.readAll()).toEqual([]);
      expect(w.events).not.toContain('enqueue');
    } finally {
      jest.useRealTimers();
    }
  });
});
