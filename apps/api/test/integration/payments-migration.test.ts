import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
beforeAll(async () => {
  database = await migratedDatabase({ checkProjection: false });
});
afterAll(async () => {
  await database.close();
});

const admin = () => database.admin;
const T = '2026-10-13T08:00:00Z';
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};

let counter = 0;
async function insertOrder(): Promise<string> {
  counter += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${counter}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-${3200 + counter}-0001`, customerId, siteId }]);
  return [...ids.values()][0] ?? '';
}

interface MilestoneSpec {
  readonly id?: string;
  readonly name?: string;
  readonly status?: string;
  readonly amountMinor?: number | null;
  readonly currency?: string | null;
  readonly deletedAt?: string;
}
const insertMilestone = (workOrderId: string, position: number, spec: MilestoneSpec = {}) =>
  sql`insert into payments.payment_milestones (id, work_order_id, name, position, status, amount_minor, currency, created_at, updated_at, deleted_at)
      values (${spec.id ?? uuidv7()}, ${workOrderId}, ${spec.name ?? 'Transza syntetyczna'}, ${position}, ${spec.status ?? 'planned'},
        ${spec.amountMinor ?? null}, ${spec.currency ?? null}, ${T}, ${T}, ${spec.deletedAt ?? null})`.execute(admin());

const insertEvent = (action: string, amounts: { before?: number | null; after?: number | null; currency?: string | null }) =>
  sql`insert into audit.events (occurred_at, actor_type, origin, action, outcome, object_type, trace_id,
        amount_before_minor, amount_after_minor, currency)
      values (${T}, 'system', 'cli', ${action}, 'success', 'payment_milestone', ${TRACE},
        ${amounts.before ?? null}, ${amounts.after ?? null}, ${amounts.currency ?? null})`.execute(admin());

describe('migration 0026 — payment milestones (EVM-053 AC1, AC3, AC4; ADR-0003; D5; expand only)', () => {
  it('EVM-053 AC1 a milestone starts as planned at version 1, the status is one of the four values and the identifier is a UUIDv7', async () => {
    const orderId = await insertOrder();
    await insertMilestone(orderId, 1);
    const { rows } = await sql<{ status: string; version: number }>`
      select status, version from payments.payment_milestones where work_order_id = ${orderId}`.execute(admin());
    expect(rows).toEqual([{ status: 'planned', version: 1 }]);
    await fails(insertMilestone(orderId, 2, { status: 'overdue' }), '23514');
    await fails(insertMilestone(orderId, 3, { id: '00000000-0000-4000-8000-000000000001' }), '23514');
  });

  it('EVM-053 AC3 D5 the amount is a positive bigint of grosze with the currency PLN — both or neither; empty only in planned or cancelled', async () => {
    const orderId = await insertOrder();
    await insertMilestone(orderId, 1, { amountMinor: 360000, currency: 'PLN' });
    await insertMilestone(orderId, 2, { amountMinor: 99_999_999_999, currency: 'PLN' });
    await insertMilestone(orderId, 3, { status: 'cancelled' });
    await insertMilestone(orderId, 4, { status: 'paid', amountMinor: 1, currency: 'PLN' });
    await fails(insertMilestone(orderId, 5, { amountMinor: 0, currency: 'PLN' }), '23514');
    await fails(insertMilestone(orderId, 6, { amountMinor: -100, currency: 'PLN' }), '23514');
    await fails(insertMilestone(orderId, 7, { amountMinor: 100_000_000_000, currency: 'PLN' }), '23514');
    await fails(insertMilestone(orderId, 8, { amountMinor: 100, currency: 'EUR' }), '23514');
    await fails(insertMilestone(orderId, 9, { amountMinor: 100 }), '23514');
    await fails(insertMilestone(orderId, 10, { currency: 'PLN' }), '23514');
    await fails(insertMilestone(orderId, 11, { status: 'invoiced' }), '23514');
    const { rows } = await sql<{ type: string }>`
      select data_type as type from information_schema.columns
      where table_schema = 'payments' and table_name = 'payment_milestones' and column_name = 'amount_minor'`.execute(admin());
    expect(rows[0]?.type).toBe('bigint');
  });

  it('EVM-053 AC4 an order has at most one ACTIVE milestone per position 1..20 (soft delete frees it); the name is 1–200 characters like the template', async () => {
    const orderId = await insertOrder();
    await insertMilestone(orderId, 1);
    await fails(insertMilestone(orderId, 1), '23505');
    await fails(insertMilestone(orderId, 21), '23514');
    await fails(insertMilestone(orderId, 0), '23514');
    await sql`update payments.payment_milestones set deleted_at = ${T} where work_order_id = ${orderId}`.execute(admin());
    await insertMilestone(orderId, 1, { name: 'x'.repeat(200) });
    await fails(insertMilestone(orderId, 2, { name: 'x'.repeat(201) }), '23514');
    await fails(insertMilestone(orderId, 3, { name: '' }), '23514');
  });

  it('EVM-053 SR-AUTHZ-02 the order and the template milestone are keys ON DELETE RESTRICT — no cascade', async () => {
    const orderId = await insertOrder();
    await fails(insertMilestone(uuidv7(), 1), '23503');
    await insertMilestone(orderId, 1);
    await fails(sql`delete from work_orders.work_orders where id = ${orderId}`.execute(admin()), '23001');
    const { rows } = await sql<{ on_delete: string }>`
      select confdeltype as on_delete from pg_constraint where contype = 'f' and connamespace = 'payments'::regnamespace`.execute(admin());
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.on_delete === 'r')).toBe(true);
  });

  it('EVM-053 SR-DATA-03 the application role has SELECT, INSERT and UPDATE and no DELETE or TRUNCATE; the schema is not open to PUBLIC', async () => {
    const { rows } = await sql<Record<string, boolean>>`
      select has_table_privilege('evia_it_app', 'payments.payment_milestones', 'select') as "select",
             has_table_privilege('evia_it_app', 'payments.payment_milestones', 'insert') as "insert",
             has_table_privilege('evia_it_app', 'payments.payment_milestones', 'update') as "update",
             has_table_privilege('evia_it_app', 'payments.payment_milestones', 'delete') as "delete",
             has_table_privilege('evia_it_app', 'payments.payment_milestones', 'truncate') as "truncate"`.execute(admin());
    expect(rows[0]).toEqual({ select: true, insert: true, update: true, delete: false, truncate: false });
    const { rows: open } = await sql<{ n: string }>`
      select count(*)::text as n from information_schema.table_privileges
      where table_schema = 'payments' and grantee = 'PUBLIC'`.execute(admin());
    expect(open[0]?.n).toBe('0');
  });
});

describe('migration 0027 — the amounts of the audit trail for payments (EVM-053 AC3, AC6; SR-LOG-03; expand only)', () => {
  it('EVM-053 AC3 an event of a payment milestone may carry the amount before and after in PLN; a positive amount only', async () => {
    await insertEvent('payment_milestone.amount_changed', { before: 300000, after: 360000, currency: 'PLN' });
    await insertEvent('payment_milestone.created', { after: 360000, currency: 'PLN' });
    await insertEvent('payment_milestone.cancelled', {});
    await fails(insertEvent('payment_milestone.amount_changed', { before: 0, after: 1, currency: 'PLN' }), '23514');
    await fails(insertEvent('payment_milestone.amount_changed', { after: -1, currency: 'PLN' }), '23514');
    await fails(insertEvent('payment_milestone.amount_changed', { after: 1, currency: 'EUR' }), '23514');
    await fails(insertEvent('payment_milestone.amount_changed', { after: 1 }), '23514');
    await fails(insertEvent('payment_milestone.amount_changed', { currency: 'PLN' }), '23514');
  });

  it('EVM-053 SR-LOG-03 no other action can carry an amount (defence in depth)', async () => {
    await fails(insertEvent('work_order.cancelled', { after: 100, currency: 'PLN' }), '23514');
    await fails(insertEvent('paymentXmilestone.created', { after: 100, currency: 'PLN' }), '23514');
    await insertEvent('work_order.cancelled', {});
  });

  it('EVM-053 SR-LOG-03 the trail stays append-only: the role of the application has INSERT and SELECT only, the owner is stopped by the trigger', async () => {
    const { rows } = await sql<Record<string, boolean>>`
      select has_table_privilege('evia_it_app', 'audit.events', 'select') as "select",
             has_table_privilege('evia_it_app', 'audit.events', 'insert') as "insert",
             has_table_privilege('evia_it_app', 'audit.events', 'update') as "update",
             has_table_privilege('evia_it_app', 'audit.events', 'delete') as "delete"`.execute(admin());
    expect(rows[0]).toEqual({ select: true, insert: true, update: false, delete: false });
    await insertEvent('payment_milestone.created', { after: 100, currency: 'PLN' });
    await fails(sql`update audit.events set amount_after_minor = 200 where amount_after_minor = 100`.execute(admin()), 'EV001');
  });
});
