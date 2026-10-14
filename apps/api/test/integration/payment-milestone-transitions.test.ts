import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createPasskey, createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones, type MilestoneSpec } from '../support/payment-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

/** "Today" of the stories of AC1 and AC2: 2026-10-03 in Europe/Warsaw. */
const TODAY = new Date('2026-10-03T10:00:00.000Z');
const BASE = '/api/v1/work-orders';
const INVOICE = 'FV/TEST/0021/2026';
/** A synthetic reason that would betray the free text wherever it leaked to. */
const REASON = 'powod-anulowania-znacznik-synt';

let current: IdentityApp;
let tick = 0;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  tick += 1;
  // the same business day, a new minute for every test: the per-address limit never adds up
  current.clock.set(new Date(TODAY.getTime() + tick * 61_000));
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;

async function signIn(role: Role = 'editor', options: { channel?: 'web' | 'mobile'; freshKey?: boolean } = {}) {
  const user = await createUser(admin(), current.clock, { role });
  if (options.freshKey === true) await createPasskey(admin(), current.clock, user);
  const session = await createSession(admin(), current.clock, user, {
    channel: options.channel ?? 'web',
    ...(options.freshKey === true ? { passkeyAuthenticatedAt: current.clock.now() } : {}),
  });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order(milestones: MilestoneSpec[], status: WorkOrderStatus = 'in_progress') {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-3${String(numbering).padStart(3, '0')}-0054`,
      customerId,
      siteId,
      status,
      ...(status === 'settled' || status === 'cancelled' ? { closedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  return { id, milestoneIds: await insertMilestones(admin(), id, milestones) };
}

const pln = (amountMinor: number) => ({ amountMinor, currency: 'PLN' });
interface Options {
  readonly ifMatch?: string | null;
  readonly key?: string;
}
const headers = (options: Options) => ({
  ...(options.ifMatch === null ? {} : { 'If-Match': options.ifMatch ?? '"1"' }),
  ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
});
const go = (browser: Browser, orderId: string, milestoneId: string, body: unknown, options: Options = {}) =>
  browser.panel.post(`${BASE}/${orderId}/payment-milestones/${milestoneId}/transitions`, body, headers(options));
const patch = (browser: Browser, orderId: string, milestoneId: string, body: unknown, options: Options = {}) =>
  browser.panel.patch(`${BASE}/${orderId}/payment-milestones/${milestoneId}`, body, headers(options));
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;

interface Row {
  status: string;
  amount_minor: string | null;
  invoice_number: string | null;
  invoiced_on: string | null;
  due_date: string | null;
  paid_on: string | null;
  status_reason: string | null;
  version: number;
}
const rowOf = async (milestoneId: string): Promise<Row | undefined> =>
  (
    await sql<Row>`
      select status, amount_minor, invoice_number, to_char(invoiced_on, 'YYYY-MM-DD') as invoiced_on,
             to_char(due_date, 'YYYY-MM-DD') as due_date, to_char(paid_on, 'YYYY-MM-DD') as paid_on, status_reason, version
      from payments.payment_milestones where id = ${milestoneId}`.execute(admin())
  ).rows[0];
interface AuditRow {
  action: string;
  amount_before_minor: string | null;
  amount_after_minor: string | null;
  currency: string | null;
  from_code: string | null;
  to_code: string | null;
}
const auditOf = async (milestoneId: string): Promise<AuditRow[]> =>
  (
    await sql<AuditRow>`
      select action, amount_before_minor, amount_after_minor, currency, from_code, to_code from audit.events
      where object_id = ${milestoneId} order by occurred_at, id`.execute(admin())
  ).rows;
const journalOf = async (orderId: string) =>
  (
    await sql<{ event_code: string; event_payload: unknown }>`
      select event_code, event_payload from timeline.timeline_entries
      where work_order_id = ${orderId} and kind = 'event' order by created_at, id`.execute(admin())
  ).rows;

describe('"Wystaw fakturę…" — planned → invoiced (EVM-054 AC1; SR-LOG-03, Q3a, Q3b, Q3c)', () => {
  it('EVM-054 AC1 1 230,00 zł, FV/TEST/0021/2026 of 2026-10-03 with a plan of 7 days: "Wystawiona" due 2026-10-10, the audit event has the amount and the status codes, the journal the codes only', async () => {
    const editor = await signIn();
    const created = await order([{ name: 'Zaliczka', paymentTermDays: 7 }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const response = await go(
      editor,
      created.id,
      milestoneId,
      { to: 'invoiced', amount: pln(123000), invoiceNumber: INVOICE, invoicedOn: '2026-10-03' },
      { key: uuidv7() },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.body).toMatchObject({
      id: milestoneId,
      status: 'invoiced',
      amount: pln(123000),
      invoiceNumber: INVOICE,
      invoicedOn: '2026-10-03',
      dueDate: '2026-10-10',
      paidOn: null,
      isOverdue: false,
      version: 2,
      allowedTransitions: ['paid'],
    });
    expect(await auditOf(milestoneId)).toEqual([
      {
        action: 'payment_milestone.invoiced',
        amount_before_minor: null,
        amount_after_minor: '123000',
        currency: 'PLN',
        from_code: 'planned',
        to_code: 'invoiced',
      },
    ]);
    expect(await journalOf(created.id)).toEqual([
      {
        event_code: 'payment_milestone_status_changed',
        event_payload: { objectType: 'payment_milestone', objectId: milestoneId, fromStatus: 'planned', toStatus: 'invoiced' },
      },
    ]);
    const { rows } = await sql`select * from audit.events where object_id = ${milestoneId}`.execute(admin());
    expect(JSON.stringify(rows)).not.toMatch(/FV\/TEST|Zaliczka/);
  });

  it('EVM-054 AC1 the due date of the dialog wins over the default; the amount entered before is used when none is sent; the day of the invoice may be in the future (Q3a)', async () => {
    const editor = await signIn();
    const created = await order([
      { paymentTermDays: 7, amountMinor: 500000 },
      { paymentTermDays: 14, amountMinor: 1 },
    ]);
    const [first, second] = created.milestoneIds;
    const edited = await go(editor, created.id, first ?? '', { to: 'invoiced', invoiceNumber: 'FV/1', dueDate: '2026-10-31' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(await rowOf(first ?? '')).toMatchObject({ amount_minor: '500000', invoiced_on: '2026-10-03', due_date: '2026-10-31' });
    const future = await go(editor, created.id, second ?? '', { to: 'invoiced', invoiceNumber: 'FV/2', invoicedOn: '2027-01-15' });
    expect(future.status).toBe(200);
    expect(await rowOf(second ?? '')).toMatchObject({ invoiced_on: '2027-01-15', due_date: '2027-01-29' });
  });

  it('EVM-054 AC1 Q3a Q3b Q3c no amount, no number, a milestone added by hand without a due date, a due date before the day, a day before 2000 — 400 with pointers and codes, never values; nothing is written', async () => {
    const editor = await signIn();
    const created = await order([{}]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const missing = await go(editor, created.id, milestoneId, { to: 'invoiced', invoiceNumber: ' ' });
    expect(missing.status).toBe(400);
    expect(errorsOf(missing.body)).toEqual([
      { pointer: '/amount', code: 'required' },
      { pointer: '/invoiceNumber', code: 'required' },
      { pointer: '/dueDate', code: 'required' },
    ]);
    const base = { to: 'invoiced', amount: pln(1), invoiceNumber: INVOICE };
    const before = await go(editor, created.id, milestoneId, { ...base, invoicedOn: '2026-10-03', dueDate: '2026-10-02' });
    expect(errorsOf(before.body)).toEqual([{ pointer: '/dueDate', code: 'before_invoiced_on' }]);
    const old = await go(editor, created.id, milestoneId, { ...base, invoicedOn: '1999-12-31', dueDate: '2026-10-02' });
    expect(errorsOf(old.body)).toContainEqual({ pointer: '/invoicedOn', code: 'out_of_range' });
    const hidden = await go(editor, created.id, milestoneId, { ...base, invoiceNumber: 'FV‮/1', dueDate: '2026-10-10' });
    expect(errorsOf(hidden.body)).toEqual([{ pointer: '/invoiceNumber', code: 'invalid_characters' }]);
    expect(JSON.stringify([missing.body, before.body, old.body, hidden.body])).not.toContain('FV');
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'planned', version: 1, invoice_number: null });
    expect(await auditOf(milestoneId)).toEqual([]);
  });
});

describe('"Odnotuj wpłatę…" — invoiced → paid (EVM-054 AC2; Q3e)', () => {
  it('EVM-054 AC2 the payment of today (the default) makes the milestone "Opłacona"; the audit event has the amount and the codes', async () => {
    const editor = await signIn();
    const created = await order([{ status: 'invoiced', amountMinor: 123000, invoiceNumber: INVOICE }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const response = await go(editor, created.id, milestoneId, { to: 'paid' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'paid', paidOn: '2026-10-03', invoiceNumber: INVOICE, allowedTransitions: [] });
    expect(await auditOf(milestoneId)).toEqual([
      {
        action: 'payment_milestone.paid',
        amount_before_minor: '123000',
        amount_after_minor: '123000',
        currency: 'PLN',
        from_code: 'invoiced',
        to_code: 'paid',
      },
    ]);
  });

  it('EVM-054 AC2 a payment of 2026-10-04 when today is 2026-10-03 is 422 transition_condition_not_met (/paidOn, in_future); nothing changes', async () => {
    const editor = await signIn();
    const created = await order([{ status: 'invoiced' }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const response = await go(editor, created.id, milestoneId, { to: 'paid', paidOn: '2026-10-04' });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'transition_condition_not_met', errors: [{ pointer: '/paidOn', code: 'in_future' }] });
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'invoiced', paid_on: null, version: 1 });
    expect(await auditOf(milestoneId)).toEqual([]);
    expect(await journalOf(created.id)).toEqual([]);
  });
});

describe('"Anuluj transzę…" — planned → cancelled (EVM-054 AC3; SR-LOG-03, SR-DATA-01)', () => {
  it('EVM-054 AC3 the milestone is "Anulowana" with the reason in its column only — not in the answer, the audit trail, the journal or the idempotency record', async () => {
    const editor = await signIn();
    const created = await order([{ amountMinor: 70000 }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const response = await go(editor, created.id, milestoneId, { to: 'cancelled', reason: ` ${REASON} ` }, { key: uuidv7() });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'cancelled', allowedTransitions: [] });
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'cancelled', status_reason: REASON, version: 2 });
    expect(await auditOf(milestoneId)).toEqual([
      {
        action: 'payment_milestone.cancelled',
        amount_before_minor: '70000',
        amount_after_minor: '70000',
        currency: 'PLN',
        from_code: 'planned',
        to_code: 'cancelled',
      },
    ]);
    const leaks = [
      response.body,
      (await sql`select * from audit.events where object_id = ${milestoneId}`.execute(admin())).rows,
      await journalOf(created.id),
      (await sql`select * from platform.idempotency_records where user_id = ${editor.userId}`.execute(admin())).rows,
    ];
    expect(JSON.stringify(leaks)).not.toContain(REASON);
    expect((await journalOf(created.id)).map((entry) => entry.event_payload)).toEqual([
      { objectType: 'payment_milestone', objectId: milestoneId, fromStatus: 'planned', toStatus: 'cancelled' },
    ]);
  });

  it('EVM-054 AC3 without a reason it is 400 required, over 500 characters too_long; a field of another move is not_allowed', async () => {
    const editor = await signIn();
    const created = await order([{}]);
    const milestoneId = created.milestoneIds[0] ?? '';
    expect(errorsOf((await go(editor, created.id, milestoneId, { to: 'cancelled' })).body)).toEqual([
      { pointer: '/reason', code: 'required' },
    ]);
    expect(errorsOf((await go(editor, created.id, milestoneId, { to: 'cancelled', reason: 'x'.repeat(501) })).body)).toEqual([
      { pointer: '/reason', code: 'too_long' },
    ]);
    expect(errorsOf((await go(editor, created.id, milestoneId, { to: 'cancelled', reason: REASON, paidOn: '2026-10-01' })).body)).toEqual([
      { pointer: '/paidOn', code: 'not_allowed' },
    ]);
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'planned', status_reason: null, version: 1 });
  });
});

describe('"Popraw dane faktury…" and "Popraw datę wpłaty…" — the PATCH (EVM-054 AC4; Q3a, Q3b, Q3d, Q3e; SR-API-07)', () => {
  const invoicedSpec: MilestoneSpec = { status: 'invoiced', amountMinor: 123000, invoiceNumber: INVOICE, dueDate: '2026-10-10' };

  it('EVM-054 AC4 the number, the day and the due date of an invoiced milestone change with If-Match — the amount and the status stay; the audit event has no value', async () => {
    const editor = await signIn();
    const created = await order([invoicedSpec]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const response = await patch(editor, created.id, milestoneId, {
      invoiceNumber: 'FV/TEST/0022/2026',
      invoicedOn: '2026-10-02',
      dueDate: '2026-10-16',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(await rowOf(milestoneId)).toMatchObject({
      status: 'invoiced',
      amount_minor: '123000',
      invoice_number: 'FV/TEST/0022/2026',
      invoiced_on: '2026-10-02',
      due_date: '2026-10-16',
      version: 2,
    });
    expect(await auditOf(milestoneId)).toEqual([
      {
        action: 'payment_milestone.details_changed',
        amount_before_minor: null,
        amount_after_minor: null,
        currency: null,
        from_code: null,
        to_code: null,
      },
    ]);
    expect(await journalOf(created.id)).toEqual([]);
  });

  it('EVM-054 AC4 the day of the payment of a paid milestone changes; a day after today is 400 in_future (Q3e)', async () => {
    const editor = await signIn();
    const created = await order([{ ...invoicedSpec, status: 'paid' }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    expect((await patch(editor, created.id, milestoneId, { paidOn: '2026-10-02' })).status).toBe(200);
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'paid', paid_on: '2026-10-02', version: 2 });
    const future = await patch(editor, created.id, milestoneId, { paidOn: '2026-10-04' }, { ifMatch: '"2"' });
    expect(future.status).toBe(400);
    expect(errorsOf(future.body)).toEqual([{ pointer: '/paidOn', code: 'in_future' }]);
  });

  it('EVM-054 AC4 Q3d a field outside the status is 409 invalid_state_transition: the invoice of a planned or paid milestone, the payment of an invoiced one', async () => {
    const editor = await signIn();
    const created = await order([{}, invoicedSpec, { ...invoicedSpec, status: 'paid' }, { status: 'cancelled' }]);
    const [planned, invoiced, paid, cancelled] = created.milestoneIds;
    for (const [id, body] of [
      [planned, { invoiceNumber: 'FV/9' }],
      [planned, { amount: pln(1), dueDate: '2026-10-20' }],
      [invoiced, { paidOn: '2026-10-01' }],
      [paid, { dueDate: '2026-10-20' }],
      [cancelled, { paidOn: '2026-10-01' }],
    ] as const) {
      const response = await patch(editor, created.id, id ?? '', body);
      expect(response.status, JSON.stringify(body)).toBe(409);
      expect(codeOf(response.body)).toBe('invalid_state_transition');
    }
    expect(await auditOf(invoiced ?? '')).toEqual([]);
  });

  it('EVM-054 AC4 AC5 the amount of an invoiced or paid milestone is 403 forbidden — also together with other fields, also with a stale version', async () => {
    const created = await order([invoicedSpec, { ...invoicedSpec, status: 'paid' }]);
    for (const role of ['editor', 'administrator'] as const) {
      const browser = await signIn(role);
      for (const id of created.milestoneIds) {
        for (const options of [{}, { ifMatch: '"7"' }]) {
          const response = await patch(browser, created.id, id, { amount: pln(1), invoiceNumber: 'FV/9' }, options);
          expect(response.status, `${role} ${JSON.stringify(options)}`).toBe(403);
          expect(codeOf(response.body)).toBe('forbidden');
        }
      }
    }
    expect(await rowOf(created.milestoneIds[0] ?? '')).toMatchObject({ amount_minor: '123000', invoice_number: INVOICE, version: 1 });
  });

  it('EVM-054 AC4 Q3b the due date is checked on the merged state — /invoicedOn when only the day changes, else /dueDate; Q3a a day out of 2000–2100 is 400', async () => {
    const editor = await signIn();
    const created = await order([invoicedSpec]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const day = await patch(editor, created.id, milestoneId, { invoicedOn: '2026-10-11' });
    expect(errorsOf(day.body)).toEqual([{ pointer: '/invoicedOn', code: 'before_invoiced_on' }]);
    const due = await patch(editor, created.id, milestoneId, { dueDate: '2026-09-30' });
    expect(errorsOf(due.body)).toEqual([{ pointer: '/dueDate', code: 'before_invoiced_on' }]);
    const range = await patch(editor, created.id, milestoneId, { invoicedOn: '2101-01-01' });
    expect(errorsOf(range.body)).toEqual([{ pointer: '/invoicedOn', code: 'out_of_range' }]);
    const future = await patch(editor, created.id, milestoneId, { invoicedOn: '2026-10-05' });
    expect(future.status, 'a future day of the invoice is allowed (Q3a)').toBe(200);
    expect(await rowOf(milestoneId)).toMatchObject({ invoiced_on: '2026-10-05', due_date: '2026-10-10' });
  });

  it('EVM-054 AC4 AC7 without If-Match it is 428, with a stale one 412; the same values again are a change without effect (200, no version, no event); an empty body is 400', async () => {
    const editor = await signIn();
    const created = await order([invoicedSpec]);
    const milestoneId = created.milestoneIds[0] ?? '';
    expect((await patch(editor, created.id, milestoneId, { invoiceNumber: 'FV/9' }, { ifMatch: null })).status).toBe(428);
    expect((await patch(editor, created.id, milestoneId, { invoiceNumber: 'FV/9' }, { ifMatch: '"3"' })).status).toBe(412);
    const same = await patch(editor, created.id, milestoneId, { invoiceNumber: ` ${INVOICE}`, dueDate: '2026-10-10' });
    expect(same.status).toBe(200);
    expect(same.headers['etag']).toBe('"1"');
    const empty = await patch(editor, created.id, milestoneId, {});
    expect(empty.status).toBe(400);
    expect(errorsOf(empty.body)).toEqual([{ pointer: '', code: 'required' }]);
    expect(await auditOf(milestoneId)).toEqual([]);
  });
});

describe('the corrections without the Administrator with a step-up (EVM-054 AC5; EVM-057 AC5, AC6; P2; SR-AUTHZ-10, SR-SESS-08)', () => {
  it('EVM-057 AC6 withdraw and cancel an invoice, undo a payment, restore a milestone: 403 forbidden for the Editor, 403 step_up_required for the Administrator without a step-up — before the version; nothing changes, no audit, no journal', async () => {
    const created = await order([{ status: 'invoiced' }, { status: 'invoiced' }, { status: 'paid' }, { status: 'cancelled' }]);
    const [invoicedA, invoicedB, paid, cancelled] = created.milestoneIds;
    const moves = [
      [invoicedA, 'planned'],
      [invoicedB, 'cancelled'],
      [paid, 'invoiced'],
      [cancelled, 'planned'],
    ] as const;
    for (const [role, code] of [
      ['editor', 'forbidden'],
      ['administrator', 'step_up_required'],
    ] as const) {
      const browser = await signIn(role);
      for (const [id, to] of moves) {
        for (const options of [{}, { ifMatch: '"9"' }]) {
          const response = await go(browser, created.id, id ?? '', { to }, options);
          expect(response.status, `${role} ${to} ${JSON.stringify(options)}`).toBe(403);
          expect(codeOf(response.body)).toBe(code);
        }
      }
    }
    const { rows } = await sql<{ status: string; version: number }>`
      select status, version from payments.payment_milestones where work_order_id = ${created.id} order by position`.execute(admin());
    expect(rows).toEqual([
      { status: 'invoiced', version: 1 },
      { status: 'invoiced', version: 1 },
      { status: 'paid', version: 1 },
      { status: 'cancelled', version: 1 },
    ]);
    for (const id of created.milestoneIds) expect(await auditOf(id)).toEqual([]);
    expect(await journalOf(created.id)).toEqual([]);
  });

  it('EVM-054 AC5 Q1 EVM-057 AC6 the deletion of a milestone: Editor and Read-only 403 forbidden, the Administrator without a step-up 403 step_up_required — the same for a milestone that does not exist; nothing is written', async () => {
    const since = current.clock.now();
    const created = await order([{ status: 'paid' }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const remove = (browser: Browser, id: string) =>
      browser.panel.delete(`${BASE}/${created.id}/payment-milestones/${id}`, { 'If-Match': '"1"', 'Idempotency-Key': uuidv7() });
    const cases = [
      [await signIn('editor'), 'forbidden'],
      [await signIn('read_only'), 'forbidden'],
      [await signIn('administrator'), 'step_up_required'],
    ] as const;
    for (const [browser, code] of cases) {
      for (const id of [milestoneId, uuidv7()]) {
        const response = await remove(browser, id);
        expect(response.status, code).toBe(403);
        expect(codeOf(response.body), code).toBe(code);
      }
    }
    const fresh = await signIn('administrator', { freshKey: true });
    const bad = await fresh.panel.delete(`${BASE}/${created.id}/payment-milestones/x`, { 'If-Match': '"1"' });
    expect(bad.status).toBe(400);
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'paid', version: 1 });
    expect(await auditOf(milestoneId)).toEqual([]);
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from audit.events where object_type = 'payment_milestone' and occurred_at >= ${since}`.execute(admin());
    expect(rows[0]?.n).toBe('0');
  });
});

