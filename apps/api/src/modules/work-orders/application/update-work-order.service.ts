/**
 * The change of the data of a work order — the title, the description, the coordinator and the planned date (EVM-035 AC1, AC6, AC7,
 * AC8; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-02, SR-INPUT-05, SR-DATA-02,
 * SR-LOG-02, SR-LOG-03, ASVS V2.3.3, CWE-639, CWE-915). The guard has decided before this runs: a signed-in Administrator or Editor
 * on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401 without reaching the headers or the
 * body.
 *
 * ONE transaction, and every decision in it is taken on the order LOCKED with `SELECT … FOR UPDATE` (the read policy is in that
 * query), never on an earlier read (TOCTOU). The order:
 *   1. the order is locked: missing or soft deleted is `404 not_found`, the same for every role — BEFORE the headers and the body,
 *      so a malformed request tells a caller nothing about an order that is not theirs;
 *   2. `If-Match` (`428` / `400`) and the body (the schema of the contract, strict: a field of the server — `number`, `status`,
 *      `customerId`, `siteId`, `version` … — is `read_only_field`, a stranger `unknown_field`) and the rules of the domain (plain
 *      text, a title that is not empty, the range of the date): `400`, pointers and codes, never values;
 *   3. the idempotency port (when there is a key): a repeat of the same key, order and body returns the stored result BEFORE the
 *      checks below. The key is bound to the ORDER: the same key and body on another order is `422 idempotency_mismatch`;
 *   4. a closed order (settled or cancelled, PO-8) is `409 work_order_closed` — before the version, so a client with a stale tag
 *      learns the true reason;
 *   5. the version (`412 version_conflict`, no current value in the answer, the data stay as they were);
 *   6. the coordinator, when a CHANGE is named: an ACTIVE user, read in this transaction; one who is missing, invited, deactivated
 *      or deleted is the ONE answer `400` (`/assigneeUserId`, `assignee_unavailable`) — no way to enumerate accounts;
 *   7. the update (`version + 1`) and the coordinator, the event `work_order.updated` for the audit trail (the actor and the order —
 *      no value, no name of a field), the event of the JOURNAL (EVM-038: the NAMES of the fields that really changed), the
 *      idempotency record. An error anywhere rolls the whole command back.
 * A patch that changes nothing writes nothing (no version, no event) and answers the order as it is. The title and the description
 * are free text that may name a person: they go into the columns of the order and nowhere else — not into a log, an event, the
 * journal, an error or the idempotency record (only the hash of the body).
 */
import { zUpdateWorkOrderHeaders, zUpdateWorkOrderPath, zWorkOrderDetails, zWorkOrderPatch } from '@evia/contracts/zod';
import type { WorkOrderDetails } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { UserDirectory } from '../../identity/index.ts';
import { CLOSED_STATUSES } from '../domain/work-order-list-query.ts';
import {
  changedFieldsOf,
  normalizeWorkOrderPatch,
  type WorkOrderField,
  type WorkOrderPatch,
  type WorkOrderPatchInput,
} from '../domain/work-order-patch.ts';
import type { WorkOrderEvent, WorkOrderFieldsChangedEvent } from '../events.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import {
  lockWorkOrderForEdit,
  replaceCoordinator,
  updateWorkOrderData,
  type EditableWorkOrderRow,
} from '../infrastructure/work-order-edit-store.ts';
import { findCoordinatorUserId } from '../infrastructure/work-order-store.ts';
import { ReadWorkOrderService } from './read-work-order.service.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order (see {@link updateWorkOrderScope}). */
export const UPDATE_WORK_ORDER_SCOPE = 'PATCH /api/v1/work-orders/{workOrderId}';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE ORDER. A patch such as `{"description":null}`
 * says nothing of the order, so a scope of the route alone would let the key of one order "replay" the change for another one that
 * was never changed (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841).
 */
export const updateWorkOrderScope = (workOrderId: string): string => UPDATE_WORK_ORDER_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zUpdateWorkOrderPath);
const patchBody = strictObjects(zWorkOrderPatch);
const idempotencyKeySchema = zUpdateWorkOrderHeaders.shape['Idempotency-Key'];

