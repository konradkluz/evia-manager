// EVM-110 AC1, AC2, AC3: the recording of a film over the REAL stores of the encrypted database (node:sqlite engine), the REAL `MediaUploads` and a scripted
// camera and native file system. A film is one file, one command of 5 keys and one row together - or nothing. "Kill" = the process disappears while the
// camera records: the promise of the recording never resolves and nothing is saved.
import type { EnqueueInput, QueueRecord } from '@evia/sync-core';
import type { VideoRecording, VideoResult } from '../../src/capture/capture-pipeline';
import { VIDEO_BLOCK_BELOW_BYTES, VIDEO_STOP_BELOW_BYTES } from '../../src/capture/disk-space';
import type { UnlockedStore } from '../../src/storage';
import type { Database } from '../../src/storage/database';
import { SqlMediaFileStore } from '../../src/storage/media-file-store';
import { SqlQueueStore } from '../../src/storage/queue-store';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import { MediaUploads } from '../../src/upload/media-uploads';
import { migratedDatabase } from '../storage/harness';
import { newDisk, removeDisk, type TestDisk } from '../storage/node-sqlite-engine';
import { MB, PhoneFiles, ScriptedCamera, nativeOf } from './video-harness';

const MEDIA_COMMAND = 'CreateMediaAsset' as unknown as QueueRecord['type'];
const USER = '90000000-0000-4000-8000-0000000000aa';
const DEVICE = '7a000000-0000-4000-8000-000000000001';
const WO = '10000000-0000-4000-8000-000000000001';
const request = { workOrderId: WO, category: 'defect' as const };

let disk: TestDisk;
beforeEach(() => {
  disk = newDisk();
});
afterEach(() => {
  removeDisk(disk);
});

interface World {
  readonly db: Database;
  readonly queue: SqlQueueStore;
  readonly phone: PhoneFiles;
  readonly store: UnlockedStore;
  readonly enqueued: EnqueueInput[];
  readonly state: { free: number | null; session: boolean; enqueueFails: boolean; marker: boolean; markerOps: string[]; user: string };
  /** A new service over the same database and files (a restart of the app); `camera` is the one the pipeline records with. */
  boot(camera?: ScriptedCamera): { uploads: MediaUploads; camera: ScriptedCamera; pipeline: ReturnType<MediaUploads['capturePipeline']> };
}

async function world(): Promise<World> {
  const { db } = await migratedDatabase(disk);
  const queue = new SqlQueueStore(db);
  const replica = new SqlReplicaStore(db);
  const phone = new PhoneFiles();
  const state = {
    free: (10 * 1024 ** 3) as number | null,
    session: true,
    enqueueFails: false,
    marker: false,
    markerOps: [] as string[],
    user: USER,
  };
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
  const boot: World['boot'] = (camera = new ScriptedCamera()) => {
    const uploads = new MediaUploads({
      native: nativeOf(phone),
      // another user signed in after the recording started: the same queue, a different user of the session
      store: () => (state.session ? (state.user === USER ? store : { ...store, userId: state.user }) : null),
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
      now: () => (clock += 1000),
      dataVisible: () => true,
      capture: {
        disk: { freeBytes: () => state.free },
        newId: () => `0194c2a0-0000-7000-8000-${String((id += 1)).padStart(12, '0')}`,
      },
      recordingMarker: {
        set: () => {
          state.marker = true;
          state.markerOps.push('set');
          return Promise.resolve();
        },
        clear: () => {
          state.marker = false;
          state.markerOps.push('clear');
          return Promise.resolve();
        },
        present: () => Promise.resolve(state.marker),
      },
    });
    return { uploads, camera, pipeline: uploads.capturePipeline(() => Promise.resolve(null), camera) };
  };
  return { db, queue, phone, store, enqueued, boot, state };
}

const rows = (w: World) => w.store.media.list();
const entries = async (w: World): Promise<QueueRecord[]> => (await w.queue.readAll()) as QueueRecord[];
const started = (w: World, camera: ScriptedCamera = new ScriptedCamera()) => {
  const booted = w.boot(camera);
  const result = booted.pipeline.startVideo(request);
  if (!result.ok) throw new Error(`not started: ${result.code}`);
  return { ...booted, recording: result.recording };
};
const done = (recording: VideoRecording): Promise<VideoResult> => recording.done;

