/**
 * Queries of the `customers` module (EVM-020, EVM-039; the page of the list and of the search is in `customer-list-reader.ts`). Every value reaches the database as a bound parameter; the read policy is a
 * condition of the query, never a filter of the result (SR-AUTHZ-03).
 */
import { sql } from 'kysely';
import { searchTextMatches } from '../../../platform/database/search-text.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { NewCustomer } from '../domain/customer.ts';
import { neutralValuesOf } from '../domain/anonymized-customer.ts';
import { readableCustomers, visibleCustomers } from './read-policy.ts';
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
  'deleted_at',
  'anonymized_at',
] as const;

/**
 * INSERT only: an existing identifier — also of a soft-deleted customer — inserts nothing (`undefined`), whatever the content, and
 * the caller answers `409 id_conflict` without a word about the existing row.
 */
export function insertCustomer(
  db: CustomersDb,
  customer: NewCustomer,
  actorUserId: string,
  now: Date,
  createdViaDeviceId: string | null = null,
) {
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
      created_via_device_id: createdViaDeviceId,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning(COLUMNS)
    .executeTakeFirst();
}

/**
 * How many customers the device has created since `since` (EVM-099 AC7): ALL rows, a deleted or anonymized one too, so a deletion does not reset the limit.
 * The window is the time of the server (`created_at`), never a time from the phone (SR-SYNC-05); the partial index of 0058 serves it.
 */
export async function countCustomersCreatedBy(db: CustomersDb, deviceId: string, since: Date): Promise<number> {
  const row = await db
    .selectFrom('customers.customers')
    .select((eb) => eb.fn.countAll<string>().as('total'))
    .where('created_via_device_id', '=', deviceId)
    .where('created_at', '>', since)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}

export function findVisibleCustomer(db: CustomersDb, principal: Principal, id: string) {
  return db.selectFrom('customers.customers').select(COLUMNS).where('id', '=', id).where(visibleCustomers(principal)).executeTakeFirst();
}

export type CustomerRow = NonNullable<Awaited<ReturnType<typeof findVisibleCustomer>>>;

/**
 * The customer as the MODULE may read it (`readableCustomers`): the Administrator also gets a deleted one (the detail and the view
 * "Usunięci" of W-14); the other roles get a missing and a deleted customer alike - `undefined`.
 */
export function findReadableCustomer(db: CustomersDb, principal: Principal, id: string) {
  return db.selectFrom('customers.customers').select(COLUMNS).where('id', '=', id).where(readableCustomers(principal)).executeTakeFirst();
}

/** The identifier and the display name only (the facade `CustomerDirectory`): no contact data is selected (SR-DATA-03). */
export function findVisibleCustomerSummary(db: CustomersDb, principal: Principal, id: string) {
  return db
    .selectFrom('customers.customers')
    .select(['id', 'display_name'])
    .where('id', '=', id)
    .where(visibleCustomers(principal))
    .executeTakeFirst();
}

/**
 * The customer of a new work order LOCKED `FOR KEY SHARE` with the read policy in the query (the facade `CustomerDirectory.lockVisible`,
 * EVM-041 D7): the foreign key of the order takes the same lock, but ONLY at the insert and it does not look at `deleted_at`; this lock is
 * taken first, so a deletion or an anonymization (`FOR UPDATE`) of the customer and the creation of an order are serialised. A deletion
 * that commits first makes this query find nothing (`deleted_at` is checked again on the committed row), the order is refused as for a
 * customer that never existed; an order created first makes the deletion count it. Not for a read-only transaction.
 */
export function lockVisibleCustomerForOrder(db: CustomersDb, principal: Principal, id: string) {
  return db
    .selectFrom('customers.customers')
    .select(['id', 'display_name'])
    .where('id', '=', id)
    .where(visibleCustomers(principal))
    .forKeyShare()
    .executeTakeFirst();
}

