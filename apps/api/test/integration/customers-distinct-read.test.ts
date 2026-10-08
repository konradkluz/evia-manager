import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryBulkReadMeter } from '../../src/platform/bulk-read/bulk-read-meter.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { BULK_READ_METER, CLOCK, METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { MINUTE } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type UserFixture } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';

const LIST = '/api/v1/customers';
const SEARCH = '/api/v1/customers/search';

interface Page {
  items: Array<{ id: string; displayName: string }>;
  nextCursor: string | null;
}

/** Customers `<prefix>001…` written straight into the database (ids UUIDv7-shaped, in a block of their own per prefix). */
let block = 0;
async function seed(app: IdentityApp, prefix: string, count: number): Promise<string[]> {
  block += 1;
  const { rows } = await sql<{ id: string }>`
    insert into customers.customers (id, kind, first_name, last_name, phone, created_at, updated_at)
    select ('0198b0a0-0000-7000-8000-' || lpad(to_hex(${block} * 100000 + n), 12, '0'))::uuid, 'person', 'Seria',
           ${prefix}::text || lpad(n::text, 3, '0'), '+48600000001', now(), now()
    from generate_series(1, ${count}::int) as n
    returning id`.execute(app.database.admin);
  return rows.map((row) => row.id);
}

async function newUser(app: IdentityApp) {
  const user = await createUser(app.database.admin, app.clock, { role: 'editor' });
  const browser = async (u: UserFixture = user) => {
    const session = await createSession(app.database.admin, app.clock, u);
    const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
    panel.cookie = session.cookie;
    panel.csrfToken = session.csrfToken;
    return panel;
  };
  return { userId: user.id, browser, panel: await browser() };
}
type Reader = Awaited<ReturnType<typeof newUser>>;

const securityAlerts = (app: IdentityApp) => app.logs.entries.filter((entry) => entry['alert'] === 'security');
const auditOf = async (app: IdentityApp, userId: string) =>
  (
    await sql<{ action: string; object_type: string }>`
      select action, object_type from audit.events where actor_user_id = ${userId} order by occurred_at, id`.execute(app.database.admin)
  ).rows.map((row) => `${row.action}:${row.object_type}`);
const counters = (app: IdentityApp) =>
  Object.fromEntries(
    app.app
      .get<MetricsRegistry>(METRICS, { strict: false })
      .snapshot()
      .filter((sample) => sample.name.startsWith('bulk_read'))
      .map((sample) => [sample.name, sample.value]),
  );

