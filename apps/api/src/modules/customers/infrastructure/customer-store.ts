/**
 * Queries of the `customers` module (EVM-020, EVM-039; the page of the list and of the search is in `customer-list-reader.ts`). Every value reaches the database as a bound parameter; the read policy is a
 * condition of the query, never a filter of the result (SR-AUTHZ-03).
 */
import { sql } from 'kysely';
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

/** The columns of the card "Klient" only (the facade `CustomerDirectory`): the name, the telephone and the e-mail (SR-DATA-03). */
export function findVisibleCustomerCard(db: CustomersDb, principal: Principal, id: string) {
  return db
    .selectFrom('customers.customers')
    .select(['display_name', 'phone', 'email'])
    .where('id', '=', id)
    .where(visibleCustomers(principal))
    .executeTakeFirst();
}

/**
 * The customer LOCKED for update (`SELECT … FOR UPDATE`) with the read policy IN the query: a missing or soft-deleted customer is
 * `undefined` for every role — one answer, no oracle (SR-AUTHZ-02). Every decision of the edit is taken on this row, never on an
 * earlier read (TOCTOU, ASVS V2.3.3).
 */
export function lockVisibleCustomer(db: CustomersDb, principal: Principal, id: string) {
  return db
    .selectFrom('customers.customers')
    .select(COLUMNS)
    .where('id', '=', id)
    .where(visibleCustomers(principal))
    .forUpdate()
    .executeTakeFirst();
}

/**
 * Writes the normalised customer over the row and raises the version by one — only for the version the command decided on (the lock
 * already guarantees it; the condition is the second line of defence). Every column the customer owns is written, so a change of kind
 * leaves no field of the previous one. `undefined` — nothing was updated.
 */
export function updateCustomerRow(
  db: CustomersDb,
  id: string,
  expectedVersion: number,
  customer: NewCustomer,
  actorUserId: string,
  now: Date,
) {
  return db
    .updateTable('customers.customers')
    .set({
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
      version: sql<number>`version + 1`,
      updated_at: now,
      updated_by: actorUserId,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning(COLUMNS)
    .executeTakeFirst();
}
