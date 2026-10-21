/**
 * The retention of the data of the protection against guessing (EVM-026 M6; RODO art. 5(1)(e)): a job of the worker, every 15 minutes, deletes the counters
 * past their `expires_at` (30 minutes after the end of their window or lock), the first steps 30 minutes after they expired (they carry the HMAC of the
 * address) and the browsers not seen for 30 days (with their counters). A purge that only
 * happened when somebody touched a row again would leave the rows nobody touches for ever.
 *
 * It is idempotent (two runs, or a retry, delete nothing twice); a failure leaves as `JobFailure` with a fixed code, so the queue retries and stores nothing of
 * the original error; the log holds the numbers deleted, never a key, a hash or an account.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../../../platform/jobs/index.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { CLOCK, DATABASE, LOGGER } from '../../../platform/tokens.ts';
import { LoginThrottle } from './login-throttle.ts';

export const PURGE_LOGIN_SECURITY_JOB = 'identity.purge-login-security';
export const PURGE_LOGIN_SECURITY_FAILED = 'login_security_purge_failed';
export const PURGE_LOGIN_SECURITY_SCHEDULE: JobSchedule = { cron: '*/15 * * * *', timezone: 'Europe/Warsaw' };

@Injectable()
export class PurgeLoginSecurityJob {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #throttle: LoginThrottle;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(LOGGER) logger: Logger,
    @Inject(LoginThrottle) throttle: LoginThrottle,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#logger = logger;
    this.#throttle = throttle;
  }

  definition(): JobDefinition {
    return { name: PURGE_LOGIN_SECURITY_JOB, schedule: PURGE_LOGIN_SECURITY_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    try {
      const purged = await runInTransaction(this.#db, (transaction) => this.#throttle.purge(transaction, this.#clock.now()));
      this.#logger.info({ job: PURGE_LOGIN_SECURITY_JOB, ...purged }, 'login security purge: done');
      return purged;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.#logger.error(
        {
          job: PURGE_LOGIN_SECURITY_JOB,
          errorType: error instanceof Error ? error.name : 'unknown',
          errorCode: typeof code === 'string' ? code : undefined,
        },
        'login security purge: failed',
      );
      throw new JobFailure(PURGE_LOGIN_SECURITY_FAILED);
    }
  }
}
