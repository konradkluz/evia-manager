import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scopeOf, type CursorCodec } from '../../src/platform/crypto/opaque-cursor.ts';
import { CURSOR_CODEC } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones, type MilestoneSpec } from '../support/payment-fixtures.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const LIST = '/api/v1/payment-milestones';
/** Noon in Warsaw on the day of the examples of the story. */
const TODAY_NOON = '2026-10-03T10:00:00.000Z';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(TODAY_NOON);
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}

let numbering = 0;
async function order(milestones: MilestoneSpec[], options: { customerId?: string | undefined; deleted?: boolean; title?: string } = {}) {
  numbering += 1;
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-2026-${String(numbering).padStart(4, '0')}`,
      title: options.title ?? `Zlecenie syntetyczne ${numbering}`,
      ...(options.customerId === undefined ? {} : { customerId: options.customerId }),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  const milestoneIds = await insertMilestones(admin(), id, milestones);
  return { id, number: `ZL-2026-${String(numbering).padStart(4, '0')}`, milestoneIds };
}
const invoiced = (dueDate: string, amountMinor: number, extra: MilestoneSpec = {}): MilestoneSpec => ({
  status: 'invoiced',
  dueDate,
  amountMinor,
  ...extra,
});

interface Item {
  id: string;
  workOrder: { id: string; number: string; title: string };
  customer: { id: string; displayName: string } | { deleted: true } | null;
  name: string;
  invoiceNumber: string;
  amount: { amountMinor: number; currency: string };
  dueDate: string;
  status: string;
  isOverdue: boolean;
  overdueDays: number | null;
  version: number;
}
interface Count {
  count: number;
  total: { amountMinor: number; currency: string };
}
interface Summary {
  unpaid: Count;
  overdue: Count;
  longestOverdue: { days: number; workOrder: { id: string; number: string } } | null;
  filtered: Count;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
  asOf: string;
  summary: Summary;
}
type Browser = Awaited<ReturnType<typeof signIn>>;

async function page(browser: Browser, query = ''): Promise<{ status: number; body: Page; headers: Record<string, string> }> {
  const response = await browser.panel.get(`${LIST}${query === '' ? '' : `?${query}`}`);
  return { status: response.status, body: response.body as Page, headers: response.headers };
}
/** Every page of a query, following `nextCursor` until it is `null`. */
async function allPages(browser: Browser, query: string, limit: number): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const response = await page(browser, `${query}${query === '' ? '' : '&'}limit=${limit}${cursor === null ? '' : `&cursor=${cursor}`}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    pages.push(response.body);
    cursor = response.body.nextCursor;
  } while (cursor !== null);
  return pages;
}
const codeOf = (body: unknown) => (body as { code?: string }).code;

/** The 12 issued milestones of the story: 4 overdue on 2026-10-03 (15 200,00 zł), 8 not yet (33 100,00 zł), 48 300,00 zł together. */
const DATASET: ReadonlyArray<readonly [string, number]> = [
  ['2026-09-12', 400_000], // 21 days
  ['2026-09-20', 300_000],
  ['2026-09-28', 420_000], // 5 days
  ['2026-10-02', 400_000], // 1 day
  ['2026-10-03', 410_000], // the due day itself: not overdue
  ['2026-10-05', 410_000],
  ['2026-10-10', 410_000],
  ['2026-10-15', 410_000],
  ['2026-10-20', 410_000],
  ['2026-10-25', 420_000],
  ['2026-11-01', 420_000],
  ['2026-11-10', 420_000],
];

/** The dataset plus noise that must change nothing: other statuses, a deleted milestone, a deleted order. */
async function seedStory() {
  const shared = await insertCustomer(admin(), { firstName: 'Anna', lastName: 'Wspólna' });
  const orders = [];
  for (const [index, [dueDate, amount]] of DATASET.entries()) {
    const customerId = index === 1 || index === 5 ? shared : await insertCustomer(admin(), { lastName: `Klient${index}` });
    orders.push(await order([invoiced(dueDate, amount)], { customerId }));
  }
  await order([{ status: 'planned' }, { status: 'paid', amountMinor: 999_999 }, { status: 'cancelled', amountMinor: 555 }]);
  await order([invoiced('2026-01-01', 777_777, { deletedAt: new Date('2026-10-02T08:00:00Z') })]);
  await order([invoiced('2026-01-01', 888_888)], { deleted: true });
  return { orders, shared };
}

