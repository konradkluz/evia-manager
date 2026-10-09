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

describe('migration 0018 — the index of the other orders of a site (EVM-036; ADR-0003; expand only)', () => {
  it('EVM-036 AC5 the orders of a site have a partial index on (site_id, number desc, id desc)', async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes where indexname = 'work_orders_site_number_idx'`.execute(database.admin);
    expect(rows[0]?.indexdef).toMatch(/\(site_id, number DESC, id DESC\)/);
    expect(rows[0]?.indexdef).toMatch(/WHERE \(deleted_at IS NULL\)/);
  });

  it('EVM-036 AC5 the migration touches no privilege: the application role has SELECT, INSERT and UPDATE and no DELETE', async () => {
    const { rows } = await sql<{ select: boolean; insert: boolean; update: boolean; delete: boolean }>`
      select has_table_privilege('evia_app', 'work_orders.work_orders', 'select') as "select",
             has_table_privilege('evia_app', 'work_orders.work_orders', 'insert') as "insert",
             has_table_privilege('evia_app', 'work_orders.work_orders', 'update') as "update",
             has_table_privilege('evia_app', 'work_orders.work_orders', 'delete') as "delete"`.execute(database.admin);
    expect(rows[0]).toEqual({ select: true, insert: true, update: true, delete: false });
  });
});
