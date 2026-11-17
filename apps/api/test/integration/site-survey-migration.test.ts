import { sql, type Kysely, type RawBuilder } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { freshDatabaseUrl } from './database.ts';

/**
 * 0066 - the site survey (EVM-135 AC7; ADR-0024 "Migracje"; expand only). It is applied on a database that already holds ordinary orders. FIRST it meets an order
 * without a customer: the control query stops the migration, the transaction of the runner rolls back and nothing of 0066 stays; the order is given a customer
 * (what the product owner would decide) and 0066 then applies. The code of N-1 (it names none of the new columns) keeps writing orders; the invariants refuse an
 * order without a customer and without a deadline; the logical undo (the runner keeps no `down`) runs at the end and loses no data. Synthetic data only.
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0066')) as typeof MIGRATIONS;
const clock = new FixedClock('2026-11-16T08:00:00.000Z');
const T = '2026-11-16T08:00:00Z';
const PHONE = '+48600700800';

let db: Kysely<Database>;
let customerId = '';
let siteId = '';
let userId = '';
let failure: unknown;
let orderWithoutCustomer = '';
let sequence = 0;

const columnsOf = async (schema: string, table: string): Promise<string[]> =>
  (
    await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_schema = ${schema} and table_name = ${table}`.execute(db)
  ).rows.map((row) => row.column_name);

/** An order written with plain SQL, the way a test proves a constraint; `survey` sets the deadline. */
const insertOrder = (fields: {
  readonly customer?: string | null;
  readonly status?: string;
  readonly expiresAt?: string | null;
  readonly phone?: string | null;
  readonly extensions?: number;
  readonly remindedAt?: string | null;
}) => {
  sequence += 1;
  return sql`
    insert into work_orders.work_orders (id, number, title, status, customer_id, site_id, created_at, created_by, updated_at,
      site_survey_expires_at, requester_phone, site_survey_extensions, site_survey_reminded_at)
    values (${uuidv7()}, ${`ZL-6600-${String(sequence).padStart(4, '0')}`}, 'Wizja lokalna', ${fields.status ?? 'quoting'},
      ${fields.customer === undefined ? customerId : fields.customer}, ${siteId}, ${T}, ${userId}, ${T},
      ${fields.expiresAt ?? null}, ${fields.phone ?? null}, ${fields.extensions ?? 0}, ${fields.remindedAt ?? null})
    returning id`.execute(db);
};
const SURVEY = { customer: null, expiresAt: '2027-02-14T08:00:00Z' } as const;
const refused = async (statement: Promise<unknown>): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code: '23514' });
};

beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  userId = (await createUser(db, clock, { role: 'editor' })).id;
  customerId = await insertCustomer(db, {});
  siteId = await insertSite(db);
  await insertWorkOrders(db, [{ number: 'ZL-6600-9001', customerId, siteId }]);
  // before 0066 the database does not forbid an order without a customer (0015): the control query must find it
  orderWithoutCustomer = uuidv7();
  await sql`insert into work_orders.work_orders (id, number, title, status, site_id, created_at, updated_at)
    values (${orderWithoutCustomer}, 'ZL-6600-9002', 'Zlecenie', 'new', ${siteId}, ${T}, ${T})`.execute(db);
  failure = await migrateToLatest(db, MIGRATIONS).then(
    () => undefined,
    (error: unknown) => error,
  );
});
afterAll(async () => {
  await db.destroy();
});

