import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let app: Kysely<Database>;
const T = '2026-10-07T08:00:00Z';

beforeAll(async () => {
  database = await migratedDatabase();
  app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
});
afterAll(async () => {
  await app.destroy();
  await database.close();
});

const admin = () => database.admin;
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};
const insertOrder = (id: string, number: string, extra: { customerId?: string; siteId?: string; description?: string } = {}) =>
  sql`insert into work_orders.work_orders (id, number, title, status, customer_id, site_id, description, created_at, updated_at)
      values (${id}, ${number}, 'Zlecenie syntetyczne', 'new', ${extra.customerId ?? null}, ${extra.siteId ?? null},
        ${extra.description ?? null}, ${T}, ${T})`.execute(admin());
const insertScopeItem = (
  workOrderId: string,
  position: number,
  extra: { quantity?: number; parameters?: string; deletedAt?: string } = {},
) =>
  sql`insert into work_orders.scope_items (work_order_id, position, code, name, parameter_set_code, parameters, quantity, created_at, updated_at, deleted_at)
      values (${workOrderId}, ${position}, 'wallbox_supply', 'Dostawa wallboxa', 'charger_spec', ${extra.parameters ?? '{}'}::jsonb,
        ${extra.quantity ?? 1}, ${T}, ${T}, ${extra.deletedAt ?? null})`.execute(admin());

