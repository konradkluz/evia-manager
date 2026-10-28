/**
 * The monitor of the signatures of the scanner (EVM-049 AC7; P5, SR-ERR-01, SR-LOG-07): a job of the worker, every 15 minutes, asks the scanner
 * when its signatures were built (a fixed command, the reply parsed strictly, the time read as UTC) and raises a security alert when they are old:
 * `signature_stale` ONCE per episode past 24 hours, `signature_stale_72h` once a day past 72 hours. The scan goes on with the older signatures.
 *
 * Fail closed: a scanner that does not answer, a reply that is not the expected shape and a date from the future (more than 5 minutes ahead of the
 * clock) are an UNKNOWN age, and an age unknown for more than 24 hours raises the same alerts as an old one - a broken monitor must not hide
 * old signatures. The start of the unknown age is kept in memory of the worker (a restart begins counting again; recorded as a residual risk).
 * The deduplication is in the database (the newest alert of each code in the outbox), so several workers and restarts do not double an alert.
 * Without a scanner (no `CLAMD_SOCKET`) nothing is scanned at all, so there is nothing to monitor.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { enqueueSecurityAlert, latestAlertAt } from '../../../platform/alerts/security-alerts.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { newTraceId } from '../../../platform/http/request-context.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../../../platform/jobs/index.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { MALWARE_SCANNER, type MalwareScanner } from '../../../platform/malware-scan/malware-scanner.ts';
import { CLOCK, DATABASE, LOGGER } from '../../../platform/tokens.ts';
import { SIGNATURE_FUTURE_SKEW_MS, signatureAlertsDue } from '../domain/quarantine.ts';

export const SIGNATURE_MONITOR_JOB = 'media.signature-monitor';
export const SIGNATURE_MONITOR_FAILED = 'signature_monitor_failed';
export const SIGNATURE_MONITOR_SCHEDULE: JobSchedule = { cron: '*/15 * * * *', timezone: 'Europe/Warsaw' };
const HOUR_MS = 3_600_000;

@Injectable()
export class SignatureMonitorJob {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #scanner: MalwareScanner | null;
  /** Since when the age of the signatures has been unknown (`null` while it is known). */
  #unknownSince: Date | null = null;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(LOGGER) logger: Logger,
    @Inject(MALWARE_SCANNER) scanner: MalwareScanner | null,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#logger = logger;
    this.#scanner = scanner;
  }

  definition(): JobDefinition {
    return { name: SIGNATURE_MONITOR_JOB, schedule: SIGNATURE_MONITOR_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    const scanner = this.#scanner;
    if (scanner === null) return { alerts: 0 };
    const now = this.#clock.now();
    const built = await this.#builtAt(scanner, now);
    if (built === null) this.#unknownSince ??= now;
    else this.#unknownSince = null;
    const since = built ?? this.#unknownSince ?? now;
    try {
      const alerts = await runInTransaction(this.#db, async (tx) => {
        const due = signatureAlertsDue({
          now,
          since,
          lastStaleAlert: await latestAlertAt(tx, 'signature_stale'),
          last72hAlert: await latestAlertAt(tx, 'signature_stale_72h'),
        });
        for (const code of due) await enqueueSecurityAlert(tx, { code, occurredAt: now, traceId: newTraceId() });
        return due.length;
      });
      const ageHours = Math.floor((now.getTime() - since.getTime()) / HOUR_MS);
      this.#logger.info({ job: SIGNATURE_MONITOR_JOB, ageHours, ageKnown: built !== null, alerts }, 'signature monitor: checked');
      return { alerts, ageHours };
    } catch {
      this.#logger.error({ job: SIGNATURE_MONITOR_JOB }, 'signature monitor: failed');
      throw new JobFailure(SIGNATURE_MONITOR_FAILED);
    }
  }

  /** @returns when the signatures were built, or `null` when that is not known (no answer, a bad reply, a date from the future) */
  async #builtAt(scanner: MalwareScanner, now: Date): Promise<Date | null> {
    try {
      const built = await scanner.signatureDate();
      return built.getTime() > now.getTime() + SIGNATURE_FUTURE_SKEW_MS ? null : built;
    } catch {
      return null;
    }
  }
}
