/**
 * The daily cleanup of expired idempotency records (EVM-079; ADR-0004: retention 30 days): a job of the worker, 04:10 in
 * Europe/Warsaw (night; it skips the gap and the repeated hour of the change of time, like the verify of the projection). It takes
 * the batches one after another (`BATCH_SIZE` rows, a short transaction each, so the writers of the API are never blocked for long)
 * until a batch is not full.
 *
 * - two instances at once, or a retry: the function skips the rows another run holds, so nothing is deleted twice and nothing
 *   waits; a failed run deletes nothing more and the next one starts from what is left (the work is idempotent);
 * - a failure is logged as the kind and the SQLSTATE only — never SQL, parameters or data — and leaves as `JobFailure` with a fixed
 *   code, so the queue retries and stores nothing of the original error;
 * - the log holds the number of deleted records, of batches and the duration — never a user, a key or a hash (SR-LOG-02, SR-LOG-03).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '../clock/clock.ts';
import { newTraceId } from '../http/request-context.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../jobs/index.ts';
import type { Logger } from '../logging/logger.ts';
import { CLOCK, LOGGER } from '../tokens.ts';
import { IDEMPOTENCY_PURGER, type IdempotencyPurger } from './idempotency-purger.ts';

export const PURGE_IDEMPOTENCY_JOB = 'platform.purge-idempotency';
export const PURGE_IDEMPOTENCY_FAILED = 'idempotency_purge_failed';
export const PURGE_IDEMPOTENCY_SCHEDULE: JobSchedule = { cron: '10 4 * * *', timezone: 'Europe/Warsaw' };
export const BATCH_SIZE = 1000;

@Injectable()
export class PurgeIdempotencyJob {
  readonly #purger: IdempotencyPurger;
  readonly #logger: Logger;
  readonly #clock: Clock;

  constructor(@Inject(IDEMPOTENCY_PURGER) purger: IdempotencyPurger, @Inject(LOGGER) logger: Logger, @Inject(CLOCK) clock: Clock) {
    this.#purger = purger;
    this.#logger = logger;
    this.#clock = clock;
  }

  definition(): JobDefinition {
    return { name: PURGE_IDEMPOTENCY_JOB, schedule: PURGE_IDEMPOTENCY_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    const traceId = newTraceId();
    const startedAt = this.#clock.now().getTime();
    let deleted = 0;
    let batches = 0;
    try {
      for (;;) {
        const purged = await this.#purger.purgeBatch(BATCH_SIZE);
        batches += 1;
        deleted += purged;
        if (purged < BATCH_SIZE) break;
      }
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.#logger.error(
        {
          traceId,
          job: PURGE_IDEMPOTENCY_JOB,
          deleted,
          batches,
          durationMs: this.#clock.now().getTime() - startedAt,
          errorType: error instanceof Error ? error.name : 'unknown',
          errorCode: typeof code === 'string' ? code : undefined,
        },
        'idempotency purge: failed',
      );
      throw new JobFailure(PURGE_IDEMPOTENCY_FAILED);
    }
    this.#logger.info(
      { traceId, job: PURGE_IDEMPOTENCY_JOB, deleted, batches, durationMs: this.#clock.now().getTime() - startedAt },
      'idempotency purge: done',
    );
    return { deleted, batches };
  }
}
