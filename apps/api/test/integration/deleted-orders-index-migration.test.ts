import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';
import { freshDatabaseUrl } from './database.ts';

/**
 * 0033 is applied on a database that already holds orders, one of them soft deleted, and their projection: the index is added and
 * nothing else changes — no row, no column, no privilege (expand only; the migrations of the project are forward only, so a fix
 * would be a new migration, ADR-0003).
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0033')) as typeof MIGRATIONS;

let db: Kysely<Database>;
let snapshotBefore = '';
const snapshot = async (): Promise<string> =>
  JSON.stringify((await sql`select to_jsonb(t)::text as row from overview.work_order_summaries t order by 1`.execute(db)).rows);

beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  await insertWorkOrders(db, [
    { number: numberOf(2026, 3301) },
    { number: numberOf(2026, 3302), deletedAt: new Date('2026-10-10T08:00:00Z') },
  ]);
  // the helper has written the projection of both orders (the shape of 0023 is the shape of the helper)
  expect(JSON.parse(await snapshot())).toHaveLength(2);
  snapshotBefore = await snapshot();
  // later migrations (e.g. 0035+) run in the same call; this test is about 0033 only
  expect((await migrateToLatest(db, MIGRATIONS)).applied.filter((name) => name <= '0034')).toEqual(['0033_deleted_orders_index']);
});
afterAll(async () => {
  await db.destroy();
});

describe('migration 0033 — the index of the view "Usunięte" (EVM-060 AC4; ADR-0003, ADR-0017; expand only)', () => {
  it('EVM-060 AC4 one partial index on (deleted_at desc, work_order_id) holds the deleted rows only', async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes where indexname = 'work_order_summaries_deleted_idx'`.execute(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toMatch(/\(deleted_at DESC, work_order_id\)/);
    expect(rows[0]?.indexdef).toMatch(/WHERE \(deleted_at IS NOT NULL\)/);
  });

  it('EVM-060 AC4 the migration changes no data: the projection of the existing orders is the same row for row', async () => {
    expect(await snapshot()).toBe(snapshotBefore);
  });

  it('EVM-060 AC4 the migration touches no privilege: the application role keeps SELECT, INSERT and UPDATE and has no DELETE', async () => {
    const { rows } = await sql<{ select: boolean; insert: boolean; update: boolean; delete: boolean }>`
      select has_table_privilege('evia_app', 'overview.work_order_summaries', 'select') as "select",
             has_table_privilege('evia_app', 'overview.work_order_summaries', 'insert') as "insert",
             has_table_privilege('evia_app', 'overview.work_order_summaries', 'update') as "update",
             has_table_privilege('evia_app', 'overview.work_order_summaries', 'delete') as "delete"`.execute(db);
    expect(rows[0]).toEqual({ select: true, insert: true, update: true, delete: false });
  });

  it('EVM-060 AC4 the planner can use it for the page of the deleted orders (the condition of the mode "deleted" implies the predicate of the index)', async () => {
    await sql`set enable_seqscan = off`.execute(db);
    const { rows } = await sql<{ 'QUERY PLAN': string }>`
      explain select work_order_id from overview.work_order_summaries
      where deleted_at is not null order by deleted_at desc, work_order_id limit 26`.execute(db);
    expect(rows.map((row) => row['QUERY PLAN']).join('\n')).toContain('work_order_summaries_deleted_idx');
  });
});
