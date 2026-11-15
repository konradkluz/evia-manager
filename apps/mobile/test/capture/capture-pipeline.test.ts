import { CapturePipeline, type CapturePorts, type CaptureResult } from '../../src/capture/capture-pipeline';
import { BLOCK_BELOW_BYTES } from '../../src/capture/disk-space';
import type { CapturedPhoto } from '../../src/upload/create-media-asset';
import type { AddMediaResult } from '../../src/upload/media-uploads';

const WO = '10000000-0000-4000-8000-000000000001';
const asset = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'd'.repeat(64);
const GB = 1024 ** 3;
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The ports with a log of the calls in order; every one can be made to fail. */
function rig(overrides: Partial<CapturePorts> = {}) {
  const log: string[] = [];
  let counter = 0;
  const added: { photo: CapturedPhoto; digest: { sizeBytes: number; sha256: string } }[] = [];
  const state = { free: (10 * GB) as number | null, camera: 'file:///cache/Camera/x.jpg' as string | null };
  const ports: CapturePorts = {
    takePicture: () => {
      log.push('takePicture');
      return Promise.resolve(state.camera === null ? null : { uri: state.camera });
    },
    native: {
      importOriginal: (assetId, uri) => {
        log.push(`import:${assetId.slice(-2)}:${uri}`);
        return Promise.resolve('ok');
      },
      digestOriginal: (assetId) => {
        log.push(`digest:${assetId.slice(-2)}`);
        return Promise.resolve({ sizeBytes: 4096, sha256: SHA });
      },
      cancelUpload: (assetId, deleteOriginal) => {
        log.push(`cancel:${assetId.slice(-2)}:${String(deleteOriginal)}`);
        return Promise.resolve(true);
      },
    },
    disk: { freeBytes: () => state.free },
    registerAndEnqueue: (photo, digest): Promise<AddMediaResult> => {
      log.push(`register:${photo.assetId.slice(-2)}`);
      added.push({ photo, digest });
      return Promise.resolve({ ok: true });
    },
    now: () => Date.UTC(2026, 10, 15, 8, 0, 0),
    newId: () => asset((counter += 1)),
    ...overrides,
  };
  return { ports, log, added, state, pipeline: () => new CapturePipeline(ports) };
}

const take = (pipeline: CapturePipeline, category: 'defect' | 'other' = 'defect'): Promise<CaptureResult> =>
  pipeline.capture({ workOrderId: WO, category });

describe('the capture pipeline - the order of a durable save (EVM-108 AC1)', () => {
  it('EVM-108 AC1: space, camera, native import, digest, then the ONE registration of the command and the row - in this order', async () => {
    const r = rig();
    const result = await take(r.pipeline());
    expect(result).toEqual({ ok: true, assetId: asset(1), sizeBytes: 4096 });
    expect(r.log).toEqual(['takePicture', 'import:01:file:///cache/Camera/x.jpg', 'digest:01', 'register:01']);
    expect(r.added).toEqual([
      {
        photo: { assetId: asset(1), workOrderId: WO, category: 'defect', capturedAt: '2026-11-15T08:00:00.000Z' },
        digest: { sizeBytes: 4096, sha256: SHA },
      },
    ]);
  });

  it('EVM-108 AC1: the picture is named by a new UUIDv7 for every shot - a series never repeats an asset id', async () => {
    const r = rig();
    const pipeline = r.pipeline();
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const result = await take(pipeline);
      if (result.ok) ids.push(result.assetId);
    }
    expect(new Set(ids).size).toBe(20);
  });

  it('EVM-108 AC1: the source of the picture is exchangeable - a synthetic source (the e2e hook) takes the SAME path of the save', async () => {
    const r = rig({
      takePicture: () => Promise.resolve({ uri: 'file:///cache/Camera/synthetic.jpg' }),
    });
    const result = await take(r.pipeline());
    expect(result.ok).toBe(true);
    expect(r.log).toEqual(['import:01:file:///cache/Camera/synthetic.jpg', 'digest:01', 'register:01']);
  });

  it('EVM-108 AC1: a failed native import leaves nothing - no command, no row, an answer without text', async () => {
    for (const code of ['invalid', 'source_missing', 'io_error', 'wipe_active', 'exists', 'unavailable'] as const) {
      const r = rig();
      r.ports.native.importOriginal = () => Promise.resolve(code);
      expect(await take(r.pipeline())).toEqual({ ok: false, code: 'save_failed' });
      expect(r.log.filter((entry) => entry.startsWith('register'))).toEqual([]);
    }
  });

  it('EVM-108 AC1: a native import that throws is a failed save; a camera that throws or gives nothing is a camera error and nothing is imported', async () => {
    const throwing = rig();
    throwing.ports.native.importOriginal = () => Promise.reject(new Error('synthetic /data/user/0/path'));
    expect(await take(throwing.pipeline())).toEqual({ ok: false, code: 'save_failed' });
    const camera = rig({ takePicture: () => Promise.reject(new Error('synthetic')) });
    expect(await take(camera.pipeline())).toEqual({ ok: false, code: 'camera_failed' });
    const nothing = rig();
    nothing.state.camera = null;
    expect(await take(nothing.pipeline())).toEqual({ ok: false, code: 'camera_failed' });
    expect(nothing.log).toEqual(['takePicture']);
  });

  it('EVM-108 AC1: no digest or an empty file removes the original again and registers nothing', async () => {
    for (const digest of [null, { sizeBytes: 0, sha256: SHA }]) {
      const r = rig();
      r.ports.native.digestOriginal = () => Promise.resolve(digest);
      expect(await take(r.pipeline())).toEqual({ ok: false, code: 'save_failed' });
      expect(r.log).toEqual(['takePicture', 'import:01:file:///cache/Camera/x.jpg', 'cancel:01:true']);
    }
    const throwing = rig();
    throwing.ports.native.digestOriginal = () => Promise.reject(new Error('synthetic'));
    expect(await take(throwing.pipeline())).toEqual({ ok: false, code: 'save_failed' });
    expect(throwing.log.at(-1)).toBe('cancel:01:true');
  });

  it('EVM-108 AC1: a failed registration of the command and the row removes the original - nothing stays that the user was not told about', async () => {
    for (const failure of [
      () => Promise.resolve({ ok: false, code: 'enqueue_failed' } as const),
      () => Promise.reject(new Error('synthetic')),
    ]) {
      const r = rig({ registerAndEnqueue: failure });
      expect(await take(r.pipeline())).toEqual({ ok: false, code: 'save_failed' });
      expect(r.log).toEqual(['takePicture', 'import:01:file:///cache/Camera/x.jpg', 'digest:01', 'cancel:01:true']);
    }
  });

  it('EVM-108 AC1: a removal that itself fails does not change the answer (the sweep of the module takes the file later)', async () => {
    const r = rig({ registerAndEnqueue: () => Promise.resolve({ ok: false, code: 'enqueue_failed' }) });
    r.ports.native.cancelUpload = () => Promise.reject(new Error('synthetic'));
    expect(await take(r.pipeline())).toEqual({ ok: false, code: 'save_failed' });
  });
});