describe('a recorded film is a file, a command of 5 keys and a row together (EVM-110 AC1)', () => {
  it('EVM-110 AC1: the film is imported as a video, and the file, the command and the row exist together; the length stays in the row and out of the command', async () => {
    const w = await world();
    const { recording, camera } = started(w);
    recording.progress({ duration: 133.4, fileSize: 78 * MB });
    camera.end();
    const result = await done(recording);
    expect(result).toMatchObject({ ok: true, end: 'stopped', durationMs: 133_400 });
    if (!result.ok) throw new Error('not saved');
    expect(w.phone.imports).toEqual([{ assetId: result.assetId, mediaType: 'video' }]);
    expect(w.phone.originals.get(result.assetId)).toBe(78 * MB);
    const [row] = await rows(w);
    expect(row).toMatchObject({
      assetId: result.assetId,
      mime: 'video/mp4',
      sizeBytes: 78 * MB,
      state: 'pending',
      category: 'defect',
      durationMs: 133_400,
    });
    const [entry] = await entries(w);
    expect(Object.keys(entry?.payload as object).sort()).toEqual(['capturedAt', 'category', 'id', 'mediaType', 'workOrderId']);
    expect(entry?.payload).toMatchObject({ mediaType: 'video', category: 'defect', workOrderId: WO });
    expect(JSON.stringify(entry)).not.toMatch(/duration|description|procedureStageId/i);
  });

  it('EVM-110 AC1: the options of the recording are the time limit and the size limit counted at the start - and nothing else', async () => {
    const w = await world();
    w.state.free = 400 * MB;
    const { camera, recording } = started(w);
    expect(camera.options).toEqual([{ maxDuration: 300, maxFileSize: Math.floor(400 * MB - 150 * MB) }]);
    expect(Object.keys(camera.options[0] as object).sort()).toEqual(['maxDuration', 'maxFileSize']);
    camera.end();
    await done(recording);
    const w2 = await world();
    const { camera: roomy } = started(w2);
    expect(roomy.options).toEqual([{ maxDuration: 300, maxFileSize: 500_000_000 }]);
  });

  it.each([
    ['the import fails', 'import_io_error', (w: World) => (w.phone.importResult = 'io_error')],
    ['the digest of the original is empty', 'digest', (w: World) => (w.phone.digestNull = true)],
    ['the command cannot be queued', 'register_enqueue_failed', (w: World) => (w.state.enqueueFails = true)],
  ])(
    'EVM-110 AC1 AC2: when %s there is no row, no command in the queue and no original (a failure leaves nothing behind) and the step is named',
    async (_name, reason, fault) => {
      const w = await world();
      fault(w);
      const { recording, camera } = started(w);
      camera.end();
      expect(await done(recording)).toEqual({ ok: false, code: 'save_failed', reason });
      expect(await rows(w)).toEqual([]);
      expect(await entries(w)).toEqual([]);
      expect([...w.phone.originals.keys()]).toEqual([]);
    },
  );

  it('EVM-110 AC1: a recorder that fails writes nothing and says so; a recorder that gives no file is a failure of the camera', async () => {
    const w = await world();
    const crashing = started(w);
    crashing.camera.crash();
    expect(await done(crashing.recording)).toEqual({ ok: false, code: 'camera_failed', reason: 'record_rejected' });
    const empty = started(w);
    empty.camera.end(null);
    expect(await done(empty.recording)).toEqual({ ok: false, code: 'camera_failed', reason: 'record_empty' });
    expect(await rows(w)).toEqual([]);
    expect(w.phone.imports).toEqual([]);
  });
});

