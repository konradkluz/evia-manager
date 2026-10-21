/**
 * The retention of sessions (EVM-028 AC7; SR-DATA-07, P4; RODO art. 5(1)(e)): a job of the worker, once a day, deletes the sessions that ended more than 30 days
 * ago — a session ends at the earliest of its revocation and its two deadlines. The address (kept in full for the owner, P9) and the user agent go with the row.
 * The challenges of those sessions go first (a foreign key). Sessions that are alive, or ended less than 30 days ago, stay. The audit trail is NEVER touched —
 * its records of the sessions (an identifier, a time, a reason code) are the trail and are kept by their own rules.
 *
 * The job is idempotent (a second run, or a retry, deletes nothing twice). Its result is a count and nothing else: no identifier, no address, no account. A
 * failure leaves as a `JobFailure` with a fixed code, so the queue retries and stores nothing of the original error; the log holds the count, never a row.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../../../platform/jobs/index.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { CLOCK, DATABASE, LOGGER } from '../../../platform/tokens.ts';
import { SESSION_RETENTION_MS } from '../domain/constants.ts';
import { deleteSessionsEndedBefore } from '../infrastructure/account-queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

export const PURGE_SESSIONS_JOB = 'identity.purge-sessions';
export const PURGE_SESSIONS_FAILED = 'sessions_purge_failed';
/** Every night at 03:50 (the business zone, after the verification of the projection at 03:30), when nobody works; a missed run is made up by the next one. */
export const PURGE_SESSIONS_SCHEDULE: JobSchedule = { cron: '50 3 * * *', timezone: 'Europe/Warsaw' };

@Injectable()
export class PurgeSessionsJob {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #logger: Logger;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(LOGGER) logger: Logger) {
    this.#db = db;
    this.#clock = clock;
    this.#logger = logger;
  }

  definition(): JobDefinition {
    return { name: PURGE_SESSIONS_JOB, schedule: PURGE_SESSIONS_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    try {
      const cutoff = new Date(this.#clock.now().getTime() - SESSION_RETENTION_MS);
      const sessions = await runInTransaction(this.#db, (transaction) => deleteSessionsEndedBefore(identityTables(transaction), cutoff));
      this.#logger.info({ job: PURGE_SESSIONS_JOB, sessions }, 'sessions purge: done');
      return { sessions };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.#logger.error(
        {
          job: PURGE_SESSIONS_JOB,
          errorType: error instanceof Error ? error.name : 'unknown',
          errorCode: typeof code === 'string' ? code : undefined,
        },
        'sessions purge: failed',
      );
      throw new JobFailure(PURGE_SESSIONS_FAILED);
    }
  }
}