describe('the summary of unpaid invoices (EVM-055 AC1, AC2, AC3; SR-AUTHZ-03)', () => {
  it('EVM-055 AC1 AC3 12 issued milestones in 12 orders: the tiles 12 / 48 300,00 zł, 4 / 15 200,00 zł and 21 days with the order number; the table is sorted "Najdłużej po terminie" and paged without a duplicate or a gap', async () => {
    const { orders } = await seedStory();
    const reader = await signIn('editor');
    const pages = await allPages(reader, '', 5);
    expect(pages.map((one) => one.items.length)).toEqual([5, 5, 2]);
    const first = pages[0]?.summary;
    expect(first?.unpaid).toEqual({ count: 12, total: { amountMinor: 4_830_000, currency: 'PLN' } });
    expect(first?.overdue).toEqual({ count: 4, total: { amountMinor: 1_520_000, currency: 'PLN' } });
    expect(first?.longestOverdue).toEqual({ days: 21, workOrder: { id: orders[0]?.id, number: orders[0]?.number } });
    expect(first?.filtered).toEqual(first?.unpaid);
    for (const one of pages) expect(one.summary).toEqual(first);
    const items = pages.flatMap((one) => one.items);
    expect(items.map((item) => item.dueDate)).toEqual(DATASET.map(([dueDate]) => dueDate));
    expect(new Set(items.map((item) => item.id)).size).toBe(12);
    expect(items.map((item) => item.workOrder.id)).toEqual(orders.map((one) => one.id));
    expect(pages.at(-1)?.nextCursor).toBeNull();
  });

  it('EVM-055 AC1 an item has exactly the fields of the contract: the order to link, the customer, the instalment, the invoice, the amount, the due day, the status and the version — no reason of a cancellation, no author', async () => {
    const customerId = await insertCustomer(admin(), { firstName: 'Jan', lastName: 'Zamawiający' });
    const { id, number, milestoneIds } = await order([invoiced('2026-09-28', 360_000, { name: 'Zaliczka', invoiceNumber: 'FV/12/2026' })], {
      customerId,
      title: 'Wallbox garaż',
    });
    const response = await page(await signIn('administrator'));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const [item] = response.body.items;
    expect(Object.keys(item ?? {}).sort()).toEqual(
      ['amount', 'customer', 'dueDate', 'id', 'invoiceNumber', 'isOverdue', 'name', 'overdueDays', 'status', 'version', 'workOrder'].sort(),
    );
    expect(item).toMatchObject({
      id: milestoneIds[0],
      workOrder: { id, number, title: 'Wallbox garaż' },
      name: 'Zaliczka',
      invoiceNumber: 'FV/12/2026',
      amount: { amountMinor: 360_000, currency: 'PLN' },
      dueDate: '2026-09-28',
      status: 'invoiced',
      version: 1,
    });
    expect(item?.customer).toMatchObject({ id: customerId });
    expect(JSON.stringify(response.body)).not.toMatch(/status_reason|statusReason|created_by|updated_by/);
  });

  it('EVM-055 AC2 on 2026-10-03 the milestone due on 2026-09-28 is "Po terminie" for 5 days and the one due on 2026-10-03 is only issued — the day is the day of Europe/Warsaw, also around midnight UTC', async () => {
    await order([invoiced('2026-09-28', 100_000)]);
    await order([invoiced('2026-10-03', 100_000)]);
    const reader = await signIn('read_only');
    const noon = await page(reader);
    expect(noon.body.asOf).toBe('2026-10-03');
    expect(noon.body.items.map((item) => [item.dueDate, item.isOverdue, item.overdueDays])).toEqual([
      ['2026-09-28', true, 5],
      ['2026-10-03', false, null],
    ]);
    // 2026-10-03 21:59 UTC is still the 3rd in Warsaw (CEST); 22:00 UTC is already the 4th
    current.clock.set('2026-10-03T21:59:00.000Z');
    expect((await page(await signIn('read_only'))).body.asOf).toBe('2026-10-03');
    current.clock.set('2026-10-03T22:00:00.000Z');
    const night = await page(await signIn('read_only'));
    expect(night.body.asOf).toBe('2026-10-04');
    expect(night.body.items.map((item) => item.overdueDays)).toEqual([6, 1]);
    expect(night.body.summary.overdue.count).toBe(2);
  });

  it('EVM-055 AC2 the day of a page is the day of its cursor: a midnight between two pages neither repeats nor skips a milestone', async () => {
    for (const due of ['2026-10-01', '2026-10-03', '2026-10-04']) await order([invoiced(due, 100_000)]);
    current.clock.set('2026-10-03T21:50:00.000Z'); // 23:50 on the 3rd in Warsaw
    const reader = await signIn('editor');
    const first = await page(reader, 'limit=1');
    expect(first.body.items.map((item) => item.overdueDays)).toEqual([2]);
    current.clock.set('2026-10-03T22:10:00.000Z'); // 00:10 on the 4th in Warsaw
    const second = await page(reader, `limit=2&cursor=${first.body.nextCursor}`);
    expect(second.status).toBe(200);
    expect(second.body.asOf).toBe('2026-10-03');
    expect(second.body.items.map((item) => [item.dueDate, item.overdueDays])).toEqual([
      ['2026-10-03', null],
      ['2026-10-04', null],
    ]);
    expect(second.body.summary.overdue.count).toBe(1);
  });

  it('EVM-055 AC3 AC7 only the issued milestones of live orders count: planned, paid, cancelled, a deleted milestone and a milestone of a deleted order are on no page and in no sum — for every role', async () => {
    await seedStory();
    const marker = await order([invoiced('2026-09-01', 123_456, { name: 'Znacznik-nie-widoczny' })], { deleted: true });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const pages = await allPages(await signIn(role), '', 100);
      expect(pages).toHaveLength(1);
      const serialised = JSON.stringify(pages);
      expect(serialised).not.toContain('Znacznik-nie-widoczny');
      expect(serialised).not.toContain(marker.number);
      expect(pages[0]?.items).toHaveLength(12);
      expect(pages[0]?.summary.unpaid.total.amountMinor).toBe(4_830_000);
      expect(pages[0]?.summary.longestOverdue?.days).toBe(21);
    }
  });

  it('EVM-055 AC3 for every combination of filters the sum below the table equals the sum of all its pages, and the tiles do not move', async () => {
    const { shared } = await seedStory();
    const reader = await signIn('editor');
    const baseline = (await page(reader)).body.summary;
    const combinations = [
      '',
      'view=overdue',
      'view=unpaid',
      'dueFrom=2026-09-20',
      'dueTo=2026-10-05',
      'dueFrom=2026-09-20&dueTo=2026-10-05',
      'view=overdue&dueFrom=2026-09-15',
      'view=overdue&dueTo=2026-09-28',
      `customerId=${shared}`,
      `view=overdue&customerId=${shared}`,
      `dueFrom=2026-10-01&customerId=${shared}`,
      `view=overdue&dueFrom=2026-09-01&dueTo=2026-10-31&customerId=${shared}`,
      'dueFrom=2026-12-01',
    ];
    for (const query of combinations) {
      const pages = await allPages(reader, query, 3);
      const items = pages.flatMap((one) => one.items);
      const filtered = pages[0]?.summary.filtered;
      expect(filtered?.count, query).toBe(items.length);
      expect(filtered?.total.amountMinor, query).toBe(items.reduce((sum, item) => sum + item.amount.amountMinor, 0));
      for (const one of pages) {
        expect(one.summary.filtered, query).toEqual(filtered);
        expect({ ...one.summary, filtered: null }, query).toEqual({ ...baseline, filtered: null });
      }
    }
    expect((await allPages(reader, 'view=overdue', 100))[0]?.summary.filtered).toEqual(baseline.overdue);
    expect((await allPages(reader, `customerId=${shared}`, 100))[0]?.items.map((item) => item.dueDate)).toEqual([
      '2026-09-20',
      '2026-10-05',
    ]);
  });

  it('EVM-055 AC3 no issued milestone at all: an empty page, zero tiles and no longest overdue', async () => {
    await order([{ status: 'planned' }, { status: 'paid', amountMinor: 1000 }]);
    const { body } = await page(await signIn('editor'));
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
    const zero = { count: 0, total: { amountMinor: 0, currency: 'PLN' } };
    expect(body.summary).toEqual({ unpaid: zero, overdue: zero, longestOverdue: null, filtered: zero });
  });

  it('EVM-055 AC3 two milestones due the same day are ordered by their identifier, and the longest overdue is the order of the smaller one', async () => {
    const [a, b] = [await order([invoiced('2026-09-28', 100_000)]), await order([invoiced('2026-09-28', 200_000)])];
    const { body } = await page(await signIn('editor'));
    const expected = [a, b].sort((x, y) => (x.milestoneIds[0] ?? '').localeCompare(y.milestoneIds[0] ?? ''));
    expect(body.items.map((item) => item.workOrder.id)).toEqual(expected.map((one) => one.id));
    expect(body.summary.longestOverdue?.workOrder.id).toBe(expected[0]?.id);
    const small = await allPages(await signIn('editor'), '', 1);
    expect(small.flatMap((one) => one.items.map((item) => item.id))).toEqual(expected.map((one) => one.milestoneIds[0]));
  });
});