describe('limits and free space (EVM-110 AC2)', () => {
  it('EVM-110 AC2: below 200 MB before the start nothing is started and nothing is written; exactly 200 MB starts', async () => {
    const w = await world();
    w.state.free = VIDEO_BLOCK_BELOW_BYTES - 1;
    const { pipeline, camera } = w.boot();
    expect(pipeline.startVideo(request)).toEqual({ ok: false, code: 'no_space' });
    expect(camera.options).toEqual([]);
    expect(await rows(w)).toEqual([]);
    w.state.free = VIDEO_BLOCK_BELOW_BYTES;
    expect(pipeline.startVideo(request).ok).toBe(true);
  });

  it('EVM-110 AC2: the film that reaches 5 minutes ends by the time limit and is saved normally', async () => {
    const w = await world();
    const { recording, camera } = started(w);
    recording.progress({ duration: 299.5, fileSize: 190 * MB });
    camera.end();
    expect(await done(recording)).toMatchObject({ ok: true, end: 'time_limit', durationMs: 299_500 });
    expect(await rows(w)).toHaveLength(1);
  });

  it('EVM-110 AC2: the film that reaches the safety limit of the size ends by the size and is saved normally', async () => {
    const w = await world();
    const { recording, camera } = started(w);
    recording.progress({ duration: 120, fileSize: 500_000_000 });
    camera.end();
    expect(await done(recording)).toMatchObject({ ok: true, end: 'size_limit' });
  });

  it('EVM-110 AC2: the free space falling below 100 MB during the recording stops it and the film is saved with "no space"', async () => {
    const w = await world();
    const { recording, camera } = started(w);
    recording.progress({ duration: 60, fileSize: 30 * MB });
    expect(camera.stops).toBe(0);
    w.state.free = VIDEO_STOP_BELOW_BYTES - 1;
    recording.progress({ duration: 61, fileSize: 31 * MB });
    expect(camera.stops).toBe(1);
    expect(await done(recording)).toMatchObject({ ok: true, end: 'no_space', durationMs: 61_000 });
    expect(await rows(w)).toHaveLength(1);
  });

  it('EVM-110 AC2: a reading of the free space that fails (unknown, negative, not a number) does not stop a film', async () => {
    const w = await world();
    const { recording, camera } = started(w);
    for (const free of [null, -1, Number.NaN]) {
      w.state.free = free;
      recording.progress({ duration: 5, fileSize: MB });
    }
    expect(camera.stops).toBe(0);
    camera.end();
    expect(await done(recording)).toMatchObject({ ok: true, end: 'stopped' });
  });

  it('EVM-110 AC2: the shutter ends the film as "stopped"; a second stop and a stop after the end change nothing', async () => {
    const w = await world();
    const { recording, camera } = started(w);
    camera.endsOnStop = false;
    recording.stop('user');
    recording.stop('interrupted');
    expect(camera.stops).toBe(2);
    camera.end();
    expect(await done(recording)).toMatchObject({ ok: true, end: 'stopped' });
  });
});

