/**
 * The edit of a customer (EVM-039 AC3, AC4, AC6, AC7; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01,
 * SR-LOG-02, SR-LOG-03, SR-DATA-02, ASVS V2.3.3, CWE-639). The guard has decided before this runs: a signed-in Administrator or Editor
 * on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401 without reaching the headers or the body.
 *
 * Order: the path (400), the `Idempotency-Key`, `If-Match` (`428` / `400`) and the body against the schema of the contract (strict: a
 * field of the server, `id` included, is `read_only_field`, a stranger `unknown_field`) — all of it BEFORE the database is asked, so
 * a malformed request says nothing about a customer that is not there. Then ONE transaction, and every decision in it is taken on the
 * customer LOCKED with `SELECT … FOR UPDATE` (the read policy is in that query), never on an earlier read:
 *   1. the customer is locked: missing or soft deleted is `404 not_found`, the same for every role (before the version — a deleted
 *      customer with a stale `If-Match` is 404, not 412, so the answer is no oracle of existence);
 *   2. the idempotency port (when there is a key): a repeat of the same key, customer and body returns the stored result BEFORE the
 *      version is compared. The key is bound to the CUSTOMER (the scope holds its id): the same key and body on another customer is
 *      `422 idempotency_mismatch`, not a replay that would silently skip the second change;
 *   3. the version (`412 version_conflict`, no current value in the answer);
 *   4. the merged customer through the rules of the creation (`400`, pointers and codes, never a value);
 *   5. the update (`version + 1`), the event `customer.updated` for the audit trail (the actor and the customer, no field, no value),
 *      the idempotency record. An error anywhere rolls the whole command back.
 * A repeat returns the customer as the caller may read it NOW (the read policy: deleted in between is 404).
 */
import { zCustomer, zCustomerPatch, zUpdateCustomerHeaders, zUpdateCustomerPath } from '@evia/contracts/zod';
import type { Customer } from '@evia/contracts';
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
import { normalizeNewCustomer, type CustomerInput } from '../domain/customer.ts';
import { mergeCustomerPatch, type CustomerPatchInput } from '../domain/customer-patch.ts';
import type { CustomerEvent } from '../events.ts';
import { findVisibleCustomer, lockVisibleCustomer, updateCustomerRow, type CustomerRow } from '../infrastructure/customer-store.ts';
import { customerTables } from '../infrastructure/tables.ts';
import { toCustomer } from './customer-representation.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the customer (see {@link updateCustomerScope}). */
export const UPDATE_CUSTOMER_SCOPE = 'PATCH /api/v1/customers/{customerId}';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE CUSTOMER. A patch such as `{"phone":"+48…"}` says
 * nothing of the customer, so a scope of the route alone would let the key of one customer "replay" the change for another one that was
 * never changed (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841).
 */
export const updateCustomerScope = (customerId: string): string => UPDATE_CUSTOMER_SCOPE.replace('{customerId}', customerId);

const pathSchema = strictObjects(zUpdateCustomerPath);
const patchBody = strictObjects(zCustomerPatch);
/** The fields of the server that a patch names in vain: the keys of the customer that the patch lacks (derived from the contract). */
const SERVER_FIELDS = readOnlyKeys(zCustomer, zCustomerPatch);
const idempotencyKeySchema = zUpdateCustomerHeaders.shape['Idempotency-Key'];

export interface UpdatedCustomer {
  readonly customer: Customer;
  /** True when the answer repeats an earlier edit (same key, customer and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class UpdateCustomerService {
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
  async update(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<UpdatedCustomer> {
    const { customerId } = parseInput(pathSchema, rawParams) as { customerId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const expectedVersion = parseIfMatch(rawIfMatch);
    const patch = parseInput(patchBody, rawBody, SERVER_FIELDS) as CustomerPatchInput;
    const request = { ...context, sessionId: principal.sessionId };

    return this.#db.transaction().execute(async (tx) => {
      const locked = await lockVisibleCustomer(customerTables(tx), principal, customerId);
      if (locked === undefined) throw new ProblemException('not_found');

      const perform = async () => {
        await this.#perform(tx, principal, locked, expectedVersion, patch, request);
        return { value: undefined, result: { status: 200, code: 'updated', resourceId: customerId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: updateCustomerScope(customerId), bodyHash: requestHash(patch) },
                perform,
              )
            ).replayed;
      const current = await findVisibleCustomer(customerTables(tx), principal, customerId);
      if (current === undefined) throw new ProblemException('not_found');
      return { customer: toCustomer(current), replayed };
    });
  }

  /** Steps 3–5 of the order described above, on the locked row. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    locked: CustomerRow,
    expectedVersion: number,
    patch: CustomerPatchInput,
    request: EventContext,
  ): Promise<void> {
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');
    const normalized = normalizeNewCustomer(mergeCustomerPatch(inputOf(locked), patch));
    if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });

    const updated = await updateCustomerRow(
      customerTables(tx),
      locked.id,
      expectedVersion,
      normalized.customer,
      principal.userId,
      this.#clock.now(),
    );
    if (updated === undefined) throw new ProblemException('internal_error');
    const event: CustomerEvent = {
      type: 'customer.updated',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'customer',
      objectId: locked.id,
    };
    await this.#events.publish(tx, event, request);
  }
}

/** The stored customer as the input of the rules (a column that is NULL is an absent field). */
function inputOf(row: CustomerRow): CustomerInput {
  const text = (value: string | null): string | undefined => value ?? undefined;
  const address =
    row.street === null || row.building_number === null || row.postal_code === null || row.city === null
      ? undefined
      : {
          street: row.street,
          buildingNumber: row.building_number,
          apartmentNumber: text(row.apartment_number),
          postalCode: row.postal_code,
          city: row.city,
        };
  return {
    id: row.id,
    kind: row.kind,
    firstName: text(row.first_name),
    lastName: text(row.last_name),
    companyName: text(row.company_name),
    taxId: text(row.tax_id),
    contactPersonName: text(row.contact_person_name),
    phone: row.phone,
    email: text(row.email),
    postalAddress: address,
    notes: text(row.notes),
  };
}
