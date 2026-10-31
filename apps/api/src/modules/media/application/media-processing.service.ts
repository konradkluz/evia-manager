/**
 * The derivatives of the photos — the worker's job (EVM-068 AC1-AC4; ADR-0009, ADR-0010; SR-FILE-04, SR-FILE-06, SR-FILE-08; P3). A file that
 * passed the scan (`clean`) becomes `processing` and then `ready` with a thumbnail (320 px) and a preview (1600 px), or `failed` with
 * `processing_error`. The sibling of {@link MediaScanService} and built the same way:
 *
 * - the TABLE is the queue: the loop takes `clean` photos and `processing` ones nobody has touched for {@link STALE_PROCESSING_MS} (the retry is
 *   slow enough to be a backoff). Taking a file is a compare-and-set that RAISES `process_attempts` — at the take, not at the failure, so a
 *   processor that is killed by the OOM killer on a file uses an attempt too and no poison pill loops forever. After
 *   {@link MAX_PROCESSING_ATTEMPTS} takes the file is `failed`. Pictures are processed one after another (one job per processor).
 * - ONE pinned version of the original (`VersionId` and `If-Match`) is read; its SHA-256 and size are checked against the ones recorded by the scan
 *   BEFORE the processor opens it (an object that is not the scanned one never reaches libvips) - this is also the evidence for AC2 that the
 *   original is the one that was scanned and is not changed by the processing (nothing here writes to it).
 * - the outputs of the processor are checked by the adapter; here they are written under keys derived from the key of the ORIGINAL, add-only
 *   (`If-None-Match: *`): an object that is already there after a crash before the commit is a success when its size is the same;
 * - `processing` to `ready` and the rows of BOTH derivatives are ONE transaction (`ready` without them is not a state that exists);
 * - every change of state goes through `transitionFile` (the one place EVM-048 will emit the change of the file for the sync).
 * Errors: a fixed code and identifiers in the log, never a message of a library, a path or an address (SR-ERR-01, SR-LOG-02).
 */
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { ImageProcessingError, type DerivedImage, type ImageProcessor } from '../../../platform/media-processing/image-processor.ts';
import { ObjectStorageError, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import {
  DERIVATIVE_CACHE_CONTROL,
  DERIVATIVE_CONTENT_TYPE,
  MAX_PROCESSING_ATTEMPTS,
  PROCESSING_WARNING_MS,
  STALE_PROCESSING_MS,
  derivativeKey,
  isPermanent,
} from '../domain/derivatives.ts';
import { normalizeContentType } from '../domain/file-rules.ts';
import {
  claimForProcessing,
  releaseProcessingAttempt,
  countUnprocessedStuck,
  findUnprocessed,
  insertDerivatives,
  transitionFile,
  type NewDerivative,
  type StoredFileRow,
} from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';

const BATCH = 10;

/** The object read from the storage is not the one the scan recorded (another checksum or size): permanent, never processed. */
class OriginalChangedError extends Error {}
/** The scan left no usable type or key: nothing to ask the processor. */
class NotProcessableError extends Error {}

export interface ProcessingDependencies {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly storage: ObjectStorage | null;
  readonly processor: ImageProcessor | null;
  /** The identifier of the directory of a try (tests only; the default is a random UUID). */
  readonly newJobId?: () => string;
}

export type ProcessingOutcome = 'ready' | 'failed' | 'retry' | 'deferred' | 'skipped';

export class MediaProcessingService {
  readonly #deps: ProcessingDependencies;
  #running = false;
  #pass: Promise<number> | undefined;

  constructor(deps: ProcessingDependencies) {
    this.#deps = deps;
  }

  /** Both the storage and the processor are configured; without them nothing is processed and the files stay `clean`. */
  get enabled(): boolean {
    return this.#deps.storage !== null && this.#deps.processor !== null;
  }

  /** Removes what a crash left in the work area of the processor (the photos of private sites must not stay there - P3). Call before the first pass. */
  async cleanWorkArea(): Promise<void> {
    await this.#deps.processor?.cleanup();
  }

  /** Starts the loop; @returns the function that stops it - its promise settles once the pass in progress has finished. */
  start(intervalMs = 5000): () => Promise<void> {
    const timer = setInterval(() => {
      this.#drain().catch(() => {
        this.#deps.logger.error({ job: 'media.process' }, 'media: processing pass failed');
      });
    }, intervalMs);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await this.#pass?.catch(() => undefined);
    };
  }

  /** Passes until one is short of a full batch: a backlog (the first deployment, a large batch of photos) does not wait for the interval. */
  async #drain(): Promise<void> {
    let handled: number;
    do {
      handled = await this.runOnce();
    } while (handled >= BATCH);
  }

  /** One pass: at most {@link BATCH} photos, one after another. @returns how many reached `ready` or `failed` */
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
    const waiting = await findUnprocessed(mediaTables(db), new Date(now.getTime() - STALE_PROCESSING_MS), BATCH);
    let decided = 0;
    for (const item of waiting) {
      // a take that never finished and used the last attempt: no more tries, the file is failed (a crash of the worker or the processor)
      if (item.state === 'processing' && item.attempts >= MAX_PROCESSING_ATTEMPTS) {
        if (await this.#fail(item.id)) decided += 1;
        continue;
      }
      const outcome = await this.processFile(item.id);
      if (outcome === 'ready' || outcome === 'failed') decided += 1;
      // the processor cannot be reached: the next photos would only wait for the connection too; the next pass asks again
      if (outcome === 'deferred') break;
    }
    const stuck = await countUnprocessedStuck(mediaTables(db), new Date(now.getTime() - PROCESSING_WARNING_MS));
    if (stuck > 0) logger.warn({ job: 'media.process', stuck }, 'media: photos wait for their derivatives for over 30 minutes');
    return decided;
  }

  /** @returns what happened to the file; `deferred`: the processor was unreachable (the attempt was given back); `skipped`: taken by someone else (or no attempts left) */
  async processFile(storedFileId: string): Promise<ProcessingOutcome> {
    const { db, clock, logger, storage, processor } = this.#deps;
    // runOnce checks `enabled` first; the guard keeps a direct call from processing without a processor
    if (storage === null || processor === null) return 'skipped';
    const now = clock.now();
    const file = await claimForProcessing(
      mediaTables(db),
      storedFileId,
      new Date(now.getTime() - STALE_PROCESSING_MS),
      now,
      MAX_PROCESSING_ATTEMPTS,
    );
    if (file === undefined) return 'skipped';
    try {
      const images = await this.#derive(file, storage, processor);
      await this.#store(file, images, storage);
      logger.info({ job: 'media.process', storedFileId: file.id, state: 'ready' }, 'media: derivatives were made');
      return 'ready';
    } catch (error) {
      return this.#failed(file, error);
    }
  }

  /** Reads the pinned original through the checksum and gives it to the processor; @returns the derivatives it made. */
  async #derive(file: StoredFileRow, storage: ObjectStorage, processor: ImageProcessor): Promise<readonly DerivedImage[]> {
    const contentType = file.content_type === null ? undefined : normalizeContentType(file.content_type);
    if (contentType === undefined || file.sha256 === null || file.size_bytes === null) throw new NotProcessableError();
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
    return processor.derive({
      jobId: (this.#deps.newJobId ?? randomUUID)(),
      contentType,
      original: Readable.from(observed()),
      maxBytes: expectedSize,
      beforeProcessing: () => {
        if (seen.bytes !== expectedSize || hash.digest('hex') !== file.sha256) throw new OriginalChangedError();
      },
    });
  }

  /** Writes the derivatives (add-only) and, in ONE transaction, moves the file to `ready` with the rows of both. */
  async #store(file: StoredFileRow, images: readonly DerivedImage[], storage: ObjectStorage): Promise<void> {
    const rows: NewDerivative[] = [];
    for (const image of images) {
      const objectKey = derivativeKey(file.object_key, image.variant);
      if (objectKey === undefined) throw new NotProcessableError();
      await this.#put(storage, objectKey, image.body);
      rows.push({
        storedFileId: file.id,
        variant: image.variant,
        objectKey,
        width: image.width,
        height: image.height,
        sizeBytes: image.body.length,
      });
    }
    await runInTransaction(this.#deps.db, async (tx) => {
      const at = this.#deps.clock.now();
      const tables = mediaTables(tx);
      // the compare-and-set first: another worker may have finished this file while this one worked; then there is nothing to write
      if (!(await transitionFile(tables, file.id, 'processing', { state: 'ready' }, at))) return;
      await insertDerivatives(tables, rows, at);
    });
  }

  /**
   * `If-None-Match: *`: a derivative is never overwritten. An object that is already there (a crash after the write and before the commit) is a
   * success when it has the size of what this try made; anything else is a transient fault (the next try meets the same and the attempts end).
   */
  async #put(storage: ObjectStorage, key: string, body: Buffer): Promise<void> {
    try {
      await storage.putObjectIfAbsent({ key, body, contentType: DERIVATIVE_CONTENT_TYPE, cacheControl: DERIVATIVE_CACHE_CONTROL });
    } catch (error) {
      if (!(error instanceof ObjectStorageError) || error.code !== 'precondition_failed') throw error;
      const head = await storage.head(key);
      if (head?.size !== body.length) throw new ObjectStorageError('unavailable');
    }
  }

  /** The try failed: permanent codes and the last attempt end in `failed`; the rest waits for the stale period. */
  async #failed(file: StoredFileRow, error: unknown): Promise<ProcessingOutcome> {
    const { logger } = this.#deps;
    const permanent =
      error instanceof OriginalChangedError ||
      error instanceof NotProcessableError ||
      (error instanceof ImageProcessingError && isPermanent(error.code));
    const code =
      error instanceof ImageProcessingError
        ? error.code
        : error instanceof OriginalChangedError
          ? 'original_changed'
          : error instanceof NotProcessableError
            ? 'not_processable'
            : error instanceof ObjectStorageError
              ? 'storage'
              : 'internal';
    if (error instanceof ImageProcessingError && error.code === 'unreachable') {
      // never delivered to the processor: no fault of the file, so the take is given back and the photo cannot run out of attempts during an outage
      await releaseProcessingAttempt(mediaTables(this.#deps.db), file.id);
      logger.warn(
        { job: 'media.process', storedFileId: file.id, code: error.code },
        'media: the processor is unreachable; the photo waits',
      );
      return 'deferred';
    }
    if (permanent || file.process_attempts >= MAX_PROCESSING_ATTEMPTS) {
      await this.#fail(file.id);
      logger.warn(
        { job: 'media.process', storedFileId: file.id, code, attempts: file.process_attempts },
        'media: a photo could not be processed and is failed',
      );
      return 'failed';
    }
    logger.warn(
      { job: 'media.process', storedFileId: file.id, code, attempts: file.process_attempts },
      'media: a photo could not be processed; it is retried',
    );
    return 'retry';
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
    if (moved) logger.info({ job: 'media.process', storedFileId, state: 'failed' }, 'media: a photo was failed');
    return moved;
  }
}
