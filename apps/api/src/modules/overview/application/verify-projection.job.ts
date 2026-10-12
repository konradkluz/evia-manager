/**
 * The nightly `verify` of the projection (ADR-0017 W11, T7; EVM-034 step 9): a job of the worker that compares every row of the
 * projection with its recomputation from the sources — the detecting control of TM-106…TM-111. It is read-only (a retry is safe).
 *
 * - a difference is a RESULT, not a failure: the job ends successfully (a retry would only repeat `verify` and its alert). A difference
 *   of the authorisation column enqueues the security alert `projection_authz_drift` (inside `verify`); every difference is one log
 *   entry at `warn` with the stable fields `metric: "projection_drift_total"`, `value` (this run, not a cumulative counter) and
 *   `traceId` — the rule of the alert (EVM-007) matches on them. The counter in the registry of the process is incremented as well;
 *   the exporter of the metrics belongs to EVM-007;
 * - a failure (the database is down, a timeout) is logged as the kind and the SQLSTATE only — never SQL, parameters or data — and
 *   leaves as `JobFailure` with a fixed code, so the queue retries (retryLimit 2) and stores nothing of the original error;
 * - the schedule is 03:30 in Europe/Warsaw: it skips the gap and the repeated hour of the change of time (02:00–03:00) — the job runs
 *   exactly once a day, whatever the day;
 * - the job returns numbers only; the log holds numbers and the trace id (SR-LOG-02, SR-LOG-03).
 *
 * The module knows the interface of the queue (`platform/jobs`), not the library: the composition root of the worker registers it.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '../../../platform/clock/clock.ts';
import { newTraceId } from '../../../platform/http/request-context.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../../../platform/jobs/index.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { CLOCK, LOGGER } from '../../../platform/tokens.ts';
import { COLUMN_GROUPS } from '../domain/recompute.ts';
import { ProjectionMaintenance } from './projection-maintenance.ts';

export const VERIFY_PROJECTION_JOB = 'overview.verify-projection';
export const VERIFY_PROJECTION_FAILED = 'projection_verify_failed';
export const VERIFY_PROJECTION_SCHEDULE: JobSchedule = { cron: '30 3 * * *', timezone: 'Europe/Warsaw' };

@Injectable()
export class VerifyProjectionJob {
  readonly #maintenance: Pick<ProjectionMaintenance, 'verify'>;
  readonly #logger: Logger;
  readonly #clock: Clock;

  constructor(
    @Inject(ProjectionMaintenance) maintenance: Pick<ProjectionMaintenance, 'verify'>,
    @Inject(LOGGER) logger: Logger,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.#maintenance = maintenance;
    this.#logger = logger;
    this.#clock = clock;
  }

  definition(): JobDefinition {
    return { name: VERIFY_PROJECTION_JOB, schedule: VERIFY_PROJECTION_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    const traceId = newTraceId();
    const startedAt = this.#clock.now().getTime();
    this.#logger.info({ traceId, job: VERIFY_PROJECTION_JOB }, 'projection verify: start');
    let report;
    try {
      report = await this.#maintenance.verify({ traceId });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.#logger.error(
        {
          traceId,
          job: VERIFY_PROJECTION_JOB,
          errorType: error instanceof Error ? error.name : 'unknown',
          errorCode: typeof code === 'string' ? code : undefined,
        },
        'projection verify: failed',
      );
      throw new JobFailure(VERIFY_PROJECTION_FAILED);
    }
    const differing = new Set(COLUMN_GROUPS.flatMap((group) => report.drift[group]));
    const value = differing.size + report.missing.length;
    // the key is `authz`, not `authorization`: the logger redacts keys that name credentials (SENSITIVE_KEY_FRAGMENTS)
    const counts: JobCounts = {
      checked: report.checked,
      inSync: report.inSync,
      missing: report.missing.length,
      differing: differing.size,
      authz: report.drift.authorization.length,
    };
    const fields = { traceId, job: VERIFY_PROJECTION_JOB, ...counts, durationMs: this.#clock.now().getTime() - startedAt };
    if (value > 0) {
      this.#logger.warn({ ...fields, metric: 'projection_drift_total', value }, 'projection verify: drift found');
    } else {
      this.#logger.info(fields, 'projection verify: in sync');
    }
    return counts;
  }
}
