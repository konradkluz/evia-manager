import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryBulkReadMeter } from '../../src/platform/bulk-read/bulk-read-meter.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { BULK_READ_METER, CLOCK, METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { MINUTE } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';

const SEARCH = '/api/v1/customers/search';

let app: IdentityApp;
beforeAll(async () => {
  // thresholds lowered through the provider (not the environment): an alert at 30 records, a block at 60, in 10 minutes
  app = await createIdentityApp({
    configure: (builder) =>
      builder.overrideProvider(BULK_READ_METER).useFactory({
        inject: [CLOCK],
        factory: (clock: { now(): Date }) => new InMemoryBulkReadMeter(clock, { alertAt: 30, blockAt: 60 }),
      }),
  });
  for (let index = 0; index < 30; index += 1) {
    await insertCustomer(app.database.admin, { firstName: 'Masowy', lastName: `Klient${String(index).padStart(2, '0')}` });
  }
});
afterAll(async () => {
  await app.close();
});

async function newUser() {
  const user = await createUser(app.database.admin, app.clock, { role: 'editor' });
  const session = await createSession(app.database.admin, app.clock, user);
  const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, search: (query: string) => panel.post(SEARCH, { query }) };
}
const securityAlerts = () => app.logs.entries.filter((entry) => entry['alert'] === 'security');
const counters = () =>
  Object.fromEntries(
    app.app
      .get<MetricsRegistry>(METRICS, { strict: false })
      .snapshot()
      .filter((sample) => sample.name.startsWith('bulk_read'))
      .map((sample) => [sample.name, sample.value]),
  );
const codeOf = (response: { body: unknown }) => (response.body as { code: string }).code;

describe('the results of a search count towards mass read (EVM-020 AC6; SR-API-02, SR-LOG-06, P10, RR-13)', () => {
  it('EVM-020 AC6 the records returned are counted: past the alert threshold ONE alert without personal data, past the block 429 with Retry-After — audited as a read of customers', async () => {
    const user = await newUser();
    const before = securityAlerts().length;
    const counted = counters()['bulk_read_rejected'] ?? 0;
    expect((await user.search('masowy')).status).toBe(200); // 20 records
    expect((await user.search('masowy')).status).toBe(200); // 40: over the alert threshold
    expect(securityAlerts().length).toBe(before); // the alert is raised by the NEXT read
    expect((await user.search('masowy')).status).toBe(200); // 60: the alert; the answer is still given
    const alerts = securityAlerts().slice(before);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ alert: 'security', alertCode: 'bulk_read', level: 'error' });
    const serialised = JSON.stringify(alerts);
    for (const forbidden of [user.userId, 'masowy', 'Masowy']) expect(serialised.includes(forbidden), forbidden).toBe(false);

    const blocked = await user.search('masowy');
    expect(blocked.status).toBe(429);
    expect(codeOf(blocked)).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBe(600); // the bucket leaves in 10 minutes (the 60 searches a minute are far away)
    expect(JSON.stringify(blocked.body)).not.toMatch(/Klient|Masowy/);
    expect(counters()['bulk_read_rejected']).toBe(counted + 1);

    const { rows } = await sql<{ action: string; object_type: string; actor_user_id: string }>`
      select action, object_type, actor_user_id from audit.events where actor_user_id = ${user.userId} order by occurred_at, id`.execute(
      app.database.admin,
    );
    expect(rows.map((row) => `${row.action}:${row.object_type}`)).toEqual(['bulk_read.alerted:customer', 'bulk_read.rejected:customer']);

    app.clock.advance(10 * MINUTE);
    expect((await user.search('masowy')).status).toBe(200); // the window moved on
  });

  it('EVM-020 AC6 the order is limiter, validation, meter, query, record: an invalid phrase never reaches the meter and a refused request counts nothing; another user is not affected', async () => {
    const heavy = await newUser();
    for (let index = 0; index < 3; index += 1) expect((await heavy.search('masowy')).status).toBe(200);
    expect((await heavy.search('masowy')).status).toBe(429);
    const rejected = counters()['bulk_read_rejected'];

    const invalid = await heavy.search('ab');
    expect(invalid.status).toBe(400); // validation answers before the meter would say 429
    expect(counters()['bulk_read_rejected']).toBe(rejected);

    const other = await newUser();
    expect((await other.search('klient00')).status).toBe(200); // 1 record
    expect((await other.search('klient01')).status).toBe(200);
  });

  it('EVM-020 AC6 the limit of 60 searches comes BEFORE the meter: past it the answer is the limit (Retry-After within a minute) and the meter is not asked', async () => {
    const user = await newUser();
    for (let index = 0; index < 3; index += 1) await user.search('masowy');
    for (let index = 0; index < 57; index += 1) expect((await user.search('masowy')).status).toBe(429); // meter refusals, 3 + 57 = 60 searches
    const rejected = counters()['bulk_read_rejected'];
    const limited = await user.search('masowy'); // the 61st
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(counters()['bulk_read_rejected']).toBe(rejected); // the meter was not asked
  });
});
