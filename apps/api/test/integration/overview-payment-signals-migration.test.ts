import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { insertMilestones } from '../support/payment-fixtures.ts';
import { projectionTools } from '../support/projection.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';
import { freshDatabaseUrl } from './database.ts';

/**
 * 0031 is applied on a database that already holds orders, their projection (0023) and milestones (0026, 0028): the three columns get
 * their defaults (no rewrite, no backfill), `verify` reports the group `payments` for the orders whose milestones are issued or paid
 * until `rebuild` fills them (the step of the deployment in the CHANGELOG), and from then on the projection equals the recomputation.
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0031')) as typeof MIGRATIONS;

let db: Kysely<Database>;
let withMilestones = '';
let without = '';
beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  const ids = await insertWorkOrders(db, [{ number: numberOf(2026, 3101) }, { number: numberOf(2026, 3102) }]);
  [withMilestones = '', without = ''] = [...ids.values()];
  // the projection of 0023 as the `rebuild` of EVM-034 wrote it (the helpers recompute only a projection of the current shape)
  await sql`insert into overview.work_order_summaries (work_order_id, number, status, created_at, recomputed_at)
    select id, number, status, created_at, now() from work_orders.work_orders`.execute(db);
  await insertMilestones(db, withMilestones, [
    { status: 'invoiced', dueDate: '2026-10-07', amountMinor: 360_000 },
    { status: 'paid', dueDate: '2026-10-01' },
    { status: 'planned' },
  ]);
  expect((await migrateToLatest(db, MIGRATIONS)).applied).toEqual(['0031_overview_payment_signals']);
});
afterAll(async () => {
  await db.destroy();
});

const fails = async (statement: Promise<unknown>): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code: '23514' });
};

describe('migration 0031 — the signals of payments in the projection (EVM-056 AC1, AC2; ADR-0017 W1, W10; expand only)', () => {
  it('EVM-056 AC1 K7 exactly three columns are added — two counters and a date, no amount — with defaults on the existing rows', async () => {
    const { rows } = await sql<{ column_name: string; data_type: string; column_default: string | null; is_nullable: string }>`
      select column_name, data_type, column_default, is_nullable from information_schema.columns
      where table_schema = 'overview' and table_name = 'work_order_summaries'
        and column_name in ('invoiced_count', 'paid_count', 'earliest_invoiced_due_date') order by column_name`.execute(db);
    expect(rows).toEqual([
      { column_name: 'earliest_invoiced_due_date', data_type: 'date', column_default: null, is_nullable: 'YES' },
      { column_name: 'invoiced_count', data_type: 'integer', column_default: '0', is_nullable: 'NO' },
      { column_name: 'paid_count', data_type: 'integer', column_default: '0', is_nullable: 'NO' },
    ]);
    const { rows: values } = await sql<{ n: string }>`
      select count(*)::text as n from overview.work_order_summaries
      where invoiced_count = 0 and paid_count = 0 and earliest_invoiced_due_date is null`.execute(db);
    expect(values[0]?.n).toBe('2');
  });

  it('EVM-056 AC1 the CHECKs: no negative counter, and the earliest issued due date exists exactly when an issued milestone does', async () => {
    await fails(sql`update overview.work_order_summaries set invoiced_count = -1 where work_order_id = ${without}`.execute(db));
    await fails(sql`update overview.work_order_summaries set paid_count = -1 where work_order_id = ${without}`.execute(db));
    await fails(sql`update overview.work_order_summaries set invoiced_count = 1 where work_order_id = ${without}`.execute(db));
    await fails(
      sql`update overview.work_order_summaries set earliest_invoiced_due_date = '2026-10-07' where work_order_id = ${without}`.execute(db),
    );
    await sql`update overview.work_order_summaries set invoiced_count = 1, earliest_invoiced_due_date = '2026-10-07'
      where work_order_id = ${without}`.execute(db);
    await sql`update overview.work_order_summaries set invoiced_count = 0, earliest_invoiced_due_date = null
      where work_order_id = ${without}`.execute(db);
  });

  it('EVM-056 AC1 K7 no privilege changes: the application role keeps its DML, the read-only role has nothing; no trigger', async () => {
    const privilege = async (role: string, name: string) =>
      (await sql<{ ok: boolean }>`select has_table_privilege(${role}, 'overview.work_order_summaries', ${name}) as ok`.execute(db)).rows[0]
        ?.ok;
    for (const name of ['SELECT', 'INSERT', 'UPDATE']) expect(await privilege('evia_app', name), name).toBe(true);
    for (const name of ['DELETE', 'TRUNCATE']) expect(await privilege('evia_app', name), name).toBe(false);
    // nobody but the application role is granted anything (no read-only role, no PUBLIC — SR-DATA-08)
    const { rows: grantees } = await sql<{ grantee: string }>`
      select distinct grantee from information_schema.role_table_grants
      where table_schema = 'overview' and grantee not in (select tableowner from pg_tables where schemaname = 'overview') order by 1`.execute(
      db,
    );
    expect(grantees.map((row) => row.grantee)).toEqual(['evia_app']);
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from information_schema.triggers where trigger_schema = 'overview'`.execute(db);
    expect(rows[0]?.n).toBe('0');
  });

  it('EVM-056 AC1 the step of the deployment: until `rebuild`, verify reports the group `payments` (numbers and identifiers only); after it, nothing', async () => {
    const { maintenance } = projectionTools(db);
    const before = await maintenance.verify({ traceId: '0'.repeat(32), alert: false });
    expect(before.drift.payments).toEqual([withMilestones]);
    expect(before.drift.authorization).toEqual([]);
    // the report carries identifiers and counts, never a date or an amount (W11, T7)
    expect(JSON.stringify(before)).not.toMatch(/2026-10-0|360000/);
    expect(await maintenance.rebuild()).toMatchObject({ rebuilt: 2, skipped: 0 });
    const { rows } = await sql<{ invoiced_count: number; paid_count: number; due: string | null }>`
      select invoiced_count, paid_count, to_char(earliest_invoiced_due_date, 'YYYY-MM-DD') as due
      from overview.work_order_summaries where work_order_id = ${withMilestones}`.execute(db);
    expect(rows).toEqual([{ invoiced_count: 1, paid_count: 1, due: '2026-10-07' }]);
    const after = await maintenance.verify({ traceId: '0'.repeat(32), alert: false });
    expect(after).toMatchObject({ checked: 2, inSync: 2, missing: [] });
    expect(after.drift.payments).toEqual([]);
  });
});
