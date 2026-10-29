import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYNC_EXCLUDED_TABLES, SYNC_SCOPE_SCHEMAS, SYNCED_ENTITIES } from '../../src/modules/sync/domain/synced-entities.ts';
import { createDatabase } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

interface LogRow {
  entity_type: string;
  entity_id: string;
  operation: string;
  work_order_id: string | null;
  entity_version: number;
}
const log = async (id: string): Promise<LogRow[]> =>
  (
    await sql<LogRow>`select entity_type, entity_id, operation, work_order_id, entity_version from sync.change_log where entity_id = ${id} order by seq`.execute(
      database.admin,
    )
  ).rows;
const admin = () => database.admin;

describe('the change log written by the trigger (EVM-096 AC1; ADR-0021 D4)', () => {
  it('EVM-096 AC1 insert, update, update without a change, soft delete, restore and purge of a site map to upsert/delete', async () => {
    const id = await insertSite(admin());
    await sql`update sites.sites set city = 'Gdansk', version = version + 1 where id = ${id}`.execute(admin());
    await sql`update sites.sites set city = city where id = ${id}`.execute(admin());
    await sql`update sites.sites set deleted_at = now(), version = version + 1 where id = ${id}`.execute(admin());
    await sql`update sites.sites set deleted_at = null, version = version + 1 where id = ${id}`.execute(admin());
    await sql`delete from sites.sites where id = ${id}`.execute(admin());
    expect((await log(id)).map((row) => row.operation)).toEqual(['upsert', 'upsert', 'delete', 'upsert', 'delete']);
    expect(await log(id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ entity_type: 'site', work_order_id: null, entity_version: 1 })]),
    );
  });

  it('EVM-096 AC1 a customer has no anchor and a work order is its own anchor; the row names no personal data', async () => {
    const customerId = await insertCustomer(admin(), { email: 'a@example.test' });
    const [order] = [...(await insertWorkOrders(admin(), [{ number: 'ZL-2026-9001' }])).values()];
    expect(await log(customerId)).toEqual([expect.objectContaining({ entity_type: 'customer', work_order_id: null, operation: 'upsert' })]);
    expect(await log(order ?? '')).toEqual([
      expect.objectContaining({ entity_type: 'work_order', work_order_id: order, operation: 'upsert' }),
    ]);
    const columns = await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_schema = 'sync' and table_name = 'change_log' order by ordinal_position`.execute(
      admin(),
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'seq',
      'txid',
      'entity_type',
      'entity_id',
      'operation',
      'work_order_id',
      'entity_version',
      'recorded_at',
    ]);
  });

  it('EVM-096 AC1 the application role may only read the log; it cannot fabricate, change or erase a row, cannot truncate, switch triggers off or leave the replica role', async () => {
    const privilege = async (check: string, object: string): Promise<boolean> =>
      (await sql<{ allowed: boolean }>`select has_table_privilege('evia_app', ${object}, ${check}) as allowed`.execute(admin())).rows[0]
        ?.allowed === true;
    expect(await privilege('select', 'sync.change_log')).toBe(true);
    for (const forbidden of ['insert', 'update', 'delete', 'truncate'])
      expect(await privilege(forbidden, 'sync.change_log'), forbidden).toBe(false);
    const sequence = await sql<{
      allowed: boolean;
    }>`select has_sequence_privilege('evia_app', 'sync.change_log_seq_seq', 'usage') as allowed`.execute(admin());
    expect(sequence.rows[0]?.allowed).toBe(false);
    for (const { table } of SYNCED_ENTITIES) expect(await privilege('truncate', table), table).toBe(false);

    const app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 1 } });
    try {
      await expect(
        sql`insert into sync.change_log (entity_type, entity_id, operation, entity_version) values ('site', uuidv7(), 'upsert', 1)`.execute(
          app,
        ),
      ).rejects.toThrow();
      await expect(sql`delete from sync.change_log`.execute(app)).rejects.toThrow();
      await expect(sql`set session_replication_role = replica`.execute(app)).rejects.toThrow();
      await expect(sql`alter table sites.sites disable trigger record_change_update`.execute(app)).rejects.toThrow();
      await expect(sql`select sync.record_change()`.execute(app)).rejects.toThrow();
    } finally {
      await app.destroy();
    }
  });

  it('EVM-096 AC1 the registry equals the triggers of the database and every table in scope is registered or excluded with a reason (fail closed)', async () => {
    const triggers = await sql<{ table: string }>`
      select distinct (n.nspname || '.' || c.relname) as "table" from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
      where not t.tgisinternal and pn.nspname = 'sync' and p.proname = 'record_change'`.execute(admin());
    expect(triggers.rows.map((row) => row.table).sort()).toEqual(SYNCED_ENTITIES.map((entity) => entity.table).sort());
    const tables = await sql<{ table: string }>`
      select (table_schema || '.' || table_name) as "table" from information_schema.tables
      where table_type = 'BASE TABLE' and table_schema in (${sql.join([...SYNC_SCOPE_SCHEMAS])})`.execute(admin());
    const known = new Set([...SYNCED_ENTITIES.map((entity) => entity.table), ...Object.keys(SYNC_EXCLUDED_TABLES)]);
    expect(tables.rows.map((row) => row.table).filter((table) => !known.has(table))).toEqual([]);
    expect([...known].filter((table) => !tables.rows.some((row) => row.table === table))).toEqual([]);
    for (const reason of Object.values(SYNC_EXCLUDED_TABLES)) expect(reason.length).toBeGreaterThan(10);
  });
});
