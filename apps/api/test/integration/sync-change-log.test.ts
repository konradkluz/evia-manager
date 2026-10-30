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
    // `identity.users` is outside the scope schemas on purpose (the other tables of `identity` never reach the phone) - it is registered and has its trigger
    expect([...known].filter((table) => table !== 'identity.users' && !tables.rows.some((row) => row.table === table))).toEqual([]);
    for (const reason of Object.values(SYNC_EXCLUDED_TABLES)) expect(reason.length).toBeGreaterThan(10);
  });
});

describe('the migration 0054 (EVM-097; ADR-0021 D4)', () => {
  const triggerNames = async (table: string): Promise<string[]> =>
    (
      await sql<{ name: string }>`
        select t.tgname as name from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal and (n.nspname || '.' || c.relname) = ${table} order by 1`.execute(admin())
    ).rows.map((row) => row.name);

  it('EVM-097 AC1 every table of the remaining types has the pair of triggers of the log, the users one only for the name and the deletion', async () => {
    for (const table of [
      'work_orders.scope_items',
      'parties.parties',
      'procedures.procedure_stages',
      'timeline.timeline_entries',
      'identity.users',
    ])
      expect(await triggerNames(table), table).toEqual(expect.arrayContaining(['record_change_insert_delete', 'record_change_update']));
    expect(await triggerNames('procedures.procedures')).toContain('record_procedure_change');
    const users = await sql<{ definition: string }>`
      select pg_get_triggerdef(t.oid) as definition from pg_trigger t where t.tgname = 'record_change_update' and t.tgrelid = 'identity.users'::regclass`.execute(
      admin(),
    );
    const definition = users.rows[0]?.definition ?? '';
    expect(definition).toContain('display_name');
    expect(definition).toContain('deleted_at');
    expect(definition).not.toContain('version');
    expect(definition).not.toContain('role');
  });

  it('EVM-097 AC1 the functions of the log are SECURITY DEFINER with a pinned search_path and no right of the public; the application role has no INSERT on the log and cannot call them', async () => {
    const functions = await sql<{ name: string; definer: boolean; config: string[] | null; public_execute: boolean; app_execute: boolean }>`
      select p.proname as name, p.prosecdef as definer, p.proconfig as config,
        has_function_privilege('public', p.oid, 'execute') as public_execute, has_function_privilege('evia_app', p.oid, 'execute') as app_execute
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'sync' and p.proname like 'record\_%' order by 1`.execute(
      admin(),
    );
    expect(functions.rows.map((row) => row.name)).toEqual(['record_change', 'record_procedure_change', 'record_superseded_change']);
    for (const row of functions.rows) {
      expect(row.definer, row.name).toBe(true);
      expect(row.config, row.name).toEqual(['search_path=pg_catalog, pg_temp']);
      expect(row.public_execute, row.name).toBe(false);
      expect(row.app_execute, row.name).toBe(false);
    }
    const privilege = async (check: string, object: string): Promise<boolean> =>
      (await sql<{ allowed: boolean }>`select has_table_privilege('evia_app', ${object}, ${check}) as allowed`.execute(admin())).rows[0]
        ?.allowed === true;
    for (const forbidden of ['insert', 'update', 'delete', 'truncate'])
      expect(await privilege(forbidden, 'sync.change_log'), forbidden).toBe(false);
    expect(await privilege('insert', 'sync.snapshot_requests')).toBe(true);
    expect(await privilege('truncate', 'sync.snapshot_requests')).toBe(false);
  });

  it('EVM-097 AC1 a change of the name or the code of a process writes one row for each live stage; a deleted stage writes none; the rows of 0053 survive', async () => {
    const [order] = [...(await insertWorkOrders(admin(), [{ number: 'ZL-2026-9101' }])).values()];
    const { insertProcedure } = await import('../support/procedure-fixtures.ts');
    const procedure = await insertProcedure(admin(), order ?? '', { stages: [{}, {}, { deletedAt: new Date('2026-10-02T08:00:00Z') }] });
    const rows = async (): Promise<number> =>
      Number(
        (
          await sql<{
            n: string;
          }>`select count(*) as n from sync.change_log where entity_type = 'procedure_stage' and entity_id in (${sql.join(procedure.stageIds)})`.execute(
            admin(),
          )
        ).rows[0]?.n,
      );
    const before = await rows();
    await sql`update procedures.procedures set updated_at = now() where id = ${procedure.id}`.execute(admin());
    expect(await rows()).toBe(before);
    await sql`update procedures.procedures set name = 'Zmieniona nazwa' where id = ${procedure.id}`.execute(admin());
    expect(await rows()).toBe(before + 2);
    expect(await log(order ?? '')).toEqual([expect.objectContaining({ entity_type: 'work_order' })]);
  });

  it('EVM-097 AC7 the audit trail takes a number of entities that is not negative, and the outbox takes the new alert code but not an invented one', async () => {
    const insertEvent = (count: number) =>
      sql`insert into audit.events (occurred_at, actor_type, origin, action, outcome, object_type, trace_id, entity_count)
        values (now(), 'system', 'web', 'sync.work_order_snapshot', 'success', 'device', ${'0'.repeat(32)}, ${count})`.execute(admin());
    await insertEvent(12);
    await expect(insertEvent(-1)).rejects.toThrow();
    const alert = (code: string) =>
      sql`insert into platform.security_alert_outbox (alert_code, occurred_at, trace_id) values (${code}, now(), ${'0'.repeat(32)})`.execute(
        admin(),
      );
    await alert('sync_snapshot_rate_exceeded');
    await alert('sync_full_downloads_excess');
    await expect(alert('sync_invented')).rejects.toThrow();
  });
});
