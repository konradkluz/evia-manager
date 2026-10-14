import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PaymentProjectionSourceService } from '../../src/modules/payments/infrastructure/projection-source.ts';
import { invoicedTotalsOf } from '../../src/modules/payments/infrastructure/totals-reader.ts';
import { paymentTables } from '../../src/modules/payments/infrastructure/tables.ts';
import { compareUrgency, urgencyOf } from '../../src/modules/overview/domain/payment-signals.ts';
import { runInTransaction } from '../../src/platform/database/transactional.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { assertProjectionInSync } from '../support/projection.ts';
import { insertMilestones, type MilestoneSpec } from '../support/payment-fixtures.ts';
import { insertProcedure, type StageSpec } from '../support/procedure-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

/**
 * EVM-056 on a real PostgreSQL: the column "Płatność" (D8), the views "Po terminie" and "Nieopłacone" (D6, D7), the sort "Najpilniejsze"
 * (D9) on the list and on the search, the days overdue of a milestone (D13), the day of the clock (AC5, W8), the roles (AC7, T2) and the
 * read policy in the query (AC6, T1). "Today" is 2026-10-08 in Europe/Warsaw (10:00 CEST) unless a test moves the clock.
 */
const LIST = '/api/v1/work-orders';
const SEARCH = '/api/v1/work-orders/search';
const TODAY = '2026-10-08T08:00:00.000Z';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp({ now: TODAY });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(TODAY);
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;
const pln = (amountMinor: number) => ({ amountMinor, currency: 'PLN' });

