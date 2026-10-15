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

describe('migration 0030 — the index of the summary of unpaid invoices (EVM-055; ADR-0003; expand only)', () => {
  it('EVM-055 AC1 the issued milestones have a partial index on (due_date, id) for the live rows only', async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes where indexname = 'payment_milestones_unpaid_idx'`.execute(database.admin);
    expect(rows[0]?.indexdef).toMatch(/\(due_date, id\)/);
    expect(rows[0]?.indexdef).toMatch(/WHERE \(\(status = 'invoiced'::text\) AND \(deleted_at IS NULL\)\)/);
  });

  it('EVM-055 AC1 the migration touches no privilege: the application role has SELECT, INSERT and UPDATE and no DELETE', async () => {
    const { rows } = await sql<{ select: boolean; insert: boolean; update: boolean; delete: boolean }>`
      select has_table_privilege('evia_app', 'payments.payment_milestones', 'select') as "select",
             has_table_privilege('evia_app', 'payments.payment_milestones', 'insert') as "insert",
             has_table_privilege('evia_app', 'payments.payment_milestones', 'update') as "update",
             has_table_privilege('evia_app', 'payments.payment_milestones', 'delete') as "delete"`.execute(database.admin);
    expect(rows[0]).toEqual({ select: true, insert: true, update: true, delete: false });
  });
});
