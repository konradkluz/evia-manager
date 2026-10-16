/**
 * The deletion of a work order — soft delete, ADMINISTRATOR only (EVM-060 AC1, AC2, AC3, AC5, AC6; SR-AUTHZ-05, SR-AUTHZ-10, SR-SESS-08,
 * SR-API-05, SR-API-06, SR-DATA-08, SR-LOG-03, SR-ERR-01; ASVS V2.3.1, V2.3.3, V7.5.3; AB-17, TM-17, TM-21; CWE-639, CWE-841). The
 * guard has decided before this runs: a signed-in Administrator on the web channel with a valid CSRF token — the Editor and Read-only
 * get `403 forbidden` and an anonymous caller `401` without reaching the headers; the service checks the role again before it takes a lock.
 *
 * A soft delete must not hide a receivable, so the rule depends on the state of the payment milestones, which the guard cannot know —
 * the step-up is therefore NOT a condition of the operation in the contract (`stepUp: false`), it is the object policy of the use case
 * (as in EVM-030 for the restoration of a closed order). The order of the decisions — ONE transaction, every decision taken on the
 * order LOCKED with `SELECT … FOR NO KEY UPDATE` (the lock every command of payments takes on the same row, so a deletion and a milestone
 * issued in parallel are serialised), never on an earlier read:
 *   1. the order is locked in any state (this query has no read policy: it is for the Administrator alone): missing is `404 not_found`; an
 *      order that is already deleted is `404` too — the same answer — unless the request repeats a deletion with an idempotency key (step 3);
 *   2. `If-Match` (`428` / `400`);
 *   3. the idempotency port (when there is a key): a repeat of the same key and order answers `204` BEFORE the dependents are asked — a
 *      retry after a lost answer is the same command, not a `404` or a `409`. The key is bound to the user (the port), the method, the
 *      route AND the ORDER: the same key on another order, or on the restoration, is `422 idempotency_mismatch`;
 *   4. the dependents, through the participants (`payments`: a live `invoiced` milestone is `409 has_active_dependents`, with or without a
 *      `paid` one; the answer has no count, no amount and no id). An empty registry, a participant that throws or an unknown state is
 *      refused, never allowed (`500` / `409`, fail closed);
 *   5. the step-up, when a dependent asks for it (`paid`): `403 step_up_required` — one implementation of freshness, the clock of the
 *      application (15 minutes: exactly 15 is closed). The order is the guard's: a role that may not use the operation never learns it
 *      is protected;
 *   6. the version (`412 version_conflict`);
 *   7. the soft delete (`version + 1`, the actor), the event of the audit trail (`work_order.deleted`: the actor, the id and, when the
 *      step-up was needed, the code `step_up_verified` — never the title, the customer, the address or an amount) and the idempotency
 *      record. The projection of the list recomputes in the same transaction (the event names the order). A refusal at any step (`403`,
 *      `409`, `412`) rolls everything back: no idempotency record, no effect (SR-API-06).
 */
import { zDeleteWorkOrderHeaders, zDeleteWorkOrderPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { stepUpFresh } from '../../identity/index.ts';
import { WorkOrderDeletionRegistry } from '../deletion-participant.ts';
import { decideDeletion } from '../domain/work-order-deletion.ts';
import type { WorkOrderEvent } from '../events.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { lockWorkOrderAnyState, softDeleteWorkOrder, type AnyStateWorkOrderRow } from '../infrastructure/work-order-store.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order (see {@link deleteWorkOrderScope}). */
export const DELETE_WORK_ORDER_SCOPE = 'DELETE /api/v1/work-orders/{workOrderId}';

/**
 * A deletion has no body, so a scope of the route alone would let the key of one order "replay" the deletion of another one that was
 * never deleted (ASVS V2.3.1, SR-API-05, CWE-841).
 */
export const deleteWorkOrderScope = (workOrderId: string): string => DELETE_WORK_ORDER_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zDeleteWorkOrderPath);
const idempotencyKeySchema = zDeleteWorkOrderHeaders.shape['Idempotency-Key'];

@Injectable()
export class DeleteWorkOrderService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #participants: WorkOrderDeletionRegistry;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WorkOrderDeletionRegistry) participants: WorkOrderDeletionRegistry,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#participants = participants;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   * @returns `true` when the answer repeats an earlier deletion (`Idempotent-Replayed: true`)
   */
  async delete(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<boolean> {
    // the second line of defence behind the guard: the lock below has no read policy, so it is never taken for another role
    if (principal.role !== 'administrator') throw new ProblemException('forbidden');
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const locked = await lockWorkOrderAnyState(workOrderTables(tx), workOrderId);
      if (locked === undefined || (locked.deleted_at !== null && key === undefined)) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(rawIfMatch);

      const perform = async () => {
        await this.#remove(tx, principal, locked, expectedVersion, request);
        return { value: undefined, result: { status: 204, code: 'deleted', resourceId: workOrderId } };
      };
      if (key === undefined) {
        await perform();
        return false;
      }
      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: deleteWorkOrderScope(workOrderId), bodyHash: requestHash(null) },
        perform,
      );
      return outcome.replayed;
    });
  }

  /** Steps 4–7 of the order described above, on the locked row. */
  async #remove(
    tx: Kysely<Database>,
    principal: Principal,
    locked: AnyStateWorkOrderRow,
    expectedVersion: number,
    request: EventContext,
  ): Promise<void> {
    // an order that is deleted already and a key that is not a repeat: the same `404` as for an order that does not exist
    if (locked.deleted_at !== null) throw new ProblemException('not_found');
    const now = this.#clock.now();
    const assessments = await this.#participants.assessAll(tx, { workOrderId: locked.id, principal, now, request });
    const decision = decideDeletion(assessments, stepUpFresh(principal.passkeyAuthenticatedAt, now));
    switch (decision) {
      case 'blocked':
        throw new ProblemException('has_active_dependents');
      case 'step_up_required':
        throw new ProblemException('step_up_required');
      case 'allow':
        break;
    }
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const version = await softDeleteWorkOrder(workOrderTables(tx), locked.id, expectedVersion, principal.userId, now);
    if (version === undefined) throw new ProblemException('internal_error');

    const event: WorkOrderEvent = {
      type: 'work_order.deleted',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'work_order',
      objectId: locked.id,
      ...(assessments.some((assessment) => assessment.stepUpRequired) ? { reasonCode: 'step_up_verified' as const } : {}),
    };
    await this.#events.publish(tx, event, request);
  }
}
