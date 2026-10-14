/**
 * The deletion of a payment milestone — "Usuń transzę…", a correction of the Administrator with a step-up (EVM-057 AC4, AC6–AC8;
 * EVM-054 Q1; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-10, SR-LOG-03, SR-SESS-08, ASVS V2.3.3, CWE-639).
 * Soft delete: the row stays (`deleted_at`, `deleted_by`), the milestone leaves every list, total and signal of payments for every
 * role, and the live ones after it move up by one place. The guard has decided before this runs: the Administrator on the web channel
 * with a valid CSRF token and an authentication with a passkey in the last 15 minutes (`stepUp` of the operation in the contract) —
 * the Editor and Read-only get `403 forbidden`, the Administrator without a fresh step-up `403 step_up_required`, an anonymous caller
 * `401`, none of them reaching the headers.
 *
 * Order: the path and the `Idempotency-Key` (`400`) before the database is asked. Then ONE transaction, and every decision in it is
 * taken on rows LOCKED until it ends — the order first, then the milestone (the one order of locks of the module):
 *   1. the ORDER is locked through the facade of `work-orders` (`FOR NO KEY UPDATE`, the read policy in that query): missing or soft
 *      deleted is `404 not_found`;
 *   2. `If-Match` (`428` / `400`);
 *   3. the idempotency port (when there is a key), BEFORE the milestone is looked for: a repeat of the same key, order and milestone
 *      answers `204` although the milestone is gone — a retry after a lost answer is the same command, not a `404`. The key is bound to
 *      the ORDER and the MILESTONE (the same key for another milestone — `422 idempotency_mismatch`);
 *   4. the MILESTONE is locked with `id AND work_order_id AND deleted_at IS NULL` in ONE condition: a milestone of another order, one
 *      that does not exist and one that is already deleted are the same `404 not_found` (IDOR);
 *   5. a closed order (settled or cancelled, PO-8) is `409 work_order_closed` — before the version;
 *   6. the version of the milestone (`412 version_conflict`, no current value in the answer);
 *   7. the soft delete (`version + 1`; no row there after a successful lock is a defect — `500`), the renumbering of the live
 *      milestones, the event of the audit trail (`payment_milestone.deleted`: the actor and the amount of the milestone — never its
 *      name or its invoice number), the event of the journal (`payment_milestone.removed` → the code `payment_milestone_deleted`: the
 *      milestone alone) and the idempotency record. Both events name the order, so the read model recomputes its signals of payments
 *      in the same transaction (P4). An error anywhere rolls the whole command back.
 */
import { zDeletePaymentMilestoneHeaders, zDeletePaymentMilestonePath } from '@evia/contracts/zod';
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
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory, type WorkOrderRef } from '../../work-orders/index.ts';
import type { PaymentMilestoneEvent, PaymentMilestoneRemovedEvent } from '../events.ts';
import { lockMilestone } from '../infrastructure/milestone-reader.ts';
import { compactPositions, softDeleteMilestone } from '../infrastructure/milestone-store.ts';
import { paymentTables } from '../infrastructure/tables.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the milestone. */
export const DELETE_MILESTONE_SCOPE = 'DELETE /api/v1/work-orders/{workOrderId}/payment-milestones/{milestoneId}';

/**
 * A deletion has no body, so a scope of the route alone would let the key of one milestone "replay" the deletion of another one that
 * was never deleted (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841).
 */
export const deleteMilestoneScope = (workOrderId: string, milestoneId: string): string =>
  DELETE_MILESTONE_SCOPE.replace('{workOrderId}', workOrderId).replace('{milestoneId}', milestoneId);

const pathSchema = strictObjects(zDeletePaymentMilestonePath);
const idempotencyKeySchema = zDeletePaymentMilestoneHeaders.shape['Idempotency-Key'];

@Injectable()
export class DeleteMilestoneService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
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
    const { workOrderId, milestoneId } = parseInput(pathSchema, rawParams) as { workOrderId: string; milestoneId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(rawIfMatch);

      const perform = async () => {
        await this.#remove(tx, principal, order, milestoneId, expectedVersion, request);
        return { value: undefined, result: { status: 204, code: 'deleted', resourceId: milestoneId } };
      };
      if (key === undefined) {
        await perform();
        return false;
      }
      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: deleteMilestoneScope(order.id, milestoneId), bodyHash: requestHash(null) },
        perform,
      );
      return outcome.replayed;
    });
  }

  /** Steps 4–7 of the order described above, on the locked rows. */
  async #remove(
    tx: Kysely<Database>,
    principal: Principal,
    order: WorkOrderRef,
    milestoneId: string,
    expectedVersion: number,
    request: EventContext,
  ): Promise<void> {
    const tables = paymentTables(tx);
    const locked = await lockMilestone(tables, order.id, milestoneId);
    if (locked === undefined) throw new ProblemException('not_found');
    if (order.closed) throw new ProblemException('work_order_closed');
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const version = await softDeleteMilestone(
      tables,
      { workOrderId: order.id, milestoneId, expectedVersion },
      principal.userId,
      this.#clock.now(),
    );
    if (version === undefined) throw new ProblemException('internal_error');
    await compactPositions(tables, order.id);

    const actor = { type: 'user', userId: principal.userId } as const;
    const audited: PaymentMilestoneEvent = {
      type: 'payment_milestone.deleted',
      actor,
      outcome: 'success',
      objectType: 'payment_milestone',
      objectId: milestoneId,
      workOrderId: order.id,
      amountBeforeMinor: locked.amountMinor,
      amountAfterMinor: null,
      fromCode: null,
      toCode: null,
    };
    await this.#events.publish(tx, audited, request);
    const journal: PaymentMilestoneRemovedEvent = {
      type: 'payment_milestone.removed',
      actor,
      outcome: 'success',
      objectType: 'payment_milestone',
      objectId: milestoneId,
      workOrderId: order.id,
    };
    await this.#events.publish(tx, journal, request);
  }
}
