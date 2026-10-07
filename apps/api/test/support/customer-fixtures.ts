/**
 * Synthetic customers written straight into the database (EVM-020) — owner connection, so the API under test has to find them
 * through its own queries. A TEST helper outside `src`; everything is synthetic (names, numbers and addresses are invented).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../src/platform/database/database.ts';
import { uuidv7 } from './uuid.ts';

export interface CustomerSpec {
  readonly id?: string;
  readonly kind?: 'person' | 'company';
  readonly firstName?: string;
  readonly lastName?: string;
  readonly companyName?: string;
  readonly taxId?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly city?: string;
  readonly notes?: string;
  readonly deletedAt?: string;
}

const T = '2026-10-07T08:00:00Z';

/** Inserts a customer (a person by default) and returns its identifier. */
export async function insertCustomer(db: Kysely<Database>, spec: CustomerSpec = {}): Promise<string> {
  const id = spec.id ?? uuidv7();
  const company = spec.kind === 'company';
  const address = spec.city === undefined ? [null, null, null, null] : ['Piotrkowska', '1', '90-001', spec.city];
  await sql`
    insert into customers.customers (id, kind, first_name, last_name, company_name, tax_id, phone, email, street, building_number,
      postal_code, city, notes, created_at, updated_at, deleted_at)
    values (${id}, ${spec.kind ?? 'person'}, ${company ? null : (spec.firstName ?? 'Jan')}, ${company ? null : (spec.lastName ?? 'Przykładowy')},
      ${company ? (spec.companyName ?? 'Firma Testowa sp. z o.o.') : null}, ${company ? (spec.taxId ?? null) : null},
      ${spec.phone ?? '+48600000001'}, ${spec.email ?? null}, ${address[0]}, ${address[1]}, ${address[2]}, ${address[3]},
      ${spec.notes ?? null}, ${T}, ${T}, ${spec.deletedAt ?? null})`.execute(db);
  return id;
}

export const clearCustomers = async (db: Kysely<Database>): Promise<void> => {
  await sql`delete from customers.customers`.execute(db);
  await sql`delete from platform.idempotency_records`.execute(db);
};
