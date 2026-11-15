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
import type { AddMediaResult, CapturedPhoto, MediaCategory } from '../upload/create-media-asset';
import type { OriginalDigest, ImportResultName } from '../../modules/evia-upload/src';
import { diskLevel, type DiskSpace } from './disk-space';

export type CaptureResult =
  | { readonly ok: true; readonly assetId: string; readonly sizeBytes: number }
  | { readonly ok: false; readonly code: 'no_space' | 'save_failed' | 'camera_failed' | 'busy' };

export interface CapturePorts {
  /** The picture to save: the camera (`takePictureAsync`) or a synthetic file of the e2e hook; `null` = no picture. The URI is a `file://` of the capture cache. */
  takePicture(): Promise<{ readonly uri: string } | null>;
  readonly native: {
    importOriginal(assetId: string, sourceUri: string): Promise<ImportResultName>;
    digestOriginal(assetId: string): Promise<OriginalDigest | null>;
    cancelUpload(assetId: string, deleteOriginal: boolean): Promise<boolean>;
  };
  readonly disk: DiskSpace;
  /** `MediaUploads.addCaptured`: the command and the row of the file in one transaction. */
  registerAndEnqueue(photo: CapturedPhoto, digest: OriginalDigest): Promise<AddMediaResult>;
  now(): number;
  /** A new UUIDv7 (the CSPRNG of the session). */
  newId(): string;
}

export interface CaptureRequest {
  readonly workOrderId: string;
  readonly category: MediaCategory;
}

export class CapturePipeline {
  readonly #ports: CapturePorts;
  #saving: Promise<CaptureResult> | null = null;

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
    const imported = await native.importOriginal(assetId, picture.uri).catch(() => 'io_error' as const);
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
