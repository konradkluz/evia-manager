/**
 * "Eksportuj zdjęcia (ZIP)" - the order of a ZIP export of the photos of a work order (EVM-052 AC1, AC2, AC3, AC5; ADR-0009; P10; SR-FILE-07, SR-FILE-09, SR-SESS-08,
 * SR-AUTHZ-05, SR-LOG-03, SR-LOG-07). The guard has decided before this runs (Administrator or Editor, web channel, a fresh step-up, CSRF): Read-only gets
 * `403 forbidden`, an Administrator or an Editor with an old authentication `403 step_up_required`.
 *
 * ONE transaction. The order of the answer: the path (`400`) -> the order through the read policy (`404`) -> the storage of the exports (`503`) -> the
 * `Idempotency-Key` (`400`) -> the idempotency port (a repeat returns the stored export BEFORE any limit is looked at, so it is never counted twice; the same key
 * for another order or the same order with other rules is `422`) -> a lock of the user (two concurrent orders of one user cannot both pass the limits: one `202`,
 * one `429`) -> the limits of the user (`429 export_rate_limited`, `Retry-After`) -> the set of the photos (`409 no_media_to_export`; the size above 10 GiB `429
 * export_too_large`) -> the row, the audit `media_export.requested`, an e-mail to EVERY active Administrator (the link to the order and nothing else) and the alert
 * `media_export_started` - all in this transaction, so a rollback leaves no mail, no alert and no row.
 *
 * A refusal by a limit is audited (`media_export.rate_limited`, the requester and the export-less object: the order) in a transaction of its own, because the
 * request ends in an error and its own transaction is rolled back. The worker builds the archive from the table (the table is the queue).
 */
