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

/** "Today": 2026-10-14 in Europe/Warsaw — after every day of the fixtures (the due date 2026-10-08 is past). */
const TODAY = new Date('2026-10-14T10:00:00.000Z');
const BASE = '/api/v1/work-orders';
const INVOICE = 'FV/TEST/0007/2026';
const NAME = 'Zaliczka-znacznik-synt';
const MINUTE = 60_000;

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
  // the same business day, a new hour for every test: the per-address limit never adds up and a step-up of a test is not fresh in the next
  current.clock.set(new Date(TODAY.getTime() + tick * 61 * MINUTE));
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;

/** `key`: `fresh` — a passkey just now; a number — that many minutes ago; absent — no passkey in the session at all. */
async function signIn(role: Role, options: { channel?: 'web' | 'mobile'; key?: 'fresh' | number } = {}) {
  const user = await createUser(admin(), current.clock, { role });
  if (options.key !== undefined) await createPasskey(admin(), current.clock, user);
  const minutes = options.key === 'fresh' ? 0 : options.key;
  const session = await createSession(admin(), current.clock, user, {
    channel: options.channel ?? 'web',
    ...(minutes === undefined ? {} : { passkeyAuthenticatedAt: new Date(current.clock.now().getTime() - minutes * MINUTE) }),
  });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, sessionId: session.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;
const administrator = () => signIn('administrator', { key: 'fresh' });

let numbering = 0;
async function order(milestones: MilestoneSpec[], status: WorkOrderStatus = 'in_progress') {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-4${String(numbering).padStart(3, '0')}-0057`,
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
const remove = (browser: Browser, orderId: string, milestoneId: string, options: Options = {}) =>
  browser.panel.delete(`${BASE}/${orderId}/payment-milestones/${milestoneId}`, headers(options));
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;

interface Row {
  status: string;
  position: number;
  amount_minor: string | null;
  invoice_number: string | null;
  invoiced_on: string | null;
  due_date: string | null;
  paid_on: string | null;
  status_reason: string | null;
  version: number;
  deleted: boolean;
}
const rowOf = async (milestoneId: string): Promise<Row | undefined> =>
  (
    await sql<Row>`
      select status, position, amount_minor, invoice_number, to_char(invoiced_on, 'YYYY-MM-DD') as invoiced_on,
             to_char(due_date, 'YYYY-MM-DD') as due_date, to_char(paid_on, 'YYYY-MM-DD') as paid_on, status_reason, version,
             deleted_at is not null as deleted
      from payments.payment_milestones where id = ${milestoneId}`.execute(admin())
  ).rows[0];
interface AuditRow {
  action: string;
  outcome: string;
  actor_user_id: string | null;
  amount_before_minor: string | null;
  amount_after_minor: string | null;
  currency: string | null;
  from_code: string | null;
  to_code: string | null;
}
const auditOf = async (milestoneId: string): Promise<AuditRow[]> =>
  (
    await sql<AuditRow>`
      select action, outcome, actor_user_id, amount_before_minor, amount_after_minor, currency, from_code, to_code from audit.events
      where object_id = ${milestoneId} order by occurred_at, id`.execute(admin())
  ).rows;
/** Every column of the audit trail of the milestone as text: the name, the invoice number and a reason must be nowhere in it. */
const auditText = async (milestoneId: string): Promise<string> =>
  JSON.stringify((await sql`select * from audit.events where object_id = ${milestoneId}`.execute(admin())).rows);
const journalOf = async (orderId: string) =>
  (
    await sql<{ event_code: string; event_payload: unknown }>`
      select event_code, event_payload from timeline.timeline_entries
      where work_order_id = ${orderId} and kind = 'event' order by created_at, id`.execute(admin())
  ).rows;
const invoicedCountOf = async (orderId: string) =>
  (
    await sql<{ invoiced_count: number; paid_count: number }>`
      select invoiced_count, paid_count from overview.work_order_summaries where work_order_id = ${orderId}`.execute(admin())
  ).rows[0];
const listOf = async (browser: Browser, orderId: string) => {
  const response = await browser.panel.get(`${BASE}/${orderId}/payment-milestones`);
  expect(response.status).toBe(200);
  return response.body as {
    items: Array<{ id: string; position: number; status: string; allowedTransitions: string[] }>;
    totals: { unpaid: { amountMinor: number }; paid: { amountMinor: number } };
  };
};

const invoiced: MilestoneSpec = { status: 'invoiced', amountMinor: 360_000, invoiceNumber: INVOICE, name: NAME };

describe('"Wycofaj fakturę…" — invoiced → planned (EVM-057 AC1; SR-LOG-03, SR-SESS-08)', () => {
  it('EVM-057 AC1 the Administrator with a fresh step-up withdraws FV/TEST/0007/2026: "Planowana", the invoice data cleared, the amount kept; the audit has the status codes and the amount, the journal the codes; the read model is recomputed', async () => {
    const browser = await administrator();
    const created = await order([invoiced]);
    const milestoneId = created.milestoneIds[0] ?? '';
    expect(await invoicedCountOf(created.id)).toMatchObject({ invoiced_count: 1 });

    const response = await go(browser, created.id, milestoneId, { to: 'planned' }, { key: uuidv7() });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.body).toMatchObject({
      status: 'planned',
      amount: pln(360_000),
      invoiceNumber: null,
      invoicedOn: null,
      dueDate: null,
      isOverdue: false,
      version: 2,
      allowedTransitions: ['invoiced', 'cancelled'],
    });
    expect(await rowOf(milestoneId)).toMatchObject({
      status: 'planned',
      amount_minor: '360000',
      invoice_number: null,
      invoiced_on: null,
      due_date: null,
      version: 2,
    });
    expect(await auditOf(milestoneId)).toEqual([
      {
        action: 'payment_milestone.invoice_withdrawn',
        outcome: 'success',
        actor_user_id: browser.userId,
        amount_before_minor: '360000',
        amount_after_minor: '360000',
        currency: 'PLN',
        from_code: 'invoiced',
        to_code: 'planned',
      },
    ]);
    expect(await auditText(milestoneId)).not.toMatch(/FV\/TEST|znacznik/);
    expect(await journalOf(created.id)).toEqual([
      {
        event_code: 'payment_milestone_status_changed',
        event_payload: { objectType: 'payment_milestone', objectId: milestoneId, fromStatus: 'invoiced', toStatus: 'planned' },
      },
    ]);
    expect(await invoicedCountOf(created.id)).toMatchObject({ invoiced_count: 0 });
  });
});

describe('"Anuluj fakturę…" and "Cofnij wpłatę…" (EVM-057 AC2)', () => {
  it('EVM-057 AC2 cancelling an invoice: "Anulowana" with the data of the invoice kept and no reason; audited with the codes and the amount', async () => {
    const browser = await administrator();
    const created = await order([invoiced]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const response = await go(browser, created.id, milestoneId, { to: 'cancelled' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'cancelled', invoiceNumber: INVOICE, allowedTransitions: ['planned'] });
    expect(await rowOf(milestoneId)).toMatchObject({
      status: 'cancelled',
      invoice_number: INVOICE,
      invoiced_on: '2026-10-01',
      due_date: '2026-10-08',
      status_reason: null,
      version: 2,
    });
    expect(await auditOf(milestoneId)).toMatchObject([
      { action: 'payment_milestone.invoice_cancelled', amount_before_minor: '360000', from_code: 'invoiced', to_code: 'cancelled' },
    ]);
  });

  it('EVM-057 AC2 undoing a payment: "Wystawiona" with the day of the payment cleared — and at once overdue when the due date has passed; audited', async () => {
    const browser = await administrator();
    const created = await order([{ status: 'paid', amountMinor: 360_000 }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    expect(await invoicedCountOf(created.id)).toMatchObject({ invoiced_count: 0, paid_count: 1 });
    const response = await go(browser, created.id, milestoneId, { to: 'invoiced' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'invoiced', paidOn: null, isOverdue: true });
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'invoiced', paid_on: null, due_date: '2026-10-08' });
    expect(await auditOf(milestoneId)).toMatchObject([
      { action: 'payment_milestone.payment_undone', amount_before_minor: '360000', from_code: 'paid', to_code: 'invoiced' },
    ]);
    expect(await invoicedCountOf(created.id)).toMatchObject({ invoiced_count: 1, paid_count: 0 });
  });

  it('EVM-057 AC2 CWE-915 a correction takes the target alone: a reason, an amount or a field of the invoice is 400 not_allowed — nothing changes', async () => {
    const browser = await administrator();
    const created = await order([invoiced]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const withReason = await go(browser, created.id, milestoneId, { to: 'cancelled', reason: 'powod-znacznik-synt' });
    expect(withReason.status).toBe(400);
    expect(errorsOf(withReason.body)).toEqual([{ pointer: '/reason', code: 'not_allowed' }]);
    expect(JSON.stringify(withReason.body)).not.toContain('znacznik');
    const withFields = await go(browser, created.id, milestoneId, { to: 'planned', amount: pln(1), invoiceNumber: 'FV/1' });
    expect(withFields.status).toBe(400);
    expect(errorsOf(withFields.body)).toEqual([
      { pointer: '/amount', code: 'not_allowed' },
      { pointer: '/invoiceNumber', code: 'not_allowed' },
    ]);
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'invoiced', version: 1 });
    expect(await auditOf(milestoneId)).toEqual([]);
  });
});

describe('"Zmień kwotę…" of an invoiced or paid milestone (EVM-057 AC3; SR-LOG-03)', () => {
  it('EVM-057 AC3 3 600,00 zł → 3 690,00 zł of an invoiced milestone: the amount is changed, the status and the invoice stay, the audit has the amount before and after', async () => {
    const browser = await administrator();
    const created = await order([invoiced, { status: 'paid', amountMinor: 100_000 }]);
    const [first, second] = created.milestoneIds as [string, string];
    const response = await patch(browser, created.id, first, { amount: pln(369_000) }, { key: uuidv7() });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'invoiced', amount: pln(369_000), invoiceNumber: INVOICE, version: 2 });
    expect(await auditOf(first)).toEqual([
      {
        action: 'payment_milestone.amount_corrected',
        outcome: 'success',
        actor_user_id: browser.userId,
        amount_before_minor: '360000',
        amount_after_minor: '369000',
        currency: 'PLN',
        from_code: null,
        to_code: null,
      },
    ]);
    expect(await auditText(first)).not.toMatch(/FV\/TEST|znacznik/);
    const paid = await patch(browser, created.id, second, { amount: pln(120_000) });
    expect(paid.status).toBe(200);
    expect(await auditOf(second)).toMatchObject([
      { action: 'payment_milestone.amount_corrected', amount_before_minor: '100000', amount_after_minor: '120000' },
    ]);
    expect((await listOf(browser, created.id)).totals).toMatchObject({ unpaid: { amountMinor: 369_000 }, paid: { amountMinor: 120_000 } });
    expect(await journalOf(created.id)).toEqual([]);
  });

  it('EVM-057 AC3 the amount together with the invoice of the same status is one correction; the same amount again is 200 without a new version or an event; null is 400', async () => {
    const browser = await administrator();
    const created = await order([invoiced]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const both = await patch(browser, created.id, milestoneId, { amount: pln(369_000), invoiceNumber: 'FV/TEST/0008/2026' });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    expect(await rowOf(milestoneId)).toMatchObject({ amount_minor: '369000', invoice_number: 'FV/TEST/0008/2026', version: 2 });
    const same = await patch(browser, created.id, milestoneId, { amount: pln(369_000) }, { ifMatch: '"2"' });
    expect(same.status).toBe(200);
    expect(same.headers['etag']).toBe('"2"');
    const empty = await patch(browser, created.id, milestoneId, { amount: null }, { ifMatch: '"2"' });
    expect(empty.status).toBe(400);
    expect(codeOf(empty.body)).toBe('validation_failed');
    const trail = await auditOf(milestoneId);
    expect(trail).toHaveLength(2);
    expect(trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'payment_milestone.amount_corrected',
          amount_before_minor: '360000',
          amount_after_minor: '369000',
        }),
        expect.objectContaining({ action: 'payment_milestone.details_changed', amount_before_minor: null, amount_after_minor: null }),
      ]),
    );
    expect(await auditText(milestoneId)).not.toMatch(/FV\/TEST/);
    expect(await journalOf(created.id)).toEqual([]);
  });

  it('EVM-057 AC3 regression: an explicit null of a correction does not change a patch — the number alone keeps the days, the amount and the status', async () => {
    const editor = await signIn('editor');
    const created = await order([invoiced]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const response = await patch(editor, created.id, milestoneId, { invoiceNumber: 'FV/TEST/0009/2026' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await rowOf(milestoneId)).toMatchObject({
      status: 'invoiced',
      amount_minor: '360000',
      invoice_number: 'FV/TEST/0009/2026',
      invoiced_on: '2026-10-01',
      due_date: '2026-10-08',
      paid_on: null,
    });
  });

  it('EVM-057 AC6 security A1 the amount of a cancelled milestone is 403 forbidden for the Administrator with a fresh step-up too; nothing changes', async () => {
    const browser = await administrator();
    const created = await order([{ status: 'cancelled', amountMinor: 100_000 }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const response = await patch(browser, created.id, milestoneId, { amount: pln(200_000) });
    expect(response.status).toBe(403);
    expect(codeOf(response.body)).toBe('forbidden');
    expect(await rowOf(milestoneId)).toMatchObject({ amount_minor: '100000', version: 1 });
    expect(await auditOf(milestoneId)).toEqual([]);
  });
});

describe('"Przywróć transzę…" and "Usuń transzę…" (EVM-057 AC4)', () => {
  it('EVM-057 AC4 restoring a cancelled invoice: "Planowana", the invoice and the reason cleared, the amount kept; audited "restored"', async () => {
    const browser = await administrator();
    const created = await order([invoiced]);
    const milestoneId = created.milestoneIds[0] ?? '';
    expect((await go(browser, created.id, milestoneId, { to: 'cancelled' })).status).toBe(200);
    const response = await go(browser, created.id, milestoneId, { to: 'planned' }, { ifMatch: '"2"' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await rowOf(milestoneId)).toMatchObject({
      status: 'planned',
      amount_minor: '360000',
      invoice_number: null,
      invoiced_on: null,
      due_date: null,
      paid_on: null,
      status_reason: null,
      version: 3,
    });
    expect((await auditOf(milestoneId)).map((row) => [row.action, row.from_code, row.to_code])).toEqual([
      ['payment_milestone.invoice_cancelled', 'invoiced', 'cancelled'],
      ['payment_milestone.restored', 'cancelled', 'planned'],
    ]);
  });

  it('EVM-057 AC4 restoring a milestone cancelled with a reason clears the reason (the CHECK of 0028 holds)', async () => {
    const editor = await signIn('editor');
    const created = await order([{ amountMinor: 50_000 }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    expect((await go(editor, created.id, milestoneId, { to: 'cancelled', reason: 'powod-znacznik-synt' })).status).toBe(200);
    const response = await go(await administrator(), created.id, milestoneId, { to: 'planned' }, { ifMatch: '"2"' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'planned', status_reason: null, amount_minor: '50000' });
  });

  it('EVM-057 AC4 the deletion: 204, soft delete, the audit with the amount, the journal entry without a name; the milestone is gone for the Editor, Read-only and the Administrator — from the list, the totals, the unpaid and the read model; the next ones move up', async () => {
    const browser = await administrator();
    const created = await order([{ name: 'Pierwsza' }, invoiced, { status: 'paid', amountMinor: 100_000 }]);
    const [first, target, last] = created.milestoneIds as [string, string, string];
    const key = uuidv7();
    const response = await remove(browser, created.id, target, { key });
    expect(response.status, JSON.stringify(response.body)).toBe(204);
    expect(response.body).toEqual({});
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(await rowOf(target)).toMatchObject({ deleted: true, version: 2, status: 'invoiced' });
    expect(await rowOf(first)).toMatchObject({ position: 1, version: 1 });
    expect(await rowOf(last)).toMatchObject({ position: 2, version: 1 });
    expect(await auditOf(target)).toEqual([
      {
        action: 'payment_milestone.deleted',
        outcome: 'success',
        actor_user_id: browser.userId,
        amount_before_minor: '360000',
        amount_after_minor: null,
        currency: 'PLN',
        from_code: null,
        to_code: null,
      },
    ]);
    expect(await auditText(target)).not.toMatch(/FV\/TEST|znacznik/);
    expect(await journalOf(created.id)).toEqual([
      { event_code: 'payment_milestone_deleted', event_payload: { objectType: 'payment_milestone', objectId: target } },
    ]);
    for (const role of ['editor', 'read_only', 'administrator'] as const) {
      const viewer = await signIn(role);
      const list = await listOf(viewer, created.id);
      expect(
        list.items.map((item) => [item.id, item.position]),
        role,
      ).toEqual([
        [first, 1],
        [last, 2],
      ]);
      expect(list.totals).toMatchObject({ unpaid: { amountMinor: 0 }, paid: { amountMinor: 100_000 } });
      const unpaid = await viewer.panel.get('/api/v1/payment-milestones');
      expect(unpaid.status).toBe(200);
      expect(JSON.stringify(unpaid.body)).not.toContain(target);
      const timeline = await viewer.panel.get(`${BASE}/${created.id}/timeline?eventGroup=payments`);
      expect(timeline.status).toBe(200);
      expect((timeline.body as { items: Array<{ event: unknown }> }).items.map((item) => item.event)).toEqual([
        {
          code: 'payment_milestone_deleted',
          objectType: 'payment_milestone',
          fromStatus: null,
          toStatus: null,
          waitingOn: null,
          waitingOnParty: null,
          changedFields: [],
          paymentMilestone: { id: target, name: null },
        },
      ]);
    }
    expect(await invoicedCountOf(created.id)).toMatchObject({ invoiced_count: 0, paid_count: 1 });

    const replay = await remove(browser, created.id, target, { key });
    expect(replay.status).toBe(204);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(await auditOf(target)).toHaveLength(1);
    const elsewhere = await remove(browser, created.id, first, { key });
    expect(elsewhere.status).toBe(422);
    expect(codeOf(elsewhere.body)).toBe('idempotency_mismatch');
    expect(await rowOf(first)).toMatchObject({ deleted: false });
  });

  it('EVM-057 AC4 security A3 a deleted milestone cannot be changed, moved or deleted again: 404 for the Administrator with a step-up and the Editor', async () => {
    const browser = await administrator();
    const created = await order([invoiced]);
    const milestoneId = created.milestoneIds[0] ?? '';
    expect((await remove(browser, created.id, milestoneId)).status).toBe(204);
    const editor = await signIn('editor');
    for (const actor of [browser, editor]) {
      for (const response of [
        await go(actor, created.id, milestoneId, { to: 'planned' }, { ifMatch: '"2"' }),
        await go(actor, created.id, milestoneId, { to: 'paid' }, { ifMatch: '"2"' }),
        await patch(actor, created.id, milestoneId, { invoiceNumber: 'FV/1' }, { ifMatch: '"2"' }),
      ]) {
        expect(response.status).toBe(404);
        expect(codeOf(response.body)).toBe('not_found');
      }
    }
    const again = await remove(browser, created.id, milestoneId, { ifMatch: '"2"', key: uuidv7() });
    expect(again.status).toBe(404);
    expect(await rowOf(milestoneId)).toMatchObject({ deleted: true, version: 2, status: 'invoiced' });
  });

  it('EVM-057 AC4 20 milestones, the middle one deleted, a new one added: it takes position 20 — no CHECK error', async () => {
    const browser = await administrator();
    const created = await order(Array.from({ length: 20 }, () => ({})));
    const middle = created.milestoneIds[9] ?? '';
    expect((await remove(browser, created.id, middle)).status).toBe(204);
    const added = await browser.panel.post(
      `${BASE}/${created.id}/payment-milestones`,
      { id: uuidv7(), name: 'Dodatkowa' },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body).toMatchObject({ position: 20 });
    const positions = (await listOf(browser, created.id)).items.map((item) => item.position);
    expect(positions).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it('EVM-057 AC4 the deletion checks its version (412) and needs If-Match (428); a weak tag is 400', async () => {
    const browser = await administrator();
    const created = await order([invoiced]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const stale = await remove(browser, created.id, milestoneId, { ifMatch: '"7"' });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect((await remove(browser, created.id, milestoneId, { ifMatch: null })).status).toBe(428);
    expect((await remove(browser, created.id, milestoneId, { ifMatch: 'W/"1"' })).status).toBe(400);
    expect(await rowOf(milestoneId)).toMatchObject({ deleted: false, version: 1 });
    expect(await auditOf(milestoneId)).toEqual([]);
  });
});

describe('the step-up of a correction (EVM-057 AC5; SR-SESS-08, SR-API-05)', () => {
  it('EVM-057 AC5 the Administrator authenticated with a passkey 20 minutes ago gets 403 step_up_required for every correction, the amount and the deletion; nothing is written', async () => {
    const created = await order([invoiced, invoiced, { status: 'paid' }, { status: 'cancelled' }]);
    const [a, b, paid, cancelled] = created.milestoneIds as [string, string, string, string];
    const browser = await signIn('administrator', { key: 20 });
    for (const response of [
      await go(browser, created.id, a, { to: 'planned' }),
      await go(browser, created.id, b, { to: 'cancelled' }),
      await go(browser, created.id, paid, { to: 'invoiced' }),
      await go(browser, created.id, cancelled, { to: 'planned' }),
      await patch(browser, created.id, a, { amount: pln(369_000) }),
      await patch(browser, created.id, paid, { amount: pln(1) }),
      await remove(browser, created.id, a, { key: uuidv7() }),
    ]) {
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('step_up_required');
      expect(JSON.stringify(response.body)).not.toMatch(/amount|invoice/i);
    }
    for (const id of created.milestoneIds) {
      expect(await rowOf(id)).toMatchObject({ version: 1, deleted: false });
      expect(await auditOf(id)).toEqual([]);
    }
    expect(await journalOf(created.id)).toEqual([]);
  });

  it('EVM-057 AC5 the window is 15 minutes on the injected clock: 14:59 ago passes, 15:00 ago asks for a step-up', async () => {
    const created = await order([invoiced, invoiced]);
    const [a, b] = created.milestoneIds as [string, string];
    const late = await signIn('administrator', { key: 15 });
    const closed = await go(late, created.id, a, { to: 'planned' });
    expect(closed.status).toBe(403);
    expect(codeOf(closed.body)).toBe('step_up_required');
    const user = await createUser(admin(), current.clock, { role: 'administrator' });
    await createPasskey(admin(), current.clock, user);
    const session = await createSession(admin(), current.clock, user, {
      passkeyAuthenticatedAt: new Date(current.clock.now().getTime() - 15 * MINUTE + 1_000),
    });
    const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    panel.cookie = session.cookie;
    panel.csrfToken = session.csrfToken;
    const open = await go({ userId: user.id, sessionId: session.id, panel }, created.id, b, { to: 'planned' });
    expect(open.status, JSON.stringify(open.body)).toBe(200);
  });

  it('EVM-057 AC5 security A4 a 403 step_up_required leaves no idempotency record: after the step-up the retry with the SAME key performs the correction once (no 422, no replayed 403)', async () => {
    const created = await order([invoiced, invoiced]);
    const [a, b] = created.milestoneIds as [string, string];
    const browser = await signIn('administrator', { key: 20 });
    const transitionKey = uuidv7();
    const deletionKey = uuidv7();
    const amountKey = uuidv7();
    expect(codeOf((await go(browser, created.id, a, { to: 'planned' }, { key: transitionKey })).body)).toBe('step_up_required');
    expect(codeOf((await patch(browser, created.id, b, { amount: pln(369_000) }, { key: amountKey })).body)).toBe('step_up_required');
    expect(codeOf((await remove(browser, created.id, b, { key: deletionKey })).body)).toBe('step_up_required');
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from platform.idempotency_records
      where idempotency_key in (${transitionKey}, ${amountKey}, ${deletionKey})`.execute(admin());
    expect(rows[0]?.n).toBe('0');

    // W-04: the passkey of this session again (what POST /auth/step-up writes)
    await sql`update identity.sessions set passkey_authenticated_at = ${current.clock.now()} where id = ${browser.sessionId}`.execute(
      admin(),
    );
    const retried = await go(browser, created.id, a, { to: 'planned' }, { key: transitionKey });
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.headers['idempotent-replayed']).toBeUndefined();
    const amount = await patch(browser, created.id, b, { amount: pln(369_000) }, { key: amountKey });
    expect(amount.status, JSON.stringify(amount.body)).toBe(200);
    const deleted = await remove(browser, created.id, b, { ifMatch: '"2"', key: deletionKey });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
    expect((await auditOf(a)).map((row) => row.action)).toEqual(['payment_milestone.invoice_withdrawn']);
    expect((await auditOf(b)).map((row) => row.action)).toEqual(['payment_milestone.amount_corrected', 'payment_milestone.deleted']);
  });
});

