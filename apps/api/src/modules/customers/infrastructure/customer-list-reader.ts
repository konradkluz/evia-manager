/**
 * Reads a page of customers for the list and the search (SELECT only; Kysely builder with bound parameters — no `sql.raw`, no
 * concatenation of a value of the request, CWE-89). ONE statement per page: the customers the read policy lets the caller see
 * (a condition of the query, SR-AUTHZ-03), optionally those whose search text contains the phrase, in the fixed order `sort_name`,
 * `id` (ICU `pl-PL` collation of the database), cut by a keyset — no OFFSET, so a deep page costs what the first one does. One row more
 * than the limit is read to know whether a next page exists.
 *
 * The keyset compares the tuple `(sort_name, id)` with the values of the last customer of the previous page. A cursor holds only
 * that customer's id; its sort key is read here by the primary key, WITHOUT the read policy: a customer who was soft deleted while the
 * caller paged must not break the paging (the customer is not shown, only the position is used). A customer that is gone for good
 * (a hard delete, EVM-041) leaves no position — the caller answers `400 invalid_cursor`.
 */
import type { Principal } from '../../../platform/http/principal.ts';
import { searchTextMatches } from '../../../platform/database/search-text.ts';
import type { CustomerKind } from '../domain/customer.ts';
import { visibleCustomers } from './read-policy.ts';
import type { CustomersDb } from './tables.ts';

export interface CustomerListRow {
  readonly id: string;
  readonly kind: CustomerKind;
  readonly display_name: string;
  readonly sort_name: string;
  readonly phone: string;
  readonly email: string | null;
}

export interface CustomerPageRequest {
  /** the normalised search phrase; absent for the list */
  readonly term: string | undefined;
  readonly limit: number;
  /** where the page starts: the sort key and the id of the last customer of the previous page */
  readonly after: { readonly sortName: string; readonly id: string } | undefined;
}

/** @returns the sort key of the customer, or undefined when no such row exists (a deleted one is a row too) */
export async function findSortName(db: CustomersDb, id: string): Promise<string | undefined> {
  const row = await db.selectFrom('customers.customers').select('sort_name').where('id', '=', id).executeTakeFirst();
  return row?.sort_name;
}

/** @returns at most `request.limit + 1` rows in the order of the list */
export function readCustomerPage(db: CustomersDb, principal: Principal, request: CustomerPageRequest): Promise<CustomerListRow[]> {
  let select = db
    .selectFrom('customers.customers')
    .select(['id', 'kind', 'display_name', 'sort_name', 'phone', 'email'])
    .where(visibleCustomers(principal));
  if (request.term !== undefined) select = select.where(searchTextMatches(request.term));
  const { after } = request;
  if (after !== undefined) {
    select = select.where((eb) => eb(eb.refTuple('sort_name', 'id'), '>', eb.tuple(after.sortName, after.id)));
  }
  return select
    .orderBy('sort_name')
    .orderBy('id')
    .limit(request.limit + 1)
    .execute();
}
