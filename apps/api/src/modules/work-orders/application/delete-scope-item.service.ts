/**
 * The removal of an item from the scope of a work order (EVM-035 AC3, AC6, AC7, AC8; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02,
 * SR-AUTHZ-05, SR-LOG-03, ASVS V2.3.3, CWE-639). Soft delete: the row stays, the item leaves the scope, the others are numbered
 * 1…n again, and the processes the item brought STAY (the user decides about them — EVM-042). The guard has decided before this
 * runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller
 * 401 without reaching the headers.
 *
 * ONE transaction, and every decision in it is taken on rows LOCKED with `SELECT … FOR NO KEY UPDATE`, never on an earlier read:
 *   1. the ORDER is locked (the read policy is in that query): missing or soft deleted is `404 not_found`, the same for every role;
 *   2. `If-Match` (`428` / `400`);
 *   3. the idempotency port (when there is a key), BEFORE the item is looked for: a repeat of the same key, order and item answers
 *      `204` although the item is gone — a retry after a lost answer is the same command, not a `404`. The key is bound to the
 *      ORDER and the ITEM;
 *   4. the ITEM is locked with `id AND work_order_id` in ONE condition: an item of another order, one that does not exist and one
 *      that is already deleted are the same `404 not_found` (IDOR);
 *   5. a closed order (settled or cancelled, PO-8) is `409 work_order_closed` — before the version;
 *   6. the version of the ITEM (`412 version_conflict`);
 *   7. the soft delete, the renumbering, the event `scope_item.deleted` for the audit trail (an action of its own: the removal of a
 *      record is always told apart in the trail), the event of the JOURNAL (EVM-038: the code of the item), the idempotency record.
 *      An error anywhere rolls the whole command back.
 */
import { zDeleteWorkOrderScopeItemHeaders, zDeleteWorkOrderScopeItemPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { CLOSED_STATUSES, type WorkOrderStatus } from '../domain/work-order-status.ts';
import type { ScopeItemRemovedEvent, WorkOrderEvent } from '../events.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { findScopeItem, renumberScopeItems, softDeleteScopeItem } from '../infrastructure/work-order-edit-store.ts';
import { findVisibleWorkOrderRef } from '../infrastructure/work-order-store.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the item (see {@link deleteScopeItemScope}). */
export const DELETE_SCOPE_ITEM_SCOPE = 'DELETE /api/v1/work-orders/{workOrderId}/scope-items/{scopeItemId}';

/**
 * What an idempotency key is bound to besides the user: the method, the route, THE ORDER and THE ITEM. A removal has no body, so a
 * scope of the route alone would let the key of one item "replay" the removal of another (ASVS V2.3.1, SR-API-05, CWE-841).
 */
export const deleteScopeItemScope = (workOrderId: string, scopeItemId: string): string =>
  DELETE_SCOPE_ITEM_SCOPE.replace('{workOrderId}', workOrderId).replace('{scopeItemId}', scopeItemId);

const pathSchema = strictObjects(zDeleteWorkOrderScopeItemPath);
const idempotencyKeySchema = zDeleteWorkOrderScopeItemHeaders.shape['Idempotency-Key'];

@Injectable()
export class DeleteScopeItemService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   * @returns `true` when the answer repeats an earlier removal (`Idempotent-Replayed: true`)
   */
  async delete(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<boolean> {
    const { workOrderId, scopeItemId } = parseInput(pathSchema, rawParams) as { workOrderId: string; scopeItemId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await findVisibleWorkOrderRef(workOrderTables(tx), principal, workOrderId, { lock: true });
      if (order === undefined) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(rawIfMatch);

      const perform = async () => {
        await this.#remove(tx, principal, order, scopeItemId, expectedVersion, request);
        return { value: undefined, result: { status: 204, code: 'deleted', resourceId: scopeItemId } };
      };
      if (key === undefined) {
        await perform();
        return false;
      }
      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: deleteScopeItemScope(order.id, scopeItemId), bodyHash: requestHash(null) },
        perform,
      );
      return outcome.replayed;
    });
  }

  /** Steps 4–7 of the order described above, on the locked rows. */
  async #remove(
    tx: Kysely<Database>,
    principal: Principal,
    order: { readonly id: string; readonly status: WorkOrderStatus },
    scopeItemId: string,
    expectedVersion: number,
    request: EventContext,
  ): Promise<void> {
    const tables = workOrderTables(tx);
    const locked = await findScopeItem(tables, order.id, scopeItemId, { lock: true });
    if (locked === undefined) throw new ProblemException('not_found');
    if (CLOSED_STATUSES.includes(order.status)) throw new ProblemException('work_order_closed');
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    await softDeleteScopeItem(tables, order.id, scopeItemId, expectedVersion, principal.userId, this.#clock.now());
    await renumberScopeItems(tables, order.id);

    const actor = { type: 'user', userId: principal.userId } as const;
    const audited: WorkOrderEvent = {
      type: 'scope_item.deleted',
      actor,
      outcome: 'success',
      objectType: 'scope_item',
      objectId: scopeItemId,
    };
    await this.#events.publish(tx, audited, request);
    const journal: ScopeItemRemovedEvent = {
      type: 'work_order.scope_item_removed',
      actor,
      outcome: 'success',
      objectType: 'scope_item',
      objectId: scopeItemId,
      workOrderId: order.id,
      itemCode: locked.code,
    };
    await this.#events.publish(tx, journal, request);
  }
}
