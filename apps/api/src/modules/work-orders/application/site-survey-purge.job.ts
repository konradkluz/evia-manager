/**
 * The automatic purge of site surveys (EVM-139 AC1-AC6; ADR-0024 pt 9; SR-PRIV-11, SR-PRIV-04, SR-FILE-11, SR-LOG-03, DO-K): a job of the worker, once a day, in one of two modes.
 *
 * - `report` (the DEFAULT, `SITE_SURVEY_PURGE_MODE`): counts the candidates - the surveys with the three conditions `site_survey_expires_at < now AND customer_id IS NULL AND
 *   site_survey_purged_at IS NULL` - and writes the count to the log and to the gauge `site_survey_purge_candidates`; the participants count what they would erase (EVM-147:
 *   the documents of the candidates and the versions whose `change_note` breaks the invariant - gauges `site_survey_purge_candidate_documents` and
 *   `site_survey_purge_change_note_violations`, numbers only). It changes NOTHING.
 * - `enforce` (the decision of the owner after the backups run): erases at most `SITE_SURVEY_PURGE_LIMIT_PER_RUN` candidates. For EACH survey, in ONE transaction of its own:
 *     1. the survey LOCKED with the three conditions asked again (a customer assigned in the last moment wins: the survey is no candidate any more);
 *     2. the participants say which identifiers they will touch (the media, the documents - EVM-147; whether they hold the location) - reads only;
 *     3. the location, when it was made for the survey and nothing else holds it, LOCKED `FOR UPDATE` (a new order pointing at it waits for the commit);
 *     4. THE ENTRY IN THE REGISTER OF DELETIONS (identifiers only; the actor is the system) - before anything is changed; a register that refuses (not configured, no key,
 *        down) rolls the transaction back: the survey is untouched, the failure is audited and alerted;
 *     5. the participants erase (the files of the media - rows marked, the entries of the journal redacted, the free text of the stages); the location anonymized; the survey becomes the TOMBSTONE (neutral
 *        title, no description, no phone, no free text of the reason, soft deleted, `site_survey_purged_at`), the number stays; the documents of the order are erased like the
 *        media (EVM-147; ADR-0025 pt 4) - a `change_note` that is not `NULL` is a FAILURE with the reason `change_note_invariant` (fail closed: the survey stays, audited and
 *        alerted with `site_survey_purge_failed`); the event `work_order.site_survey_purged`
 *        (audit, projection) - identifiers only. The free text of the scope items (`notes`) is cleared here; the reasons, notes and typed names of the stages by `procedures` (a participant). The trigger of `sync.change_log` writes the `delete` markers (identifiers only).
 *        A medium committed while the register was written (the lock of the order does not stop an insert) makes `erase` of the media throw `SurveyChangedDuringPurge`: the
 *        transaction rolls back, the survey is untouched, the next run takes it (counted as `changedDuringPurge`, no alert, no failure). The media are marked by identifier.
 *     COMMIT; THEN the objects of the files are removed from the storage. A storage that fails there leaves `erased_at` set and `objects_erased_at` empty: the sweep of
 *     `ErasureCompletionJob` (EVM-051) finishes the removal, so nothing is orphaned and the survey - already purged - is never a candidate again (no second register entry).
 *
 * One survey that fails does NOT stop the others; the job ends as a `JobFailure` with a fixed code only after the pass, so the queue retries what is left. The register is a
 * journal of INTENT with at-least-once semantics (`deletion-register.ts`): an entry written for a survey whose transaction then rolled back stays as an orphan - harmless, the
 * replay of it is idempotent. The log, the metrics and the events hold counts and identifiers of orders only - never an address, a phone, a title or a file name.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { enqueueSecurityAlert } from '../../../platform/alerts/security-alerts.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { AppConfig } from '../../../platform/config/config.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import {
  DELETION_REGISTER,
  DeletionRegisterUnavailable,
  type DeletionRegister,
} from '../../../platform/deletion-register/deletion-register.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { newTraceId } from '../../../platform/http/request-context.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobSchedule } from '../../../platform/jobs/index.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import type { MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { SYSTEM_ACTOR_ID } from '../../../platform/system-actor.ts';
import { APP_CONFIG, CLOCK, DATABASE, EVENT_BUS, LOGGER, METRICS } from '../../../platform/tokens.ts';
import { SITE_ANONYMIZATION, type SiteAnonymization } from '../../sites/index.ts';
import { SITE_SURVEY_PURGE_LIMIT_PER_RUN, siteMadeForSurveyWindow, type SiteSurveyPurgeMode } from '../domain/site-survey-purge.ts';
import type { WorkOrderEvent } from '../events.ts';
import {
  candidateIds,
  clearScopeItemNotes,
  countCandidates,
  lockCandidate,
  siteHeldByAnotherOrder,
  tombstoneSurvey,
} from '../infrastructure/site-survey-purge-store.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import {
  SiteSurveyPurgeRegistry,
  SurveyChangedDuringPurge,
  SurveyPurgeInvariantViolated,
  type AfterCommit,
  type SurveyEraseContext,
  type SurveyPurgeContext,
} from '../site-survey-purge-participant.ts';

export const SITE_SURVEY_PURGE_JOB = 'work-orders.site-survey-purge';
export const SITE_SURVEY_PURGE_FAILED = 'site_survey_purge_failed';
export const SITE_SURVEY_PURGE_CANDIDATES_GAUGE = 'site_survey_purge_candidates';
export const SITE_SURVEY_PURGED_COUNTER = 'site_survey_purged_total';
export const SITE_SURVEY_PURGE_FAILURES_COUNTER = 'site_survey_purge_failures_total';
export const SITE_SURVEY_PURGE_DOCUMENTS_GAUGE = 'site_survey_purge_candidate_documents';
export const SITE_SURVEY_PURGE_CHANGE_NOTE_GAUGE = 'site_survey_purge_change_note_violations';
/** Every day at 03:20 in the business zone, in the quiet of the night; a missed run is made up by the next one (the surveys are still candidates). */
export const SITE_SURVEY_PURGE_SCHEDULE: JobSchedule = { cron: '20 3 * * *', timezone: 'Europe/Warsaw' };

