/**
 * The detail of one customer (EVM-039 AC2, AC5, AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, SR-API-02, SR-DATA-03, SR-LOG-02). The guard has
 * decided before this runs (the three roles, web channel). The customer is resolved with the read policy IN THE QUERY: one that does
 * not exist and one that is soft deleted are the same `404 not_found`, for every role (the view of deleted customers is EVM-041).
 *
 * The mass-read meter is asked BEFORE the query (429) and the customer is counted AFTER the answer is built — as a record for the
 * mass-read limit and as an identifier for the alert of policy P10 — so a missing customer, an invalid request and a refused one count
 * nothing. The answer is parsed with the schema of the contract (no search text, sort key or deletion mark). A read is not an audited
 * event; nothing here logs a body.
 */
import { zGetCustomerPath } from '@evia/contracts/zod';
import type { Customer } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { BulkReadControl } from '../../../platform/bulk-read/bulk-read-control.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { BULK_READ_CONTROL, DATABASE } from '../../../platform/tokens.ts';
import { findVisibleCustomer } from '../infrastructure/customer-store.ts';
import { customerTables } from '../infrastructure/tables.ts';
import { toCustomer } from './customer-representation.ts';

const pathSchema = strictObjects(zGetCustomerPath);

@Injectable()
export class ReadCustomerService {
  readonly #db: Kysely<Database>;
  readonly #bulkRead: BulkReadControl;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(BULK_READ_CONTROL) bulkRead: BulkReadControl) {
    this.#db = db;
    this.#bulkRead = bulkRead;
  }

  /** @param rawParams the path parameters as parsed by the framework */
  async get(principal: Principal, rawParams: unknown, context: EventContext): Promise<Customer> {
    const { customerId } = parseInput(pathSchema, rawParams) as { customerId: string };
    const eventContext = { ...context, sessionId: principal.sessionId };
    await this.#bulkRead.before(principal.userId, eventContext, 'customer');

    const row = await findVisibleCustomer(customerTables(this.#db), principal, customerId);
    if (row === undefined) throw new ProblemException('not_found');
    const customer = toCustomer(row);
    this.#bulkRead.after(principal.userId, 1);
    await this.#bulkRead.afterDistinct(principal.userId, 'customer', [customer.id], eventContext);
    return customer;
  }
}