describe('the filters of the summary (EVM-055 AC4; SR-API-04)', () => {
  it('EVM-055 AC4 the filters combine with AND: overdue, a range of due days and a customer narrow the list, the count and the sum — the tiles stay', async () => {
    const { shared } = await seedStory();
    const reader = await signIn('editor');
    const overdue = await page(reader, 'view=overdue');
    expect(overdue.body.items.map((item) => item.dueDate)).toEqual(['2026-09-12', '2026-09-20', '2026-09-28', '2026-10-02']);
    expect(overdue.body.summary.filtered).toEqual({ count: 4, total: { amountMinor: 1_520_000, currency: 'PLN' } });
    expect(overdue.body.summary.unpaid.count).toBe(12);

    const range = await page(reader, 'view=overdue&dueFrom=2026-09-20&dueTo=2026-09-28');
    expect(range.body.items.map((item) => item.dueDate)).toEqual(['2026-09-20', '2026-09-28']);
    expect(range.body.summary.filtered.total.amountMinor).toBe(720_000);

    const customer = await page(reader, `view=overdue&customerId=${shared}`);
    expect(customer.body.items.map((item) => item.dueDate)).toEqual(['2026-09-20']);
    expect(customer.body.items[0]?.customer).toMatchObject({ id: shared });
    expect(JSON.stringify(customer.body.items[0]?.customer)).toContain('Wspólna');
    expect(customer.body.summary.filtered.count).toBe(1);
    expect(customer.body.summary.overdue.count).toBe(4);
  });

  it('EVM-055 AC4 a customer who does not exist, a deleted one and an unknown filter value give an empty list and no 404 — the same answer, so there is no oracle', async () => {
    const { shared } = await seedStory();
    const gone = await insertCustomer(admin(), { lastName: 'Usunięty', deletedAt: '2026-10-05T08:00:00Z' });
    await order([invoiced('2026-09-01', 100_000)], { customerId: gone });
    const reader = await signIn('read_only');
    const unfiltered = await page(reader);
    expect(unfiltered.body.summary.unpaid.count).toBe(13);
    for (const customerId of [randomUUID(), gone]) {
      const { status, body } = await page(reader, `customerId=${customerId}`);
      expect(status).toBe(200);
      expect(body.items).toEqual([]);
      expect(body.nextCursor).toBeNull();
      expect(body.summary.filtered).toEqual({ count: 0, total: { amountMinor: 0, currency: 'PLN' } });
      expect(body.summary.unpaid.count).toBe(13);
    }
    expect((await page(reader, `customerId=${shared}`)).body.items).toHaveLength(2);
  });

  it('EVM-055 AC1 the customer of an order whose customer was deleted is {deleted: true} — no identifier, no name; an order without a customer has null', async () => {
    const gone = await insertCustomer(admin(), { lastName: 'Usunięta-nazwa', deletedAt: '2026-10-05T08:00:00Z' });
    await order([invoiced('2026-09-01', 100_000)], { customerId: gone });
    await order([invoiced('2026-09-02', 100_000)]);
    const { body } = await page(await signIn('editor'));
    expect(body.items.map((item) => item.customer)).toEqual([{ deleted: true }, null]);
    expect(JSON.stringify(body)).not.toContain('Usunięta-nazwa');
    expect(JSON.stringify(body)).not.toContain(gone);
  });

  it('EVM-055 AC4 an invalid query is 400 and names the field and the code, never the value: view, days, a range turned round, customer, limit, cursor, an unknown and a repeated parameter', async () => {
    const reader = await signIn('editor');
    const bad = [
      ['view=to_invoice', 'validation_failed'],
      ['dueFrom=1999-12-31', 'validation_failed'],
      ['dueTo=2101-01-01', 'validation_failed'],
      ['dueFrom=2026-02-30', 'validation_failed'],
      ['dueFrom=2026-10-04&dueTo=2026-10-03', 'validation_failed'],
      ['customerId=not-a-uuid', 'validation_failed'],
      ['limit=0', 'validation_failed'],
      ['limit=101', 'validation_failed'],
      ['cursor=a%20b', 'validation_failed'],
      ['sort=-dueDate', 'unknown_parameter'],
      ['view=overdue&view=unpaid', 'duplicate_parameter'],
    ] as const;
    for (const [query, code] of bad) {
      const response = await reader.panel.get(`${LIST}?${query}`);
      expect(response.status, query).toBe(400);
      expect(codeOf(response.body), query).toBe(code);
      expect(JSON.stringify(response.body), query).not.toMatch(/1999-12-31|2101-01-01|2026-02-30|to_invoice|not-a-uuid/);
    }
  });
});