type Outcome = { readonly kind: 'skipped' } | { readonly kind: 'purged'; readonly afterCommit: readonly AfterCommit[] };

@Injectable()
export class SiteSurveyPurgeJob {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #events: EventBus;
  readonly #register: DeletionRegister;
  readonly #participants: SiteSurveyPurgeRegistry;
  readonly #sites: SiteAnonymization;
  readonly #mode: SiteSurveyPurgeMode;
  readonly #candidates: ReturnType<MetricsRegistry['gauge']>;
  readonly #documents: ReturnType<MetricsRegistry['gauge']>;
  readonly #changeNotes: ReturnType<MetricsRegistry['gauge']>;
  readonly #purged: ReturnType<MetricsRegistry['counter']>;
  readonly #failures: ReturnType<MetricsRegistry['counter']>;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(LOGGER) logger: Logger,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(DELETION_REGISTER) register: DeletionRegister,
    @Inject(SiteSurveyPurgeRegistry) participants: SiteSurveyPurgeRegistry,
    @Inject(SITE_ANONYMIZATION) sites: SiteAnonymization,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#logger = logger;
    this.#events = events;
    this.#register = register;
    this.#participants = participants;
    this.#sites = sites;
    this.#mode = config.siteSurveyPurgeMode;
    this.#candidates = metrics.gauge(SITE_SURVEY_PURGE_CANDIDATES_GAUGE);
    this.#documents = metrics.gauge(SITE_SURVEY_PURGE_DOCUMENTS_GAUGE);
    this.#changeNotes = metrics.gauge(SITE_SURVEY_PURGE_CHANGE_NOTE_GAUGE);
    this.#purged = metrics.counter(SITE_SURVEY_PURGED_COUNTER, []);
    this.#failures = metrics.counter(SITE_SURVEY_PURGE_FAILURES_COUNTER, ['reason']);
  }

  definition(): JobDefinition {
    return { name: SITE_SURVEY_PURGE_JOB, schedule: SITE_SURVEY_PURGE_SCHEDULE, handler: () => this.run() };
  }

  async run(): Promise<JobCounts> {
    const now = this.#clock.now();
    const tables = workOrderTables(this.#db);
    let candidates: number;
    try {
      candidates = await countCandidates(tables, now);
    } catch (error) {
      this.#logFailure(error, 'site survey purge: the search failed');
      throw new JobFailure(SITE_SURVEY_PURGE_FAILED);
    }
    this.#candidates.set(candidates);
    if (this.#mode === 'report') return this.#report(candidates, now);
    return this.#enforce(candidates, now);
  }

  /** The mode `report`: the counts of the candidates and of what the participants would erase (EVM-147: the documents, the broken invariants) - numbers only. */
  async #report(candidates: number, now: Date): Promise<JobCounts> {
    let documents = 0;
    let changeNoteViolations = 0;
    try {
      const ids = candidates === 0 ? [] : await candidateIds(workOrderTables(this.#db), now, candidates);
      for (const participant of this.#participants.ordered()) {
        const report = await participant.report?.(this.#db, ids);
        documents += report?.documents ?? 0;
        changeNoteViolations += report?.changeNoteViolations ?? 0;
      }
    } catch (error) {
      this.#logFailure(error, 'site survey purge: the report failed');
      throw new JobFailure(SITE_SURVEY_PURGE_FAILED);
    }
    this.#documents.set(documents);
    this.#changeNotes.set(changeNoteViolations);
    const counts: JobCounts = { candidates, documents, changeNoteViolations, purged: 0, failed: 0 };
    this.#logger.info({ job: SITE_SURVEY_PURGE_JOB, mode: 'report', ...counts }, 'site survey purge: report only, nothing is erased');
    return counts;
  }

  async #enforce(candidates: number, now: Date): Promise<JobCounts> {
    let ids: string[];
    try {
      ids = await candidateIds(workOrderTables(this.#db), now, SITE_SURVEY_PURGE_LIMIT_PER_RUN);
    } catch (error) {
      this.#logFailure(error, 'site survey purge: the selection failed');
      throw new JobFailure(SITE_SURVEY_PURGE_FAILED);
    }
    let purged = 0;
    let failed = 0;
    let objectsPending = 0;
    let changed = 0;
    for (const id of ids) {
      try {
        const outcome = await runInTransaction(this.#db, (tx) => this.#purgeOne(tx, id, now));
        if (outcome.kind === 'purged') {
          purged += 1;
          this.#purged.increment({});
          objectsPending += await this.#removeObjects(outcome.afterCommit);
        }
      } catch (error) {
        if (error instanceof SurveyChangedDuringPurge) {
          // transient: a medium arrived while the register was written; the survey is untouched and is taken by the next run (no alert)
          changed += 1;
          continue;
        }
        failed += 1;
        const reason =
          error instanceof DeletionRegisterUnavailable
            ? 'register_unavailable'
            : error instanceof SurveyPurgeInvariantViolated
              ? error.code
              : 'error';
        this.#failures.increment({ reason });
        this.#logFailure(error, 'site survey purge: one survey failed; it is untouched and is retried');
        await this.#recordFailure(id);
      }
    }
    const counts: JobCounts = { candidates, taken: ids.length, purged, failed, objectsPending, changedDuringPurge: changed };
    this.#logger.info({ job: SITE_SURVEY_PURGE_JOB, mode: 'enforce', ...counts }, 'site survey purge: done');
    if (failed > 0) {
      await this.#alert(now);
      throw new JobFailure(SITE_SURVEY_PURGE_FAILED);
    }
    return counts;
  }

  /** One survey in one transaction (steps 1-5 above). */
  async #purgeOne(tx: Kysely<Database>, id: string, now: Date): Promise<Outcome> {
    const tables = workOrderTables(tx);
    const survey = await lockCandidate(tables, id, now);
    if (survey === undefined) return { kind: 'skipped' };
    const context: SurveyPurgeContext = { workOrderId: survey.id, siteId: survey.siteId, now };
    const participants = this.#participants.ordered();

    const mediaAssetIds: string[] = [];
    const documentIds: string[] = [];
    let holdsSite = false;
    for (const participant of participants) {
      const identity = await participant.identify(tx, context);
      mediaAssetIds.push(...identity.mediaAssetIds);
      documentIds.push(...identity.documentIds);
      holdsSite = holdsSite || identity.holdsSite;
    }

    let anonymizeSiteId: string | undefined;
    if (survey.siteId !== null) {
      const window = siteMadeForSurveyWindow(survey.createdAt);
      const claimed = await this.#sites.claimCreatedFor(tx, {
        siteId: survey.siteId,
        createdBy: survey.createdBy,
        createdNotBefore: window.notBefore,
        createdNotAfter: window.notAfter,
        unshared: async () => !holdsSite && !(await siteHeldByAnotherOrder(tables, survey.siteId as string, survey.id)),
      });
      if (claimed) anonymizeSiteId = survey.siteId;
    }

    // THE ENTRY IN THE REGISTER, before the first change; a refusal throws and rolls the transaction back
    await this.#register.record({
      operationCode: 'site_survey_purged',
      subjectType: 'work_order',
      subjectId: survey.id,
      workOrderId: survey.id,
      mediaAssetIds,
      // EVM-147 (ADR-0025 pt 4): additive, absent when the survey has no document
      ...(documentIds.length === 0 ? {} : { documentIds }),
      ...(anonymizeSiteId === undefined ? {} : { siteId: anonymizeSiteId }),
      actorUserId: SYSTEM_ACTOR_ID,
    });

    const afterCommit: AfterCommit[] = [];
    const eraseContext: SurveyEraseContext = { ...context, declaredMediaAssetIds: mediaAssetIds, declaredDocumentIds: documentIds };
    for (const participant of participants) {
      const step = await participant.erase(tx, eraseContext);
      if (step !== undefined) afterCommit.push(step);
    }
    await clearScopeItemNotes(tables, survey.id, SYSTEM_ACTOR_ID, now);
    if (anonymizeSiteId !== undefined) await this.#sites.anonymize(tx, anonymizeSiteId, SYSTEM_ACTOR_ID, now);
    if (!(await tombstoneSurvey(tables, survey.id, SYSTEM_ACTOR_ID, now)))
      throw new Error('site survey purge: the survey changed under the lock');
    await this.#events.publish(tx, this.#event('work_order.site_survey_purged', 'success', survey.id), {
      origin: 'cli',
      traceId: newTraceId(),
    });
    return { kind: 'purged', afterCommit };
  }

  /** The work on the storage after the commit; a failure is counted, not thrown - the sweep of the worker finishes it. @returns how many steps failed */
  async #removeObjects(steps: readonly AfterCommit[]): Promise<number> {
    let failed = 0;
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        failed += 1;
        this.#logFailure(error, 'site survey purge: the objects could not be removed; the sweep of the worker finishes it');
      }
    }
    return failed;
  }

  /** The audit trail of a survey that could not be purged: its own transaction after the rollback; a failure here is logged. */
  async #recordFailure(id: string): Promise<void> {
    try {
      await runInTransaction(this.#db, (tx) =>
        this.#events.publish(tx, this.#event('work_order.site_survey_purge_failed', 'failed', id), {
          origin: 'cli',
          traceId: newTraceId(),
        }),
      );
    } catch (error) {
      this.#logFailure(error, 'site survey purge: the audit of a failure was not written');
    }
  }

  /** One alert per run for the Administrators (the outbox of security alerts: the API emits it into the log the alert rule watches). */
  async #alert(now: Date): Promise<void> {
    try {
      await runInTransaction(this.#db, (tx) =>
        enqueueSecurityAlert(tx, { code: 'site_survey_purge_failed', occurredAt: now, traceId: newTraceId() }),
      );
    } catch (error) {
      this.#logFailure(error, 'site survey purge: the alert was not written');
    }
  }

  #event(type: WorkOrderEvent['type'], outcome: WorkOrderEvent['outcome'], id: string): WorkOrderEvent {
    return { type, actor: { type: 'system' }, outcome, objectType: 'work_order', objectId: id };
  }

  #logFailure(error: unknown, message: string): void {
    const code = (error as { code?: unknown } | null)?.code;
    this.#logger.error(
      {
        job: SITE_SURVEY_PURGE_JOB,
        errorType: error instanceof Error ? error.name : 'unknown',
        errorCode: typeof code === 'string' ? code : undefined,
      },
      message,
    );
  }
}