describe('no way around a correction (EVM-057 AC6; SR-AUTHZ-10, SR-AUTHZ-05; security A2, B1)', () => {
  it('EVM-057 AC6 the Editor is 403 forbidden and the Administrator without a step-up 403 step_up_required on every path to the effect of a correction: the moves back, the amount (also with other fields), the deletion', async () => {
    const created = await order([invoiced, invoiced, { status: 'paid' }, { status: 'cancelled' }]);
    const [a, b, paid, cancelled] = created.milestoneIds as [string, string, string, string];
    for (const [browser, code] of [
      [await signIn('editor', { key: 'fresh' }), 'forbidden'],
      [await signIn('administrator'), 'step_up_required'],
    ] as const) {
      for (const response of [
        await go(browser, created.id, a, { to: 'planned' }),
        await go(browser, created.id, b, { to: 'cancelled' }),
        await go(browser, created.id, paid, { to: 'invoiced' }),
        await go(browser, created.id, cancelled, { to: 'planned' }),
        await patch(browser, created.id, a, { amount: pln(369_000) }),
        await patch(browser, created.id, a, { amount: pln(369_000), invoiceNumber: 'FV/2' }),
        await patch(browser, created.id, paid, { amount: pln(1), paidOn: '2026-10-02' }),
        await remove(browser, created.id, a),
      ]) {
        expect(response.status).toBe(403);
        expect(codeOf(response.body)).toBe(code);
      }
    }
    for (const id of created.milestoneIds) {
      expect(await rowOf(id)).toMatchObject({ version: 1, deleted: false });
      expect(await auditOf(id)).toEqual([]);
    }
  });

  it('EVM-057 AC6 sequences of the Editor never lead back: an invoiced milestone is paid or stays, a cancelled one stays cancelled; cancelling the order with an invoice is refused', async () => {
    const editor = await signIn('editor');
    const created = await order([{ amountMinor: 10_000 }, invoiced]);
    const [planned, issued] = created.milestoneIds as [string, string];
    expect((await go(editor, created.id, planned, { to: 'cancelled', reason: 'powod' })).status).toBe(200);
    expect(codeOf((await go(editor, created.id, planned, { to: 'planned' }, { ifMatch: '"2"' })).body)).toBe('forbidden');
    expect((await go(editor, created.id, issued, { to: 'paid' })).status).toBe(200);
    expect(codeOf((await go(editor, created.id, issued, { to: 'invoiced' }, { ifMatch: '"2"' })).body)).toBe('forbidden');
    expect(codeOf((await patch(editor, created.id, issued, { amount: pln(1) }, { ifMatch: '"2"' })).body)).toBe('forbidden');
    const second = await order([invoiced]);
    const cancel = await editor.panel.post(`${BASE}/${second.id}/transitions`, { to: 'cancelled', reason: 'powod' }, { 'If-Match': '"1"' });
    expect(cancel.status).toBe(422);
    expect(await rowOf(second.milestoneIds[0] ?? '')).toMatchObject({ status: 'invoiced', version: 1 });
  });

  it('EVM-057 AC6 security A2 TOCTOU: the Editor changes the amount on the version it saw as planned, but the milestone was invoiced meanwhile — 403 forbidden on the locked row (before 412), the amount unchanged', async () => {
    const editor = await signIn('editor');
    const other = await signIn('editor');
    const created = await order([{ amountMinor: 10_000 }]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const invoiced_ = await go(other, created.id, milestoneId, { to: 'invoiced', invoiceNumber: INVOICE, dueDate: '2026-10-30' });
    expect(invoiced_.status, JSON.stringify(invoiced_.body)).toBe(200);
    const late = await patch(editor, created.id, milestoneId, { amount: pln(20_000) }, { ifMatch: '"1"' });
    expect(late.status).toBe(403);
    expect(codeOf(late.body)).toBe('forbidden');
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'invoiced', amount_minor: '10000', version: 2 });
  });

  it('EVM-057 AC6 EVM-060 AC2 the deletion of a work order is no way round the corrections: with an invoiced milestone it is 409 has_active_dependents even for the Administrator with a fresh step-up, and the milestone is untouched', async () => {
    const browser = await administrator();
    const created = await order([invoiced]);
    const response = await browser.panel.delete(`${BASE}/${created.id}`, { 'If-Match': '"1"' });
    expect([response.status, codeOf(response.body)]).toEqual([409, 'has_active_dependents']);
    expect(await rowOf(created.milestoneIds[0] ?? '')).toMatchObject({ deleted: false, status: 'invoiced', version: 1 });
  });
});

