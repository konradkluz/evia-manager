/**
 * The deletion of a customer - soft delete, ADMINISTRATOR only (EVM-041 AC1, AC2, AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, SR-API-05, SR-API-06,
 * SR-LOG-03, SR-DATA-08, SR-ERR-01; ASVS V2.3.1, V2.3.3; TM-18; CWE-639, CWE-841, CWE-367). The guard has decided before this runs: a
 * signed-in Administrator on the web channel with a valid CSRF token - the Editor and Read-only get `403 forbidden` and an anonymous caller
 * `401` without reaching the headers; the service checks the role again before it takes a lock. Modelled on the deletion of a work order
 * (EVM-060).
 *
 * ONE transaction, every decision taken on the customer LOCKED with `SELECT ... FOR UPDATE` (the Administrator reads the row in any state;
 * `FOR UPDATE` conflicts with the `FOR KEY SHARE` that the creation of an order takes, so the two are serialised), never on an earlier read:
 *   1. the customer is locked: missing is `404 not_found`; one that is deleted already is `404` too - unless the request repeats a deletion
 *      with an idempotency key (step 3);
 *   2. `If-Match` (`428` / `400`) - for a customer that is live; for one that is deleted already the header is not looked at, so the `404`
 *      does not depend on it;
 *   3. the idempotency port (when there is a key): a repeat of the same key and customer answers `204` BEFORE the dependents are asked. The
 *      key is bound to the user (the port), the method, the route AND the CUSTOMER: the same key on another customer, or on the
 *      restoration, is `422 idempotency_mismatch`;
 *   4. the dependents, through the registry of the port (`work-orders`: an order that is not settled or cancelled and not deleted is
 *      `409 has_active_dependents` with `openWorkOrders`, a NUMBER). The count is a statement of its own AFTER the lock, so an order
 *      committed before the lock is counted. An empty registry or an implementation that fails is `500`, never a permission;
 *   5. the version (`412 version_conflict`);
 *   6. the soft delete (`version + 1`, the actor), the event `customer.deleted` (the actor and the id - never a value of the customer) and
 *      the idempotency record. A refusal at any step rolls everything back: no record, no effect.
 * A lock wait that runs out is `503 service_unavailable` (nothing changed; retry).
 */
import { zDeleteCustomerHeaders, zDeleteCustomerPath } from '@evia/contracts/zod';
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
import { CustomerDependentsRegistry } from '../dependents-guard.ts';
import { rethrowLockWait } from '../domain/lock-wait.ts';
import { lockReadableCustomer, softDeleteCustomer, type CustomerRow } from '../infrastructure/customer-store.ts';
import { customerTables } from '../infrastructure/tables.ts';
import { assertNoOpenDependents, customerEvent } from './customer-command-support.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the customer (see {@link deleteCustomerScope}). */
export const DELETE_CUSTOMER_SCOPE = 'DELETE /api/v1/customers/{customerId}';

/** A deletion has no body, so a scope of the route alone would let the key of one customer "replay" the deletion of another (ASVS V2.3.1, CWE-841). */
export const deleteCustomerScope = (customerId: string): string => DELETE_CUSTOMER_SCOPE.replace('{customerId}', customerId);

const pathSchema = strictObjects(zDeleteCustomerPath);
const idempotencyKeySchema = zDeleteCustomerHeaders.shape['Idempotency-Key'];

@Injectable()
export class DeleteCustomerService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #dependents: CustomerDependentsRegistry;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(CustomerDependentsRegistry) dependents: CustomerDependentsRegistry,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#dependents = dependents;
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
    // the second line of defence behind the guard: the lock below reads a deleted customer too, so it is never taken for another role
    if (principal.role !== 'administrator') throw new ProblemException('forbidden');
    const { customerId } = parseInput(pathSchema, rawParams) as { customerId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const locked = await lockReadableCustomer(customerTables(tx), principal, customerId);
      const live = locked !== undefined && locked.deleted_at === null;
      if (locked === undefined || (!live && key === undefined)) throw new ProblemException('not_found');
      // a customer that is deleted already has no version to compare: `If-Match` is not looked at, so its `404` is the one of a missing customer
      const expectedVersion = live ? parseIfMatch(rawIfMatch) : 0;

      const perform = async () => {
        await this.#remove(tx, principal, locked, expectedVersion, request);
        return { value: undefined, result: { status: 204, code: 'deleted', resourceId: customerId } };
      };
      if (key === undefined) {
        await perform();
        return false;
      }
      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: deleteCustomerScope(customerId), bodyHash: requestHash(null) },
        perform,
      );
      return outcome.replayed;
    }).catch(rethrowLockWait);
  }

  /** Steps 4-6 of the order described above, on the locked row. */
  async #remove(
    tx: Kysely<Database>,
    principal: Principal,
    locked: CustomerRow,
    expectedVersion: number,
    request: EventContext,
  ): Promise<void> {
    // a customer that is deleted already and a key that is not a repeat: the same `404` as for a customer that does not exist
    if (locked.deleted_at !== null) throw new ProblemException('not_found');
    await assertNoOpenDependents(this.#dependents, tx, locked.id);
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const version = await softDeleteCustomer(customerTables(tx), locked.id, expectedVersion, principal.userId, this.#clock.now());
    if (version === undefined) throw new ProblemException('internal_error');
    await this.#events.publish(tx, customerEvent('customer.deleted', principal, locked.id, 'success'), request);
  }
}
