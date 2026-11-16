/**
 * The durable save of a picture (EVM-108 AC1, AC4; offline-sync.md; media-pipeline.md §1) — pure logic on ports, no screen, no native call of its own.
 * Order (the technician is told "saved" only after the last step, so a kill before it loses a picture nobody confirmed):
 * 1. free space — below the blocking threshold nothing is asked of the camera and nothing is written (`no_space`);
 * 2. the picture of the source (the camera, or the synthetic file of the e2e hook — the SAME path after this point);
 * 3. the native import: checked, copied with `fsync` into the private folder of the originals, the source removed (`importOriginal`);
 * 4. the digest of the original (size, SHA-256; computed natively as a stream);
 * 5. ONE registration of the command `CreateMediaAsset` and the row of the file (one transaction of the encrypted database).
 * A failure at any step after 3 removes the original again (`cancelUpload(assetId, true)`): there is no file without an entry and no entry
 * without a file (a kill in the window leaves a file the sweep of the module removes). One shot at a time (the next waits for "Gotowe" or is `busy`).
 * The answer is typed and carries no text, no path and no identifier of the user.
 */
import type { AddMediaResult, CapturedPhoto, CapturedVideo, MediaCategory } from '../upload/create-media-asset';
import type { OriginalDigest, ImportResultName } from '../../modules/evia-upload/src';
import { diskLevel, videoDiskLevel, videoSizeLimit, type DiskSpace } from './disk-space';
import { VideoRecording, type VideoEnd, type VideoResult, type VideoSource } from './video-recording';

export type { VideoEnd, VideoResult, VideoSource } from './video-recording';
export { VideoRecording } from './video-recording';

export type CaptureResult =
  | { readonly ok: true; readonly assetId: string; readonly sizeBytes: number }
  | { readonly ok: false; readonly code: 'no_space' | 'save_failed' | 'camera_failed' | 'busy' };

export interface CapturePorts {
  /** The picture to save: the camera (`takePictureAsync`) or a synthetic file of the e2e hook; `null` = no picture. The URI is a `file://` of the capture cache. */
  takePicture(): Promise<{ readonly uri: string } | null>;
  readonly native: {
    importOriginal(assetId: string, sourceUri: string, mediaType: 'photo' | 'video'): Promise<ImportResultName>;
    digestOriginal(assetId: string): Promise<OriginalDigest | null>;
    cancelUpload(assetId: string, deleteOriginal: boolean): Promise<boolean>;
  };
  readonly disk: DiskSpace;
  /** `MediaUploads.addCaptured`: the command and the row of the file in one transaction. */
  registerAndEnqueue(photo: CapturedPhoto, digest: OriginalDigest): Promise<AddMediaResult>;
  now(): number;
  /** EVM-110: the camera in the video mode (`recordAsync` / `stopRecording` of the view); without it a film cannot be recorded (`camera_failed`). */
  readonly video?: VideoSource;
  /** EVM-110: the registration of a film (`MediaUploads.addCapturedVideo`): the command with 5 keys and the row of the file in one transaction. */
  registerVideo?(video: CapturedVideo, digest: OriginalDigest): Promise<AddMediaResult>;
  /**
   * EVM-110 (SEC-110-12): the user of the session now, `null` without one. The user is noted when the recording starts and compared when the file is saved: a
   * recording that finishes after the session ended - or after another user signed in - is NOT imported (a film never reaches the queue of somebody else).
   */
  sessionUser?(): string | null;
  /** EVM-110: a film could not be started or saved - the CODE of the step (never a path or a message); the e2e variant keeps it for the tool, a release build ignores it. */
  onFailure?(reason: string): void;
  /** EVM-110: the recording in progress (or `null` when it is over); the session owner stops it before a sign-out or a wipe. */
  onRecording?(recording: VideoRecording | null): void;
  /** A new UUIDv7 (the CSPRNG of the session). */
  newId(): string;
}

export interface CaptureRequest {
  readonly workOrderId: string;
  readonly category: MediaCategory;
}

export class CapturePipeline {
  readonly #ports: CapturePorts;
  #saving: Promise<unknown> | null = null;

  constructor(ports: CapturePorts) {
    this.#ports = ports;
  }

  /** `true` while a picture is being saved. */
  get saving(): boolean {
    return this.#saving !== null;
  }