describe('a closed order (EVM-057 AC7; PO-8)', () => {
  it('EVM-057 AC7 in an order "Rozliczone" or "Anulowane" every correction, the amount and the deletion of the Administrator with a step-up are 409 work_order_closed; nothing changes; the list offers nothing', async () => {
    const browser = await administrator();
    for (const status of ['settled', 'cancelled'] as const) {
      const created = await order([{ status: 'paid' }, { status: 'cancelled' }], status);
      const [paid, cancelled] = created.milestoneIds as [string, string];
      for (const response of [
        await go(browser, created.id, paid, { to: 'invoiced' }),
        await go(browser, created.id, cancelled, { to: 'planned' }),
        await patch(browser, created.id, paid, { amount: pln(1) }),
        await remove(browser, created.id, paid, { key: uuidv7() }),
      ]) {
        expect(response.status, status).toBe(409);
        expect(codeOf(response.body)).toBe('work_order_closed');
      }
      for (const id of created.milestoneIds) expect(await rowOf(id)).toMatchObject({ version: 1, deleted: false });
      expect((await listOf(browser, created.id)).items.map((item) => item.allowedTransitions)).toEqual([[], []]);
    }
  });
});

describe('the roles, the channel and IDOR (EVM-057 AC8; SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-12, CWE-639)', () => {
  it('EVM-057 AC8 IDOR: the Administrator with a fresh step-up gets the same 404 for the milestone of order B in the path of A, a deleted one and one that does not exist — for every correction, the amount and the deletion; B is unchanged', async () => {
    const browser = await administrator();
    const orderA = await order([invoiced, { ...invoiced, deletedAt: new Date('2026-10-02T08:00:00Z') }]);
    const orderB = await order([invoiced]);
    const foreign = orderB.milestoneIds[0] ?? '';
    const bodies = new Set<string>();
    for (const milestoneId of [foreign, orderA.milestoneIds[1] ?? '', uuidv7()]) {
      for (const response of [
        await go(browser, orderA.id, milestoneId, { to: 'planned' }),
        await patch(browser, orderA.id, milestoneId, { amount: pln(1) }),
        await remove(browser, orderA.id, milestoneId, { key: uuidv7() }),
      ]) {
        expect(response.status).toBe(404);
        bodies.add(JSON.stringify({ ...(response.body as object), traceId: null }));
      }
    }
    expect(bodies.size).toBe(1);
    expect(await rowOf(foreign)).toMatchObject({ status: 'invoiced', version: 1, deleted: false, amount_minor: '360000' });
    expect(await auditOf(foreign)).toEqual([]);
  });

  it('EVM-057 AC8 Read-only is 403 forbidden, a mobile token of the Administrator with a fresh key is 403 and an anonymous caller 401 — for the corrections and the deletion', async () => {
    const created = await order([invoiced]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const reader = await signIn('read_only');
    const phone = await signIn('administrator', { channel: 'mobile', key: 'fresh' });
    for (const browser of [reader, phone]) {
      for (const response of [
        await go(browser, created.id, milestoneId, { to: 'planned' }),
        await patch(browser, created.id, milestoneId, { amount: pln(1) }),
        await remove(browser, created.id, milestoneId),
      ]) {
        expect(response.status).toBe(403);
      }
    }
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await anonymous.delete(`${BASE}/${created.id}/payment-milestones/${milestoneId}`, { 'If-Match': '"1"' })).status).toBe(401);
    expect(
      (
        await anonymous.post(
          `${BASE}/${created.id}/payment-milestones/${milestoneId}/transitions`,
          { to: 'planned' },
          { 'If-Match': '"1"' },
        )
      ).status,
    ).toBe(401);
    expect(await rowOf(milestoneId)).toMatchObject({ version: 1, deleted: false });
  });

  it('EVM-057 AC8 a stale version of a correction is 412 after the step-up check; a correction without If-Match is 428', async () => {
    const browser = await administrator();
    const created = await order([invoiced]);
    const milestoneId = created.milestoneIds[0] ?? '';
    const stale = await go(browser, created.id, milestoneId, { to: 'planned' }, { ifMatch: '"3"' });
    expect(stale.status).toBe(412);
    expect(JSON.stringify(stale.body)).not.toMatch(/invoiced|version":/);
    expect((await patch(browser, created.id, milestoneId, { amount: pln(1) }, { ifMatch: '"3"' })).status).toBe(412);
    expect((await go(browser, created.id, milestoneId, { to: 'planned' }, { ifMatch: null })).status).toBe(428);
    expect(await rowOf(milestoneId)).toMatchObject({ version: 1 });
  });
});
