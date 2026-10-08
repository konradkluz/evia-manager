/**
 * Queries of the `customers` module (EVM-020). Every value reaches the database as a bound parameter; the read policy is a
 * condition of the query, never a filter of the result (SR-AUTHZ-03).
 */
import { searchTextMatches } from '../../../platform/database/search-text.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { NewCustomer } from '../domain/customer.ts';
import { visibleCustomers } from './read-policy.ts';
import type { CustomersDb } from './tables.ts';

const COLUMNS = [
  'id',
  'kind',
  'first_name',
  'last_name',
  'company_name',
  'tax_id',
  'contact_person_name',
  'phone',
  'email',
  'street',
  'building_number',
  'apartment_number',
  'postal_code',
  'city',
  'notes',
  'display_name',
  'version',
  'created_at',
  'updated_at',
] as const;

export interface SearchRow {
  readonly id: string;
  readonly display_name: string;
  readonly phone: string;
}

/**
 * Customers whose search text contains the phrase. The phrase is normalised here by the same function as the column
 * (`f_unaccent(lower(…))`), so "Lodz" meets "Łódź", and ESCAPED AFTER that (`%`, `_`, `\`): unaccent maps full-width `％＿＼` to the
 * ASCII pattern characters, so escaping before it would leave a pattern (CWE-180). A hard LIMIT and
 * the statement timeout of the pool bound the cost (TM-22); the order is fixed (`sort_name`, `id` in the ICU collation of the database).
 */
export function searchVisibleCustomers(db: CustomersDb, principal: Principal, term: string, limit: number): Promise<SearchRow[]> {
  return db
    .selectFrom('customers.customers')
    .select(['id', 'display_name', 'phone'])
    .where(visibleCustomers(principal))
    .where(searchTextMatches(term))
    .orderBy('sort_name')
    .orderBy('id')
    .limit(limit)
    .execute();
}

/**
 * INSERT only: an existing identifier — also of a soft-deleted customer — inserts nothing (`undefined`), whatever the content, and
 * the caller answers `409 id_conflict` without a word about the existing row.
 */
export function insertCustomer(db: CustomersDb, customer: NewCustomer, actorUserId: string, now: Date) {
  return db
    .insertInto('customers.customers')
    .values({
      id: customer.id,
      kind: customer.kind,
      first_name: customer.firstName,
      last_name: customer.lastName,
      company_name: customer.companyName,
      tax_id: customer.taxId,
      contact_person_name: customer.contactPersonName,
      phone: customer.phone,
      email: customer.email,
      street: customer.address?.street ?? null,
      building_number: customer.address?.buildingNumber ?? null,
      apartment_number: customer.address?.apartmentNumber ?? null,
      postal_code: customer.address?.postalCode ?? null,
      city: customer.address?.city ?? null,
      notes: customer.notes,
      created_at: now,
      created_by: actorUserId,
      updated_at: now,
      updated_by: actorUserId,
      deleted_at: null,
      deleted_by: null,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning(COLUMNS)
    .executeTakeFirst();
}

export function findVisibleCustomer(db: CustomersDb, principal: Principal, id: string) {
  return db.selectFrom('customers.customers').select(COLUMNS).where('id', '=', id).where(visibleCustomers(principal)).executeTakeFirst();
}

export type CustomerRow = NonNullable<Awaited<ReturnType<typeof findVisibleCustomer>>>;

/** The identifier and the display name only (the facade `CustomerDirectory`): no contact data is selected (SR-DATA-03). */
export function findVisibleCustomerSummary(db: CustomersDb, principal: Principal, id: string) {
  return db
    .selectFrom('customers.customers')
    .select(['id', 'display_name'])
    .where('id', '=', id)
    .where(visibleCustomers(principal))
    .executeTakeFirst();
}