  /** Resolves when no save is in progress ("Gotowe" waits for it). */
  async whenIdle(): Promise<void> {
    while (this.#saving !== null) await this.#saving.catch(() => undefined);
  }

  /**
   * EVM-110 AC1-AC3: starts a recording of a film. The free space is read first (below 200 MB nothing is started and nothing is written); the limits are
   * the constant time and the size counted now. The returned handle takes the progress of the view and the stop; `done` resolves with the saved film
   * or the reason it was not saved - in the same order of steps as a picture (import, digest, ONE transaction; any failure removes the original again).
   * One recording or picture at a time: a second request answers `busy`.
   */
  startVideo(
    request: CaptureRequest,
  ):
    | { readonly ok: true; readonly recording: VideoRecording }
    | { readonly ok: false; readonly code: 'no_space' | 'camera_failed' | 'busy' | 'no_session' } {
    const { disk, video } = this.#ports;
    if (this.#saving !== null) return { ok: false, code: 'busy' };
    if (video === undefined || this.#ports.registerVideo === undefined) return { ok: false, code: 'camera_failed' };
    const user = this.#ports.sessionUser === undefined ? null : this.#ports.sessionUser();
    if (this.#ports.sessionUser !== undefined && user === null) return { ok: false, code: 'no_session' };
    const free = disk.freeBytes();
    if (videoDiskLevel(free) === 'blocked') {
      this.#ports.onFailure?.('start_no_space');
      return { ok: false, code: 'no_space' };
    }
    const recording = new VideoRecording({
      source: video,
      disk,
      now: () => this.#ports.now(),
      maxFileSize: videoSizeLimit(free),
      save: (uri, end, durationMs, startedAt) => this.#saveVideo(request, user, startedAt, uri, end, durationMs),
    });
    const finished = recording.done
      .then((result) => {
        if (!result.ok && result.code !== 'busy' && result.code !== 'no_session') this.#ports.onFailure?.(result.reason ?? result.code);
        return result;
      })
      .finally(() => {
        this.#saving = null;
        this.#ports.onRecording?.(null);
      });
    this.#saving = finished;
    this.#ports.onRecording?.(recording);
    return { ok: true, recording };
  }

  async #saveVideo(
    request: CaptureRequest,
    user: string | null,
    startedAt: number,
    uri: string,
    end: VideoEnd,
    durationMs: number,
  ): Promise<VideoResult> {
    const { native } = this.#ports;
    // SEC-110-12: the session ended while the film was recorded (sign-out, wipe): the file is not imported, the cleaning of the cache takes it
    if (this.#ports.sessionUser !== undefined && this.#ports.sessionUser() !== user)
      return { ok: false, code: 'no_session', reason: 'session_changed' };
    if (!Number.isFinite(startedAt)) return { ok: false, code: 'save_failed', reason: 'bad_time' };
    const capturedAt = new Date(startedAt).toISOString();
    const assetId = this.#ports.newId();
    const imported = await native.importOriginal(assetId, uri, 'video').catch(() => 'io_error' as const);
    if (imported === 'no_space') return { ok: false, code: 'no_space', reason: 'import_no_space' };
    if (imported !== 'ok') return { ok: false, code: 'save_failed', reason: `import_${imported}` };
    const digest = await native.digestOriginal(assetId).catch(() => null);
    if (digest === null || digest.sizeBytes <= 0) return this.#undoVideo(assetId, 'digest');
    const ports = this.#ports;
    const added = await (
      ports.registerVideo === undefined
        ? Promise.resolve({ ok: false } as const)
        : ports.registerVideo({ assetId, workOrderId: request.workOrderId, category: request.category, capturedAt, durationMs }, digest)
    ).catch(() => ({ ok: false }) as const);
    if (!added.ok) return this.#undoVideo(assetId, `register_${'code' in added ? added.code : 'failed'}`);
    return { ok: true, assetId, sizeBytes: digest.sizeBytes, durationMs, end };
  }

  async #undoVideo(assetId: string, reason: string): Promise<VideoResult> {
    await this.#ports.native.cancelUpload(assetId, true).catch(() => false);
    return { ok: false, code: 'save_failed', reason };
  }

  /** Takes one picture and saves it durably; never throws. A second call while a save is in progress answers `busy` and takes no picture. */
  capture(request: CaptureRequest): Promise<CaptureResult> {
    if (this.#saving !== null) return Promise.resolve({ ok: false, code: 'busy' });
    const run = this.#run(request).finally(() => {
      this.#saving = null;
    });
    this.#saving = run;
    return run;
  }

  async #run(request: CaptureRequest): Promise<CaptureResult> {
    const { disk, native } = this.#ports;
    if (diskLevel(disk.freeBytes()) === 'blocked') return { ok: false, code: 'no_space' };
    const picture = await this.#ports.takePicture().catch(() => null);
    if (picture === null) return { ok: false, code: 'camera_failed' };
    const capturedAt = this.#instant();
    if (capturedAt === null) return { ok: false, code: 'save_failed' };
    const assetId = this.#ports.newId();
    const imported = await native.importOriginal(assetId, picture.uri, 'photo').catch(() => 'io_error' as const);
    if (imported === 'no_space') return { ok: false, code: 'no_space' };
    if (imported !== 'ok') return { ok: false, code: 'save_failed' };
    const digest = await native.digestOriginal(assetId).catch(() => null);
    if (digest === null || digest.sizeBytes <= 0) return this.#undo(assetId);
    const added = await this.#ports
      .registerAndEnqueue({ assetId, workOrderId: request.workOrderId, category: request.category, capturedAt }, digest)
      .catch(() => ({ ok: false }) as const);
    if (!added.ok) return this.#undo(assetId);
    return { ok: true, assetId, sizeBytes: digest.sizeBytes };
  }

  #instant(): string | null {
    const time = this.#ports.now();
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }

  /** The original is removed again; when even that fails, the sweep of the module takes the file (nobody was told it was saved). */
  async #undo(assetId: string): Promise<CaptureResult> {
    await this.#ports.native.cancelUpload(assetId, true).catch(() => false);
    return { ok: false, code: 'save_failed' };
  }
}