/** Reads pages of the list of `limit` customers from a cursor; returns the page (the test asserts the status itself). */
async function listPage(reader: Reader, limit: number, cursor?: string, panel = reader.panel): Promise<Page> {
  const response = await panel.get(`${LIST}?limit=${limit}${cursor === undefined ? '' : `&cursor=${cursor}`}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
}

describe('300 different customers in an hour (EVM-039 AC5; SR-API-02, SR-LOG-06, SR-LOG-07, P10, RR-13)', () => {
  let app: IdentityApp;
  let groups: Record<'a' | 'b' | 'c' | 'd', string[]>;
  beforeAll(async () => {
    app = await createIdentityApp();
    groups = {
      a: await seed(app, 'Aaa', 100),
      b: await seed(app, 'Bbb', 100),
      c: await seed(app, 'Ccc', 100),
      d: await seed(app, 'Ddd', 10),
    };
  });
  afterAll(async () => {
    await app.close();
  });

  it('EVM-039 AC5 300 different customers read (list) raise no alert; the 301st (the detail) raises ONE security alert without personal data, audited as bulk_read.alerted for customers', async () => {
    const reader = await newUser(app);
    const alertsBefore = securityAlerts(app).length;
    const first = await listPage(reader, 100);
    const second = await listPage(reader, 100, first.nextCursor ?? '');
    await listPage(reader, 100, second.nextCursor ?? '');
    expect(securityAlerts(app).length).toBe(alertsBefore);

    const detail = await reader.panel.get(`${LIST}/${groups.d[0]}`);
    expect(detail.status).toBe(200);
    const alerts = securityAlerts(app).slice(alertsBefore);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ alert: 'security', alertCode: 'bulk_read_customers', level: 'error' });
    expect(String(alerts[0]?.['traceId'])).toMatch(/^[0-9a-f]{32}$/);
    const serialised = JSON.stringify(alerts);
    for (const forbidden of [reader.userId, groups.d[0] ?? '', 'Seria', 'Ddd001', '+48600000001'])
      expect(serialised.includes(forbidden), forbidden).toBe(false);
    expect(await auditOf(app, reader.userId)).toEqual(['bulk_read.alerted:customer']);

    // the same window: more customers, no second alert
    expect((await reader.panel.get(`${LIST}/${groups.d[1]}`)).status).toBe(200);
    expect(securityAlerts(app).length).toBe(alertsBefore + 1);
    expect(await auditOf(app, reader.userId)).toEqual(['bulk_read.alerted:customer']);
  });

  it('EVM-039 AC5 the window slides: an hour later the old customers no longer count, 300 again is quiet and the 301st alerts again', async () => {
    const reader = await newUser(app);
    const alertsBefore = securityAlerts(app).length;
    const walk = async (panel: PanelClient) => {
      let cursor: string | undefined;
      for (let index = 0; index < 3; index += 1) cursor = (await listPage(reader, 100, cursor, panel)).nextCursor ?? undefined;
    };
    await walk(reader.panel);
    expect((await reader.panel.get(`${LIST}/${groups.d[2]}`)).status).toBe(200);
    expect(securityAlerts(app).length).toBe(alertsBefore + 1);

    app.clock.advance(61 * MINUTE);
    const later = await reader.browser();
    await walk(later);
    expect(securityAlerts(app).length).toBe(alertsBefore + 1); // 300 different customers in the new window
    expect((await later.get(`${LIST}/${groups.d[3]}`)).status).toBe(200);
    expect(securityAlerts(app).length).toBe(alertsBefore + 2);
  });

  it('EVM-039 AC5 the list, the search and the detail all count: 100 + 100 + 100 different customers are quiet, the 301st is the alert', async () => {
    const reader = await newUser(app);
    const alertsBefore = securityAlerts(app).length;
    await listPage(reader, 100); // Aaa001 … Aaa100
    const search = await reader.panel.post(SEARCH, { query: 'Bbb', limit: 100 });
    expect((search.body as Page).items).toHaveLength(100);
    for (const id of groups.c) expect((await reader.panel.get(`${LIST}/${id}`)).status).toBe(200);
    expect(securityAlerts(app).length).toBe(alertsBefore);
    expect((await reader.panel.post(SEARCH, { query: 'Ddd001' })).status).toBe(200);
    expect(securityAlerts(app).length).toBe(alertsBefore + 1);
  });

  it('EVM-039 AC5 the SAME customers read again are not different ones: any number of reads of 300 customers stays quiet', async () => {
    const reader = await newUser(app);
    const alertsBefore = securityAlerts(app).length;
    for (let round = 0; round < 2; round += 1) {
      let cursor: string | undefined;
      for (let index = 0; index < 3; index += 1) cursor = (await listPage(reader, 100, cursor)).nextCursor ?? undefined;
    }
    expect(securityAlerts(app).length).toBe(alertsBefore);
  });

  it('EVM-039 AC5 the count is per USER, not per session: pages read in two sessions of one user add up to the 301st customer', async () => {
    const reader = await newUser(app);
    const second = await reader.browser();
    const alertsBefore = securityAlerts(app).length;
    const p1 = await listPage(reader, 100);
    const p2 = await listPage(reader, 100, p1.nextCursor ?? '', second);
    const p3 = await listPage(reader, 100, p2.nextCursor ?? '');
    expect(securityAlerts(app).length).toBe(alertsBefore);
    await listPage(reader, 100, p3.nextCursor ?? '', second); // the fourth page: ten more customers
    expect(securityAlerts(app).length).toBe(alertsBefore + 1);
    expect(await auditOf(app, reader.userId)).toEqual(['bulk_read.alerted:customer']);
  });

  it('EVM-039 AC5 a customer who is missing or deleted, a bad identifier and a bad cursor count nothing', async () => {
    const reader = await newUser(app);
    const alertsBefore = securityAlerts(app).length;
    let cursor: string | undefined;
    for (let index = 0; index < 3; index += 1) cursor = (await listPage(reader, 100, cursor)).nextCursor ?? undefined;
    const deleted = await insertCustomer(app.database.admin, { lastName: 'Usuniety', deletedAt: '2026-10-02T08:00:00Z' });
    expect((await reader.panel.get(`${LIST}/${deleted}`)).status).toBe(404);
    expect((await reader.panel.get(`${LIST}/0198b0a0-0000-7000-8000-0000000000ff`)).status).toBe(404);
    expect((await reader.panel.get(`${LIST}/nie-uuid`)).status).toBe(400);
    expect((await reader.panel.get(`${LIST}?cursor=garbage`)).status).toBe(400);
    expect((await reader.panel.post(SEARCH, { query: 'ab' })).status).toBe(400);
    expect(securityAlerts(app).length).toBe(alertsBefore); // still 300 different customers
    expect(await auditOf(app, reader.userId)).toEqual([]);
  });

  it('EVM-039 AC5 the card "Klient" of a work order (getWorkOrderCustomer) counts too: the 301st customer read through W-06 alerts; a card that is 404 counts nothing', async () => {
    const reader = await newUser(app);
    const alertsBefore = securityAlerts(app).length;
    let cursor: string | undefined;
    for (let index = 0; index < 3; index += 1) cursor = (await listPage(reader, 100, cursor)).nextCursor ?? undefined;
    const deleted = await insertCustomer(app.database.admin, { lastName: 'KartaUsunieta', deletedAt: '2026-10-02T08:00:00Z' });
    const orders = await insertWorkOrders(app.database.admin, [
      { number: 'ZL-2026-9001', customerId: groups.d[4] ?? '' },
      { number: 'ZL-2026-9002', customerId: deleted },
    ]);
    const [good, orphan] = [orders.get('ZL-2026-9001'), orders.get('ZL-2026-9002')];
    expect((await reader.panel.get(`/api/v1/work-orders/${orphan}/customer`)).status).toBe(404);
    expect(securityAlerts(app).length).toBe(alertsBefore);
    const card = await reader.panel.get(`/api/v1/work-orders/${good}/customer`);
    expect(card.status).toBe(200);
    expect(securityAlerts(app).length).toBe(alertsBefore + 1);
    expect(JSON.stringify(securityAlerts(app).slice(alertsBefore))).not.toMatch(/Ddd005|Seria|600000001/);
    expect(await auditOf(app, reader.userId)).toEqual(['bulk_read.alerted:customer']);
  });
});

describe('the records of the customers count towards the mass-read block (EVM-039 AC5; SR-API-02, P10)', () => {
  let app: IdentityApp;
  let ids: string[];
  beforeAll(async () => {
    // thresholds lowered through the provider (not the environment): an alert at 4 records, a block at 6, in 10 minutes
    app = await createIdentityApp({
      configure: (builder) =>
        builder.overrideProvider(BULK_READ_METER).useFactory({
          inject: [CLOCK],
          factory: (clock: { now(): Date }) => new InMemoryBulkReadMeter(clock, { alertAt: 4, blockAt: 6 }),
        }),
    });
    ids = await seed(app, 'Rec', 12);
  });
  afterAll(async () => {
    await app.close();
  });

  it('EVM-039 AC5 each detail is one record: past the block the detail is 429 rate_limited with Retry-After, audited once as bulk_read.rejected for customers; a missing customer counted nothing', async () => {
    const reader = await newUser(app);
    for (let index = 0; index < 5; index += 1)
      expect((await reader.panel.get(`${LIST}/0198b0a0-0000-7000-8000-0000000000ff`)).status).toBe(404);
    for (let index = 0; index < 6; index += 1) expect((await reader.panel.get(`${LIST}/${ids[index]}`)).status, String(index)).toBe(200);
    const counted = counters(app)['bulk_read_rejected'] ?? 0;
    const blocked = await reader.panel.get(`${LIST}/${ids[6]}`);
    expect(blocked.status).toBe(429);
    expect((blocked.body as { code: string }).code).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBe(600);
    expect(JSON.stringify(blocked.body)).not.toMatch(/Rec0|Seria/);
    expect(counters(app)['bulk_read_rejected']).toBe(counted + 1);
    expect((await reader.panel.get(`${LIST}/${ids[7]}`)).status).toBe(429);
    expect(await auditOf(app, reader.userId)).toEqual(['bulk_read.alerted:customer', 'bulk_read.rejected:customer']);
    app.clock.advance(10 * MINUTE);
    const later = await reader.browser();
    expect((await later.get(`${LIST}/${ids[6]}`)).status).toBe(200);
  });

  it('EVM-039 AC5 the list counts its items as records: a page of 6 customers reaches the block and the next list request is 429', async () => {
    const reader = await newUser(app);
    await listPage(reader, 6);
    const blocked = await reader.panel.get(`${LIST}?limit=1`);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBe(600);
  });
});
