import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryBulkReadMeter } from '../../src/platform/bulk-read/bulk-read-meter.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { BULK_READ_METER, CLOCK, METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { MINUTE } from '../support/clock.ts';
import { clearCustomers, insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { clearSitesAndParties, insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

/**
 * EVM-072: `POST /api/v1/work-orders/search` on a real PostgreSQL — the phrase in the body, the three sources of the match
 * (the order, the customer, the site), the filters of the list, the cursor in the body, the read policy in the query, the limits.
 * Thresholds of the mass-read meter are lowered through the provider (an alert at 30 records, a block at 60 in 10 minutes).
 */
const SEARCH = '/api/v1/work-orders/search';
const LIST = '/api/v1/work-orders';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp({
    configure: (builder) =>
      builder.overrideProvider(BULK_READ_METER).useFactory({
        inject: [CLOCK],
        factory: (clock: { now(): Date }) => new InMemoryBulkReadMeter(clock, { alertAt: 30, blockAt: 60 }),
      }),
  });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await sql`delete from work_orders.work_order_assignments`.execute(current.database.admin);
  await sql`delete from work_orders.work_orders`.execute(current.database.admin);
  await clearCustomers(current.database.admin);
  await clearSitesAndParties(current.database.admin);
});

const admin = () => current.database.admin;