/**
 * The fields of the server that a patch names in vain: the keys of the header of the order that the patch lacks (derived from the
 * contract: the number, the status, the version …) and the columns of the model that the header does not return (the customer and
 * the site by id, the template, the reason of a status, the author …): all are `read_only_field`, not `unknown_field` (SR-AUTHZ-04).
 */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zWorkOrderDetails, zWorkOrderPatch),
  'customerId',
  'siteId',
  'sourceTemplateId',
  'statusReason',
  'scopeItems',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deletedAt',
  'deletedBy',
]);

export interface UpdatedWorkOrder {
  readonly workOrder: WorkOrderDetails;
  /** True when the answer repeats an earlier change (same key, order and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class UpdateWorkOrderService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #users: UserDirectory;
  readonly #reads: ReadWorkOrderService;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(UserDirectory) users: UserDirectory,
    @Inject(ReadWorkOrderService) reads: ReadWorkOrderService,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#users = users;
    this.#reads = reads;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   */
  async update(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<UpdatedWorkOrder> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return this.#db.transaction().execute(async (tx) => {
      const locked = await lockWorkOrderForEdit(workOrderTables(tx), principal, workOrderId);
      if (locked === undefined) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(rawIfMatch);
      const body = parseInput(patchBody, rawBody, SERVER_FIELDS) as WorkOrderPatchInput;
      const normalized = normalizeWorkOrderPatch(body);
      if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });

      const perform = async () => {
        await this.#perform(tx, principal, locked, expectedVersion, normalized.patch, request);
        return { value: undefined, result: { status: 200, code: 'updated', resourceId: workOrderId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: updateWorkOrderScope(workOrderId), bodyHash: requestHash(body) },
                perform,
              )
            ).replayed;
      return { workOrder: await this.#reads.detailsOf(tx, principal, workOrderId), replayed };
    });
  }

  /** Steps 4–7 of the order described above, on the locked row. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    locked: EditableWorkOrderRow,
    expectedVersion: number,
    patch: WorkOrderPatch,
    request: EventContext,
  ): Promise<void> {
    if (CLOSED_STATUSES.includes(locked.status)) throw new ProblemException('work_order_closed');
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const tables = workOrderTables(tx);
    const coordinatorUserId = (await findCoordinatorUserId(tables, locked.id)) ?? null;
    const changed = changedFieldsOf(patch, {
      title: locked.title,
      description: locked.description,
      plannedDate: locked.planned_date,
      coordinatorUserId,
    });
    if (changed.length === 0) return;
    const newCoordinator = changed.includes('coordinator') ? patch.assigneeUserId : undefined;
    if (newCoordinator !== undefined) await this.#requireActiveUser(tx, newCoordinator);

    const now = this.#clock.now();
    await updateWorkOrderData(
      tables,
      locked.id,
      expectedVersion,
      {
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.plannedDate === undefined ? {} : { plannedDate: patch.plannedDate }),
      },
      principal.userId,
      now,
    );
    if (newCoordinator !== undefined) await replaceCoordinator(tables, locked.id, newCoordinator, principal.userId, now);
    await this.#publish(tx, principal, locked.id, changed, request);
  }

  async #publish(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderId: string,
    changedFields: readonly WorkOrderField[],
    request: EventContext,
  ): Promise<void> {
    const actor = { type: 'user', userId: principal.userId } as const;
    const audited: WorkOrderEvent = {
      type: 'work_order.updated',
      actor,
      outcome: 'success',
      objectType: 'work_order',
      objectId: workOrderId,
    };
    await this.#events.publish(tx, audited, request);
    // the journal (EVM-035 AC7, EVM-038): the NAMES of the fields that changed — never the title, the description or the person
    const journal: WorkOrderFieldsChangedEvent = {
      type: 'work_order.fields_changed',
      actor,
      outcome: 'success',
      objectType: 'work_order',
      objectId: workOrderId,
      changedFields,
    };
    await this.#events.publish(tx, journal, request);
  }

  /** A named user must be ACTIVE — the one answer for every other state of an account. */
  async #requireActiveUser(tx: Kysely<Database>, userId: string): Promise<void> {
    if ((await this.#users.findActive(userId, tx)) === undefined) {
      throw new ProblemException('validation_failed', { errors: [{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }] });
    }
  }
}