describe('the capture pipeline - space, one shot at a time (EVM-108 AC2, AC4)', () => {
  it('EVM-108 AC4: below the blocking threshold nothing happens - the camera is not asked, nothing is imported or registered', async () => {
    const r = rig();
    r.state.free = BLOCK_BELOW_BYTES - 1;
    expect(await take(r.pipeline())).toEqual({ ok: false, code: 'no_space' });
    expect(r.log).toEqual([]);
  });

  it('EVM-108 AC4: a low (but not blocking) space and an unknown reading still save the picture', async () => {
    const low = rig();
    low.state.free = BLOCK_BELOW_BYTES;
    expect((await take(low.pipeline())).ok).toBe(true);
    const unknown = rig();
    unknown.state.free = null;
    expect((await take(unknown.pipeline())).ok).toBe(true);
  });

  it('EVM-108 AC4: when the native import finds no space the answer is no_space (nothing was written, the source is gone)', async () => {
    const r = rig();
    r.ports.native.importOriginal = () => Promise.resolve('no_space');
    expect(await take(r.pipeline())).toEqual({ ok: false, code: 'no_space' });
    expect(r.log.filter((entry) => entry.startsWith('register') || entry.startsWith('digest'))).toEqual([]);
  });

  it('EVM-108 AC2: only ONE shot is saved at a time - a second one meanwhile is "busy" and takes no picture; "Gotowe" waits for the save in progress', async () => {
    let release: (value: { sizeBytes: number; sha256: string }) => void = () => undefined;
    const r = rig();
    r.ports.native.digestOriginal = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pipeline = r.pipeline();
    const first = take(pipeline);
    await tick();
    expect(pipeline.saving).toBe(true);
    expect(await take(pipeline)).toEqual({ ok: false, code: 'busy' });
    let idle = false;
    void pipeline.whenIdle().then(() => {
      idle = true;
    });
    await tick();
    expect(idle).toBe(false);
    release({ sizeBytes: 10, sha256: SHA });
    expect((await first).ok).toBe(true);
    await pipeline.whenIdle();
    await tick();
    expect(idle).toBe(true);
    expect(pipeline.saving).toBe(false);
    expect(r.log.filter((entry) => entry === 'takePicture')).toHaveLength(1);
  });

  it('EVM-108 AC2: after a failure the next shot is possible - a failed save does not lock the camera', async () => {
    const r = rig();
    const pipeline = r.pipeline();
    r.ports.native.importOriginal = () => Promise.resolve('io_error');
    expect((await take(pipeline)).ok).toBe(false);
    r.ports.native.importOriginal = () => Promise.resolve('ok');
    expect((await take(pipeline)).ok).toBe(true);
    await pipeline.whenIdle();
    expect(pipeline.saving).toBe(false);
  });

  it('EVM-108 AC1: a time of the clock that cannot be written as an ISO instant is a failed save, not an exception', async () => {
    const r = rig({ now: () => Number.NaN });
    expect(await take(r.pipeline())).toEqual({ ok: false, code: 'save_failed' });
    // nothing was imported: the picture waits in the cache of the camera, where the sweep takes it
    expect(r.log).toEqual(['takePicture']);
  });
});