interface Item {
  id: string;
  number: string;
  title: string;
  status: string;
  customer?: { id: string; displayName: string } | { deleted: true } | null;
  site?: { id: string; city: string; street: string; buildingNumber: string } | null;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

/** A signed-in browser of a NEW user of the role (every user has their own search limit and mass-read window). */
async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;
const search = (browser: Browser, body: unknown) => browser.panel.post(SEARCH, body);
const found = async (browser: Browser, body: unknown): Promise<Page> => {
  const response = await search(browser, typeof body === 'string' ? { query: body } : body);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
};
const numbers = (page: Page): string[] => page.items.map((item) => item.number);
const problemOf = (response: { body: unknown }) =>
  response.body as { code: string; errors?: Array<{ pointer: string; code: string }>; detail?: string };

/** The scene of the story: ZL-2026-0042 of "Jan Przykładowy" in Łódź at "ul. Żółkiewskiego", titled "Garaż — pełny". */
async function scene() {
  const jan = await insertCustomer(admin(), { firstName: 'Jan', lastName: 'Przykładowy', city: 'Łódź' });
  const other = await insertCustomer(admin(), { firstName: 'Ewa', lastName: 'Testowa', phone: '+48600000002', city: 'Gdańsk' });
  const lodz = await insertSite(admin(), { street: 'ul. Żółkiewskiego', buildingNumber: '12', postalCode: '91-100', city: 'Łódź' });
  const gdansk = await insertSite(admin(), { street: 'ul. Długa', buildingNumber: '3', postalCode: '80-001', city: 'Gdańsk' });
  const ids = await insertWorkOrders(admin(), [
    { number: 'ZL-2026-0042', title: 'Garaż — pełny', customerId: jan, siteId: lodz },
    { number: 'ZL-2026-0043', title: 'Wallbox w domu', customerId: other, siteId: gdansk },
    { number: 'ZL-2026-0044', title: 'Przegląd instalacji' },
  ]);
  return { jan, other, lodz, gdansk, ids };
}

describe('search by a phrase (EVM-072 AC2; SR-API-04, SR-INPUT-03)', () => {
  it('EVM-072 AC2 "0042", "Garaż — pełny", "przykladowy", "zolkiewskiego" and "Lodz" each find ZL-2026-0042 — by its number, title, customer and address; case and Polish letters do not matter', async () => {
    await scene();
    const browser = await signIn();
    for (const phrase of [
      '0042',
      'Garaż — pełny',
      'GARAZ - PELNY',
      'przykladowy',
      'PRZYKŁADOWY',
      'zolkiewskiego',
      'Żółkiewskiego',
      'Lodz',
      'łódź',
    ]) {
      expect(numbers(await found(browser, phrase)), phrase).toEqual(['ZL-2026-0042']);
    }
    expect(numbers(await found(browser, 'nikt takiego'))).toEqual([]);
    expect(numbers(await found(browser, 'wallbox'))).toEqual(['ZL-2026-0043']);
  });

  it('EVM-072 AC2 a phrase that matches the customer of one order and the title of another gives both, once each, sorted like the list (number, newest first)', async () => {
    const jan = await insertCustomer(admin(), { lastName: 'Montażowy' });
    await insertWorkOrders(admin(), [
      { number: numberOf(2026, 1), title: 'Montażowy projekt' },
      { number: numberOf(2026, 2), customerId: jan },
      { number: numberOf(2026, 3), title: 'Inne' },
    ]);
    expect(numbers(await found(await signIn(), 'montażowy'))).toEqual([numberOf(2026, 2), numberOf(2026, 1)]);
  });

  it('EVM-072 AC1 each found item carries the customer {id, displayName} and the site {id, city, street, buildingNumber} — nothing more of the address — and the answer is not cached', async () => {
    const { jan, lodz } = await scene();
    const response = await search(await signIn('read_only'), { query: '0042' });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const [item] = (response.body as Page).items;
    expect(item).toMatchObject({
      number: 'ZL-2026-0042',
      title: 'Garaż — pełny',
      customer: { id: jan, displayName: 'Jan Przykładowy' },
      site: { id: lodz, city: 'Łódź', street: 'ul. Żółkiewskiego', buildingNumber: '12' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/91-100|postalCode|apartmentNumber|600000001/);
  });

  it('EVM-072 AC2 a phrase shorter than 3 characters is 400 too_short, a longer one than 100 too_long, a control character invalid_characters — pointer and code, never the phrase', async () => {
    const browser = await signIn();
    const cases: Array<[string, string]> = [
      ['ab', 'too_short'],
      ['  a  ', 'too_short'],
      ['', 'too_short'],
      ['x'.repeat(101), 'too_long'],
      ['ab\u0000cd', 'invalid_characters'],
      ['abc\u0007def', 'invalid_characters'],
      ['abc\u200Bdef', 'invalid_characters'],
    ];
    for (const [phrase, code] of cases) {
      const response = await search(browser, { query: phrase });
      expect([response.status, problemOf(response).code], code).toEqual([400, 'validation_failed']);
      expect(problemOf(response).errors, code).toEqual([{ pointer: '/query', code }]);
      expect(JSON.stringify(response.body)).not.toContain('abcdef');
    }
  });

  it('EVM-072 AC2 the body is strict: an unknown field is unknown_field, a missing phrase required, a wrong type invalid_type; an array or a string body is 400 (never a 500)', async () => {
    const browser = await signIn();
    const unknown = await search(browser, { query: 'wallbox', userId: randomUUID() });
    expect([unknown.status, problemOf(unknown).errors]).toEqual([400, [{ pointer: '/userId', code: 'unknown_field' }]]);
    const missing = await search(browser, { limit: 5 });
    expect(problemOf(missing).errors).toEqual([{ pointer: '/query', code: 'required' }]);
    const typed = await search(browser, { query: 12345 });
    expect(problemOf(typed).errors).toEqual([{ pointer: '/query', code: 'invalid_type' }]);
    for (const body of [[], 'wallbox', null, 7]) {
      expect((await search(browser, body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const bad of [
      { status: ['archived'] },
      { view: 'everything' },
      { sort: 'title' },
      { limit: 0 },
      { limit: 101 },
      { siteType: 'castle' },
      { templateId: 'x' },
    ]) {
      const response = await search(browser, { query: 'wallbox', ...bad });
      expect([response.status, problemOf(response).code], JSON.stringify(bad)).toEqual([400, 'validation_failed']);
      expect(JSON.stringify(response.body)).not.toMatch(/archived|everything|castle/);
    }
  });

  it('EVM-072 AC2 %, _ and \\ in the phrase match literally (SR-INPUT-03), and full-width look-alikes are not a pattern', async () => {
    await insertWorkOrders(admin(), [
      { number: numberOf(2026, 1), title: 'Rabat 50% na montaż' },
      { number: numberOf(2026, 2), title: 'Rabat 500 na montaż' },
      { number: numberOf(2026, 3), title: 'Linia_A' },
      { number: numberOf(2026, 4), title: 'LiniaXA' },
      { number: numberOf(2026, 5), title: 'Ścieżka c:\\kable' },
    ]);
    const browser = await signIn();
    expect(numbers(await found(browser, '50%'))).toEqual([numberOf(2026, 1)]);
    expect(numbers(await found(browser, 'linia_a'))).toEqual([numberOf(2026, 3)]);
    expect(numbers(await found(browser, 'c:\\kable'))).toEqual([numberOf(2026, 5)]);
    for (const phrase of ['％％％', '%%%', '___', '\\\\\\']) expect(numbers(await found(browser, phrase)), phrase).toEqual([]);
  });

  it('EVM-072 AC2 a search writes nothing: no audit event, no idempotency record', async () => {
    await scene();
    const events = async () => Number((await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin())).rows[0]?.n);
    const before = await events();
    await found(await signIn(), '0042');
    expect(await events()).toBe(before);
    const { rows } = await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin());
    expect(rows[0]?.n).toBe('0');
  });
});

describe('filters, the cursor in the body and the phrase that is not logged (EVM-072 AC2, AC3, AC4)', () => {
  it('EVM-072 AC3 the phrase combines with the filters of the list by AND: status, the view "mine", the coordinator, the customer', async () => {
    const browser = await signIn();
    const me = browser.userId;
    const other = await createUser(admin(), current.clock, { role: 'editor' });
    const jan = await insertCustomer(admin(), { lastName: 'Wspólny' });
    await insertWorkOrders(admin(), [
      { number: numberOf(2026, 1), title: 'Wallbox A', status: 'quoting', coordinatorId: me, customerId: jan },
      { number: numberOf(2026, 2), title: 'Wallbox B', status: 'new', coordinatorId: me },
      { number: numberOf(2026, 3), title: 'Wallbox C', status: 'new', coordinatorId: other.id, customerId: jan },
      { number: numberOf(2026, 4), title: 'Przegląd', status: 'new', coordinatorId: me },
    ]);
    expect(numbers(await found(browser, { query: 'wallbox', sort: 'number' }))).toEqual([
      numberOf(2026, 1),
      numberOf(2026, 2),
      numberOf(2026, 3),
    ]);
    expect(numbers(await found(browser, { query: 'wallbox', status: ['quoting'] }))).toEqual([numberOf(2026, 1)]);
    expect(numbers(await found(browser, { query: 'wallbox', status: ['new', 'new'], view: 'mine' }))).toEqual([numberOf(2026, 2)]);
    expect(numbers(await found(browser, { query: 'wallbox', coordinatorId: other.id }))).toEqual([numberOf(2026, 3)]);
    expect(numbers(await found(browser, { query: 'wspólny', customerId: jan, status: ['new'] }))).toEqual([numberOf(2026, 3)]);
    // the customer of the filter and the phrase are both required: a customer that does not match the phrase gives nothing
    expect(numbers(await found(browser, { query: 'przegląd', customerId: jan }))).toEqual([]);
  });

  it('EVM-072 AC4 siteType and templateId narrow the search (and are checked as codes and UUIDs)', async () => {
    const full =
      (await sql<{ id: string }>`select id from catalog.work_order_templates where code = 'garage_full_process'`.execute(admin())).rows[0]
        ?.id ?? '';
    const garage = await insertSite(admin(), { siteType: 'multi_family_garage' });
    const house = await insertSite(admin(), { siteType: 'single_family_house' });
    await insertWorkOrders(admin(), [
      { number: numberOf(2026, 1), title: 'Wallbox', siteId: garage, sourceTemplateId: full },
      { number: numberOf(2026, 2), title: 'Wallbox', siteId: house, sourceTemplateId: full },
      { number: numberOf(2026, 3), title: 'Wallbox', siteId: garage },
    ]);
    const browser = await signIn();
    const query = async (extra: Record<string, unknown>) => numbers(await found(browser, { query: 'wallbox', sort: 'number', ...extra }));
    expect(await query({ siteType: 'multi_family_garage' })).toEqual([numberOf(2026, 1), numberOf(2026, 3)]);
    expect(await query({ templateId: full })).toEqual([numberOf(2026, 1), numberOf(2026, 2)]);
    expect(await query({ siteType: 'multi_family_garage', templateId: full })).toEqual([numberOf(2026, 1)]);
  });

  it('EVM-072 AC3 the cursor is in the body: the next page continues the same search and the last one has nextCursor null; with no duplicates and no gaps', async () => {
    await insertWorkOrders(
      admin(),
      Array.from({ length: 7 }, (_, index) => ({ number: numberOf(2026, index + 1), title: `Wallbox ${index + 1}` })),
    );
    const browser = await signIn();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Page = await found(browser, { query: 'wallbox', limit: 3, ...(cursor === null ? {} : { cursor }) });
      seen.push(...numbers(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(seen).toEqual(Array.from({ length: 7 }, (_, index) => numberOf(2026, 7 - index)));
  });

  it('EVM-072 AC3 a cursor of another phrase, of another user, of other filters, of the list (and the other way round) or an expired one is 400 invalid_cursor — one answer', async () => {
    await insertWorkOrders(
      admin(),
      Array.from({ length: 6 }, (_, index) => ({ number: numberOf(2026, index + 1), title: `Wallbox ${index + 1}` })),
    );
    const browser = await signIn();
    const intruder = await signIn();
    const first = await found(browser, { query: 'wallbox', limit: 2 });
    const cursor = first.nextCursor ?? '';
    expect(cursor).not.toBe('');
    // the phrase is never inside the cursor, not even encoded
    expect(Buffer.from(cursor, 'base64url').toString('latin1')).not.toMatch(/wallbox/i);
    const refusals: Array<[string, Browser, unknown]> = [
      ['another phrase', browser, { query: 'wallbo', limit: 2, cursor }],
      ['another user', intruder, { query: 'wallbox', limit: 2, cursor }],
      ['other filters', browser, { query: 'wallbox', limit: 2, cursor, status: ['new'] }],
      ['garbage', browser, { query: 'wallbox', limit: 2, cursor: 'abcdefghijklmnop' }],
    ];
    for (const [label, who, body] of refusals) {
      const response = await search(who, body);
      expect([label, response.status, problemOf(response).code]).toEqual([label, 400, 'invalid_cursor']);
    }
    // a cursor of the list is no cursor of the search, and a cursor of the search is no cursor of the list
    const listPage = await browser.panel.get(`${LIST}?limit=2`);
    const listCursor = (listPage.body as Page).nextCursor ?? '';
    expect(listCursor).not.toBe('');
    const crossed = await search(browser, { query: 'wallbox', limit: 2, cursor: listCursor });
    expect([crossed.status, problemOf(crossed).code]).toEqual([400, 'invalid_cursor']);
    const back = await browser.panel.get(`${LIST}?limit=2&cursor=${cursor}`);
    expect([back.status, problemOf(back).code]).toEqual([400, 'invalid_cursor']);
    // the cursor is good for 30 minutes
    expect((await search(browser, { query: 'wallbox', limit: 2, cursor })).status).toBe(200);
    current.clock.advance(31 * MINUTE);
    const expired = await search(browser, { query: 'wallbox', limit: 2, cursor });
    expect([expired.status, problemOf(expired).code]).toEqual([400, 'invalid_cursor']);
  });

  it('EVM-072 AC2 the phrase is in no log line, no metric and no error of any answer — 200, 400, 429 — and not in the URL of the request', async () => {
    await scene();
    const browser = await signIn();
    const secret = 'przykladowy';
    const secretShort = 'zx'; // a 400 too_short
    const before = current.logs.lines.length;
    expect((await search(browser, { query: secret })).status).toBe(200);
    expect((await search(browser, { query: secretShort })).status).toBe(400);
    expect((await search(browser, { query: secret, status: ['archived'] })).status).toBe(400);
    // fill the bucket to see the 429 as well
    for (let index = 0; index < 58; index += 1) await search(browser, { query: secret });
    const limited = await search(browser, { query: secret });
    expect(limited.status).toBe(429);
    const lines = current.logs.lines.slice(before).join('\n').toLowerCase();
    expect(lines).not.toContain(secret);
    expect(lines).not.toContain(secretShort);
    expect(lines).not.toContain('archived');
    const metrics = JSON.stringify(current.app.get<MetricsRegistry>(METRICS, { strict: false }).snapshot()).toLowerCase();
    expect(metrics).not.toContain(secret);
    expect(JSON.stringify(limited.body).toLowerCase()).not.toContain(secret);
  });
});

describe('the read policy is in the query (EVM-072 AC5; SR-AUTHZ-03, ADR-0017 W2, TM-18)', () => {
  it('EVM-072 AC5 a deleted order is not found by its number, title, customer or address — for every role', async () => {
    const jan = await insertCustomer(admin(), { lastName: 'Zdarzeniowy', city: 'Opole' });
    const site = await insertSite(admin(), { street: 'ul. Zdarzeń', city: 'Opole' });
    await insertWorkOrders(admin(), [
      { number: 'ZL-2026-0900', title: 'Zdarzenie usunięte', customerId: jan, siteId: site, deletedAt: new Date('2026-10-02T08:00:00Z') },
      { number: 'ZL-2026-0901', title: 'Zdarzenie aktywne' },
    ]);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      for (const phrase of ['0900', 'usunięte', 'zdarzeniowy', 'ul. zdarzeń', 'opole']) {
        expect(numbers(await found(browser, phrase)), `${role} ${phrase}`).toEqual([]);
      }
      expect(numbers(await found(browser, 'zdarzenie')), role).toEqual(['ZL-2026-0901']);
    }
  });

  it('EVM-072 AC5 a deleted customer is not found by name (TM-18) but the order is found by its number, and its item has {deleted: true} — no name, no UUID; the site stays', async () => {
    const gone = await insertCustomer(admin(), { lastName: 'Widmowski', deletedAt: '2026-10-05T08:00:00Z' });
    const site = await insertSite(admin(), { street: 'ul. Widmowa', buildingNumber: '5', city: 'Kielce' });
    await insertWorkOrders(admin(), [{ number: 'ZL-2026-0777', title: 'Przegląd', customerId: gone, siteId: site }]);
    for (const role of ['editor', 'read_only'] as const) {
      const browser = await signIn(role);
      expect(numbers(await found(browser, 'widmowski')), role).toEqual([]);
      const byNumber = await found(browser, '0777');
      expect(numbers(byNumber), role).toEqual(['ZL-2026-0777']);
      const [item] = byNumber.items;
      expect(item?.customer).toEqual({ deleted: true });
      expect(item?.site).toMatchObject({ city: 'Kielce', street: 'ul. Widmowa', buildingNumber: '5' });
      expect(JSON.stringify(byNumber)).not.toMatch(new RegExp(`Widmowski|${gone}`));
      // the address still finds it
      expect(numbers(await found(browser, 'widmowa'))).toEqual(['ZL-2026-0777']);
    }
  });

  it('EVM-072 AC5 a deleted site is not found by address: the order is found by number and its site is null', async () => {
    const site = await insertSite(admin(), { street: 'ul. Znikająca', city: 'Płock', deletedAt: '2026-10-05T08:00:00Z' });
    await insertWorkOrders(admin(), [{ number: 'ZL-2026-0778', title: 'Przegląd', siteId: site }]);
    const browser = await signIn();
    expect(numbers(await found(browser, 'znikająca'))).toEqual([]);
    const [item] = (await found(browser, '0778')).items;
    expect(item?.site).toBeNull();
  });

  it('EVM-072 AC7 the customerId of an unknown customer is an empty page, not an error that tells whether it exists (IDOR); a deleted customer is not named', async () => {
    const gone = await insertCustomer(admin(), { lastName: 'Skasowany', deletedAt: '2026-10-05T08:00:00Z' });
    await insertWorkOrders(admin(), [{ number: numberOf(2026, 1), title: 'Wallbox', customerId: gone }]);
    const browser = await signIn();
    expect(await found(browser, { query: 'wallbox', customerId: randomUUID() })).toEqual({ items: [], nextCursor: null });
    // the filter is not a check of existence (as in the list): the order of a deleted customer is listed, and names nobody
    const [item] = (await found(browser, { query: 'wallbox', customerId: gone })).items;
    expect(item?.customer).toEqual({ deleted: true });
  });
});

describe('the roles and the channel (EVM-072 AC7; SR-AUTHZ-05)', () => {
  it('EVM-072 AC7 Administrator, Editor and Read-only get results; nobody signed in is 401; a mobile session is 403; no CSRF token is 403 csrf_failed', async () => {
    await scene();
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      expect(numbers(await found(await signIn(role), '0042')), role).toEqual(['ZL-2026-0042']);
    }
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const refused = await anonymous.post(SEARCH, { query: '0042' });
    expect([refused.status, problemOf(refused).code]).toEqual([401, 'unauthenticated']);
    expect((await anonymous.post(SEARCH, { zly: 1 })).status).toBe(401);
    for (const role of ['administrator', 'editor'] as const) {
      const mobile = await signIn(role, 'mobile');
      const response = await search(mobile, { query: '0042' });
      expect([response.status, problemOf(response).code], role).toEqual([403, 'forbidden']);
    }
    const noToken = await signIn();
    noToken.panel.csrfToken = undefined;
    const csrf = await search(noToken, { query: '0042' });
    expect([csrf.status, problemOf(csrf).code]).toEqual([403, 'csrf_failed']);
  });
});

describe('the limit of searches and mass read (EVM-072 AC5; SR-API-02, P10, CWE-770)', () => {
  it('EVM-072 AC5 60 searches in a minute pass, the 61st is 429 rate_limited with Retry-After; another user is not affected; the next minute passes', async () => {
    // a phrase that matches nothing: the records of P10 are not what is tested here (they have a test of their own)
    const heavy = await signIn();
    const other = await signIn();
    for (let index = 0; index < 60; index += 1)
      expect((await search(heavy, { query: 'brak takiej frazy' })).status, `search ${index + 1}`).toBe(200);
    const refused = await search(heavy, { query: 'brak takiej frazy' });
    expect(refused.status).toBe(429);
    expect(problemOf(refused).code).toBe('rate_limited');
    expect(refused.headers['retry-after']).toMatch(/^[1-9][0-9]*$/);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await search(other, { query: 'brak takiej frazy' })).status).toBe(200);
    current.clock.advance(MINUTE);
    expect((await search(heavy, { query: 'brak takiej frazy' })).status).toBe(200);
    const sample = current.app
      .get<MetricsRegistry>(METRICS, { strict: false })
      .snapshot()
      .find((entry) => entry.name === 'work_order_search_rate_limited');
    expect(sample?.value).toBeGreaterThanOrEqual(1);
  });

  it('EVM-072 AC5 every authorised search counts, one refused by the validation too: the limit comes BEFORE the validation', async () => {
    const browser = await signIn();
    for (let index = 0; index < 60; index += 1) expect((await search(browser, { query: 'ab' })).status).toBe(400);
    expect((await search(browser, { query: 'ab' })).status).toBe(429);
  });

  it('EVM-072 AC5 the records of a search count towards P10: past the alert threshold ONE alert without the phrase, past the block 429 with Retry-After; a refused request counts nothing', async () => {
    await insertWorkOrders(
      admin(),
      Array.from({ length: 40 }, (_, index) => ({ number: numberOf(2026, index + 1), title: `Wspólny tytuł ${index + 1}` })),
    );
    const browser = await signIn();
    const alerts = () => current.logs.entries.filter((entry) => entry['alert'] === 'security' && entry['alertCode'] === 'bulk_read');
    const before = alerts().length;
    const page = { query: 'wspólny tytuł', limit: 25 };
    expect((await search(browser, page)).status).toBe(200); // 25
    expect((await search(browser, page)).status).toBe(200); // 50, over the alert threshold of 30
    expect(alerts().length).toBe(before);
    expect((await search(browser, page)).status).toBe(200); // 75: the next read raises the alert (the answer is still given)
    expect(alerts().length).toBe(before + 1);
    expect(JSON.stringify(alerts().slice(before))).not.toMatch(/wspólny|tytu/i);
    const blocked = await search(browser, page);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toMatch(/^[1-9][0-9]*$/);
    // the list of the same user is blocked too: ONE meter for the user, whatever the operation
    expect((await browser.panel.get(`${LIST}?limit=25`)).status).toBe(429);
    current.clock.advance(10 * MINUTE);
    expect((await search(browser, page)).status).toBe(200);
  });

  it('EVM-072 AC5 an invalid search is 400 and counts nothing: after it the same user is still served', async () => {
    await insertWorkOrders(admin(), [{ number: numberOf(2026, 1), title: 'Wallbox' }]);
    const browser = await signIn();
    for (let index = 0; index < 5; index += 1) expect((await search(browser, { query: 'ab' })).status).toBe(400);
    expect(numbers(await found(browser, 'wallbox'))).toEqual([numberOf(2026, 1)]);
  });
});
