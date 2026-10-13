import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { insertParty } from '../support/site-fixtures.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let app: Kysely<Database>;
beforeAll(async () => {
  database = await migratedDatabase();
  app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 1 } });
});
afterAll(async () => {
  await app.destroy();
  await database.close();
});

const admin = () => database.admin;
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};

const SUMMARY_COLUMNS = [
  'coordinator_user_id',
  'created_at',
  'customer_id',
  'deleted_at',
  'longest_waiting_on',
  'longest_waiting_party_id',
  'longest_waiting_since',
  'next_due_date',
  'number',
  'recomputed_at',
  'site_id',
  'site_type',
  'source_template_id',
  'status',
  'waiting_count',
  'work_order_id',
];
const WAIT_COLUMNS = ['party_id', 'party_kind', 'stage_id', 'waiting_on', 'waiting_since', 'work_order_id'];

let numbering = 0;
async function order(): Promise<string> {
  numbering += 1;
  const ids = await insertWorkOrders(admin(), [{ number: numberOf(2026, 700 + numbering) }]);
  return [...ids.values()][0] ?? '';
}

describe('migration 0023 — the read model of the list (EVM-034; ADR-0017 W1, W10; expand only)', () => {
  it('EVM-034 AC6 T5 the columns of the projection are the closed list of the ADR: keys, codes, dates and counters — no title, name, amount, note or search text', async () => {
    const { rows } = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name from information_schema.columns where table_schema = 'overview' order by table_name, column_name`.execute(
      admin(),
    );
    const columnsOf = (table: string) => rows.filter((row) => row.table_name === table).map((row) => row.column_name);
    expect(columnsOf('work_order_summaries')).toEqual(SUMMARY_COLUMNS);
    expect(columnsOf('work_order_waits')).toEqual(WAIT_COLUMNS);
    const { rows: tables } = await sql<{ table_name: string }>`
      select table_name from information_schema.tables where table_schema = 'overview' order by 1`.execute(admin());
    expect(tables.map((row) => row.table_name)).toEqual(['work_order_summaries', 'work_order_waits']);
    expect(rows.map((row) => row.column_name).join(' ')).not.toMatch(
      /title|name|amount|payment|invoice|note|search|description|reason|phone|email/,
    );
  });

  it('EVM-034 AC6 T5 the tables have no trigger (no SyncChange, no hidden write) and no column of text outside codes under a CHECK', async () => {
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from information_schema.triggers where trigger_schema = 'overview'`.execute(admin());
    expect(rows[0]?.n).toBe('0');
    const { rows: texts } = await sql<{ column_name: string }>`
      select column_name from information_schema.columns
      where table_schema = 'overview' and data_type = 'text' order by 1`.execute(admin());
    const { rows: checks } = await sql<{ definition: string }>`
      select pg_get_constraintdef(c.oid) as definition from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'overview' and c.contype = 'c'`.execute(admin());
    const all = checks.map((check) => check.definition).join('\n');
    for (const column of texts.map((row) => row.column_name)) expect(all, column).toContain(column);
  });

  it('EVM-034 AC6 T5 the application role has SELECT, INSERT and UPDATE on the summaries, DELETE only on the waits; the read-only role has nothing; nobody may TRUNCATE', async () => {
    const privilege = async (table: string, name: string, role = 'evia_it_app') =>
      (await sql<{ ok: boolean }>`select has_table_privilege(${role}, ${`overview.${table}`}, ${name}) as ok`.execute(admin())).rows[0]?.ok;
    for (const name of ['SELECT', 'INSERT', 'UPDATE']) {
      expect(await privilege('work_order_summaries', name), name).toBe(true);
      expect(await privilege('work_order_waits', name), name).toBe(true);
    }
    expect(await privilege('work_order_summaries', 'DELETE')).toBe(false);
    expect(await privilege('work_order_waits', 'DELETE')).toBe(true);
    for (const table of ['work_order_summaries', 'work_order_waits']) {
      expect(await privilege(table, 'TRUNCATE'), table).toBe(false);
      expect(await privilege(table, 'REFERENCES'), table).toBe(false);
    }
    // nobody but the application role is granted anything (the read-only role and PUBLIC have no access, SR-DATA-08)
    const { rows: grantees } = await sql<{ grantee: string }>`
      select distinct grantee from information_schema.role_table_grants
      where table_schema = 'overview' and grantee not in (select tableowner from pg_tables where schemaname = 'overview') order by 1`.execute(
      admin(),
    );
    expect(grantees.map((row) => row.grantee)).toEqual(['evia_app']);
    const id = await order();
    await fails(sql`delete from overview.work_order_summaries where work_order_id = ${id}`.execute(app), '42501');
    await sql`update overview.work_order_summaries set waiting_count = 0 where work_order_id = ${id}`.execute(app);
  });

  it('EVM-034 AC6 T6 a purge of the order takes its projection with it: the chain of keys is ON DELETE CASCADE down to the waits', async () => {
    const id = await order();
    const party = await insertParty(admin());
    await sql`update overview.work_order_summaries set waiting_count = 1, longest_waiting_since = '2026-09-18',
      longest_waiting_on = 'party', longest_waiting_party_id = ${party} where work_order_id = ${id}`.execute(admin());
    await sql`insert into overview.work_order_waits (stage_id, work_order_id, waiting_on, party_id, party_kind, waiting_since)
      values (${'01a13115-0000-7000-8000-00000000f001'}, ${id}, 'party', ${party}, 'distribution_system_operator', '2026-09-18')`.execute(
      admin(),
    );
    await sql`delete from work_orders.work_order_assignments where work_order_id = ${id}`.execute(admin());
    await sql`delete from work_orders.work_orders where id = ${id}`.execute(admin());
    const { rows } = await sql<{ summaries: string; waits: string }>`
      select (select count(*) from overview.work_order_summaries where work_order_id = ${id})::text as summaries,
             (select count(*) from overview.work_order_waits where work_order_id = ${id})::text as waits`.execute(admin());
    expect(rows).toEqual([{ summaries: '0', waits: '0' }]);
  });

  it('EVM-034 AC6 the keys of the chain point at the order and at the projection row — and nowhere else (no key to a site, a customer, a party or a stage)', async () => {
    const { rows } = await sql<{ table_name: string; foreign_table: string; delete_rule: string }>`
      select tc.table_name, ccu.table_schema || '.' || ccu.table_name as foreign_table, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.unique_constraint_name and ccu.constraint_schema = rc.unique_constraint_schema
      where tc.table_schema = 'overview' and tc.constraint_type = 'FOREIGN KEY' order by 1`.execute(admin());
    expect(rows).toEqual([
      { table_name: 'work_order_summaries', foreign_table: 'work_orders.work_orders', delete_rule: 'CASCADE' },
      { table_name: 'work_order_waits', foreign_table: 'overview.work_order_summaries', delete_rule: 'CASCADE' },
    ]);
  });

  it('EVM-034 AC6 the CHECKs: a status, a code of the site type, the longest wait and the party of a wait must be consistent', async () => {
    const id = await order();
    await fails(sql`update overview.work_order_summaries set status = 'unknown' where work_order_id = ${id}`.execute(admin()), '23514');
    await fails(
      sql`update overview.work_order_summaries set site_type = 'Not A Code' where work_order_id = ${id}`.execute(admin()),
      '23514',
    );
    await fails(sql`update overview.work_order_summaries set waiting_count = -1 where work_order_id = ${id}`.execute(admin()), '23514');
    // the day without "waiting for", the count without the day, a party that is named for the customer
    await fails(
      sql`update overview.work_order_summaries set longest_waiting_since = '2026-09-18' where work_order_id = ${id}`.execute(admin()),
      '23514',
    );
    await fails(sql`update overview.work_order_summaries set waiting_count = 1 where work_order_id = ${id}`.execute(admin()), '23514');
    await fails(
      sql`insert into overview.work_order_waits (stage_id, work_order_id, waiting_on, party_id, party_kind, waiting_since)
        values (${'01a13115-0000-7000-8000-00000000f002'}, ${id}, 'customer', ${'01a13115-0000-7000-8000-0000000000a1'}, null, '2026-09-18')`.execute(
        admin(),
      ),
      '23514',
    );
    await fails(
      sql`insert into overview.work_order_waits (stage_id, work_order_id, waiting_on, party_id, party_kind, waiting_since)
        values (${'01a13115-0000-7000-8000-00000000f003'}, ${id}, 'party', null, null, '2026-09-18')`.execute(admin()),
      '23514',
    );
    await fails(
      sql`insert into overview.work_order_waits (stage_id, work_order_id, waiting_on, party_id, party_kind, waiting_since)
        values (${'01a13115-0000-7000-8000-00000000f004'}, ${'01a13115-0000-7000-8000-0000000000ff'}, 'customer', null, null, '2026-09-18')`.execute(
        admin(),
      ),
      '23503',
    );
  });

  it('EVM-034 AC6 W2 the outbox of security alerts accepts the code of an authorisation drift and still refuses an unknown one', async () => {
    await sql`insert into platform.security_alert_outbox (alert_code, occurred_at, trace_id)
      values ('projection_authz_drift', now(), ${'a'.repeat(32)})`.execute(admin());
    await fails(
      sql`insert into platform.security_alert_outbox (alert_code, occurred_at, trace_id) values ('other', now(), ${'a'.repeat(32)})`.execute(
        admin(),
      ),
      '23514',
    );
    await sql`delete from platform.security_alert_outbox`.execute(admin());
  });

  it('EVM-034 AC6 the migration is expand only: it adds a schema and widens one CHECK, and no column or table of another module changes', async () => {
    const { rows } = await sql<{ column_name: string }>`
      select column_name from information_schema.columns
      where table_schema = 'work_orders' and table_name = 'work_orders' order by 1`.execute(admin());
    expect(rows.map((row) => row.column_name)).not.toContain('waiting_count');
    const id = await order();
    const { rows: summary } = await sql<{ number: string; waiting_count: number }>`
      select number, waiting_count from overview.work_order_summaries where work_order_id = ${id}`.execute(admin());
    expect(summary).toEqual([{ number: expect.stringMatching(/^ZL-2026-/) as string, waiting_count: 0 }]);
  });
});
