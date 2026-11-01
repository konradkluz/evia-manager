/**
 * The completion of an erasure (EVM-051 AC2, AC7; SR-DATA-08, CWE-459): a job of the worker, every ten minutes, finishes the removal of the objects of the
 * files the Administrator erased, when the request that erased them could not (the storage failed after the commit; the answer was `503`). The rows say it:
 * `erased_at` is set and `objects_erased_at` is not. Every object of the file (the original, the derivatives) is removed, the multipart uploads are aborted
 * again, then `objects_erased_at` is written - all of it idempotent, so a repeat, a second worker or the repeat of the request itself are harmless.
 * One batch (100) per transaction, the rows locked `FOR UPDATE SKIP LOCKED`; the batch stops at the first failure of the storage. The log has counts only.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../../../platform/jobs/index.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE, LOGGER } from '../../../platform/tokens.ts';
import { derivativeKeysOf, lockPendingErasures, markObjectsErased, uploadIdsOf } from '../infrastructure/erasure-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';

export const ERASURE_COMPLETION_JOB = 'media.erasure-completion';
export const ERASURE_COMPLETION_FAILED = 'erasure_completion_failed';
export const ERASURE_COMPLETION_SCHEDULE: JobSchedule = { cron: '*/10 * * * *', timezone: 'Europe/Warsaw' };
const BATCH = 100;
const MAX_BATCHES = 10;
/** A file erased a moment ago is left to the request that erased it. */
export const LEAVE_TO_REQUEST_MS = 120_000;

@Injectable()
export class ErasureCompletionJob {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #storage: ObjectStorage | null;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(LOGGER) logger: Logger,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#logger = logger;
    this.#storage = storage;
  }

  definition(): JobDefinition {
    return { name: ERASURE_COMPLETION_JOB, schedule: ERASURE_COMPLETION_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    const storage = this.#storage;
    if (storage === null) {
      this.#logger.warn({ job: ERASURE_COMPLETION_JOB }, 'erasure completion: the storage is not configured; nothing is removed');
      return { completed: 0, failed: 0 };
    }
    let completed = 0;
    let failed = 0;
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const done = await this.#batch(storage);
        completed += done.completed;
        failed += done.failed;
        if (done.taken < BATCH || done.failed > 0) break;
      }
    } catch (error) {
      this.#logger.error(
        { job: ERASURE_COMPLETION_JOB, errorType: error instanceof Error ? error.name : 'unknown' },
        'erasure completion: failed',
      );
      throw new JobFailure(ERASURE_COMPLETION_FAILED);
    }
    this.#logger.info({ job: ERASURE_COMPLETION_JOB, completed, failed }, 'erasure completion: done');
    return { completed, failed };
  }

  async #batch(storage: ObjectStorage): Promise<{ taken: number; completed: number; failed: number }> {
    return runInTransaction(this.#db, async (tx) => {
      const now = this.#clock.now();
      const tables = mediaTables(tx);
      const due = await lockPendingErasures(tables, new Date(now.getTime() - LEAVE_TO_REQUEST_MS), BATCH);
      let completed = 0;
      let failed = 0;
      for (const file of due) {
        try {
          for (const upload of await uploadIdsOf(tables, [file.id])) await storage.abortMultipartUpload(upload.objectKey, upload.uploadId);
          for (const key of [file.objectKey, ...(await derivativeKeysOf(tables, [file.id]))]) await storage.deleteObject(key);
        } catch {
          failed += 1;
          this.#logger.warn(
            { job: ERASURE_COMPLETION_JOB, storedFileId: file.id },
            'erasure completion: the objects could not be removed; it is retried',
          );
          break;
        }
        await markObjectsErased(tables, [file.id], now);
        completed += 1;
      }
      return { taken: due.length, completed, failed };
    });
  }
}
