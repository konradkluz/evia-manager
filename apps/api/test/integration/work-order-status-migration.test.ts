import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
const T = '2026-10-08T08:00:00Z';

beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

const admin = () => database.admin;
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};
const insertOrder = (number: string, extra: { resumeStatus?: string; reason?: string } = {}) =>
  sql`insert into work_orders.work_orders (number, title, status, resume_status, status_reason, created_at, updated_at)
      values (${number}, 'Zlecenie syntetyczne', 'on_hold', ${extra.resumeStatus ?? null}, ${extra.reason ?? null}, ${T}, ${T})`.execute(
    admin(),
  );

describe('migration 0016 — the life cycle of a work order (EVM-030 AC2, AC3, AC4; ADR-0003; expand only)', () => {
  it('EVM-030 AC2 the five columns are NULLABLE (expand — no backfill) and have the types the application writes', async () => {
    const { rows } = await sql<{ column_name: string; is_nullable: string; data_type: string }>`
      select column_name, is_nullable, data_type from information_schema.columns
      where table_schema = 'work_orders' and table_name = 'work_orders'
        and column_name in ('resume_status', 'status_reason', 'status_changed_at', 'closed_at', 'completed_on')
      order by column_name`.execute(admin());
    expect(rows).toEqual([
      { column_name: 'closed_at', is_nullable: 'YES', data_type: 'timestamp with time zone' },
      { column_name: 'completed_on', is_nullable: 'YES', data_type: 'date' },
      { column_name: 'resume_status', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'status_changed_at', is_nullable: 'YES', data_type: 'timestamp with time zone' },
      { column_name: 'status_reason', is_nullable: 'YES', data_type: 'text' },
    ]);
  });

  it('EVM-030 AC2 the resume status is one of the four ACTIVE statuses (CHECK): a closed or held status cannot be resumed to', async () => {
    for (const [index, status] of ['new', 'quoting', 'accepted', 'in_progress'].entries()) {
      await insertOrder(`ZL-2026-${String(9300 + index)}`, { resumeStatus: status });
    }
    for (const [index, status] of ['completed', 'settled', 'on_hold', 'cancelled', 'archived'].entries()) {
      await fails(insertOrder(`ZL-2026-${String(9400 + index)}`, { resumeStatus: status }), '23514');
    }
  });

  it('EVM-030 AC2 the reason is 1..500 characters (CHECK, the bound of the contract): 500 passes, 501 and the empty text do not', async () => {
    await insertOrder('ZL-2026-9310', { reason: 'a'.repeat(500) });
    await fails(insertOrder('ZL-2026-9311', { reason: 'a'.repeat(501) }), '23514');
    await fails(insertOrder('ZL-2026-9312', { reason: '' }), '23514');
  });

  it('EVM-030 AC3 the application role may update the new columns and still has no DELETE (soft delete only)', async () => {
    await insertOrder('ZL-2026-9320', { resumeStatus: 'new' });
    const { rows } = await sql<{ select: boolean; insert: boolean; update: boolean; delete: boolean }>`
      select has_table_privilege('evia_app', 'work_orders.work_orders', 'select') as "select",
             has_table_privilege('evia_app', 'work_orders.work_orders', 'insert') as "insert",
             has_table_privilege('evia_app', 'work_orders.work_orders', 'update') as "update",
             has_table_privilege('evia_app', 'work_orders.work_orders', 'delete') as "delete"`.execute(admin());
    expect(rows[0]).toEqual({ select: true, insert: true, update: true, delete: false });
  });
});