describe('the rules of the command (EVM-054 AC7; SR-API-07, SR-INPUT-02, CWE-915)', () => {
  it('EVM-054 AC7 a move outside the table is 409 invalid_state_transition — 412 when the version is stale; no If-Match is 428', async () => {
    const editor = await signIn();
    const created = await order([{}, { status: 'paid' }]);
    const [planned, paid] = created.milestoneIds;
    const outside = await go(editor, created.id, planned ?? '', { to: 'paid' });
    expect(outside.status).toBe(409);
    expect(codeOf(outside.body)).toBe('invalid_state_transition');
    expect((await go(editor, created.id, paid ?? '', { to: 'cancelled', reason: REASON })).status).toBe(409);
    expect((await go(editor, created.id, planned ?? '', { to: 'paid' }, { ifMatch: '"4"' })).status).toBe(412);
    const stale = await go(editor, created.id, planned ?? '', { to: 'cancelled', reason: REASON }, { ifMatch: '"4"' });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(JSON.stringify(stale.body)).not.toMatch(/planned|version":/);
    expect((await go(editor, created.id, planned ?? '', { to: 'cancelled', reason: REASON }, { ifMatch: null })).status).toBe(428);
    expect((await go(editor, created.id, planned ?? '', { to: 'cancelled', reason: REASON }, { ifMatch: 'W/"1"' })).status).toBe(400);
    expect(await rowOf(planned ?? '')).toMatchObject({ status: 'planned', version: 1 });
  });

  it('EVM-054 AC7 in an order "Rozliczone" or "Anulowane" every move is 409 work_order_closed — before the table', async () => {
    const editor = await signIn();
    for (const status of ['settled', 'cancelled'] as const) {
      const created = await order([{ status: 'paid' }], status);
      const response = await go(editor, created.id, created.milestoneIds[0] ?? '', { to: 'cancelled', reason: REASON });
      expect(response.status, status).toBe(409);
      expect(codeOf(response.body)).toBe('work_order_closed');
      const listed = await editor.panel.get(`${BASE}/${created.id}/payment-milestones`);
      expect((listed.body as { items: Array<{ allowedTransitions: string[] }> }).items[0]?.allowedTransitions).toEqual([]);
    }
  });

  it('EVM-054 AC7 CWE-915 the status, the version and the reason of the server are read_only_field; a stranger is unknown_field; a target outside the list is 400', async () => {
    const editor = await signIn();
    const created = await order([{}]);
    const milestoneId = created.milestoneIds[0] ?? '';
    for (const field of ['status', 'version', 'name', 'allowedTransitions', 'statusReason']) {
      const response = await go(editor, created.id, milestoneId, { to: 'cancelled', reason: REASON, [field]: 'paid' });
      expect(response.status, field).toBe(400);
      expect(errorsOf(response.body), field).toContainEqual({ pointer: `/${field}`, code: 'read_only_field' });
    }
    expect(errorsOf((await go(editor, created.id, milestoneId, { to: 'cancelled', reason: REASON, x: 1 })).body)).toContainEqual({
      pointer: '/x',
      code: 'unknown_field',
    });
    expect((await go(editor, created.id, milestoneId, { to: 'overdue' })).status).toBe(400);
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'planned', version: 1 });
  });

  it('EVM-054 AC7 SR-API-05 a repeat with the same key and body is 200 with Idempotent-Replayed — one move, one audit event, one journal entry; the same key on another milestone is 422', async () => {
    const editor = await signIn();
    const created = await order([{ status: 'invoiced' }, { status: 'invoiced' }]);
    const [first, second] = created.milestoneIds;
    const key = uuidv7();
    expect((await go(editor, created.id, first ?? '', { to: 'paid' }, { key })).status).toBe(200);
    const again = await go(editor, created.id, first ?? '', { to: 'paid' }, { key });
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toMatchObject({ status: 'paid', version: 2 });
    expect(await auditOf(first ?? '')).toHaveLength(1);
    expect(await journalOf(created.id)).toHaveLength(1);
    const elsewhere = await go(editor, created.id, second ?? '', { to: 'paid' }, { key });
    expect(elsewhere.status).toBe(422);
    expect(codeOf(elsewhere.body)).toBe('idempotency_mismatch');
    expect(await rowOf(second ?? '')).toMatchObject({ status: 'invoiced', version: 1 });
  });

  it('EVM-054 AC5 EVM-057 AC8 the list offers the moves of the role of the caller: A and E — invoice and cancel a planned one, pay an invoiced one; the Administrator also the corrections, with or without a fresh step-up; Read-only — none', async () => {
    const created = await order([{}, { status: 'invoiced' }, { status: 'paid' }, { status: 'cancelled' }]);
    const corrections = [['invoiced', 'cancelled'], ['paid', 'planned', 'cancelled'], ['invoiced'], ['planned']];
    for (const [role, expected, freshKey] of [
      ['editor', [['invoiced', 'cancelled'], ['paid'], [], []], false],
      ['administrator', corrections, false],
      ['administrator', corrections, true],
      ['read_only', [[], [], [], []], false],
    ] as const) {
      const browser = await signIn(role, { freshKey });
      const listed = await browser.panel.get(`${BASE}/${created.id}/payment-milestones`);
      expect(listed.status).toBe(200);
      expect(
        (listed.body as { items: Array<{ allowedTransitions: string[] }> }).items.map((item) => item.allowedTransitions),
        role,
      ).toEqual(expected);
    }
  });
});
