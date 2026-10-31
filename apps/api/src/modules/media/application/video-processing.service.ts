/**
 * The processing of films - the worker's job (EVM-046 AC2, AC4, AC5; ADR-0009, ADR-0010; SR-FILE-03, SR-FILE-04, SR-FILE-06, SR-FILE-08; P3). The sibling
 * of {@link MediaProcessingService} (photos) with its own loop:
 * - the TABLE is the queue: `clean` films and `processing` ones nobody has touched for {@link STALE_VIDEO_PROCESSING_MS}, oldest first;
 * - the concurrency is ONE and it holds in the DATABASE: the take of a film ({@link claimVideoForProcessing}) refuses while another film is `processing` with
 *   a fresh claim, so a second replica of the worker cannot start a second transcoding (the in-process pass guard is an addition). Photos have their own loop
 *   and are never held back by a film;
 * - before a film is taken the work area is asked for room (the original + its preview + a reserve). No room is no fault of the file: it is left as it is,
 *   no attempt is used, and a counter without labels goes up (an alert on the disk is the operator's signal);
 * - the original is read pinned (`VersionId`, `If-Match`) through its SHA-256 and size, which are compared with the ones the scan recorded BEFORE the
 *   processor opens it - a stream, never the whole film in memory;
 * - the STRUCTURAL check (ffprobe) comes first. A film the check refuses (`unsupported`, `too_long`: not an MP4/MOV of H.264/H.265, longer than 30 min, ...)
 *   is `quarantined` with `type_mismatch` - in ONE transaction with the audit event, the e-mail to the Administrators and the alert (the first entry only;
 *   the clock of the retention is the FIRST `quarantined_at`) - and the new scan of EVM-049 can bring it back (`quarantined -> scanning -> clean -> processing`).
 *   The duration is recorded in its own short transaction after the check: from then on the original may be released (`isVideoOriginalReleasable`);
 * - then the transcoding. A failure of it is the failure of the PROCESSING, not of the file: `failed` / `processing_error` (a timeout at once, a crash twice);
 * - the preview is streamed from the work area to the storage (`putObjectStreamIfAbsent`), the frame is small; `processing -> ready` and the rows of both
 *   derivatives are ONE transaction. The directory of the job is removed on every path.
 * Errors: a fixed code and identifiers in the log, never a message of a tool, a path or an address (SR-ERR-01, SR-LOG-02).
 */
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { VideoProcessingError, type VideoDerivatives, type VideoProcessor } from '../../../platform/media-processing/video-processor.ts';
import { ObjectStorageError, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import {
  DERIVATIVE_CACHE_CONTROL,
  MAX_VIDEO_PROCESSING_ATTEMPTS,
  STALE_VIDEO_PROCESSING_MS,
  VIDEO_PROCESSING_WARNING_MS,
  derivativeContentType,
  derivativeKey,
  isPermanentVideo,
} from '../domain/derivatives.ts';
import { normalizeContentType } from '../domain/file-rules.ts';
import { isAcceptableDuration, wholeSeconds } from '../domain/video-rules.ts';
import {
  claimVideoForProcessing,
  countUnprocessedStuck,
  findUnprocessed,
  insertDerivatives,
  recordDuration,
  recordedSize,
  releaseProcessingAttempt,
  transitionFile,
  type NewDerivative,
  type StoredFileRow,
} from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { publishMediaEvent, raiseQuarantineAlert } from './quarantine-alert.ts';

const BATCH = 3;
export const VIDEO_WORKAREA_FULL_METRIC = 'media_video_workarea_full_total';

/** The object read from the storage is not the one the scan recorded (another checksum or size): permanent, never processed. */
class OriginalChangedError extends Error {}
/** The scan left no usable type, key or size: nothing to ask the processor. */
class NotProcessableError extends Error {}
/** The structural check refused the film: it is not what its type says (quarantine, not a failure). */
class NotAFilmError extends Error {}

export interface VideoProcessingDependencies {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly events: EventBus;
  readonly logger: Logger;
  readonly storage: ObjectStorage | null;
  readonly processor: VideoProcessor | null;
  /** The identifiers of the active Administrators (the facade of `identity`; the recipients of the alert of a quarantine). */
  readonly administrators: (tx: Kysely<Database>) => Promise<string[]>;
  /** For the counter of a full work area (no labels, no identifiers). Optional: the loop works without it. */
  readonly metrics?: MetricsRegistry;
  /** The identifier of the directory of a try (tests only; the default is a random UUID). */
  readonly newJobId?: () => string;
}

export type VideoProcessingOutcome = 'ready' | 'failed' | 'quarantined' | 'retry' | 'deferred' | 'skipped';

export class VideoProcessingService {
  readonly #deps: VideoProcessingDependencies;
  readonly #roomShortage: Counter | undefined;
  #running = false;
  #pass: Promise<number> | undefined;

  constructor(deps: VideoProcessingDependencies) {
    this.#deps = deps;
    this.#roomShortage = deps.metrics?.counter(VIDEO_WORKAREA_FULL_METRIC, []);
  }

  /** Both the storage and the processor of films are configured; without them nothing is processed and the films stay `clean`. */
  get enabled(): boolean {
    return this.#deps.storage !== null && this.#deps.processor !== null;
  }

  /** Removes what a crash left in the work area of films (they may show a private site - P3). Call before the first pass. */
  async cleanWorkArea(): Promise<void> {
    await this.#deps.processor?.cleanup();
  }

  /** Starts the loop; @returns the function that stops it - its promise settles once the pass in progress has finished. */
  start(intervalMs = 10_000): () => Promise<void> {
    const timer = setInterval(() => {
      this.runOnce().catch(() => {
        this.#deps.logger.error({ job: 'media.process.video' }, 'media: video processing pass failed');
      });
    }, intervalMs);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await this.#pass?.catch(() => undefined);
    };
  }

  /** One pass: at most {@link BATCH} films, one after another. @returns how many reached `ready`, `failed` or `quarantined` */
  runOnce(): Promise<number> {
    if (!this.enabled || this.#running) return Promise.resolve(0);
    this.#running = true;
    const pass = this.#processWaiting();
    this.#pass = pass;
    return pass.finally(() => {
      this.#running = false;
    });
  }

  async #processWaiting(): Promise<number> {
    const { db, clock, logger } = this.#deps;
    const now = clock.now();
    const waiting = await findUnprocessed(mediaTables(db), new Date(now.getTime() - STALE_VIDEO_PROCESSING_MS), BATCH, 'video');
    let decided = 0;
    for (const item of waiting) {
      // a take that never finished and used the last attempt: no more tries (a crash of the worker or the processor)
      if (item.state === 'processing' && item.attempts >= MAX_VIDEO_PROCESSING_ATTEMPTS) {
        if (await this.#fail(item.id)) decided += 1;
        continue;
      }
      const outcome = await this.processFile(item.id);
      if (outcome === 'ready' || outcome === 'failed' || outcome === 'quarantined') decided += 1;
      // no room or no processor: the next film would only meet the same; the next pass asks again
      if (outcome === 'deferred') break;
    }
    const stuck = await countUnprocessedStuck(mediaTables(db), new Date(now.getTime() - VIDEO_PROCESSING_WARNING_MS), 'video');
    if (stuck > 0) logger.warn({ job: 'media.process.video', stuck }, 'media: films wait for their previews for over 2 hours');
    return decided;
  }

  /** @returns what happened to the file; `deferred`: no room in the work area or the processor was unreachable (no attempt used); `skipped`: taken by someone else */
  async processFile(storedFileId: string): Promise<VideoProcessingOutcome> {
    const { db, clock, logger, storage, processor } = this.#deps;
    if (storage === null || processor === null) return 'skipped';

    const size = await recordedSize(mediaTables(db), storedFileId);
    if (size === undefined) return 'skipped';
    if (!(await processor.hasRoomFor(size))) {
      this.#roomShortage?.increment({});
      logger.warn({ job: 'media.process.video', storedFileId }, 'media: the work area of films has no room; the film waits');
      return 'deferred';
    }

    const now = clock.now();
    const file = await runInTransaction(db, (tx) =>
      claimVideoForProcessing(
        mediaTables(tx),
        storedFileId,
        new Date(now.getTime() - STALE_VIDEO_PROCESSING_MS),
        now,
        MAX_VIDEO_PROCESSING_ATTEMPTS,
      ),
    );
    if (file === undefined) return 'skipped';

    const jobId = (this.#deps.newJobId ?? randomUUID)();
    try {
      const derivatives = await this.#derive(file, storage, processor, jobId);
      await this.#store(file, derivatives, storage, processor, jobId);
      logger.info({ job: 'media.process.video', storedFileId: file.id, state: 'ready' }, 'media: derivatives of a film were made');
      return 'ready';
    } catch (error) {
      return await this.#failed(file, error);
    } finally {
      await processor.dispose(jobId);
    }
  }

  /** The structural check, then the transcoding. @returns the derivatives the processor made */
  async #derive(file: StoredFileRow, storage: ObjectStorage, processor: VideoProcessor, jobId: string): Promise<VideoDerivatives> {
    const contentType = file.content_type === null ? undefined : normalizeContentType(file.content_type);
    if ((contentType !== 'video/mp4' && contentType !== 'video/quicktime') || file.sha256 === null || file.size_bytes === null)
      throw new NotProcessableError();
    const expectedSize = Number(file.size_bytes);
    const hash = createHash('sha256');
    const seen = { bytes: 0 };
    const body = await storage.getObjectStream(file.object_key, {
      ...(file.s3_version_id === null ? {} : { versionId: file.s3_version_id }),
      ...(file.s3_etag === null ? {} : { ifMatch: file.s3_etag }),
    });
    async function* observed(): AsyncGenerator<Uint8Array> {
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        seen.bytes += chunk.length;
        hash.update(chunk);
        yield chunk;
      }
    }
    let probe;
    try {
      probe = await processor.probe({
        jobId,
        contentType,
        original: Readable.from(observed()),
        maxBytes: expectedSize,
        beforeProcessing: () => {
          if (seen.bytes !== expectedSize || hash.digest('hex') !== file.sha256) throw new OriginalChangedError();
        },
      });
    } catch (error) {
      // the structure of the film is not that of an MP4/MOV of an allowed codec within the limits: the film is not what its type says
      if (error instanceof VideoProcessingError && (error.code === 'unsupported' || error.code === 'too_long')) throw new NotAFilmError();
      throw error;
    }
    if (!isAcceptableDuration(probe.durationSeconds)) throw new NotAFilmError();
    // the duration is kept BEFORE the transcoding (a timeout of it does not lose it): its presence is the proof that the film was probed
    if (!(await recordDuration(mediaTables(this.#deps.db), file.id, wholeSeconds(probe.durationSeconds)))) throw new OriginalChangedError();
    return processor.transcode(jobId);
  }

  /** Writes the derivatives (add-only) and, in ONE transaction, moves the film to `ready` with the rows of both. */
  async #store(
    file: StoredFileRow,
    derived: VideoDerivatives,
    storage: ObjectStorage,
    processor: VideoProcessor,
    jobId: string,
  ): Promise<void> {
    const frameKey = derivativeKey(file.object_key, 'thumbnail', 'video');
    const previewKey = derivativeKey(file.object_key, 'preview', 'video');
    if (frameKey === undefined || previewKey === undefined) throw new NotProcessableError();

    await this.#put(
      storage,
      frameKey,
      derived.frame.body.length,
      () => Readable.from([derived.frame.body]),
      derivativeContentType('thumbnail', 'video'),
    );
    await this.#put(
      storage,
      previewKey,
      derived.preview.sizeBytes,
      () => processor.openPreview(jobId),
      derivativeContentType('preview', 'video'),
    );

    const rows: NewDerivative[] = [
      {
        storedFileId: file.id,
        variant: 'thumbnail',
        objectKey: frameKey,
        contentType: 'image/webp',
        width: derived.frame.width,
        height: derived.frame.height,
        sizeBytes: derived.frame.body.length,
      },
      {
        storedFileId: file.id,
        variant: 'preview',
        objectKey: previewKey,
        contentType: 'video/mp4',
        width: derived.preview.width,
        height: derived.preview.height,
        sizeBytes: derived.preview.sizeBytes,
      },
    ];
    await runInTransaction(this.#deps.db, async (tx) => {
      const at = this.#deps.clock.now();
      const tables = mediaTables(tx);
      // the compare-and-set first: another worker may have finished this film while this one worked; then there is nothing to write
      if (!(await transitionFile(tables, file.id, 'processing', { state: 'ready' }, at))) return;
      await insertDerivatives(tables, rows, at);
    });
  }

  /**
   * `If-None-Match: *`: a derivative is never overwritten. An object that is already there (a crash after the write and before the commit) is a success
   * when it has the size of what this try made; anything else is a transient fault (the next try meets the same and the attempts end).
   */
  async #put(
    storage: ObjectStorage,
    key: string,
    size: number,
    body: () => Readable | Promise<Readable>,
    contentType: string,
  ): Promise<void> {
    try {
      await storage.putObjectStreamIfAbsent({ key, body: await body(), size, contentType, cacheControl: DERIVATIVE_CACHE_CONTROL });
    } catch (error) {
      if (!(error instanceof ObjectStorageError) || error.code !== 'precondition_failed') throw error;
      const head = await storage.head(key);
      if (head?.size !== size) throw new ObjectStorageError('unavailable');
    }
  }

  async #failed(file: StoredFileRow, error: unknown): Promise<VideoProcessingOutcome> {
    const { logger } = this.#deps;
    if (error instanceof NotAFilmError) {
      await this.#quarantine(file);
      return 'quarantined';
    }
    const permanent =
      error instanceof OriginalChangedError ||
      error instanceof NotProcessableError ||
      (error instanceof VideoProcessingError && isPermanentVideo(error.code));
    const code =
      error instanceof VideoProcessingError
        ? error.code
        : error instanceof OriginalChangedError
          ? 'original_changed'
          : error instanceof NotProcessableError
            ? 'not_processable'
            : error instanceof ObjectStorageError
              ? 'storage'
              : 'internal';
    if (error instanceof VideoProcessingError && error.code === 'unreachable') {
      // never delivered to the processor: no fault of the film, so the take is given back
      await releaseProcessingAttempt(mediaTables(this.#deps.db), file.id);
      logger.warn({ job: 'media.process.video', storedFileId: file.id, code }, 'media: the processor is unreachable; the film waits');
      return 'deferred';
    }
    if (permanent || file.process_attempts >= MAX_VIDEO_PROCESSING_ATTEMPTS) {
      await this.#fail(file.id);
      logger.warn(
        { job: 'media.process.video', storedFileId: file.id, code, attempts: file.process_attempts },
        'media: a film could not be processed and is failed',
      );
      return 'failed';
    }
    logger.warn(
      { job: 'media.process.video', storedFileId: file.id, code, attempts: file.process_attempts },
      'media: a film could not be processed; it is retried',
    );
    return 'retry';
  }

  /** `processing -> quarantined` / `type_mismatch` with its audit event, e-mails and alert in ONE transaction (the alert only for the first entry). */
  async #quarantine(file: StoredFileRow): Promise<void> {
    const { db, clock, logger } = this.#deps;
    await runInTransaction(db, async (tx) => {
      const at = clock.now();
      const moved = await transitionFile(
        mediaTables(tx),
        file.id,
        'processing',
        { state: 'quarantined', reason: 'type_mismatch', quarantinedAt: at },
        at,
      );
      if (!moved || file.media_asset_id === null) return;
      // the clock of the retention is the FIRST entry (the coalesce of the store); the alert and the e-mails go out only for the first entry
      if (file.quarantined_at === null) await raiseQuarantineAlert(this.#deps, tx, file.media_asset_id, at);
      else await publishMediaEvent(this.#deps.events, tx, 'media_file.quarantined', file.media_asset_id);
      logger.info(
        { job: 'media.process.video', storedFileId: file.id, state: 'quarantined' },
        'media: a film is not what its type says and is held',
      );
    });
  }

  /** `processing` to `failed` / `processing_error`. @returns whether the file was moved */
  async #fail(storedFileId: string): Promise<boolean> {
    const { db, clock, logger } = this.#deps;
    const moved = await transitionFile(
      mediaTables(db),
      storedFileId,
      'processing',
      { state: 'failed', reason: 'processing_error' },
      clock.now(),
    );
    if (moved) logger.info({ job: 'media.process.video', storedFileId, state: 'failed' }, 'media: a film was failed');
    return moved;
  }
}