describe('migration 0015 — creation of a work order (EVM-022 AC1, AC5, AC6; ADR-0003; SR-AUTHZ-02; expand only)', () => {
  it('EVM-022 AC1 the columns of the creation are NULLABLE in the database (expand) and the keys to the customer, the site and the template are ON DELETE RESTRICT', async () => {
    const { rows } = await sql<{ column_name: string; is_nullable: string }>`
      select column_name, is_nullable from information_schema.columns
      where table_schema = 'work_orders' and table_name = 'work_orders'
        and column_name in ('customer_id', 'site_id', 'source_template_id', 'planned_date', 'description')`.execute(admin());
    expect(rows.map((row) => row.column_name).sort()).toEqual([
      'customer_id',
      'description',
      'planned_date',
      'site_id',
      'source_template_id',
    ]);
    expect(rows.every((row) => row.is_nullable === 'YES')).toBe(true);

    const { rows: keys } = await sql<{ table_name: string; target: string; on_delete: string }>`
      select cl.relname as table_name, (confrelid::regclass)::text as target, confdeltype as on_delete
      from pg_constraint c join pg_class cl on cl.oid = c.conrelid
      where contype = 'f' and connamespace = 'work_orders'::regnamespace and confrelid::regclass::text !~ 'identity'
      order by 1, 2`.execute(admin());
    expect(keys).toEqual(
      expect.arrayContaining([
        { table_name: 'work_orders', target: 'customers.customers', on_delete: 'r' },
        { table_name: 'work_orders', target: 'sites.sites', on_delete: 'r' },
        { table_name: 'work_orders', target: 'catalog.work_order_templates', on_delete: 'r' },
        { table_name: 'scope_items', target: 'work_orders.work_orders', on_delete: 'r' },
        { table_name: 'scope_items', target: 'catalog.service_catalog_items', on_delete: 'r' },
      ]),
    );
    expect(keys.some((key) => key.on_delete === 'c')).toBe(false); // no cascade anywhere
  });

  it('EVM-022 AC3 the customer and the site must exist (foreign keys); a customer or a site that an order points to cannot be deleted', async () => {
    const customerId = await insertCustomer(admin());
    const siteId = await insertSite(admin());
    await fails(insertOrder(uuidv7(), 'ZL-2026-0001', { customerId: uuidv7() }), '23503');
    await fails(insertOrder(uuidv7(), 'ZL-2026-0002', { siteId: uuidv7() }), '23503');
    await insertOrder(uuidv7(), 'ZL-2026-0003', { customerId, siteId });
    await fails(sql`delete from customers.customers where id = ${customerId}`.execute(admin()), '23001');
    await fails(sql`delete from sites.sites where id = ${siteId}`.execute(admin()), '23001');
  });

  it('EVM-022 AC5 the number has the format ZL-YYYY-NNNN (at least four digits); the identifier is a UUIDv7 and the description 1..2000', async () => {
    for (const number of ['ZL-26-0001', 'ZL-2026-001', 'zl-2026-0001', 'ZL-2026-00A1', 'ZL-2026-0001x', ' ZL-2026-0001'])
      await fails(insertOrder(uuidv7(), number), '23514');
    await insertOrder(uuidv7(), 'ZL-2026-12345');
    await fails(insertOrder('0198b0a0-0000-4000-8000-000000000001', 'ZL-2026-0010'), '23514');
    await fails(insertOrder(uuidv7(), 'ZL-2026-0011', { description: '' }), '23514');
    await fails(insertOrder(uuidv7(), 'ZL-2026-0012', { description: 'D'.repeat(2001) }), '23514');
    await insertOrder(uuidv7(), 'ZL-2026-0013', { description: 'D'.repeat(2000) });
  });

  it('EVM-022 AC1 a scope item has a quantity 1..100, a position 1..50 and parameters that are an object of at most 16 KB', async () => {
    const order = uuidv7();
    await insertOrder(order, 'ZL-2026-0020');
    await insertScopeItem(order, 1, { quantity: 100, parameters: '{"powerKw": 11}' });
    await fails(insertScopeItem(order, 2, { quantity: 0 }), '23514');
    await fails(insertScopeItem(order, 3, { quantity: 101 }), '23514');
    await fails(insertScopeItem(order, 0), '23514');
    await fails(insertScopeItem(order, 51), '23514');
    await fails(insertScopeItem(order, 4, { parameters: '[1]' }), '23514');
    await fails(insertScopeItem(order, 5, { parameters: JSON.stringify({ note: 'x'.repeat(16400) }) }), '23514');
    await insertScopeItem(order, 6, { parameters: JSON.stringify({ note: 'x'.repeat(16000) }) });
  });

  it('EVM-022 AC1 the position is unique among the ACTIVE scope items of an order; a soft deleted item frees it; the anchor is required', async () => {
    const order = uuidv7();
    await insertOrder(order, 'ZL-2026-0021');
    await insertScopeItem(order, 1);
    await fails(insertScopeItem(order, 1), '23505');
    await insertScopeItem(order, 2, { deletedAt: T });
    await insertScopeItem(order, 2);
    await fails(
      sql`insert into work_orders.scope_items (work_order_id, position, code, name, created_at, updated_at)
          values (null, 1, 'x_code', 'x', ${T}, ${T})`.execute(admin()),
      '23502',
    );
    await fails(insertScopeItem(uuidv7(), 1), '23503'); // the order must exist
  });

  it('EVM-022 AC5 the counter keeps one row per year, counts from 1 and refuses a year or a value out of range', async () => {
    await sql`insert into work_orders.number_counters (year, last_value) values (2027, 1)`.execute(admin());
    await fails(sql`insert into work_orders.number_counters (year, last_value) values (2027, 2)`.execute(admin()), '23505');
    await fails(sql`insert into work_orders.number_counters (year, last_value) values (1999, 1)`.execute(admin()), '23514');
    await fails(sql`insert into work_orders.number_counters (year, last_value) values (2028, 0)`.execute(admin()), '23514');
    const { rows } = await sql<{ last_value: number }>`
      insert into work_orders.number_counters (year, last_value) values (2027, 1)
      on conflict (year) do update set last_value = work_orders.number_counters.last_value + 1 returning last_value`.execute(admin());
    expect(rows[0]?.last_value).toBe(2);
  });

  it('EVM-022 AC5 a rolled back transaction takes back the use of a number (a counter in a table, not a sequence: no gap)', async () => {
    await sql`insert into work_orders.number_counters (year, last_value) values (2030, 5)`.execute(admin());
    await expect(
      admin()
        .transaction()
        .execute(async (tx) => {
          await sql`update work_orders.number_counters set last_value = last_value + 1 where year = 2030`.execute(tx);
          throw new Error('rollback');
        }),
    ).rejects.toThrow('rollback');
    const { rows } = await sql<{ last_value: number }>`select last_value from work_orders.number_counters where year = 2030`.execute(
      admin(),
    );
    expect(rows[0]?.last_value).toBe(5);
  });

  it('EVM-022 AC6 the application role may SELECT, INSERT and UPDATE the new tables but not DELETE, TRUNCATE or REFERENCE them', async () => {
    for (const table of ['work_orders.scope_items', 'work_orders.number_counters']) {
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
    await sql`insert into work_orders.number_counters (year, last_value) values (2031, 1)`.execute(app);
    await sql`update work_orders.number_counters set last_value = 2 where year = 2031`.execute(app);
    await expect(sql`delete from work_orders.number_counters where year = 2031`.execute(app)).rejects.toMatchObject({ code: '42501' });
  });
});
