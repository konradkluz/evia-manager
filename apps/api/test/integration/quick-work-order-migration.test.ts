import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let customerId = '';
let siteId = '';
let userId = '';
beforeAll(async () => {
  database = await migratedDatabase({ checkProjection: false });
  userId = (await createUser(database.admin, new FixedClock('2026-10-31T08:00:00.000Z'), { role: 'editor' })).id;
  customerId = await insertCustomer(database.admin, {});
  siteId = await insertSite(database.admin);
});
afterAll(async () => {
  await database.close();
});

const admin = () => database.admin;
const T = '2026-10-31T08:00:00Z';
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};
let sequence = 0;
const insertOrder = (origin: string | null, device: string | null) => {
  sequence += 1;
  return sql`insert into work_orders.work_orders (id, number, title, status, customer_id, site_id, created_at, updated_at, origin, created_via_device_id)
    values (${uuidv7()}, ${`ZL-4800-${String(sequence).padStart(4, '0')}`}, 'Zlecenie', 'new', ${customerId}, ${siteId}, ${T}, ${T}, coalesce(${origin}, 'office'), ${device})`.execute(
    admin(),
  );
};

describe('migration 0058 — the quick work order (EVM-099; expand only)', () => {
  it('EVM-099 AC1 an order that names no origin is an order of the office with no device (the code of version N-1 keeps working), and the old columns are untouched', async () => {
    const [id] = [...(await insertWorkOrders(admin(), [{ number: 'ZL-4801-0001', customerId, siteId }])).values()];
    const { rows } = await sql<{
      origin: string;
      created_via_device_id: string | null;
    }>`select origin, created_via_device_id from work_orders.work_orders where id = ${id ?? ''}`.execute(admin());
    expect(rows[0]).toEqual({ origin: 'office', created_via_device_id: null });
  });

  it('EVM-099 AC1 the origin is office or mobile_quick; an order of the phone has a device and only such an order has one', async () => {
    const device = uuidv7();
    await insertOrder('mobile_quick', device);
    await insertOrder('office', null);
    await fails(insertOrder('mobile_quick', null), '23514');
    await fails(insertOrder('office', device), '23514');
    await fails(insertOrder('web', null), '23514');
  });

  it('EVM-099 AC2 the device is a plain column without a foreign key on the three tables: it survives the removal of the device from the register', async () => {
    const { rows } = await sql<{ table_name: string; constraint_type: string }>`
      select tc.table_name, tc.constraint_type
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage u on u.constraint_name = tc.constraint_name and u.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and u.column_name = 'created_via_device_id'`.execute(admin());
    expect(rows).toEqual([]);
    const { rows: columns } = await sql<{ table_schema: string; is_nullable: string; data_type: string }>`
      select table_schema, is_nullable, data_type from information_schema.columns
      where column_name = 'created_via_device_id' and table_schema in ('customers', 'sites', 'work_orders') order by table_schema`.execute(
      admin(),
    );
    expect(columns).toEqual([
      { table_schema: 'customers', is_nullable: 'YES', data_type: 'uuid' },
      { table_schema: 'sites', is_nullable: 'YES', data_type: 'uuid' },
      { table_schema: 'work_orders', is_nullable: 'YES', data_type: 'uuid' },
    ]);
  });

  it('EVM-099 AC7 the partial indexes (device, created_at) serve the count of the last 24 hours for customers and sites', async () => {
    const { rows } = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef from pg_indexes where indexname in ('customers_created_via_device_idx', 'sites_created_via_device_idx') order by indexname`.execute(
      admin(),
    );
    expect(rows.map((row) => row.indexname)).toEqual(['customers_created_via_device_idx', 'sites_created_via_device_idx']);
    for (const row of rows) {
      expect(row.indexdef).toContain('(created_via_device_id, created_at)');
      expect(row.indexdef).toContain('WHERE (created_via_device_id IS NOT NULL)');
    }
  });

  it('EVM-099 AC7 the trail takes the quick order and the exceeded limit and refuses every other combination of the new fields', async () => {
    const device = uuidv7();
    const insert = (spec: {
      action: string;
      objectType: string;
      deviceId?: string | null;
      workOrderId?: string | null;
      commandType?: string | null;
      quotaKind?: string | null;
    }) =>
      sql`insert into audit.events (occurred_at, actor_type, actor_user_id, origin, action, outcome, object_type, object_id, trace_id, device_id, work_order_id, command_type, quota_kind)
        values (${T}, 'user', ${userId}, 'web', ${spec.action}, 'success', ${spec.objectType}, ${uuidv7()}, ${'a'.repeat(32)}, ${spec.deviceId ?? null}, ${spec.workOrderId ?? null},
          ${spec.commandType ?? null}, ${spec.quotaKind ?? null})`.execute(admin());
    await insert({
      action: 'sync.mutation_applied',
      objectType: 'work_order',
      deviceId: device,
      workOrderId: uuidv7(),
      commandType: 'CreateQuickWorkOrder',
    });
    await insert({ action: 'sync.quota_exceeded', objectType: 'device', deviceId: device, quotaKind: 'site' });
    await fails(insert({ action: 'sync.quota_exceeded', objectType: 'device', deviceId: device, quotaKind: 'party' }), '23514');
    await fails(insert({ action: 'sync.quota_exceeded', objectType: 'device', quotaKind: 'site' }), '23514');
    await fails(
      insert({ action: 'sync.quota_exceeded', objectType: 'device', deviceId: device, workOrderId: uuidv7(), quotaKind: 'site' }),
      '23514',
    );
    await fails(
      insert({
        action: 'sync.mutation_applied',
        objectType: 'work_order',
        deviceId: device,
        workOrderId: uuidv7(),
        commandType: 'DropTable',
      }),
      '23514',
    );
    await fails(
      insert({
        action: 'sync.mutation_applied',
        objectType: 'work_order',
        deviceId: device,
        workOrderId: uuidv7(),
        commandType: 'CreateNote',
        quotaKind: 'site',
      }),
      '23514',
    );
  });

  it('EVM-099 AC7 the marks of the alert are one per device, kind and hour; the code of the alert joins the closed list WITHOUT dropping an earlier one', async () => {
    const device = uuidv7();
    await sql`insert into identity.devices (id, user_id, secret_hash, model, os_version, security_patch, platform, app_version, last_contact_at, created_at)
      values (${device}, ${userId}, decode(${'ab'.repeat(32)}, 'hex'), 'Pixel', '14', '2026-09-05', 'android', '1.2.0', ${T}, ${T})`.execute(
      admin(),
    );
    const mark = (kind: string, hour: string) =>
      sql`insert into sync.quota_alerts (device_id, kind, window_start) values (${device}, ${kind}, ${hour})`.execute(admin());
    await mark('customer', '2026-10-31T08:00:00Z');
    await mark('site', '2026-10-31T08:00:00Z');
    await mark('customer', '2026-10-31T09:00:00Z');
    await fails(mark('customer', '2026-10-31T08:00:00Z'), '23505');
    await fails(mark('party', '2026-10-31T08:00:00Z'), '23514');
    for (const code of [
      'emergency_reset',
      'media_quarantined',
      'sync_full_downloads_excess',
      'sync_snapshot_rate_exceeded',
      'sync_quick_create_quota_exceeded',
    ]) {
      await sql`insert into platform.security_alert_outbox (alert_code, occurred_at, trace_id) values (${code}, ${T}, ${'c'.repeat(32)})`.execute(
        admin(),
      );
    }
    await fails(
      sql`insert into platform.security_alert_outbox (alert_code, occurred_at, trace_id) values ('made_up', ${T}, ${'c'.repeat(32)})`.execute(
        admin(),
      ),
      '23514',
    );
  });
});
