import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let app: Kysely<Database>;
let userId: string;
const clock = new FixedClock('2026-10-07T08:00:00Z');

beforeAll(async () => {
  database = await migratedDatabase();
  app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  userId = (await createUser(database.admin, clock, { role: 'editor' })).id;
});
afterAll(async () => {
  await app.destroy();
  await database.close();
});

const admin = () => database.admin;
const T = '2026-10-07T08:00:00Z';
const insertOrder = (number: string, extra: { status?: string; title?: string } = {}) =>
  sql<{ id: string }>`insert into work_orders.work_orders (number, title, status, created_at, updated_at)
      values (${number}, ${extra.title ?? 'Zlecenie syntetyczne'}, ${extra.status ?? 'new'}, ${T}, ${T}) returning id`.execute(admin());
const assign = (workOrderId: string, role: string, deletedAt: string | null = null) =>
  sql`insert into work_orders.work_order_assignments (work_order_id, user_id, role, created_at, updated_at, deleted_at)
      values (${workOrderId}, ${userId}, ${role}, ${T}, ${T}, ${deletedAt})`.execute(admin());
const idOf = async (number: string): Promise<string> => (await insertOrder(number)).rows[0]?.id ?? '';
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};

describe('migration 0010 — work orders (EVM-017 AC1, AC2, AC4, AC6; ADR-0003, ADR-0017; expand only)', () => {
  it('EVM-017 AC1 the schema holds the two tables of the list and the two of the creation (EVM-022 adds the customer, the site and the template with their keys)', async () => {
    const { rows } = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name from information_schema.columns where table_schema = 'work_orders' order by table_name, ordinal_position`.execute(
      admin(),
    );
    const columns = (table: string) => rows.filter((row) => row.table_name === table).map((row) => row.column_name);
    const common = ['created_at', 'created_by', 'updated_at', 'updated_by', 'version', 'deleted_at', 'deleted_by'];
    expect(columns('work_orders')).toEqual([
      'id',
      'number',
      'title',
      'status',
      ...common,
      'customer_id',
      'site_id',
      'source_template_id',
      'planned_date',
      'description',
      'resume_status',
      'status_reason',
      'status_changed_at',
      'closed_at',
      'completed_on',
    ]);
    expect(columns('work_order_assignments')).toEqual(['id', 'work_order_id', 'user_id', 'role', ...common]);
    expect([...new Set(rows.map((row) => row.table_name))].sort()).toEqual([
      'number_counters',
      'scope_items',
      'work_order_assignments',
      'work_orders',
    ]);
  });

  it('EVM-017 AC1 the status is one of the eight values of WorkOrderStatus (CHECK); the number is unique, not empty and at most 32 characters; the title 1..200', async () => {
    const statuses = ['new', 'quoting', 'accepted', 'in_progress', 'completed', 'settled', 'on_hold', 'cancelled'];
    for (const [index, status] of statuses.entries()) await insertOrder(`ZL-2026-${String(9100 + index)}`, { status });
    await fails(insertOrder('ZL-2026-9201', { status: 'archived' }), '23514');
    await fails(insertOrder('ZL-2026-9100'), '23505');
    await fails(insertOrder(''), '23514');
    await fails(insertOrder('N'.repeat(33)), '23514');
    await fails(insertOrder('ZL-2026-9202', { title: '' }), '23514');
    await fails(insertOrder('ZL-2026-9203', { title: 'T'.repeat(201) }), '23514');
    await insertOrder('ZL-2026-9204', { title: 'T'.repeat(200) });
  });

  it('EVM-017 AC2 the number is compared bytewise (COLLATE "C"), not by the ICU collation pl-PL of the database', async () => {
    const { rows } = await sql<{ collation: string }>`
      select collation_name as collation from information_schema.columns
      where table_schema = 'work_orders' and table_name = 'work_orders' and column_name = 'number'`.execute(admin());
    expect(rows[0]?.collation).toBe('C');
    const { rows: order } = await sql<{ v: string }>`
      select v from (values ('b'), ('A'), ('a'), ('B'), ('Ł'), ('L')) as t(v) order by v collate "C"`.execute(admin());
    expect(order.map((row) => row.v)).toEqual(['A', 'B', 'L', 'a', 'b', 'Ł']); // bytewise: capitals first — pl-PL would interleave them
  });

  it('EVM-017 AC1 the assignment role is coordinator or technician, the user and the order must exist, and an order has at most ONE active coordinator', async () => {
    const order = await idOf('ZL-2026-9301');
    await assign(order, 'technician');
    await assign(order, 'technician');
    await assign(order, 'coordinator');
    await fails(assign(order, 'coordinator'), '23505');
    await fails(assign(order, 'owner'), '23514');
    await fails(
      sql`insert into work_orders.work_order_assignments (work_order_id, user_id, role, created_at, updated_at)
          values (${order}, '0198b0a0-0000-7000-8000-000000000099', 'technician', ${T}, ${T})`.execute(admin()),
      '23503',
    );
    await fails(
      sql`insert into work_orders.work_order_assignments (work_order_id, user_id, role, created_at, updated_at)
          values ('0198b0a0-0000-7000-8000-000000000098', ${userId}, 'technician', ${T}, ${T})`.execute(admin()),
      '23503',
    );
  });

  it('EVM-017 AC1 an ended (soft deleted) coordinator makes room for the next one', async () => {
    const order = await idOf('ZL-2026-9302');
    await assign(order, 'coordinator', '2026-10-07T09:00:00Z');
    await assign(order, 'coordinator');
    await assign(order, 'coordinator', '2026-10-07T10:00:00Z');
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from work_orders.work_order_assignments where work_order_id = ${order}`.execute(admin());
    expect(rows[0]?.n).toBe('3');
  });

  it('EVM-017 AC4 the keyset indexes are unique or partial on the read policy (deleted_at is null), and there is no index on the status', async () => {
    const { rows } = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef from pg_indexes where schemaname = 'work_orders' order by indexname`.execute(admin());
    const byName = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    expect(byName['work_orders_number_key']).toContain('(number)');
    expect(byName['work_orders_created_at_id_idx']).toMatch(/\(created_at, id\) WHERE \(deleted_at IS NULL\)/);
    expect(byName['work_order_assignments_one_coordinator_idx']).toMatch(
      /UNIQUE.*\(work_order_id\) WHERE .*coordinator.*deleted_at IS NULL/,
    );
    expect(byName['work_order_assignments_coordinator_user_idx']).toMatch(/\(user_id\) WHERE .*coordinator.*deleted_at IS NULL/);
    expect(rows.some((row) => /\(status/.test(row.indexdef))).toBe(false);
  });

  it('EVM-017 AC1 the application role may SELECT, INSERT and UPDATE but not DELETE or TRUNCATE; PUBLIC has no access to the schema', async () => {
    for (const table of ['work_orders.work_orders', 'work_orders.work_order_assignments']) {
      const { rows } = await sql<Record<string, boolean>>`
        select has_table_privilege('evia_it_app', ${table}, 'SELECT') as "select", has_table_privilege('evia_it_app', ${table}, 'INSERT') as "insert",
               has_table_privilege('evia_it_app', ${table}, 'UPDATE') as "update", has_table_privilege('evia_it_app', ${table}, 'DELETE') as "delete",
               has_table_privilege('evia_it_app', ${table}, 'TRUNCATE') as "truncate", has_table_privilege('evia_it_app', ${table}, 'REFERENCES') as "references",
               has_table_privilege('evia_it_app', ${table}, 'TRIGGER') as "trigger"`.execute(admin());
      expect(rows[0], table).toEqual({
        select: true,
        insert: true,
        update: true,
        delete: false,
        truncate: false,
        references: false,
        trigger: false,
      });
    }
    const { rows: schema } = await sql<{ usage: boolean; create: boolean; app: boolean }>`
      select has_schema_privilege('public', 'work_orders', 'USAGE') as usage, has_schema_privilege('evia_it_app', 'work_orders', 'CREATE') as create,
             has_schema_privilege('evia_it_app', 'work_orders', 'USAGE') as app`.execute(admin());
    expect(schema[0]).toEqual({ usage: false, create: false, app: true });
    const { rows: defaults } = await sql<{ n: string }>`
      select count(*)::text as n from pg_default_acl where defaclnamespace = (select oid from pg_namespace where nspname = 'work_orders')`.execute(
      admin(),
    );
    expect(defaults[0]?.n).toBe('0');
  });

  it('EVM-017 AC6 through the application role a work order is written and soft deleted, and a hard DELETE is refused (42501)', async () => {
    await sql`insert into work_orders.work_orders (number, title, status, created_at, updated_at) values ('ZL-2026-9401', 'x', 'new', ${T}, ${T})`.execute(
      app,
    );
    await sql`update work_orders.work_orders set deleted_at = ${T}, version = version + 1 where number = 'ZL-2026-9401'`.execute(app);
    const { rows } = await sql<{
      deleted_at: Date | null;
    }>`select deleted_at from work_orders.work_orders where number = 'ZL-2026-9401'`.execute(app);
    expect(rows[0]?.deleted_at).not.toBeNull();
    await expect(sql`delete from work_orders.work_orders where number = 'ZL-2026-9401'`.execute(app)).rejects.toMatchObject({
      code: '42501',
    });
  });
});