describe('migration 0066 - the site survey (EVM-135 AC7; expand only)', () => {
  it('EVM-135 AC7 the control query: an order without a customer stops 0066 before validation, the message names the count only, and nothing of 0066 stays', async () => {
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toBe('0066: 1 work orders without a customer - stopped before validation; EVM-135 AC7 asks the product owner');
    expect(message).not.toContain(orderWithoutCustomer);
    expect(await columnsOf('work_orders', 'work_orders')).not.toContain('site_survey_expires_at');
    expect(await columnsOf('overview', 'work_order_summaries')).not.toContain('site_survey_expires_at');
    const applied = await sql<{ name: string }>`select name from kysely_migration where name like '0066%'`.execute(db);
    expect(applied.rows).toEqual([]);
  });

  it('EVM-135 AC7 once the order has a customer, 0066 applies and every constraint is validated', async () => {
    await sql`update work_orders.work_orders set customer_id = ${customerId} where id = ${orderWithoutCustomer}`.execute(db);
    expect((await migrateToLatest(db, MIGRATIONS)).applied).toEqual([
      '0066_site_survey',
      '0067_email_outbox_site_survey',
      '0068_site_survey_purge',
    ]);
    const constraints = await sql<{ conname: string; convalidated: boolean }>`
      select conname, convalidated from pg_constraint
      where conrelid = 'work_orders.work_orders'::regclass and contype = 'c' and (conname like 'work_orders_site_survey%' or conname in
        ('work_orders_requester_phone_format', 'work_orders_customer_or_site_survey'))
      order by conname`.execute(db);
    expect(constraints.rows).toEqual([
      { conname: 'work_orders_customer_or_site_survey', convalidated: true },
      { conname: 'work_orders_requester_phone_format', convalidated: true },
      { conname: 'work_orders_site_survey_extensions_range', convalidated: true },
      { conname: 'work_orders_site_survey_fields', convalidated: true },
      { conname: 'work_orders_site_survey_purged_neutral', convalidated: true }, // 0068 (EVM-139): the tombstone of a purged survey
      { conname: 'work_orders_site_survey_shape', convalidated: true },
    ]);
  });

  it('EVM-135 AC7 the existing orders are untouched and the new columns are empty or 0; N-1 writes an order without naming them', async () => {
    const rows = await sql<{
      number: string;
      site_survey_expires_at: Date | null;
      site_survey_extensions: number;
      site_survey_reminded_at: Date | null;
      site_survey_purged_at: Date | null;
      requester_phone: string | null;
    }>`select number, site_survey_expires_at, site_survey_extensions, site_survey_reminded_at, site_survey_purged_at, requester_phone
       from work_orders.work_orders order by number`.execute(db);
    expect(rows.rows).toEqual(
      ['ZL-6600-9001', 'ZL-6600-9002'].map((number) => ({
        number,
        site_survey_expires_at: null,
        site_survey_extensions: 0,
        site_survey_reminded_at: null,
        site_survey_purged_at: null,
        requester_phone: null,
      })),
    );
    // the fixture writes the columns N-1 knows, with a customer - as every path of N-1 does
    const [id] = [...(await insertWorkOrders(db, [{ number: 'ZL-6600-9003', customerId, siteId }])).values()];
    const read = await sql<{
      status: string;
      customer_id: string;
    }>`select status, customer_id from work_orders.work_orders where id = ${id ?? ''}`.execute(db);
    expect(read.rows[0]).toEqual({ status: 'new', customer_id: customerId });
    const projection = await sql<{ site_survey_expires_at: Date | null }>`
      select site_survey_expires_at from overview.work_order_summaries where work_order_id = ${id ?? ''}`.execute(db);
    expect(projection.rows).toEqual([{ site_survey_expires_at: null }]);
  });

  it('EVM-135 AC7 an order without a customer and without a deadline is refused - for every status', async () => {
    for (const status of ['new', 'quoting', 'accepted', 'on_hold', 'cancelled']) await refused(insertOrder({ customer: null, status }));
  });

  it('EVM-135 AC7 a survey with a customer or in a status outside quoting, on_hold and cancelled is refused', async () => {
    await refused(insertOrder({ ...SURVEY, customer: customerId }));
    for (const status of ['new', 'accepted', 'in_progress', 'completed', 'settled']) await refused(insertOrder({ ...SURVEY, status }));
  });

  it('EVM-135 AC7 a survey without a customer in quoting, on_hold and cancelled is accepted, with a phone in E.164 and up to 2 extensions', async () => {
    for (const status of ['quoting', 'on_hold', 'cancelled']) await insertOrder({ ...SURVEY, status });
    await insertOrder({ ...SURVEY, phone: PHONE, extensions: 2, remindedAt: T });
  });

  it('EVM-135 AC7 the phone, the extensions and the reminder only at a survey; the phone in E.164 only; at most 2 extensions', async () => {
    await refused(insertOrder({ phone: PHONE }));
    await refused(insertOrder({ extensions: 1 }));
    await refused(insertOrder({ remindedAt: T }));
    for (const phone of ['600700800', '+48 600 700 800', '+0600700800', '+4860070', '+486007008001234567', '']) {
      await refused(insertOrder({ ...SURVEY, phone }));
    }
    await refused(insertOrder({ ...SURVEY, extensions: 3 }));
    await refused(insertOrder({ ...SURVEY, extensions: -1 }));
  });

  it('EVM-135 AC7 the assignment of a customer (the shape of EVM-136: the customer set, the deadline, the extensions and the phone cleared in ONE update) is accepted; half of it is refused', async () => {
    const id = (await insertOrder({ ...SURVEY, phone: PHONE, extensions: 1 })).rows[0] as { id: string };
    await refused(sql`update work_orders.work_orders set customer_id = ${customerId} where id = ${id.id}`.execute(db));
    await refused(sql`update work_orders.work_orders set site_survey_expires_at = null where id = ${id.id}`.execute(db));
    await sql`
      update work_orders.work_orders
      set customer_id = ${customerId}, site_survey_expires_at = null, site_survey_extensions = 0, requester_phone = null, status = 'accepted'
      where id = ${id.id}`.execute(db);
  });

  it('EVM-135 the purge marker is written once: a second write or clearing it is refused (EV003)', async () => {
    const id = ((await insertOrder({ ...SURVEY, status: 'cancelled' })).rows[0] as { id: string }).id;
    await sql`update work_orders.work_orders set site_survey_purged_at = ${T}, deleted_at = ${T} where id = ${id}`.execute(db);
    await expect(sql`update work_orders.work_orders set site_survey_purged_at = now() where id = ${id}`.execute(db)).rejects.toMatchObject({
      code: 'EV003',
    });
    await expect(sql`update work_orders.work_orders set site_survey_purged_at = null where id = ${id}`.execute(db)).rejects.toMatchObject({
      code: 'EV003',
    });
    // the same value again changes nothing and is let through; other columns stay writable
    await sql`update work_orders.work_orders set site_survey_purged_at = ${T}, title = 'Wizja lokalna' where id = ${id}`.execute(db);
  });

  it('EVM-135 the partial indexes of the deadline exist on the order and on the projection', async () => {
    const indexes = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef from pg_indexes where indexname in ('work_orders_site_survey_expiry_idx', 'work_order_summaries_site_survey_idx')
      order by indexname`.execute(db);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'work_order_summaries_site_survey_idx',
      'work_orders_site_survey_expiry_idx',
    ]);
    for (const row of indexes.rows)
      expect(row.indexdef).toMatch(/WHERE \(\(site_survey_expires_at IS NOT NULL\) AND \(deleted_at IS NULL\)\)/);
  });

  it('EVM-135 AC1 the audit trail takes the command CreateSiteSurvey and still refuses an unknown one', async () => {
    const device = uuidv7();
    const order = ((await insertOrder({ ...SURVEY })).rows[0] as { id: string }).id;
    const write = (command: string) =>
      sql`insert into audit.events (occurred_at, actor_type, actor_user_id, origin, action, outcome, object_type, object_id, trace_id, device_id, work_order_id, command_type)
        values (${T}, 'user', ${userId}, 'web', 'sync.mutation_applied', 'success', 'work_order', ${order}, ${'a'.repeat(32)}, ${device}, ${order}, ${command})`.execute(
        db,
      );
    await write('CreateSiteSurvey');
    await write('CreateQuickWorkOrder');
    await refused(write('CreateSomethingElse'));
  });

  it('EVM-135 the logical undo (reverse order) runs on the data once no survey is open and loses no ordinary order', async () => {
    // the precondition of the undo: no open survey - every survey of the test gets a customer the way EVM-136 does it (the marker of the purge too: the trigger is the
    // only thing that keeps it, and the undo drops the column anyway)
    await sql`alter table work_orders.work_orders disable trigger keep_site_survey_purged_at`.execute(db);
    await sql`
      update work_orders.work_orders
      set customer_id = ${customerId}, site_survey_expires_at = null, site_survey_extensions = 0, requester_phone = null, site_survey_reminded_at = null,
          site_survey_purged_at = null
      where site_survey_expires_at is not null`.execute(db);
    await sql`alter table work_orders.work_orders enable trigger keep_site_survey_purged_at`.execute(db);
    const count = async (query: RawBuilder<{ n: number }>) => (await query.execute(db)).rows[0]?.n;
    expect(
      await count(sql<{ n: number }>`select count(*)::int as n from work_orders.work_orders where site_survey_expires_at is not null`),
    ).toBe(0);
    const before = await count(sql<{ n: number }>`select count(*)::int as n from work_orders.work_orders`);

    // the trail is append-only: with an event CreateSiteSurvey in it the CHECK of 0065 cannot come back - the wider one stays (a harmless excess)
    await expect(
      sql`
        alter table audit.events
          add constraint events_mutation_fields_0065 check (
            (device_id is null and work_order_id is null and command_type is null and quota_kind is null)
            or (device_id is not null and work_order_id is not null and quota_kind is null
                and coalesce(command_type in ('CreateNote', 'CreateComment', 'CreateQuickWorkOrder', 'CreateMediaAsset'), false))
            or (device_id is not null and work_order_id is null and command_type is null and coalesce(quota_kind in ('customer', 'site'), false))
          )`.execute(db),
    ).rejects.toMatchObject({ code: '23514' });
    await sql`drop index overview.work_order_summaries_site_survey_idx`.execute(db);
    await sql`drop index work_orders.work_orders_site_survey_expiry_idx`.execute(db);
    await sql`drop trigger keep_site_survey_purged_at on work_orders.work_orders`.execute(db);
    await sql`drop function work_orders.keep_site_survey_purged_at()`.execute(db);
    await sql`
      alter table work_orders.work_orders
        drop constraint work_orders_customer_or_site_survey,
        drop constraint work_orders_site_survey_shape,
        drop constraint work_orders_site_survey_fields,
        drop constraint work_orders_site_survey_extensions_range,
        drop constraint work_orders_requester_phone_format`.execute(db);
    await sql`alter table overview.work_order_summaries drop column site_survey_expires_at`.execute(db);
    await sql`
      alter table work_orders.work_orders
        drop column requester_phone, drop column site_survey_purged_at, drop column site_survey_reminded_at,
        drop column site_survey_extensions, drop column site_survey_expires_at`.execute(db);

    expect(await count(sql<{ n: number }>`select count(*)::int as n from work_orders.work_orders`)).toBe(before);
    expect(await count(sql<{ n: number }>`select count(*)::int as n from work_orders.work_orders where customer_id is null`)).toBe(0);
    // the code of N-1 still writes an order after the undo
    await insertWorkOrders(db, [{ number: 'ZL-6600-9004', customerId, siteId }]);
  });
});
