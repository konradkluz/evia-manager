/**
 * The reminder of a site survey that is about to be deleted (EVM-140 AC1, AC5; ADR-0024 pt 9; SR-DATA-01, SR-LOG-03, DO-K): a job of the worker, once a day, finds
 * the open surveys whose deadline is 15 days away or nearer and that were never reminded (no customer, not cancelled, not deleted, not purged), and for each of them -
 * in ONE transaction of its own - writes one message of the outbox to the creator and to every active Administrator (the same person once) and sets
 * `site_survey_reminded_at`. The extension clears the mark, so the next reminder comes 15 days before the new deadline.
 *
 * Idempotent: the mark and the messages are one unit, so a second run (or a retry after a crash) finds the survey marked and writes nothing twice; a survey that a
 * command holds locked at that moment is skipped (`SKIP LOCKED`) and comes in the next run. A failure of one survey is counted and does NOT stop the others; the job
 * leaves as a `JobFailure` with a fixed code only after the pass, so the queue retries what is left. The text of the message is composed when it is SENT (the
 * composer reads the number and the deadline): the outbox holds identifiers only. The log holds counts and nothing else - no identifier, no address, no phone.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../../../platform/jobs/index.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { CLOCK, DATABASE, LOGGER } from '../../../platform/tokens.ts';
import { AdministratorDirectory } from '../../identity/index.ts';
import { reminderHorizon } from '../domain/site-survey-extension.ts';
import { dueSurveyIds, lockDueSurvey, markReminded } from '../infrastructure/site-survey-reminder-store.ts';
import { workOrderTables } from '../infrastructure/tables.ts';

export const SITE_SURVEY_REMINDER_JOB = 'work-orders.site-survey-reminder';
export const SITE_SURVEY_REMINDER_FAILED = 'site_survey_reminder_failed';
/** Every day at 07:10 in the business zone, before the office starts; a missed run is made up by the next one (the surveys are still due). */
export const SITE_SURVEY_REMINDER_SCHEDULE: JobSchedule = { cron: '10 7 * * *', timezone: 'Europe/Warsaw' };
/** The most surveys one run reminds of (the limit of open surveys is 100 in all; the rest waits for the next run). */
export const SITE_SURVEY_REMINDER_BATCH = 200;

@Injectable()
export class SiteSurveyReminderJob {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #administrators: AdministratorDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(LOGGER) logger: Logger,
    @Inject(AdministratorDirectory) administrators: AdministratorDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#logger = logger;
    this.#administrators = administrators;
  }

  definition(): JobDefinition {
    return { name: SITE_SURVEY_REMINDER_JOB, schedule: SITE_SURVEY_REMINDER_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    const now = this.#clock.now();
    const horizon = reminderHorizon(now);
    let ids: string[];
    try {
      ids = await dueSurveyIds(workOrderTables(this.#db), horizon, SITE_SURVEY_REMINDER_BATCH);
    } catch (error) {
      this.#logFailure(error, 'site survey reminder: the search failed');
      throw new JobFailure(SITE_SURVEY_REMINDER_FAILED);
    }
    let surveys = 0;
    let messages = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const written = await runInTransaction(this.#db, (tx) => this.#remind(tx, id, horizon, now));
        if (written > 0) surveys += 1;
        messages += written;
      } catch (error) {
        failed += 1;
        this.#logFailure(error, 'site survey reminder: one survey failed');
      }
    }
    const counts: JobCounts = { due: ids.length, surveys, messages, failed };
    this.#logger.info({ job: SITE_SURVEY_REMINDER_JOB, ...counts }, 'site survey reminder: done');
    if (failed > 0) throw new JobFailure(SITE_SURVEY_REMINDER_FAILED);
    return counts;
  }

  /** One survey in one transaction: the lock, the messages and the mark. @returns how many messages were written (0 - not due any more or locked) */
  async #remind(tx: Kysely<Database>, id: string, horizon: Date, now: Date): Promise<number> {
    const tables = workOrderTables(tx);
    const survey = await lockDueSurvey(tables, id, horizon);
    if (survey === undefined) return 0;
    const recipients = new Set(await this.#administrators.listActiveIds(tx));
    if (survey.createdBy !== null) recipients.add(survey.createdBy);
    for (const recipientUserId of recipients) {
      await enqueueEmail(tx, { kind: 'site_survey_expiring', variant: null, recipientUserId, subjectId: survey.id, now });
    }
    await markReminded(tables, survey.id, now);
    return recipients.size;
  }

  #logFailure(error: unknown, message: string): void {
    const code = (error as { code?: unknown } | null)?.code;
    this.#logger.error(
      {
        job: SITE_SURVEY_REMINDER_JOB,
        errorType: error instanceof Error ? error.name : 'unknown',
        errorCode: typeof code === 'string' ? code : undefined,
      },
      message,
    );
  }
}
