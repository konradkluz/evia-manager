/**
 * The restoration of a deleted customer - ADMINISTRATOR only, no step-up (EVM-041 AC3, AC6, AC7; SR-AUTHZ-05, SR-API-05, SR-API-06, SR-LOG-03;
 * ASVS V2.3.1, V2.3.3; CWE-639, CWE-841). The guard has decided before this runs: a signed-in Administrator on the web channel with a valid CSRF
 * token - the Editor and Read-only get `403 forbidden` and an anonymous caller `401`; the service checks the role again before it takes a lock.
 * The restoration brings back the visibility only: it changes no data (an anonymized customer comes back anonymized).
 *
 * ONE transaction, every decision taken on the customer LOCKED `FOR UPDATE` (in any state - the Administrator alone):
 *   1. the customer is locked: missing is `404 not_found`; one that is NOT deleted is `404` too (the same answer) - unless the request
 *      repeats a restoration with an idempotency key (step 3);
 *   2. `If-Match` (`428` / `400`) - for a customer that is deleted; for one that is not the header is not looked at;
 *   3. the idempotency port (when there is a key): a repeat of the same key and customer answers `200` with the customer as it is NOW. The key
 *      is bound to the user, the method, the route AND the CUSTOMER (another customer or the deletion - `422 idempotency_mismatch`);
 *   4. the version (`412 version_conflict`, no current values);
 *   5. the restoration (`version + 1`, the actor), the event `customer.restored` (the actor and the id) and the idempotency record. An
 *      error anywhere rolls everything back.
 */
import { zRestoreCustomerHeaders, zRestoreCustomerPath } from '@evia/contracts/zod';
import type { Customer } from '@evia/contracts';
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
import { rethrowLockWait } from '../domain/lock-wait.ts';
import { findReadableCustomer, lockReadableCustomer, restoreCustomerRow, type CustomerRow } from '../infrastructure/customer-store.ts';
import { customerTables } from '../infrastructure/tables.ts';
import { customerEvent } from './customer-command-support.ts';
import { toCustomer } from './customer-representation.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the customer (see {@link restoreCustomerScope}). */
export const RESTORE_CUSTOMER_SCOPE = 'POST /api/v1/customers/{customerId}/restore';

/** A restoration has no body: the customer is part of the scope, or the key of one customer would replay the restoration of another (CWE-841). */
export const restoreCustomerScope = (customerId: string): string => RESTORE_CUSTOMER_SCOPE.replace('{customerId}', customerId);

const pathSchema = strictObjects(zRestoreCustomerPath);
const idempotencyKeySchema = zRestoreCustomerHeaders.shape['Idempotency-Key'];

export interface RestoredCustomer {
  readonly customer: Customer;
  /** True when the answer repeats an earlier restoration (same key and customer): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class RestoreCustomerService {
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
   */
  async restore(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<RestoredCustomer> {
    // the second line of defence behind the guard: the lock below reads a deleted customer, so it is never taken for another role
    if (principal.role !== 'administrator') throw new ProblemException('forbidden');
    const { customerId } = parseInput(pathSchema, rawParams) as { customerId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const locked = await lockReadableCustomer(customerTables(tx), principal, customerId);
      const deleted = locked !== undefined && locked.deleted_at !== null;
      if (locked === undefined || (!deleted && key === undefined)) throw new ProblemException('not_found');
      // a customer that is not deleted has nothing to restore: `If-Match` is not looked at, so its `404` is the one of a missing customer
      const expectedVersion = deleted ? parseIfMatch(rawIfMatch) : 0;

      const perform = async () => {
        await this.#bringBack(tx, principal, locked, expectedVersion, request);
        return { value: undefined, result: { status: 200, code: 'restored', resourceId: customerId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: restoreCustomerScope(customerId), bodyHash: requestHash(null) },
                perform,
              )
            ).replayed;
      const current = await findReadableCustomer(customerTables(tx), principal, customerId);
      if (current === undefined) throw new ProblemException('internal_error');
      return { customer: toCustomer(current), replayed };
    }).catch(rethrowLockWait);
  }

  /** Steps 4-5 of the order described above, on the locked row. */
  async #bringBack(
    tx: Kysely<Database>,
    principal: Principal,
    locked: CustomerRow,
    expectedVersion: number,
    request: EventContext,
  ): Promise<void> {
    // a customer that is not deleted and a key that is not a repeat: the same `404` as for a customer that does not exist
    if (locked.deleted_at === null) throw new ProblemException('not_found');
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const version = await restoreCustomerRow(customerTables(tx), locked.id, expectedVersion, principal.userId, this.#clock.now());
    if (version === undefined) throw new ProblemException('internal_error');
    await this.#events.publish(tx, customerEvent('customer.restored', principal, locked.id, 'success'), request);
  }
}