/** The columns of the card "Klient" only (the facade `CustomerDirectory`): the name, the telephone, the e-mail and the mark (SR-DATA-03). */
export function findVisibleCustomerCard(db: CustomersDb, principal: Principal, id: string) {
  return db
    .selectFrom('customers.customers')
    .select(['display_name', 'phone', 'email', 'anonymized_at'])
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
 * The customer LOCKED `FOR UPDATE` for the deletion, the restoration and the anonymization, under the policy `readableCustomers`: the
 * Administrator gets the row in ANY state (a deleted one too), another role gets `undefined` for a deleted one. `FOR UPDATE` (not
 * `FOR NO KEY UPDATE`) conflicts with the `FOR KEY SHARE` of the creation of an order. The dependents are counted AFTER this lock, by a
 * statement of their own.
 */
export function lockReadableCustomer(db: CustomersDb, principal: Principal, id: string) {
  return db
    .selectFrom('customers.customers')
    .select(COLUMNS)
    .where('id', '=', id)
    .where(readableCustomers(principal))
    .forUpdate()
    .executeTakeFirst();
}

/** Soft delete: `deleted_at`, `deleted_by`, `version + 1`. Only for the version decided on and a live row; `undefined` - nothing was updated. */
export function softDeleteCustomer(db: CustomersDb, id: string, expectedVersion: number, actorUserId: string, now: Date) {
  return db
    .updateTable('customers.customers')
    .set({
      deleted_at: now,
      deleted_by: actorUserId,
      version: sql<number>`version + 1`,
      updated_at: now,
      updated_by: actorUserId,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirst();
}

/** The restoration: the deletion marks are cleared, `version + 1`. Only for the version decided on and a deleted row. */
export function restoreCustomerRow(db: CustomersDb, id: string, expectedVersion: number, actorUserId: string, now: Date) {
  return db
    .updateTable('customers.customers')
    .set({
      deleted_at: null,
      deleted_by: null,
      version: sql<number>`version + 1`,
      updated_at: now,
      updated_by: actorUserId,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is not', null)
    .returning('version')
    .executeTakeFirst();
}

/**
 * The anonymization: the neutral values of the kind over EVERY personal column, the mark (`anonymized_at`, `anonymized_by`) and
 * `version + 1`. The display name, the sort name and the search text are generated by the database from these columns, so the old data
 * are not found any more. Only for the version decided on and a row that is not anonymized yet (the CHECK and the trigger of
 * migration 0043 are the other lines of defence). The deletion marks are left as they are.
 */
export function anonymizeCustomerRow(
  db: CustomersDb,
  id: string,
  kind: CustomerRow['kind'],
  expectedVersion: number,
  actorUserId: string,
  now: Date,
) {
  const neutral = neutralValuesOf(kind);
  return db
    .updateTable('customers.customers')
    .set({
      first_name: neutral.firstName,
      last_name: neutral.lastName,
      company_name: neutral.companyName,
      tax_id: null,
      contact_person_name: null,
      phone: neutral.phone,
      email: null,
      street: null,
      building_number: null,
      apartment_number: null,
      postal_code: null,
      city: null,
      notes: null,
      anonymized_at: now,
      anonymized_by: actorUserId,
      version: sql<number>`version + 1`,
      updated_at: now,
      updated_by: actorUserId,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('anonymized_at', 'is', null)
    .returning(COLUMNS)
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

/**
 * The identifiers of the customers whose search text contains the phrase (see `searchTextMatches`), under the read policy IN the
 * query (EVM-072): the work-order search narrows by them, so the policy of customers decides here — the same as for
 * `searchCustomers` — and a customer the caller may not see can never make an order findable (no oracle, CWE-203).
 */
export async function searchVisibleCustomerIds(db: CustomersDb, principal: Principal, term: string, limit: number): Promise<string[]> {
  const rows = await db
    .selectFrom('customers.customers')
    .select('id')
    .where(visibleCustomers(principal))
    .where(searchTextMatches(term))
    .limit(limit)
    .execute();
  return rows.map((row) => row.id);
}

/** The display names of the customers among `ids` that the caller may see (ONE query, ONE array parameter; the others are absent). */
export async function findVisibleCustomerNames(
  db: CustomersDb,
  principal: Principal,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('customers.customers')
    .select(['id', 'display_name'])
    .where(sql<boolean>`id = any(${[...ids]}::uuid[])`)
    .where(visibleCustomers(principal))
    .execute();
  return new Map(rows.map((row) => [row.id, row.display_name]));
}
