import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { freshDatabaseUrl } from './database.ts';

/**
 * 0028 and 0029 are applied on a database that already holds the data of EVM-053 (the migrations up to 0027 first, then the rows, then
 * the rest): the CHECKs added `NOT VALID` are VALIDATED over the existing rows, and every new rule refuses a row that breaks it.
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0028')) as typeof MIGRATIONS;

let db: Kysely<Database>;
let evm053Order = '';
beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  evm053Order = await insertOrder();
  // the shapes EVM-053 writes: planned with and without an amount, cancelled with and without an amount
  await insertMilestone(evm053Order, 1);
  await insertMilestone(evm053Order, 2, { amountMinor: 360000 });
  await insertMilestone(evm053Order, 3, { status: 'cancelled' });
  await insertMilestone(evm053Order, 4, { status: 'cancelled', amountMinor: 5 });
  await insertEvent('payment_milestone.cancelled', {});
  expect((await migrateToLatest(db, MIGRATIONS)).applied).toEqual([
    '0028_payment_milestone_transitions',
    '0029_audit_status_codes',
    '0030_payment_unpaid_index',
  ]);
});
afterAll(async () => {
  await db.destroy();
});

const T = '2026-10-13T08:00:00Z';
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const fails = async (statement: Promise<unknown>): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code: '23514' });
};

let counter = 0;
async function insertOrder(): Promise<string> {
  counter += 1;
  const customerId = await insertCustomer(db, { email: `jan${counter}@example.invalid` });
  const siteId = await insertSite(db);
  const ids = await insertWorkOrders(db, [{ number: `ZL-${3500 + counter}-0054`, customerId, siteId }]);
  return [...ids.values()][0] ?? '';
}

interface Spec {
  readonly status?: string;
  readonly amountMinor?: number | null;
  readonly invoiceNumber?: string | null;
  readonly invoicedOn?: string | null;
  readonly dueDate?: string | null;
  readonly paidOn?: string | null;
  readonly statusReason?: string | null;
}
const insertMilestone = (workOrderId: string, position: number, spec: Spec = {}) =>
  sql`insert into payments.payment_milestones (work_order_id, name, position, status, amount_minor, currency, invoice_number,
        invoiced_on, due_date, paid_on, created_at, updated_at ${spec.statusReason === undefined ? sql`` : sql`, status_reason`})
      values (${workOrderId}, 'Transza syntetyczna', ${position}, ${spec.status ?? 'planned'}, ${spec.amountMinor ?? null},
        ${spec.amountMinor === undefined || spec.amountMinor === null ? null : 'PLN'}, ${spec.invoiceNumber ?? null},
        ${spec.invoicedOn ?? null}, ${spec.dueDate ?? null}, ${spec.paidOn ?? null}, ${T}, ${T}
        ${spec.statusReason === undefined ? sql`` : sql`, ${spec.statusReason}`})`.execute(db);

const INVOICED: Spec = {
  status: 'invoiced',
  amountMinor: 123000,
  invoiceNumber: 'FV/TEST/0021/2026',
  invoicedOn: '2026-10-03',
  dueDate: '2026-10-10',
};

const insertEvent = (action: string, codes: { from?: string | null; to?: string | null }) =>
  sql`insert into audit.events (occurred_at, actor_type, origin, action, outcome, object_type, object_id, trace_id ${
    codes.from === undefined && codes.to === undefined ? sql`` : sql`, from_code, to_code`
  })
      values (${T}, 'system', 'cli', ${action}, 'success', 'payment_milestone', ${uuidv7()}, ${TRACE} ${
        codes.from === undefined && codes.to === undefined ? sql`` : sql`, ${codes.from ?? null}, ${codes.to ?? null}`
      })`.execute(db);

describe('migration 0028 — the rules of the statuses of a milestone (EVM-054 AC1–AC3, AC7; SR-API-07; expand only)', () => {
  it('EVM-054 AC7 the five checks exist and are VALIDATED over the rows of EVM-053, which stay as they were', async () => {
    const { rows } = await sql<{ conname: string; convalidated: boolean }>`
      select conname, convalidated from pg_constraint
      where conrelid = 'payments.payment_milestones'::regclass and conname in ('payment_milestones_invoice_data',
        'payment_milestones_planned_clean', 'payment_milestones_paid_on', 'payment_milestones_due_date', 'payment_milestones_status_reason')
      order by conname`.execute(db);
    expect(rows.map((row) => [row.conname, row.convalidated])).toEqual([
      ['payment_milestones_due_date', true],
      ['payment_milestones_invoice_data', true],
      ['payment_milestones_paid_on', true],
      ['payment_milestones_planned_clean', true],
      ['payment_milestones_status_reason', true],
    ]);
    const { rows: kept } = await sql<{ status: string; amount_minor: string | null; status_reason: string | null }>`
      select status, amount_minor, status_reason from payments.payment_milestones where work_order_id = ${evm053Order}
      order by position`.execute(db);
    expect(kept).toEqual([
      { status: 'planned', amount_minor: null, status_reason: null },
      { status: 'planned', amount_minor: '360000', status_reason: null },
      { status: 'cancelled', amount_minor: null, status_reason: null },
      { status: 'cancelled', amount_minor: '5', status_reason: null },
    ]);
  });

  it('EVM-054 AC1 an invoiced milestone has its amount, invoice number, day and due date — each missing one is refused', async () => {
    const orderId = await insertOrder();
    await insertMilestone(orderId, 1, INVOICED);
    await fails(insertMilestone(orderId, 2, { ...INVOICED, amountMinor: null }));
    await fails(insertMilestone(orderId, 3, { ...INVOICED, invoiceNumber: null }));
    await fails(insertMilestone(orderId, 4, { ...INVOICED, invoicedOn: null }));
    await fails(insertMilestone(orderId, 5, { ...INVOICED, dueDate: null }));
  });

  it('EVM-054 AC2 a paid milestone has the data of its invoice and its day of payment; no other status has a day of payment', async () => {
    const orderId = await insertOrder();
    await insertMilestone(orderId, 1, { ...INVOICED, status: 'paid', paidOn: '2026-10-05' });
    await fails(insertMilestone(orderId, 2, { ...INVOICED, status: 'paid' }));
    await fails(insertMilestone(orderId, 3, { ...INVOICED, status: 'paid', invoiceNumber: null, paidOn: '2026-10-05' }));
    await fails(insertMilestone(orderId, 4, { ...INVOICED, paidOn: '2026-10-05' }));
    await fails(insertMilestone(orderId, 5, { status: 'cancelled', paidOn: '2026-10-05' }));
  });

  it('EVM-054 AC1 a planned milestone carries no data of an invoice or a payment', async () => {
    const orderId = await insertOrder();
    await fails(insertMilestone(orderId, 1, { invoiceNumber: 'FV/1' }));
    await fails(insertMilestone(orderId, 2, { invoicedOn: '2026-10-03' }));
    await fails(insertMilestone(orderId, 3, { dueDate: '2026-10-10' }));
    await fails(sql`update payments.payment_milestones set invoice_number = 'FV/1' where work_order_id = ${evm053Order}`.execute(db));
  });

  it('EVM-054 Q3b the due date is not before the day of the invoice (the same day is allowed)', async () => {
    const orderId = await insertOrder();
    await insertMilestone(orderId, 1, { ...INVOICED, dueDate: '2026-10-03' });
    await fails(insertMilestone(orderId, 2, { ...INVOICED, dueDate: '2026-10-02' }));
  });

  it('EVM-054 AC3 the reason of a cancellation belongs to a cancelled milestone only and has 1–500 characters', async () => {
    const orderId = await insertOrder();
    await insertMilestone(orderId, 1, { status: 'cancelled', statusReason: 'Rezygnacja klienta' });
    await insertMilestone(orderId, 2, { status: 'cancelled', statusReason: 'x'.repeat(500) });
    await fails(insertMilestone(orderId, 3, { status: 'cancelled', statusReason: 'x'.repeat(501) }));
    await fails(insertMilestone(orderId, 4, { status: 'cancelled', statusReason: '' }));
    await fails(insertMilestone(orderId, 5, { statusReason: 'Rezygnacja klienta' }));
    await fails(insertMilestone(orderId, 6, { ...INVOICED, statusReason: 'Rezygnacja klienta' }));
  });

  it('EVM-054 SR-DATA-03 the application role can write the new column through its UPDATE on the table and still cannot delete', async () => {
    const { rows } = await sql<Record<string, boolean>>`
      select has_column_privilege('evia_app', 'payments.payment_milestones', 'status_reason', 'update') as "update",
             has_table_privilege('evia_app', 'payments.payment_milestones', 'delete') as "delete"`.execute(db);
    expect(rows[0]).toEqual({ update: true, delete: false });
  });
});

describe('migration 0029 — the status codes of the audit trail (EVM-054 AC1, AC3; SR-LOG-03; expand only)', () => {
  it('EVM-054 AC1 an event may carry the codes of the status before and after — both or neither, codes only; the check is VALIDATED over the existing events', async () => {
    await insertEvent('payment_milestone.invoiced', { from: 'planned', to: 'invoiced' });
    await insertEvent('payment_milestone.details_changed', {});
    await fails(insertEvent('payment_milestone.invoiced', { from: 'planned' }));
    await fails(insertEvent('payment_milestone.invoiced', { to: 'invoiced' }));
    await fails(insertEvent('payment_milestone.invoiced', { from: 'Planowana', to: 'invoiced' }));
    await fails(insertEvent('payment_milestone.invoiced', { from: 'planned', to: 'x'.repeat(41) }));
    const { rows } = await sql<{ convalidated: boolean }>`
      select convalidated from pg_constraint where conname = 'events_status_codes' and conrelid = 'audit.events'::regclass`.execute(db);
    expect(rows).toEqual([{ convalidated: true }]);
  });

  it('EVM-054 SR-LOG-03 the trail stays append-only: the owner is stopped by the trigger when it changes a code', async () => {
    await insertEvent('payment_milestone.paid', { from: 'invoiced', to: 'paid' });
    await expect(sql`update audit.events set to_code = 'cancelled' where to_code = 'paid'`.execute(db)).rejects.toMatchObject({
      code: 'EV001',
    });
  });
});
