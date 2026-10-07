/**
 * Creation of a customer (EVM-020 AC2, AC4, AC5, AC7; SR-INPUT-01, SR-AUTHZ-04, SR-API-05, SR-DATA-02). The guard has decided before
 * this runs (Administrator and Editor, web channel, CSRF): a caller who may not create never reaches the validation, so a Read-only
 * user gets 403 for any body and nobody who is not entitled can fill the table of idempotency records (TM-22).
 *
 * Order: the `Idempotency-Key` header and the body are validated with the schemas of the contract (strict — a field of the server is
 * `read_only_field`, a stranger `unknown_field`), then the rules of the domain (kind, telephone, NIP, e-mail, plain text; errors
 * are pointers and codes, never values); then ONE transaction: the idempotency port (when there is a key), the INSERT (an existing
 * `id` — also a deleted customer's — is `409 id_conflict`, the content is never compared), the event `customer.created` for the
 * audit trail (no value of personal data). A repeat (same key and body) runs none of it again: it returns the customer as it is
 * NOW, read with the permissions of the caller of the repeat.
 */
import { zCreateCustomerHeaders, zCustomer, zCustomerWritable } from '@evia/contracts/zod';
import type { Customer } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { normalizeNewCustomer, type CustomerInput, type NewCustomer } from '../domain/customer.ts';
import type { CustomerEvent } from '../events.ts';
import { findVisibleCustomer, insertCustomer, type CustomerRow } from '../infrastructure/customer-store.ts';
import { customerTables } from '../infrastructure/tables.ts';
import { toCustomer } from './customer-representation.ts';

/** Method and route template: what an idempotency key is bound to besides the user. */
export const CREATE_CUSTOMER_SCOPE = 'POST /api/v1/customers';

const createBody = strictObjects(zCustomerWritable);
const SERVER_FIELDS = readOnlyKeys(zCustomer, zCustomerWritable);
const idempotencyKeySchema = zCreateCustomerHeaders.shape['Idempotency-Key'];

export interface CreatedCustomer {
  readonly customer: Customer;
  /** True when the answer repeats an earlier creation (same key and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class CreateCustomerService {
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

  /** @param rawKey the `Idempotency-Key` header as received (`undefined` when absent) */
  async create(principal: Principal, rawBody: unknown, rawKey: string | undefined, context: EventContext): Promise<CreatedCustomer> {
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const body = parseInput(createBody, rawBody, SERVER_FIELDS) as CustomerInput;
    const normalized = normalizeNewCustomer(body);
    if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });

    const request = { ...context, sessionId: principal.sessionId };
    return this.#db.transaction().execute(async (tx) => {
      const perform = async () => {
        const row = await this.#insert(tx, principal, normalized.customer, request);
        return { value: row, result: { status: 201, code: 'created', resourceId: row.id } };
      };
      if (key === undefined) return { customer: toCustomer((await perform()).value), replayed: false };

      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: CREATE_CUSTOMER_SCOPE, bodyHash: requestHash(body) },
        perform,
      );
      if (!outcome.replayed) return { customer: toCustomer(outcome.value), replayed: false };
      const current =
        outcome.result.resourceId === null
          ? undefined
          : await findVisibleCustomer(customerTables(tx), principal, outcome.result.resourceId);
      if (current === undefined) throw new ProblemException('not_found');
      return { customer: toCustomer(current), replayed: true };
    });
  }

  async #insert(tx: Kysely<Database>, principal: Principal, customer: NewCustomer, context: EventContext): Promise<CustomerRow> {
    const row = await insertCustomer(customerTables(tx), customer, principal.userId, this.#clock.now());
    if (row === undefined) throw new ProblemException('id_conflict');
    const event: CustomerEvent = {
      type: 'customer.created',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'customer',
      objectId: row.id,
    };
    await this.#events.publish(tx, event, context);
    return row;
  }
}
