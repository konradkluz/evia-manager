import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryBulkReadMeter } from '../../src/platform/bulk-read/bulk-read-meter.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { BULK_READ_METER, CLOCK, METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { MINUTE } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones } from '../support/payment-fixtures.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const LIST = '/api/v1/payment-milestones';

async function newUser(app: IdentityApp) {
  const user = await createUser(app.database.admin, app.clock, { role: 'read_only' });
  const session = await createSession(app.database.admin, app.clock, user);
  const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, read: (query = '') => panel.get(`${LIST}${query}`) };
}
const securityAlerts = (app: IdentityApp) => app.logs.entries.filter((entry) => entry['alert'] === 'security');
const counters = (app: IdentityApp) =>
  Object.fromEntries(
    app.app
      .get<MetricsRegistry>(METRICS, { strict: false })
      .snapshot()
      .filter((sample) => sample.name.startsWith('bulk_read'))
      .map((sample) => [sample.name, sample.value]),
  );
const auditOf = async (app: IdentityApp, userId: string) =>
  (
    await sql<{ action: string; object_type: string }>`
      select action, object_type from audit.events where actor_user_id = ${userId} order by occurred_at, id`.execute(app.database.admin)
  ).rows.map((row) => `${row.action}:${row.object_type}`);
const codeOf = (response: { body: unknown }) => (response.body as { code: string }).code;

async function seedOrders(app: IdentityApp, count: number, withCustomers: boolean) {
  const specs = [];
  for (let index = 0; index < count; index += 1) {
    const customerId = withCustomers
      ? await insertCustomer(app.database.admin, { lastName: `Masowy${String(index).padStart(3, '0')}` })
      : undefined;
    specs.push({ number: `ZL-2026-${String(index + 1).padStart(4, '0')}`, ...(customerId === undefined ? {} : { customerId }) });
  }
  const ids = await insertWorkOrders(app.database.admin, specs);
  for (const id of ids.values()) await insertMilestones(app.database.admin, id, [{ status: 'invoiced', dueDate: '2026-09-20' }]);
}

describe('the records of the summary count towards mass read (EVM-055 AC6; SR-API-02, SR-LOG-06, P10, RR-13)', () => {
  let app: IdentityApp;
  beforeAll(async () => {
    // thresholds lowered through the provider (not the environment): an alert at 15 records, a block at 30, in 10 minutes
    app = await createIdentityApp({
      configure: (builder) =>
        builder.overrideProvider(BULK_READ_METER).useFactory({
          inject: [CLOCK],
          factory: (clock: { now(): Date }) => new InMemoryBulkReadMeter(clock, { alertAt: 15, blockAt: 30 }),
        }),
    });
    await clearWorkOrderCreation(app.database.admin);
    await seedOrders(app, 12, false);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    app.clock.advance(11 * MINUTE); // every test starts in a window of its own
  });

  it('EVM-055 AC6 the records of every page are counted: past the alert threshold ONE alert without personal data, past the block 429 with Retry-After — audited as a read of payment milestones', async () => {
    const user = await newUser(app);
    const alerts = securityAlerts(app).length;
    const rejected = counters(app)['bulk_read_rejected'] ?? 0;
    expect((await user.read()).status).toBe(200); // 12 records
    expect((await user.read()).status).toBe(200); // 24: over the alert threshold
    expect(securityAlerts(app).length).toBe(alerts); // the alert is raised by the NEXT read
    expect((await user.read()).status).toBe(200); // 36: the alert; the answer is still given
    const raised = securityAlerts(app).slice(alerts);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ alert: 'security', alertCode: 'bulk_read', level: 'error' });
    const serialised = JSON.stringify(raised);
    for (const forbidden of [user.userId, 'FV/', 'ZL-2026']) expect(serialised.includes(forbidden), forbidden).toBe(false);

    const blocked = await user.read();
    expect(blocked.status).toBe(429);
    expect(codeOf(blocked)).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(JSON.stringify(blocked.body)).not.toMatch(/FV\/|ZL-2026|Transza/);
    expect(counters(app)['bulk_read_rejected']).toBe(rejected + 1);
    expect(await auditOf(app, user.userId)).toEqual(['bulk_read.alerted:payment_milestone', 'bulk_read.rejected:payment_milestone']);

    app.clock.advance(10 * MINUTE);
    expect((await user.read()).status).toBe(200); // the window moved on
  });

  it('EVM-055 AC6 the order is validation, meter, query, record: an invalid query never reaches the meter and a refused request counts nothing; another user is not affected', async () => {
    const heavy = await newUser(app);
    for (let index = 0; index < 3; index += 1) expect((await heavy.read()).status).toBe(200);
    expect((await heavy.read()).status).toBe(429);
    const rejected = counters(app)['bulk_read_rejected'];

    const invalid = await heavy.read('?limit=0');
    expect(invalid.status).toBe(400); // validation answers before the meter would say 429
    expect(counters(app)['bulk_read_rejected']).toBe(rejected);

    const other = await newUser(app);
    expect((await other.read('?limit=1')).status).toBe(200); // 1 record
    expect((await other.read('?limit=1')).status).toBe(200);
  });

  it('EVM-055 AC6 only the records of the page count, not the sum of the whole list: pages of 1 do not trip the meter that a full page of 12 would', async () => {
    const user = await newUser(app);
    for (let index = 0; index < 15; index += 1) expect((await user.read('?limit=1')).status).toBe(200); // 15 records
    expect((await user.read('?limit=1')).status).toBe(200); // the alert is raised by this read
    expect(await auditOf(app, user.userId)).toEqual(['bulk_read.alerted:payment_milestone']);
  });
});

describe('300 different customers in an hour on the summary (EVM-055 AC6; SR-API-02, SR-LOG-06, SR-LOG-07, P10)', () => {
  let app: IdentityApp;
  beforeAll(async () => {
    app = await createIdentityApp();
    await clearWorkOrderCreation(app.database.admin);
    await seedOrders(app, 305, true);
  });
  afterAll(async () => {
    await app.close();
  });

  it('EVM-055 AC6 the customers named by the pages feed the counter of different customers: 300 are quiet, the 301st raises ONE alert — without a name or an identifier', async () => {
    const user = await newUser(app);
    const read = async (cursor?: string) => {
      const response = await user.read(`?limit=100${cursor === undefined ? '' : `&cursor=${cursor}`}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return response.body as { items: unknown[]; nextCursor: string | null };
    };
    const before = securityAlerts(app).length;
    const first = await read();
    const second = await read(first.nextCursor ?? '');
    const third = await read(second.nextCursor ?? '');
    expect([first.items.length, second.items.length, third.items.length]).toEqual([100, 100, 100]);
    expect(securityAlerts(app).length).toBe(before); // 300 different customers: not yet
    const fourth = await read(third.nextCursor ?? '');
    expect(fourth.items.length).toBe(5);
    const raised = securityAlerts(app).slice(before);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ alert: 'security', alertCode: 'bulk_read_customers' });
    expect(JSON.stringify(raised)).not.toMatch(/Masowy|ZL-2026/);
    expect(await auditOf(app, user.userId)).toEqual(['bulk_read.alerted:customer']);
  });
});
