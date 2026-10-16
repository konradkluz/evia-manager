/**
 * The restoration of a deleted work order — ADMINISTRATOR only, no step-up (EVM-060 AC4, AC6; SR-AUTHZ-05, SR-API-05, SR-API-06,
 * SR-LOG-03; ASVS V2.3.1, V2.3.3; TM-17, TM-21; CWE-639). The guard has decided before this runs: a signed-in Administrator on the web
 * channel with a valid CSRF token — the Editor and Read-only get `403 forbidden` and an anonymous caller `401`; the service checks the
 * role again before it takes a lock. There is no step-up: the restoration brings back the visibility only, it changes no milestone, no
 * status and no amount (policies.md → P5, as the restoration of a process, EVM-042); the decision is to be confirmed at the demo.
 *
 * ONE transaction, every decision taken on the order LOCKED (`FOR NO KEY UPDATE`, in any state — no read policy; Administrator alone):
 *   1. the order is locked: missing is `404 not_found`; one that is NOT deleted is `404` too (the same answer) — unless the request
 *      repeats a restoration with an idempotency key (step 3);
 *   2. `If-Match` (`428` / `400`);
 *   3. the idempotency port (when there is a key): a repeat of the same key and order answers `200` with the order as it is NOW. The key
 *      is bound to the user, the method, the route AND the ORDER (another order or the deletion — `422 idempotency_mismatch`);
 *   4. the version (`412 version_conflict`, no current values);
 *   5. the restoration (`version + 1`, the actor), the event of the audit trail (`work_order.undeleted`: the actor and the id) and the
 *      idempotency record; the projection of the list recomputes in the same transaction. An error anywhere rolls everything back.
 * The customer or the site deleted in the meantime do not block the restoration (the list shows "Klient usunięty", TM-18).
 */
import { zRestoreWorkOrderHeaders, zRestoreWorkOrderPath } from '@evia/contracts/zod';
import type { WorkOrderDetails } from '@evia/contracts';
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
import type { WorkOrderEvent } from '../events.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { lockWorkOrderAnyState, restoreDeletedWorkOrder, type AnyStateWorkOrderRow } from '../infrastructure/work-order-store.ts';
import { ReadWorkOrderService } from './read-work-order.service.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order (see {@link restoreWorkOrderScope}). */
export const RESTORE_WORK_ORDER_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/restore';

/** A restoration has no body: the order is part of the scope, or the key of one order would replay the restoration of another (ASVS V2.3.1, CWE-841). */
export const restoreWorkOrderScope = (workOrderId: string): string => RESTORE_WORK_ORDER_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zRestoreWorkOrderPath);
const idempotencyKeySchema = zRestoreWorkOrderHeaders.shape['Idempotency-Key'];

export interface RestoredWorkOrder {
  readonly workOrder: WorkOrderDetails;
  /** True when the answer repeats an earlier restoration (same key and order): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class RestoreWorkOrderService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #reads: ReadWorkOrderService;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(ReadWorkOrderService) reads: ReadWorkOrderService,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#reads = reads;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   */
  async restore(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<RestoredWorkOrder> {
    // the second line of defence behind the guard: the lock below has no read policy, so it is never taken for another role
    if (principal.role !== 'administrator') throw new ProblemException('forbidden');
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const locked = await lockWorkOrderAnyState(workOrderTables(tx), workOrderId);
      if (locked === undefined || (locked.deleted_at === null && key === undefined)) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(rawIfMatch);

      const perform = async () => {
        await this.#bringBack(tx, principal, locked, expectedVersion, request);
        return { value: undefined, result: { status: 200, code: 'restored', resourceId: workOrderId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: restoreWorkOrderScope(workOrderId), bodyHash: requestHash(null) },
                perform,
              )
            ).replayed;
      return { workOrder: await this.#reads.detailsOf(tx, principal, workOrderId), replayed };
    });
  }

  /** Steps 4–5 of the order described above, on the locked row. */
  async #bringBack(
    tx: Kysely<Database>,
    principal: Principal,
    locked: AnyStateWorkOrderRow,
    expectedVersion: number,
    request: EventContext,
  ): Promise<void> {
    // an order that is not deleted and a key that is not a repeat: the same `404` as for an order that does not exist
    if (locked.deleted_at === null) throw new ProblemException('not_found');
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const version = await restoreDeletedWorkOrder(workOrderTables(tx), locked.id, expectedVersion, principal.userId, this.#clock.now());
    if (version === undefined) throw new ProblemException('internal_error');

    const event: WorkOrderEvent = {
      type: 'work_order.undeleted',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'work_order',
      objectId: locked.id,
    };
    await this.#events.publish(tx, event, request);
  }
}