describe('interruptions, a kill and the end of the session (EVM-110 AC3)', () => {
  it('EVM-110 AC3: an interruption saves the valid film like a normal one and says how long it is (2:13)', async () => {
    const w = await world();
    const { recording } = started(w);
    recording.progress({ duration: 133.2, fileSize: 50 * MB });
    recording.stop('interrupted');
    const result = await done(recording);
    expect(result).toMatchObject({ ok: true, end: 'interrupted', durationMs: 133_200 });
    expect(await rows(w)).toHaveLength(1);
  });

  it('EVM-110 AC3: a process killed while recording leaves no row, no command and no original - and the next start says so once', async () => {
    const w = await world();
    const { recording } = started(w);
    recording.progress({ duration: 30, fileSize: 9 * MB });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(w.state.marker).toBe(true);
    // the process dies here: the recording never resolves, nothing else runs; the marker stays on the disk
    const restarted = w.boot();
    expect(await restarted.uploads.consumeInterruptedRecording()).toBe(true);
    // reading does not remove the marker: a screen that goes away before the notice is shown leaves it for the next start
    expect(w.state.marker).toBe(true);
    expect(await restarted.uploads.consumeInterruptedRecording()).toBe(true);
    await restarted.uploads.dismissInterruptedRecording();
    expect(w.state.marker).toBe(false);
    expect(await restarted.uploads.consumeInterruptedRecording()).toBe(false);
    expect(await rows(w)).toEqual([]);
    expect(await entries(w)).toEqual([]);
    expect([...w.phone.originals.keys()]).toEqual([]);
  });

  it('EVM-110 AC3: the marker is set when the recording starts and removed when it ends, saved or not; it is never reported while a recording is running', async () => {
    const w = await world();
    const first = started(w);
    await Promise.resolve();
    expect(w.state.markerOps).toEqual(['set']);
    expect(await first.uploads.consumeInterruptedRecording()).toBe(false);
    expect(w.state.marker).toBe(true);
    first.camera.end();
    await done(first.recording);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(w.state.marker).toBe(false);
    expect(w.state.markerOps).toEqual(['set', 'clear']);
    const failing = started(w);
    failing.camera.crash();
    await done(failing.recording);
    expect(await failing.uploads.consumeInterruptedRecording()).toBe(false);
  });

  it('EVM-110 AC3: the end of the session removes a marker a killed recording left - the next user does not see a notice that is not theirs', async () => {
    const w = await world();
    w.state.marker = true;
    const { uploads } = w.boot();
    await uploads.stopRecording();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(w.state.marker).toBe(false);
    expect(await uploads.consumeInterruptedRecording()).toBe(false);
    // the same when a recording is running: the marker goes with the stop
    const running = started(w);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(w.state.marker).toBe(true);
    await running.uploads.stopRecording();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(w.state.marker).toBe(false);
  });

  it('EVM-110 AC3 SEC-110-12: the sign-out stops the recording and waits for its save BEFORE it returns', async () => {
    const w = await world();
    const { recording, uploads } = started(w);
    recording.progress({ duration: 20, fileSize: 6 * MB });
    await uploads.stopRecording();
    expect(await rows(w)).toHaveLength(1);
    expect(await done(recording)).toMatchObject({ ok: true, end: 'interrupted' });
  });

  it('EVM-110 AC3 SEC-110-12: a recorder that does not end is not waited for longer than the limit; with no recording the call is immediate', async () => {
    const w = await world();
    const { uploads } = w.boot();
    await uploads.stopRecording(1);
    const stuck = started(w);
    stuck.camera.endsOnStop = false;
    const before = Date.now();
    await stuck.uploads.stopRecording(30);
    expect(Date.now() - before).toBeLessThan(1000);
    expect(stuck.camera.stops).toBe(1);
    expect(await rows(w)).toEqual([]);
  });

  it('EVM-110 AC3 SEC-110-12: a film that finishes AFTER the session ended is not imported - no original, no row, no command', async () => {
    const w = await world();
    const { recording, camera } = started(w);
    w.state.session = false;
    camera.end();
    expect(await done(recording)).toEqual({ ok: false, code: 'no_session', reason: 'session_changed' });
    expect(w.phone.imports).toEqual([]);
    expect(await rows(w)).toEqual([]);
    expect(await entries(w)).toEqual([]);
    expect(w.enqueued).toEqual([]);
  });

  it('EVM-110 AC3 SEC-110-12: a film that finishes after ANOTHER user signed in is not imported - it never reaches the queue of somebody else', async () => {
    const w = await world();
    const { recording, camera } = started(w);
    // the stop took longer than the next sign-in: the session now belongs to somebody else
    w.state.user = '90000000-0000-4000-8000-0000000000bb';
    camera.end();
    expect(await done(recording)).toEqual({ ok: false, code: 'no_session', reason: 'session_changed' });
    expect(w.phone.imports).toEqual([]);
    expect(await rows(w)).toEqual([]);
    expect(await entries(w)).toEqual([]);
    expect(w.enqueued).toEqual([]);
  });

  it('EVM-110 AC3 SEC-110-12: no recording starts without a session', async () => {
    const w = await world();
    w.state.session = false;
    const { pipeline, camera } = w.boot();
    expect(pipeline.startVideo(request)).toEqual({ ok: false, code: 'no_session' });
    expect(camera.options).toEqual([]);
  });

  it('EVM-110 AC1: one recording at a time - a second start and a picture meanwhile answer "busy" and change nothing', async () => {
    const w = await world();
    const { pipeline, recording, camera } = started(w);
    expect(pipeline.startVideo(request)).toEqual({ ok: false, code: 'busy' });
    expect(await pipeline.capture(request)).toEqual({ ok: false, code: 'busy' });
    expect(pipeline.saving).toBe(true);
    camera.end();
    await done(recording);
    await pipeline.whenIdle();
    expect(pipeline.saving).toBe(false);
    expect(pipeline.startVideo(request).ok).toBe(true);
  });

  it('EVM-110 AC1: a pipeline without the video source cannot record', async () => {
    const w = await world();
    const { uploads } = w.boot();
    expect(uploads.capturePipeline(() => Promise.resolve(null)).startVideo(request)).toEqual({ ok: false, code: 'camera_failed' });
  });
});
