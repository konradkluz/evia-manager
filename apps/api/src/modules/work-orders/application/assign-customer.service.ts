/**
 * The assignment of a customer to a site survey (EVM-136 AC1-AC3; ADR-0024 pt 3; SR-AUTHZ-02, SR-AUTHZ-05, SR-API-05, SR-API-06, SR-LOG-03; ASVS V2.3.1,
 * V2.3.3; CWE-639, CWE-841). The guard has decided before this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token - Read-only
 * gets 403 and an anonymous caller 401 without reaching the body.
 *
 * ONE transaction; every decision is taken on the order LOCKED with `SELECT ... FOR NO KEY UPDATE` (the read policy is in that query), never on an earlier read.
 * The customer is locked `FOR KEY SHARE` AFTER the order (one order of locks: the order, then the customer - the deletion of a customer takes `FOR UPDATE` of the
 * customer and reads the orders without a lock, so there is no cycle). The order of the steps:
 *   1. the order: missing, soft deleted and not visible are ONE `404 not_found`, before the body (a malformed request tells nothing of an order that is not
 *      the caller's);
 *   2. the body (the strict schema of the contract; a field of the server is `read_only_field`);
 *   3. the idempotency port (with a key): a repeat of the same key, order and body returns the stored result BEFORE every other decision; the key is bound to the
 *      ORDER (the same key and body on another order is `422 idempotency_mismatch`);
 *   4. the decision of the domain ({@link decideAssignment}): the same customer - `200` without a change (before the version); another customer or an
 *      order that is no survey - `409 customer_already_set`; a cancelled survey - `409 invalid_state_transition`; a stale version - `412 version_conflict`;
 *   5. the customer: missing, deleted, anonymized and invisible are ONE `422 customer_unavailable`;
 *   6. the update (one `UPDATE`), the event of the audit trail and of the journal (identifiers only), the idempotency record. An error anywhere rolls all back.
 * The phone of the requester and the address of the survey are never read here, so they cannot reach a log, an event or an answer except as the detail of
 * the order the caller may read (DO-K).
 */
import {
  zAssignWorkOrderCustomerHeaders,
  zAssignWorkOrderCustomerPath,
  zAssignWorkOrderCustomerRequest,
  zWorkOrderDetails,
} from '@evia/contracts/zod';
import type { WorkOrderDetails } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { decideAssignment } from '../domain/customer-assignment.ts';
import type { WorkOrderCustomerAssignedEvent } from '../events.ts';
import {
  assignCustomerToSurvey,
  lockWorkOrderForCustomerAssignment,
  type AssignableWorkOrderRow,
} from '../infrastructure/customer-assignment-store.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { ReadWorkOrderService } from './read-work-order.service.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order (see {@link assignCustomerScope}). */
export const ASSIGN_CUSTOMER_SCOPE = 'PUT /api/v1/work-orders/{workOrderId}/customer';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE ORDER. The body names a customer, not the order, so a scope of the route
 * alone would let the key of one order replay "done" for another order that was never changed (ASVS V2.3.1, CWE-841).
 */
export const assignCustomerScope = (workOrderId: string): string => ASSIGN_CUSTOMER_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zAssignWorkOrderCustomerPath);
const assignBody = strictObjects(zAssignWorkOrderCustomerRequest);
/** The fields of the server that a command names in vain: the keys of the order that the command lacks (derived from the contract). */
const SERVER_FIELDS = readOnlyKeys(zWorkOrderDetails, zAssignWorkOrderCustomerRequest);
const idempotencyKeySchema = zAssignWorkOrderCustomerHeaders.shape['Idempotency-Key'];

interface AssignBody {
  readonly customerId: string;
  readonly version: number;
}

export interface AssignedWorkOrder {
  readonly workOrder: WorkOrderDetails;
  /** True when the answer repeats an earlier command (same key, order and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class AssignCustomerService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #customers: CustomerDirectory;
  readonly #reads: ReadWorkOrderService;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory,
    @Inject(ReadWorkOrderService) reads: ReadWorkOrderService,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#customers = customers;
    this.#reads = reads;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   */
  async assign(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<AssignedWorkOrder> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const locked = await lockWorkOrderForCustomerAssignment(workOrderTables(tx), principal, workOrderId);
      if (locked === undefined) throw new ProblemException('not_found');
      const body = parseInput(assignBody, rawBody, SERVER_FIELDS) as AssignBody;

      const perform = async () => {
        await this.#perform(tx, principal, locked, body, request);
        return { value: undefined, result: { status: 200, code: 'customer_assigned', resourceId: workOrderId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: assignCustomerScope(workOrderId), bodyHash: requestHash(body) },
                perform,
              )
            ).replayed;
      return { workOrder: await this.#reads.detailsOf(tx, principal, workOrderId), replayed };
    });
  }

  /** Steps 4-6 of the order described above, on the locked row. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    locked: AssignableWorkOrderRow,
    body: AssignBody,
    request: EventContext,
  ): Promise<void> {
    const decision = decideAssignment(body, {
      customerId: locked.customer_id,
      siteSurveyExpiresAt: locked.site_survey_expires_at,
      status: locked.status,
      version: locked.version,
    });
    if (decision.kind === 'noop') return;
    if (decision.kind === 'refuse') throw new ProblemException(decision.code);

    if (!(await this.#customers.lockUsable(tx, principal, body.customerId))) throw new ProblemException('customer_unavailable');
    const version = await assignCustomerToSurvey(
      workOrderTables(tx),
      locked.id,
      locked.version,
      body.customerId,
      principal.userId,
      this.#clock.now(),
    );
    if (version === undefined) throw new ProblemException('internal_error');

    const event: WorkOrderCustomerAssignedEvent = {
      type: 'work_order.customer_assigned',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'work_order',
      objectId: locked.id,
      customerId: body.customerId,
    };
    await this.#events.publish(tx, event, request);
  }
}