interface Payment {
  state: string;
  invoicedCount: number;
  invoicedTotal: { amountMinor: number; currency: string };
  overdueTotal: { amountMinor: number; currency: string };
}
interface Item {
  id: string;
  number: string;
  status: string;
  payment?: Payment;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;
const list = async (browser: Browser, query: string): Promise<Page> => {
  const response = await browser.panel.get(`${LIST}${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
};
const search = async (browser: Browser, body: Record<string, unknown>): Promise<Page> => {
  const response = await browser.panel.post(SEARCH, { query: 'syntetyczne', ...body });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
};
const numbers = (page: Page) => page.items.map((item) => item.number);
/** Follows `nextCursor` to the end. */
async function allPages(browser: Browser, query: string): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const next: Page = await list(browser, `${query}${cursor === null ? '' : `&cursor=${cursor}`}`);
    pages.push(next);
    cursor = next.nextCursor;
  } while (cursor !== null);
  return pages;
}

let sequence = 0;
interface OrderSpec {
  readonly status?: 'new' | 'in_progress' | 'settled' | 'cancelled';
  readonly deletedAt?: Date;
  readonly milestones?: MilestoneSpec[];
  readonly stages?: StageSpec[];
}
/** One order with its milestones and stages (the fixtures recompute the projection, as `rebuild` would). */
async function order(spec: OrderSpec = {}): Promise<{ id: string; number: string }> {
  sequence += 1;
  const number = numberOf(2026, sequence);
  const ids = await insertWorkOrders(admin(), [
    {
      number,
      status: spec.status ?? 'in_progress',
      ...(spec.deletedAt === undefined ? {} : { deletedAt: spec.deletedAt }),
      ...(spec.status === 'settled' || spec.status === 'cancelled' ? { closedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = ids.get(number) ?? '';
  if (spec.stages !== undefined) await insertProcedure(admin(), id, { stages: spec.stages });
  if (spec.milestones !== undefined) await insertMilestones(admin(), id, spec.milestones);
  return { id, number };
}

/** The four orders of AC1: overdue 3 600,00 zł, one issued 4 500,00 zł, all paid, none issued (cancelled and deleted do not count). */
async function fourOrders() {
  const overdue = await order({
    milestones: [{ status: 'invoiced', dueDate: '2026-10-07', amountMinor: 360_000 }, { status: 'planned' }],
  });
  const unpaid = await order({
    milestones: [
      { status: 'invoiced', dueDate: '2026-10-20', amountMinor: 450_000 },
      { status: 'paid', dueDate: '2026-10-01', amountMinor: 100_000 },
    ],
  });
  const paid = await order({
    milestones: [
      { status: 'paid', dueDate: '2026-10-01' },
      { status: 'paid', dueDate: '2026-10-02' },
    ],
  });
  const none = await order({
    milestones: [
      { status: 'planned', amountMinor: 100_000 },
      { status: 'cancelled', amountMinor: 999 },
      { status: 'invoiced', dueDate: '2026-09-01', amountMinor: 7, deletedAt: new Date('2026-10-05T08:00:00Z') },
    ],
  });
  return { overdue, unpaid, paid, none };
}

describe('the column "Płatność" (EVM-056 AC1; ADR-0017 D8)', () => {
  it('EVM-056 AC1 overdue with the total past due, "Nieopłacone (1)" with the total issued, "Opłacone", "—" — cancelled and deleted milestones count nowhere', async () => {
    const { overdue, unpaid, paid, none } = await fourOrders();
    const page = await list(await signIn('read_only'), '?sort=number');
    const byNumber = new Map(page.items.map((item) => [item.number, item.payment]));
    expect(byNumber.get(overdue.number)).toEqual({
      state: 'overdue',
      invoicedCount: 1,
      invoicedTotal: pln(360_000),
      overdueTotal: pln(360_000),
    });
    expect(byNumber.get(unpaid.number)).toEqual({ state: 'unpaid', invoicedCount: 1, invoicedTotal: pln(450_000), overdueTotal: pln(0) });
    expect(byNumber.get(paid.number)).toEqual({ state: 'paid', invoicedCount: 0, invoicedTotal: pln(0), overdueTotal: pln(0) });
    expect(byNumber.get(none.number)).toEqual({ state: 'none', invoicedCount: 0, invoicedTotal: pln(0), overdueTotal: pln(0) });
  });

  it('EVM-056 AC1 the overdue total counts only the issued milestones past their due date; the issued total counts all of them', async () => {
    const mixed = await order({
      milestones: [
        { status: 'invoiced', dueDate: '2026-10-01', amountMinor: 100_000 },
        { status: 'invoiced', dueDate: '2026-10-07', amountMinor: 20_000 },
        { status: 'invoiced', dueDate: '2026-10-08', amountMinor: 3_000 },
      ],
    });
    const page = await list(await signIn(), '');
    expect(page.items.find((item) => item.id === mixed.id)?.payment).toEqual({
      state: 'overdue',
      invoicedCount: 3,
      invoicedTotal: pln(123_000),
      overdueTotal: pln(120_000),
    });
  });

  it('EVM-056 AC1 P4 a milestone invoiced and paid through the API changes the column in the same transaction (the projection is recomputed by its events)', async () => {
    const target = await order({ milestones: [{ status: 'planned', paymentTermDays: 7 }] });
    const editor = await signIn();
    const [milestone] = ((await editor.panel.get(`${LIST}/${target.id}/payment-milestones`)).body as { items: Array<{ id: string }> })
      .items;
    const path = `${LIST}/${target.id}/payment-milestones/${milestone?.id ?? ''}/transitions`;
    const invoiced = await editor.panel.post(
      path,
      { to: 'invoiced', amount: pln(250_000), invoiceNumber: 'FV/SYNT/1/2026', invoicedOn: '2026-10-01' },
      { 'If-Match': '"1"', 'Idempotency-Key': uuidv7() },
    );
    expect(invoiced.status, JSON.stringify(invoiced.body)).toBe(200);
    // due 2026-10-08 (7 days after the invoice): issued, not yet overdue today
    expect((await list(editor, '')).items[0]?.payment).toEqual({
      state: 'unpaid',
      invoicedCount: 1,
      invoicedTotal: pln(250_000),
      overdueTotal: pln(0),
    });
    const paid = await editor.panel.post(path, { to: 'paid', paidOn: '2026-10-08' }, { 'If-Match': '"2"', 'Idempotency-Key': uuidv7() });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect((await list(editor, '')).items[0]?.payment?.state).toBe('paid');
  });

  const milestonesPath = (orderId: string) => `${LIST}/${orderId}/payment-milestones`;
  const firstMilestoneId = async (browser: Browser, orderId: string): Promise<string> =>
    ((await browser.panel.get(milestonesPath(orderId))).body as { items: Array<{ id: string }> }).items[0]?.id ?? '';
  const signals = async (orderId: string) =>
    (
      await sql<{ invoiced_count: number; paid_count: number; earliest_invoiced_due_date: string | null }>`
        select invoiced_count, paid_count, earliest_invoiced_due_date::text as earliest_invoiced_due_date
        from overview.work_order_summaries where work_order_id = ${orderId}`.execute(admin())
    ).rows[0];

  it('EVM-056 AC1 P4 a due date moved into the past through PATCH makes the order overdue and puts it in "Po terminie" in the same transaction', async () => {
    const target = await order({ milestones: [{ status: 'invoiced', dueDate: '2026-10-20', amountMinor: 80_000 }] });
    const editor = await signIn();
    expect((await list(editor, '')).items[0]?.payment?.state).toBe('unpaid');
    expect(await list(editor, '?view=overdue_payments')).toMatchObject({ items: [] });
    const patched = await editor.panel.patch(
      `${milestonesPath(target.id)}/${await firstMilestoneId(editor, target.id)}`,
      { dueDate: '2026-10-03' },
      { 'If-Match': '"1"' },
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(await signals(target.id)).toMatchObject({ invoiced_count: 1, earliest_invoiced_due_date: '2026-10-03' });
    expect((await list(editor, '')).items[0]?.payment).toEqual({
      state: 'overdue',
      invoicedCount: 1,
      invoicedTotal: pln(80_000),
      overdueTotal: pln(80_000),
    });
    expect(numbers(await list(editor, '?view=overdue_payments'))).toEqual([target.number]);
    await assertProjectionInSync();
  });

  it('EVM-056 AC1 P4 the cancellation of an order (the effect cancels its planned milestones) leaves the projection with no issued milestone and no drift', async () => {
    const target = await order({
      milestones: [{ status: 'planned', amountMinor: 50_000 }, { status: 'planned' }, { status: 'paid', dueDate: '2026-10-01' }],
    });
    const editor = await signIn();
    const cancelled = await editor.panel.post(
      `${LIST}/${target.id}/transitions`,
      { to: 'cancelled', reason: 'Rezygnacja klienta' },
      { 'If-Match': '"1"', 'Idempotency-Key': uuidv7() },
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const statuses = await sql<{ status: string }>`
      select status from payments.payment_milestones where work_order_id = ${target.id} order by position`.execute(admin());
    expect(statuses.rows.map((row) => row.status)).toEqual(['cancelled', 'cancelled', 'paid']);
    expect(await signals(target.id)).toEqual({ invoiced_count: 0, paid_count: 1, earliest_invoiced_due_date: null });
    expect((await list(editor, '?sort=number')).items.find((item) => item.id === target.id)?.payment?.state).toBe('paid');
    await assertProjectionInSync();
  });

  it('EVM-056 AC1 P4 a milestone added through the API keeps the signals of the order and does not drift', async () => {
    const target = await order({ milestones: [{ status: 'invoiced', dueDate: '2026-10-07', amountMinor: 10_000 }] });
    const editor = await signIn();
    const created = await editor.panel.post(
      milestonesPath(target.id),
      { id: uuidv7(), name: 'Dopłata syntetyczna' },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await signals(target.id)).toEqual({ invoiced_count: 1, paid_count: 0, earliest_invoiced_due_date: '2026-10-07' });
    expect((await list(editor, '')).items[0]?.payment).toMatchObject({ state: 'overdue', invoicedCount: 1 });
    await assertProjectionInSync();
  });

  it('EVM-056 AC1 P4 an order created from a template with a payment plan starts with no issued milestone: invoicedCount 0, state "none"', async () => {
    const editor = await signIn();
    const { rows } = await sql<{ id: string }>`select id from catalog.work_order_templates where code = 'garage_full_process'`.execute(
      admin(),
    );
    const body = {
      id: uuidv7(),
      customerId: await insertCustomer(admin(), { email: 'jan@example.invalid' }),
      siteId: await insertSite(admin()),
      templateId: rows[0]?.id ?? '',
    };
    const response = await editor.panel.post(LIST, body, { 'Idempotency-Key': uuidv7() });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await signals(body.id)).toEqual({ invoiced_count: 0, paid_count: 0, earliest_invoiced_due_date: null });
    const item = (await list(editor, '?sort=number')).items.find((entry) => entry.id === body.id);
    expect(item?.payment).toEqual({ state: 'none', invoicedCount: 0, invoicedTotal: pln(0), overdueTotal: pln(0) });
    await assertProjectionInSync();
  });
});

describe('the views "Po terminie" and "Nieopłacone" (EVM-056 AC2; ADR-0017 D6, D7, pyt. 7)', () => {
  it('EVM-056 AC2 "Po terminie" lists the open orders with an issued milestone past its due date, "Nieopłacone" those with an issued one — closed orders never', async () => {
    const { overdue, unpaid } = await fourOrders();
    await order({ status: 'settled', milestones: [{ status: 'invoiced', dueDate: '2026-09-01', amountMinor: 1_000 }] });
    await order({ status: 'cancelled', milestones: [{ status: 'invoiced', dueDate: '2026-10-20', amountMinor: 1_000 }] });
    const browser = await signIn();
    expect(numbers(await list(browser, '?view=overdue_payments&sort=number'))).toEqual([overdue.number]);
    expect(numbers(await list(browser, '?view=unpaid&sort=number'))).toEqual([overdue.number, unpaid.number]);
  });

  it('EVM-056 AC2 the search takes the same views and gives the same orders (one reader, one meaning of a view)', async () => {
    const { overdue, unpaid } = await fourOrders();
    const browser = await signIn();
    expect(numbers(await search(browser, { view: 'overdue_payments', sort: 'number' }))).toEqual([overdue.number]);
    expect(numbers(await search(browser, { view: 'unpaid', sort: 'number' }))).toEqual([overdue.number, unpaid.number]);
    expect(numbers(await search(browser, { view: 'unpaid', sort: 'urgency' }))).toEqual(
      numbers(await list(browser, '?view=unpaid&sort=urgency')),
    );
  });

  it('EVM-056 AC2 K5 a view or a sort outside the lists — and the descending "-urgency" — is 400 validation_failed without an echo of the value', async () => {
    const browser = await signIn();
    for (const query of ['?view=overdue', '?view=Unpaid', '?sort=-urgency', '?sort=urgent']) {
      const response = await browser.panel.get(`${LIST}${query}`);
      expect(response.status, query).toBe(400);
      expect((response.body as { code: string }).code, query).toBe('validation_failed');
      expect(JSON.stringify(response.body), query).not.toMatch(/overdue"|Unpaid|-urgency|urgent"/);
    }
    const body = await browser.panel.post(SEARCH, { query: 'syntetyczne', sort: '-urgency' });
    expect(body.status).toBe(400);
  });
});

describe('the sort "Najpilniejsze" (EVM-056 AC3; ADR-0017 D9, W7, W8)', () => {
  it('EVM-056 AC3 the groups in order: overdue (oldest past date first), waiting > 14 days, the nearest deadline, the rest — closed last; ties by id', async () => {
    const lateStage = await order({ stages: [{ status: 'todo', dueDate: '2026-10-03' }] });
    const lateMilestone = await order({ milestones: [{ status: 'invoiced', dueDate: '2026-10-01', amountMinor: 1_000 }] });
    const waiting = await order({ stages: [{ status: 'waiting', waitingOn: 'customer', waitingSince: '2026-09-20' }] });
    const waiting14 = await order({ stages: [{ status: 'waiting', waitingOn: 'customer', waitingSince: '2026-09-24' }] });
    const dueToday = await order({ stages: [{ status: 'todo', dueDate: '2026-10-08' }] });
    const dueLater = await order({ stages: [{ status: 'todo', dueDate: '2026-11-01' }] });
    const closed = await order({
      status: 'settled',
      stages: [{ status: 'todo', dueDate: '2026-09-01' }],
    });
    const nothing = await order();
    const page = await list(await signIn(), '?sort=urgency');
    const rest = [waiting14, closed, nothing].map((entry) => entry.id).sort();
    expect(page.items.map((item) => item.id)).toEqual([lateMilestone.id, lateStage.id, waiting.id, dueToday.id, dueLater.id, ...rest]);
  });

  it('EVM-056 AC3 the order of the database equals the order of the rule in memory on a random set with the boundaries (today, today − 14, today − 15); pages of 7 have no repeat and no gap', async () => {
    const days = ['2026-09-23', '2026-09-24', '2026-10-07', '2026-10-08', '2026-10-09', null] as const;
    let seed = 56;
    const pick = <T>(values: readonly T[]): T => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return values[seed % values.length] as T;
    };
    const expected: Array<{ id: string; group: 1 | 2 | 3 | 4; day: string }> = [];
    for (let index = 0; index < 36; index += 1) {
      const status = pick(['in_progress', 'in_progress', 'new', 'settled'] as const);
      const invoicedDue = pick(days);
      const stageDue = pick(days);
      const waitingSince = pick([...days.filter((day) => day !== '2026-10-09')]);
      const stages: StageSpec[] = [
        ...(stageDue === null ? [] : [{ status: 'todo' as const, dueDate: stageDue }]),
        ...(waitingSince === null ? [] : [{ status: 'waiting' as const, waitingOn: 'customer' as const, waitingSince }]),
      ];
      const created = await order({
        status,
        ...(stages.length === 0 ? {} : { stages }),
        ...(invoicedDue === null ? {} : { milestones: [{ status: 'invoiced', dueDate: invoicedDue, amountMinor: 1_000 }] }),
      });
      const urgency = urgencyOf(
        { status, earliestInvoicedDueDate: invoicedDue, nextDueDate: stageDue, longestWaitingSince: waitingSince },
        '2026-10-08',
        true,
      );
      expected.push({ id: created.id, ...urgency });
    }
    const pages = await allPages(await signIn(), '?sort=urgency&limit=7');
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...expected].sort(compareUrgency).map((entry) => entry.id));
    expect(pages.length).toBe(Math.ceil(36 / 7));
  });

  it('EVM-056 AC5 T4 a cursor from before midnight continues THAT day: the next page after midnight has no repeat and no gap, and its states are of the day of the cursor', async () => {
    current.clock.set('2026-10-07T21:50:00.000Z'); // 23:50 in Warsaw, 2026-10-07
    const boundary = await order({ milestones: [{ status: 'invoiced', dueDate: '2026-10-07', amountMinor: 5_000 }] });
    for (let index = 0; index < 4; index += 1) await order({ stages: [{ status: 'todo', dueDate: `2026-10-1${index}` }] });
    const browser = await signIn();
    const whole = await list(browser, '?sort=urgency');
    const first = await list(browser, '?sort=urgency&limit=2');
    current.clock.set('2026-10-07T22:10:00.000Z'); // 00:10 in Warsaw, 2026-10-08 (the same session)
    const second = await list(browser, `?sort=urgency&limit=10&cursor=${first.nextCursor ?? ''}`);
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(whole.items.map((item) => item.id));
    const states = new Map([...first.items, ...second.items].map((item) => [item.id, item.payment?.state]));
    expect(states.get(boundary.id)).toBe('unpaid');
    // a new first page is of the new day: the milestone due 2026-10-07 is overdue now
    expect((await list(browser, '?sort=urgency')).items.find((item) => item.id === boundary.id)?.payment?.state).toBe('overdue');
  });

  it('EVM-056 AC3 K6 a cursor of another view or sort, a changed one, or one of another user is 400 invalid_cursor', async () => {
    for (let index = 0; index < 3; index += 1)
      await order({ milestones: [{ status: 'invoiced', dueDate: '2026-10-20', amountMinor: 1_000 }] });
    const browser = await signIn();
    const cursor = (await list(browser, '?view=unpaid&sort=urgency&limit=1')).nextCursor ?? '';
    expect(cursor).not.toBe('');
    const other = await signIn();
    const tampered = `${cursor.slice(0, -2)}${cursor.endsWith('AA') ? 'AB' : 'AA'}`;
    for (const [who, query] of [
      [browser, `?view=overdue_payments&sort=urgency&limit=1&cursor=${cursor}`],
      [browser, `?view=unpaid&sort=nextDueDate&limit=1&cursor=${cursor}`],
      [browser, `?sort=urgency&limit=1&cursor=${cursor}`],
      [browser, `?view=unpaid&sort=urgency&limit=1&cursor=${tampered}`],
      [other, `?view=unpaid&sort=urgency&limit=1&cursor=${cursor}`],
    ] as const) {
      const response = await who.panel.get(`${LIST}${query}`);
      expect(response.status, query).toBe(400);
      expect((response.body as { code: string }).code, query).toBe('invalid_cursor');
    }
    expect((await browser.panel.get(`${LIST}?view=unpaid&sort=urgency&limit=1&cursor=${cursor}`)).status).toBe(200);
  });
});

describe('"Po terminie" from the day (EVM-056 AC5; ADR-0017 D6, W3)', () => {
  it('EVM-056 AC5 a due date of 2026-10-07 is overdue only on 2026-10-08 — on the list, in the view and on the milestone — and nothing is written', async () => {
    current.clock.set('2026-10-07T21:45:00.000Z'); // 23:45 in Warsaw, 2026-10-07
    const target = await order({ milestones: [{ status: 'invoiced', dueDate: '2026-10-07', amountMinor: 360_000 }] });
    const projection = async () =>
      (await sql`select * from overview.work_order_summaries where work_order_id = ${target.id}`.execute(admin())).rows;
    const stored = await projection();
    const browser = await signIn();
    const milestoneOf = async () =>
      ((await browser.panel.get(`${LIST}/${target.id}/payment-milestones`)).body as { items: Array<Record<string, unknown>> }).items[0];
    expect((await list(browser, '')).items[0]?.payment?.state).toBe('unpaid');
    expect((await list(browser, '?view=overdue_payments')).items).toEqual([]);
    expect(await milestoneOf()).toMatchObject({ isOverdue: false, overdueDays: null });

    current.clock.set('2026-10-07T22:05:00.000Z'); // 00:05 in Warsaw, 2026-10-08 (the same session)
    expect((await list(browser, '')).items[0]?.payment).toMatchObject({ state: 'overdue', overdueTotal: pln(360_000) });
    expect(numbers(await list(browser, '?view=overdue_payments'))).toEqual([target.number]);
    expect(await milestoneOf()).toMatchObject({ isOverdue: true, overdueDays: 1 });
    expect(await projection()).toEqual(stored);
  });

  it('EVM-056 AC5 the change of the clock on 2026-10-25 moves no day: 2026-10-24T22:30Z is 2026-10-25 and 2026-10-25T23:30Z is 2026-10-26', async () => {
    const target = await order({ milestones: [{ status: 'invoiced', dueDate: '2026-10-20', amountMinor: 1_000 }] });
    // a new session at each instant (a session of the day before would have expired)
    const days = async () =>
      ((await (await signIn()).panel.get(`${LIST}/${target.id}/payment-milestones`)).body as { items: Array<{ overdueDays: number }> })
        .items[0]?.overdueDays;
    current.clock.set('2026-10-24T22:30:00.000Z');
    expect(await days()).toBe(5);
    current.clock.set('2026-10-25T23:30:00.000Z');
    expect(await days()).toBe(6);
  });
});

describe('the tile "Płatności" — the days overdue of a milestone (EVM-056 AC4; ADR-0017 D13)', () => {
  it('EVM-056 AC4 4 milestones (one issued past due 3 600,00 zł, three planned): only the issued one is overdue, with its days; the others have null', async () => {
    const target = await order({
      milestones: [
        { status: 'invoiced', dueDate: '2026-10-03', amountMinor: 360_000 },
        { status: 'planned' },
        { status: 'planned' },
        { status: 'planned' },
      ],
    });
    const response = await (await signIn('read_only')).panel.get(`${LIST}/${target.id}/payment-milestones`);
    expect(response.status).toBe(200);
    const body = response.body as { items: Array<{ status: string; isOverdue: boolean; overdueDays: number | null }>; totals: unknown };
    expect(body.items.map((item) => [item.status, item.isOverdue, item.overdueDays])).toEqual([
      ['invoiced', true, 5],
      ['planned', false, null],
      ['planned', false, null],
      ['planned', false, null],
    ]);
    expect(body.totals).toMatchObject({ unpaid: pln(360_000) });
  });

  it('EVM-056 AC4 T3 `overdueDays` is a field of the server: naming it in a new milestone or a change is 400 read_only_field', async () => {
    const target = await order({ milestones: [{ status: 'planned', amountMinor: 1_000 }] });
    const editor = await signIn();
    const created = await editor.panel.post(
      `${LIST}/${target.id}/payment-milestones`,
      { id: uuidv7(), name: 'Transza syntetyczna', overdueDays: 3 },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(created.status).toBe(400);
    expect((created.body as { errors: unknown[] }).errors).toEqual([{ pointer: '/overdueDays', code: 'read_only_field' }]);
    const [milestone] = ((await editor.panel.get(`${LIST}/${target.id}/payment-milestones`)).body as { items: Array<{ id: string }> })
      .items;
    const patched = await editor.panel.patch(
      `${LIST}/${target.id}/payment-milestones/${milestone?.id ?? ''}`,
      { amount: pln(2_000), overdueDays: 3 },
      { 'If-Match': '"1"' },
    );
    expect(patched.status).toBe(400);
    expect((patched.body as { errors: unknown[] }).errors).toEqual([{ pointer: '/overdueDays', code: 'read_only_field' }]);
  });
});

describe('roles and channels (EVM-056 AC7; ADR-0017 T2, W4, W9; SR-AUTHZ-05)', () => {
  const restricted = (operation: string) => AUTHZ_MANIFEST[operation]?.authz.restrictedParams?.['paymentMilestone.read'];

  it('EVM-056 AC7 every restricted value of the contract × A, E, R on the list and the search → 200 with the field `payment`; anonymous → 401; mobile → 403 forbidden', async () => {
    await fourOrders();
    const cases = ['listWorkOrders', 'searchWorkOrders'].flatMap((operation) =>
      Object.entries(restricted(operation)?.params ?? {}).flatMap(([name, values]) => values.map((value) => ({ operation, name, value }))),
    );
    // the cases come from the manifest: a value added to `restrictedParams` is tested at once
    expect(cases).toHaveLength(6);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      for (const { operation, name, value } of cases) {
        const page = operation === 'listWorkOrders' ? await list(browser, `?${name}=${value}`) : await search(browser, { [name]: value });
        expect(page.items.length, `${role} ${operation} ${name}=${value}`).toBeGreaterThan(0);
        for (const field of restricted(operation)?.fields ?? [])
          for (const item of page.items) expect(item, `${role} ${operation} ${name}=${value}`).toHaveProperty(field);
      }
    }
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const mobile = await signIn('editor', 'mobile');
    for (const { operation, name, value } of cases) {
      const send = (client: PanelClient) =>
        operation === 'listWorkOrders'
          ? client.get(`${LIST}?${name}=${value}`)
          : client.post(SEARCH, { query: 'syntetyczne', [name]: value });
      expect((await send(anonymous)).status, `${operation} ${name}=${value}`).toBe(401);
      const refused = await send(mobile.panel);
      expect(refused.status, `${operation} ${name}=${value}`).toBe(403);
      // a channel outside the policy is `403 forbidden` — the guard has no separate code for it (access-decision.ts, rule 7)
      expect((refused.body as { code: string }).code).toBe('forbidden');
    }
  });

  it('EVM-056 AC7 the milestones with `overdueDays`: A, E, R → 200; anonymous → 401; mobile → 403; an order deleted or unknown → 404 (IDOR through the anchor)', async () => {
    const target = await order({ milestones: [{ status: 'invoiced', dueDate: '2026-10-01', amountMinor: 1_000 }] });
    const deleted = await order({
      deletedAt: new Date('2026-10-05T08:00:00Z'),
      milestones: [{ status: 'invoiced', dueDate: '2026-10-01', amountMinor: 1_000 }],
    });
    const path = (id: string) => `${LIST}/${id}/payment-milestones`;
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      const response = await browser.panel.get(path(target.id));
      expect(response.status, role).toBe(200);
      expect((response.body as { items: Array<{ overdueDays: number }> }).items[0]?.overdueDays, role).toBe(7);
      expect((await browser.panel.get(path(deleted.id))).status, role).toBe(404);
      expect((await browser.panel.get(path(uuidv7()))).status, role).toBe(404);
    }
    expect((await new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN).get(path(target.id))).status).toBe(401);
    expect((await (await signIn('read_only', 'mobile')).panel.get(path(target.id))).status).toBe(403);
  });
});

describe('the read policy in the query (EVM-056 AC6; ADR-0017 test 3, T1; SR-AUTHZ-03)', () => {
  it('EVM-056 AC6 a soft-deleted order with the oldest overdue milestone and the largest amount changes no result, order, total or page boundary (60 orders, pages of 25) for A, E and R', async () => {
    for (let index = 0; index < 60; index += 1) {
      await order({
        milestones: [{ status: 'invoiced', dueDate: index % 2 === 0 ? '2026-10-01' : '2026-10-20', amountMinor: 1_000 + index }],
        stages: [{ status: 'todo', dueDate: `2026-10-${String(1 + (index % 28)).padStart(2, '0')}` }],
      });
    }
    const queries = ['?sort=urgency&limit=25', '?view=unpaid&sort=urgency&limit=25', '?view=overdue_payments&sort=urgency&limit=25'];
    const snapshot = async (role: Role) => {
      const browser = await signIn(role);
      const result: Record<string, unknown> = {};
      for (const query of queries) {
        const pages = await allPages(browser, query);
        result[query] = pages.map((page) => page.items.map((item) => [item.id, item.payment]));
      }
      return result;
    };
    const before = await Promise.all((['administrator', 'editor', 'read_only'] as const).map(snapshot));
    const victim = await order({
      deletedAt: new Date('2026-10-05T08:00:00Z'),
      milestones: [{ status: 'invoiced', dueDate: '2020-01-01', amountMinor: 99_999_999_999 }],
      stages: [{ status: 'waiting', waitingOn: 'customer', waitingSince: '2020-01-01' }],
    });
    const after = await Promise.all((['administrator', 'editor', 'read_only'] as const).map(snapshot));
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain(victim.id);
    // T1: the list gives what the single order gives — the deleted one is 404 there as well
    const browser = await signIn();
    expect((await browser.panel.get(`${LIST}/${victim.id}`)).status).toBe(404);
  });
});

describe('the sources of the read model in `payments` (EVM-056; ADR-0017 W3, W5, D8)', () => {
  it('EVM-056 AC1 K7 the system port gives the status and the due date of the live milestones that are not cancelled — no amount, no name', async () => {
    const target = await order({
      milestones: [
        { status: 'invoiced', dueDate: '2026-10-07', amountMinor: 360_000, name: 'Zaliczka syntetyczna' },
        { status: 'cancelled' },
        { status: 'paid', dueDate: '2026-10-01', deletedAt: new Date('2026-10-05T08:00:00Z') },
        { status: 'planned' },
      ],
    });
    const rows = await new PaymentProjectionSourceService().milestoneSignalsOf(admin(), [target.id]);
    expect([...rows].sort((a, b) => a.status.localeCompare(b.status))).toEqual([
      { workOrderId: target.id, status: 'invoiced', dueDate: '2026-10-07' },
      { workOrderId: target.id, status: 'planned', dueDate: null },
    ]);
    expect(await new PaymentProjectionSourceService().milestoneSignalsOf(admin(), [])).toEqual([]);
  });

  it('EVM-056 AC1 D8 a milestone in a currency other than PLN is a defect: the totals fail (no mixed sum) and the error names no amount', async () => {
    const target = await order({ milestones: [{ status: 'invoiced', dueDate: '2026-10-07', amountMinor: 360_000 }] });
    // the CHECK of 0026 allows PLN only: it is lifted inside a transaction that is rolled back, so the data of no other test changes
    const failure = await runInTransaction(admin(), async (tx) => {
      await sql`alter table payments.payment_milestones drop constraint payment_milestones_currency_check`.execute(tx);
      await sql`update payments.payment_milestones set currency = 'EUR' where work_order_id = ${target.id}`.execute(tx);
      const error = await invoicedTotalsOf(paymentTables(tx), [target.id], '2026-10-08').catch((reason: unknown) => reason);
      throw Object.assign(new Error('rollback'), { cause: error });
    }).catch((reason: unknown) => (reason as { cause?: unknown }).cause);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/PLN/);
    expect((failure as Error).message).not.toMatch(/360|3 600/);
  });
});
