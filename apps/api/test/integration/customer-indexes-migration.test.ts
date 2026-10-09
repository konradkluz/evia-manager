import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

const definitionOf = async (name: string): Promise<string | undefined> => {
  const { rows } = await sql<{ indexdef: string }>`select indexdef from pg_indexes where indexname = ${name}`.execute(database.admin);
  return rows[0]?.indexdef;
};

describe('migration 0017 — the indexes of the list of customers and of their orders (EVM-039; ADR-0003; expand only)', () => {
  it('EVM-039 AC1 the list of customers has a partial index on (sort_name, id) — the keyset of the list and the search walks it', async () => {
    const definition = await definitionOf('customers_sort_name_id_idx');
    expect(definition).toMatch(/\(sort_name, id\)/);
    expect(definition).toMatch(/WHERE \(deleted_at IS NULL\)/);
  });

  it('EVM-039 AC2 the history of a customer has a partial index on (customer_id, created_at desc, id desc)', async () => {
    const definition = await definitionOf('work_orders_customer_created_idx');
    expect(definition).toMatch(/\(customer_id, created_at DESC, id DESC\)/);
    expect(definition).toMatch(/WHERE \(deleted_at IS NULL\)/);
  });

  it('EVM-039 AC7 the migration touches no privilege: the application role has SELECT, INSERT and UPDATE on both tables and no DELETE', async () => {
    for (const table of ['customers.customers', 'work_orders.work_orders']) {
      const { rows } = await sql<{ select: boolean; insert: boolean; update: boolean; delete: boolean }>`
        select has_table_privilege('evia_app', ${table}, 'select') as "select",
               has_table_privilege('evia_app', ${table}, 'insert') as "insert",
               has_table_privilege('evia_app', ${table}, 'update') as "update",
               has_table_privilege('evia_app', ${table}, 'delete') as "delete"`.execute(database.admin);
      expect(rows[0], table).toEqual({ select: true, insert: true, update: true, delete: false });
    }
  });
});
