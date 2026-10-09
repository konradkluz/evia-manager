/**
 * ONE page of customers for the list and for the search (EVM-039 AC1, AC5; SR-API-04, SR-AUTHZ-03, SR-API-02, SR-DATA-03): the same
 * policy, the same order, the same envelope, so a customer who is on the list is found by the search and the other way round.
 *
 * Order matters: the cursor is opened (400) BEFORE the meter is asked (429); the page is read; the answer is parsed with the schema of
 * the contract (only the fields of the contract leave); and the customers returned are counted AFTER it is built — the records for the
 * mass-read limit and the different identifiers for the alert of policy P10 — so a refused or failed request counts nothing.
 *
 * The cursor is bound to the operation, to the user and to the phrase (the scope), and holds the identifier of the last customer only
 * (no name: it would not fit, and it would travel in the URL and the access log). The sort key of that customer is read by the reader.
 */
import { zCustomerList } from '@evia/contracts/zod';
import type { CustomerList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { BulkReadControl } from '../../../platform/bulk-read/bulk-read-control.ts';
import { scopeOf, type CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { BULK_READ_CONTROL, CURSOR_CODEC, DATABASE } from '../../../platform/tokens.ts';
import { parsePosition, positionParts } from '../domain/customer-list-query.ts';
import { findSortName, readCustomerPage, type CustomerListRow } from '../infrastructure/customer-list-reader.ts';
import { customerTables } from '../infrastructure/tables.ts';

/** The operations whose cursors this service issues (a cursor of one does not open in the other). */
export type CustomerPageOperation = 'listCustomers' | 'searchCustomers';

export interface CustomerPageRequest {
  readonly operation: CustomerPageOperation;
  /** the normalised search phrase; absent for the list */
  readonly term: string | undefined;
  readonly limit: number;
  readonly cursor: string | undefined;
}

@Injectable()
export class CustomerPagesService {
  readonly #db: Kysely<Database>;
  readonly #cursors: CursorCodec;
  readonly #bulkRead: BulkReadControl;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CURSOR_CODEC) cursors: CursorCodec,
    @Inject(BULK_READ_CONTROL) bulkRead: BulkReadControl,
  ) {
    this.#db = db;
    this.#cursors = cursors;
    this.#bulkRead = bulkRead;
  }

  async page(principal: Principal, request: CustomerPageRequest, context: EventContext): Promise<CustomerList> {
    const scope = scopeOf([request.term ?? '']);
    const tables = customerTables(this.#db);
    const after = await this.#after(principal, request, scope);
    const eventContext = { ...context, sessionId: principal.sessionId };
    await this.#bulkRead.before(principal.userId, eventContext, 'customer');

    const rows = await readCustomerPage(tables, principal, { term: request.term, limit: request.limit, after });
    const shown = rows.slice(0, request.limit);
    const last = shown.at(-1);
    const list = zCustomerList.safeParse({
      items: shown.map(toItem),
      nextCursor:
        rows.length > request.limit && last !== undefined
          ? this.#cursors.seal(request.operation, { position: positionParts(last.id), scope, userId: principal.userId })
          : null,
    });
    if (!list.success) throw new ProblemException('internal_error');
    this.#bulkRead.after(principal.userId, list.data.items.length);
    await this.#bulkRead.afterDistinct(
      principal.userId,
      'customer',
      list.data.items.map((item) => item.id),
      eventContext,
    );
    return list.data;
  }

  /** @throws ProblemException `invalid_cursor` — one answer for every reason: not ours, expired, other phrase, other user, gone for good */
  async #after(principal: Principal, request: CustomerPageRequest, scope: string) {
    if (request.cursor === undefined) return undefined;
    const parts = this.#cursors.open(request.operation, request.cursor, { scope, userId: principal.userId });
    const id = parts === undefined ? undefined : parsePosition(parts);
    const sortName = id === undefined ? undefined : await findSortName(customerTables(this.#db), id);
    if (id === undefined || sortName === undefined) throw new ProblemException('invalid_cursor');
    return { sortName, id };
  }
}

function toItem(row: CustomerListRow) {
  return { id: row.id, kind: row.kind, displayName: row.display_name, sortName: row.sort_name, phone: row.phone, email: row.email };
}