describe('the cursor of the summary (EVM-055 AC1, AC4; SR-API-04)', () => {
  it('EVM-055 AC4 a cursor that was changed, handed to another user, used with other filters or sealed for another operation is 400 invalid_cursor; a position that does not fit is too', async () => {
    for (const [due, amount] of DATASET.slice(0, 4)) await order([invoiced(due, amount)]);
    const owner = await signIn('editor');
    const { body } = await page(owner, 'limit=1');
    const cursor = body.nextCursor ?? '';
    expect(cursor).not.toBe('');
    expect((await page(owner, `limit=1&cursor=${cursor}`)).status).toBe(200);
    const tampered = `${cursor.slice(0, -2)}${cursor.endsWith('AA') ? 'BB' : 'AA'}`;
    const codec = current.app.get<CursorCodec>(CURSOR_CODEC, { strict: false });
    const scope = scopeOf(['unpaid', '', '', '']);
    const forged = (operation: string, position: string[], userId = owner.userId) => codec.seal(operation, { position, scope, userId });
    const cases: Array<[string, string]> = [
      ['a changed cursor', `limit=1&cursor=${tampered}`],
      ['other filters', `view=overdue&limit=1&cursor=${cursor}`],
      ['another operation', `limit=1&cursor=${forged('listWorkOrders', ['2026-10-03', '2026-09-12', randomUUID()])}`],
      ['not a day of asOf', `limit=1&cursor=${forged('listUnpaidPaymentMilestones', ['yesterday', '2026-09-12', randomUUID()])}`],
      ['a position that is not a day', `limit=1&cursor=${forged('listUnpaidPaymentMilestones', ['2026-10-03', 'soon', randomUUID()])}`],
      ['a position that is not an id', `limit=1&cursor=${forged('listUnpaidPaymentMilestones', ['2026-10-03', '2026-09-12', 'x'])}`],
      ['a position too short', `limit=1&cursor=${forged('listUnpaidPaymentMilestones', ['2026-10-03'])}`],
    ];
    for (const [label, query] of cases) {
      const response = await owner.panel.get(`${LIST}?${query}`);
      expect(response.status, label).toBe(400);
      expect(codeOf(response.body), label).toBe('invalid_cursor');
    }
    const other = await signIn('editor');
    const stolen = await other.panel.get(`${LIST}?limit=1&cursor=${cursor}`);
    expect(stolen.status).toBe(400);
    expect(codeOf(stolen.body)).toBe('invalid_cursor');
  });
});
