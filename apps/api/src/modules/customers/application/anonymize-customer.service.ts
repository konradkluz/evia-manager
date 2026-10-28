/**
 * The anonymization of a customer - ADMINISTRATOR only, with a step-up (EVM-041 AC2, AC4, AC5, AC6, AC7; SR-DATA-08, SR-SESS-08, SR-PRIV-04,
 * SR-AUTHZ-02, SR-AUTHZ-05, SR-LOG-03, SR-ERR-01, ASVS V7.5.3, V14.2.7; CWE-639, CWE-367). The guard has decided before this runs: a
 * signed-in ADMINISTRATOR on the web channel with a valid CSRF token and a passkey authentication in the last 15 minutes
 * (`step_up_required`, after the role: the Editor and Read-only get `403 forbidden`, so only an Administrator with a fresh key can ever see the
 * `409` and `503` below) - before any read, write or count of orders.
 *
 * ONE transaction, in this order (the register is written AFTER every check and BEFORE the change, so a request that ends in 404, 409 or 412
 * leaves no record, and the database never changes without the record):
 *   1. the customer LOCKED `FOR UPDATE` in any state (a deleted customer may be anonymized; the Administrator alone reads it): missing is
 *      `404 not_found`; the other roles never get here;
 *   2. a customer that is already anonymized is `409 already_anonymized` - BEFORE the version, so the retry of a lost answer (which carries
 *      the version of before) is told "already done", not "changed by someone else"; no second object in the register;
 *   3. `If-Match` (`428` / `400`) and the version (`412 version_conflict`);
 *   4. the dependents through the registry of the port: an open order is `409 has_active_dependents` with `openWorkOrders` (a number); the
 *      count is a statement of its own after the lock. An empty registry or an implementation that fails is `500`, never a permission;
 *   5. `DeletionRegister.record(...)`: one new object with the customer id, the code `customer_anonymized`, the actor and the time - NEVER a
 *      value of the customer. It has a short deadline (the lock is held for it). A refusal is `503 deletion_register_unavailable`: the
 *      anonymization does not start, the data and the version are untouched;
 *   6. the UPDATE (the neutral values, the mark, `version + 1`), the event `customer.anonymized`; COMMIT.
 * The register is a journal of INTENT with at-least-once semantics: when step 6 or the COMMIT fails after step 5 the object stays (orphaned) -
 * harmless, the replay of the register (EVM-062) is idempotent. When step 5 fails the transaction is rolled back and a short transaction of its
 * own writes the audit record with the outcome `failed` (the id only), then the `503` is answered. A lock wait that runs out is
 * `503 service_unavailable`. No value of the customer is ever in the register, the audit trail, a log, a problem or an error message.
 */
import { zAnonymizeCustomerPath } from '@evia/contracts/zod';
import type { Customer } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import {
  DELETION_REGISTER,
  DeletionRegisterUnavailable,
  type DeletionRegister,
} from '../../../platform/deletion-register/deletion-register.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { CLOCK, DATABASE, EVENT_BUS, LOGGER } from '../../../platform/tokens.ts';
import { CustomerDependentsRegistry } from '../dependents-guard.ts';
import { rethrowLockWait } from '../domain/lock-wait.ts';
import { anonymizeCustomerRow, lockReadableCustomer } from '../infrastructure/customer-store.ts';
import { customerTables } from '../infrastructure/tables.ts';
import { assertNoOpenDependents, customerEvent } from './customer-command-support.ts';
import { toCustomer } from './customer-representation.ts';

const pathSchema = strictObjects(zAnonymizeCustomerPath);

@Injectable()
export class AnonymizeCustomerService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #register: DeletionRegister;
  readonly #dependents: CustomerDependentsRegistry;
  readonly #logger: Logger;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(DELETION_REGISTER) register: DeletionRegister,
    @Inject(CustomerDependentsRegistry) dependents: CustomerDependentsRegistry,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#register = register;
    this.#dependents = dependents;
    this.#logger = logger;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   */
  async anonymize(principal: Principal, rawParams: unknown, rawIfMatch: string | undefined, context: EventContext): Promise<Customer> {
    // the second line of defence behind the guard: the lock below reads a deleted customer too, so it is never taken for another role
    if (principal.role !== 'administrator') throw new ProblemException('forbidden');
    const { customerId } = parseInput(pathSchema, rawParams) as { customerId: string };
    const request = { ...context, sessionId: principal.sessionId };
    try {
      return await runInTransaction(this.#db, (tx) => this.#anonymize(tx, principal, customerId, rawIfMatch, request)).catch(
        rethrowLockWait,
      );
    } catch (error) {
      if (!(error instanceof DeletionRegisterUnavailable)) throw error;
      await this.#recordFailure(principal, customerId, request);
      throw new ProblemException('deletion_register_unavailable');
    }
  }

  async #anonymize(
    tx: Kysely<Database>,
    principal: Principal,
    customerId: string,
    rawIfMatch: string | undefined,
    request: EventContext,
  ): Promise<Customer> {
    const tables = customerTables(tx);
    const locked = await lockReadableCustomer(tables, principal, customerId);
    if (locked === undefined) throw new ProblemException('not_found');
    if (locked.anonymized_at !== null) throw new ProblemException('already_anonymized');
    const expectedVersion = parseIfMatch(rawIfMatch);
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');
    await assertNoOpenDependents(this.#dependents, tx, locked.id);

    // before the change in the database; throws DeletionRegisterUnavailable, which rolls the transaction back
    await this.#register.record({
      operationCode: 'customer_anonymized',
      subjectType: 'customer',
      subjectId: locked.id,
      workOrderId: null,
      actorUserId: principal.userId,
    });

    const anonymized = await anonymizeCustomerRow(tables, locked.id, locked.kind, expectedVersion, principal.userId, this.#clock.now());
    if (anonymized === undefined) throw new ProblemException('internal_error');
    await this.#events.publish(tx, customerEvent('customer.anonymized', principal, locked.id, 'success'), request);
    return toCustomer(anonymized);
  }

  /** The audit record of an anonymization that did not start (outcome `failed`): a transaction of its own, after the rollback; a failure here is logged. */
  async #recordFailure(principal: Principal, customerId: string, request: EventContext): Promise<void> {
    try {
      await runInTransaction(this.#db, (tx) =>
        this.#events.publish(tx, customerEvent('customer.anonymized', principal, customerId, 'failed'), request),
      );
    } catch (error) {
      this.#logger.error(
        { errorName: error instanceof Error ? error.name : 'unknown' },
        'audit of a refused anonymization was not written',
      );
    }
  }
}