import type { CreatedMediaExport } from '@evia/contracts';
import { zCreateMediaExportPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { enqueueSecurityAlert } from '../../../platform/alerts/security-alerts.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { newTraceId } from '../../../platform/http/request-context.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { EXPORT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { AdministratorDirectory } from '../../identity/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import {
  EXPORT_LIFETIME_MS,
  EXPORT_MAX_BYTES,
  EXPORT_MAX_FILES,
  EXPORT_WINDOW_MS,
  decideRate,
  exportObjectKey,
  planEntries,
  planSizes,
} from '../domain/export-plan.ts';
import type { MediaAuditEvent } from '../events.ts';
import { exportCandidates, exportTimesOf, insertExport, lockUserExports } from '../infrastructure/export-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { idempotencyKeyOf, requireStorage } from './media-support.ts';

export const MEDIA_EXPORT_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/media-exports';
const scopeOf = (workOrderId: string): string => MEDIA_EXPORT_SCOPE.replace('{workOrderId}', workOrderId);
/** The cap of `Retry-After` in the contract (the shared `RateLimited` response says 3600): a longer wait is told as an hour. */
const RETRY_AFTER_CAP_SECONDS = 3600;

const pathSchema = strictObjects(zCreateMediaExportPath);

/** A refusal by a limit, thrown inside the transaction (rolls it back) and answered after the audit of the refusal. */
class LimitRefusal extends Error {
  readonly code: 'export_rate_limited' | 'export_too_large';
  readonly retryAfterSeconds: number | undefined;

  constructor(code: 'export_rate_limited' | 'export_too_large', retryAfterSeconds?: number) {
    super(code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface MediaExportRequested {
  readonly created: CreatedMediaExport;
  readonly replayed: boolean;
}

@Injectable()
export class RequestMediaExportService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;
  readonly #administrators: AdministratorDirectory;
  readonly #storage: ObjectStorage | null;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(AdministratorDirectory) administrators: AdministratorDirectory,
    @Inject(EXPORT_STORAGE) storage: ObjectStorage | null,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
    this.#administrators = administrators;
    this.#storage = storage;
  }

  async create(principal: Principal, rawParams: unknown, rawKey: string | undefined, context: EventContext): Promise<MediaExportRequested> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const request = { ...context, sessionId: principal.sessionId };
    try {
      return await runInTransaction(this.#db, async (tx) => {
        const order = await this.#orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) throw new ProblemException('not_found');
        requireStorage(this.#storage);
        const key = idempotencyKeyOf(rawKey);
        let exportId = '';
        const perform = async () => {
          exportId = await this.#perform(tx, principal, order.id, request);
          return { value: exportId, result: { status: 202, code: 'media_export_requested', resourceId: exportId } };
        };
        const outcome = await this.#idempotency.run(
          tx,
          { userId: principal.userId, deviceId: null, key, scope: scopeOf(order.id), bodyHash: requestHash({}) },
          perform,
        );
        const id = outcome.replayed ? (outcome.result.resourceId ?? '') : exportId;
        return { created: { exportId: id, state: 'queued' as const }, replayed: outcome.replayed };
      });
    } catch (error) {
      if (!(error instanceof LimitRefusal)) throw error;
      await this.#auditRefusal(principal, workOrderId, context);
      throw new ProblemException(
        error.code,
        error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: Math.min(error.retryAfterSeconds, RETRY_AFTER_CAP_SECONDS) },
      );
    }
  }

  async #perform(tx: Kysely<Database>, principal: Principal, workOrderId: string, context: EventContext): Promise<string> {
    const now = this.#clock.now();
    const tables = mediaTables(tx);
    await lockUserExports(tx, principal.userId);
    const decision = decideRate(await exportTimesOf(tables, principal.userId, new Date(now.getTime() - EXPORT_WINDOW_MS)), now);
    if (!decision.allowed) throw new LimitRefusal('export_rate_limited', decision.retryAfterSeconds);

    const entries = planEntries(await exportCandidates(tables, workOrderId));
    if (entries.length === 0) throw new ProblemException('no_media_to_export');
    if (entries.length > EXPORT_MAX_FILES || planSizes(entries).archiveBytes > EXPORT_MAX_BYTES) throw new LimitRefusal('export_too_large');

    const { rows } = await sql<{ id: string }>`select uuidv7() as id`.execute(tx);
    const id = rows[0]?.id ?? '';
    await insertExport(tables, {
      id,
      work_order_id: workOrderId,
      requested_by: principal.userId,
      object_key: exportObjectKey(id, now),
      created_at: now,
      expires_at: new Date(now.getTime() + EXPORT_LIFETIME_MS),
    });
    await this.#publish(tx, 'media_export.requested', 'success', principal, id, context);
    for (const recipientUserId of await this.#administrators.listActiveIds(tx)) {
      await enqueueEmail(tx, {
        kind: 'administrator_alert',
        variant: 'administrator_media_export_started',
        recipientUserId,
        subjectId: workOrderId,
        now,
      });
    }
    await enqueueSecurityAlert(tx, { code: 'media_export_started', occurredAt: now, traceId: context.traceId || newTraceId() });
    return id;
  }

  /** The object of the refusal is the ORDER (there is no export to name); the actor is the requester. Nothing else is recorded. */
  #auditRefusal(principal: Principal, workOrderId: string, context: EventContext): Promise<void> {
    return runInTransaction(this.#db, (tx) =>
      this.#publish(
        tx,
        'media_export.rate_limited',
        'denied',
        principal,
        workOrderId,
        { ...context, sessionId: principal.sessionId },
        'work_order',
      ),
    );
  }

  #publish(
    tx: Kysely<Database>,
    type: MediaAuditEvent['type'],
    outcome: MediaAuditEvent['outcome'],
    principal: Principal,
    objectId: string,
    context: EventContext,
    objectType: 'media_export' | 'work_order' = 'media_export',
  ): Promise<void> {
    const event: MediaAuditEvent = {
      type,
      actor: { type: 'user', userId: principal.userId },
      outcome,
      objectType,
      objectId,
    };
    return this.#events.publish(tx, event, context);
  }
}
