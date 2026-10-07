import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryBulkReadMeter } from '../../src/platform/bulk-read/bulk-read-meter.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { BULK_READ_METER, CLOCK, METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { MINUTE } from '../support/clock.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertParty, insertSite } from '../support/site-fixtures.ts';

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
    await insertSite(app.database.admin, { street: `ul. Masowa${String(index).padStart(2, '0')}` });
    await insertParty(app.database.admin, { displayName: `Masowy Kontrahent ${String(index).padStart(2, '0')}` });
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
  return {
    userId: user.id,
    sites: (query: string) => panel.post('/api/v1/sites/search', { query }),
    parties: (query: string) => panel.post('/api/v1/parties/search', { query }),
    customers: (query: string) => panel.post('/api/v1/customers/search', { query }),
  };
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

describe('the results of both searches count together towards mass read (EVM-021 AC7; SR-API-02, SR-LOG-06, P10, RR-13)', () => {
  it('EVM-021 AC7 the records of sites and parties are added up in ONE meter: the alert comes without personal data, the block as 429 with Retry-After — audited as a read of the kind that was asked for', async () => {
    const user = await newUser();
    const before = securityAlerts().length;
    const counted = counters()['bulk_read_rejected'] ?? 0;
    expect((await user.sites('masowa')).status).toBe(200); // 20 records
    expect((await user.parties('masowy')).status).toBe(200); // 40: over the alert threshold, only because the two searches are added up
    expect(securityAlerts().length).toBe(before); // the alert is raised by the NEXT read
    expect((await user.sites('masowa')).status).toBe(200); // 60: the alert; the answer is still given
    const alerts = securityAlerts().slice(before);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ alert: 'security', alertCode: 'bulk_read', level: 'error' });
    const serialised = JSON.stringify(alerts);
    for (const forbidden of [user.userId, 'masow', 'Masow']) expect(serialised.includes(forbidden), forbidden).toBe(false);

    const blocked = await user.parties('masowy');
    expect(blocked.status).toBe(429);
    expect(codeOf(blocked)).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBe(600); // the bucket leaves in 10 minutes (the 60 searches a minute are far away)
    expect(JSON.stringify(blocked.body)).not.toMatch(/Masow|masow/);
    expect(counters()['bulk_read_rejected']).toBe(counted + 1);
    // the customers search draws on the same meter: it is refused as well
    expect((await user.customers('przyk')).status).toBe(429);

    const { rows } = await sql<{ action: string; object_type: string }>`
      select action, object_type from audit.events where actor_user_id = ${user.userId} order by occurred_at, id`.execute(
      app.database.admin,
    );
    expect(rows.map((row) => `${row.action}:${row.object_type}`)).toEqual(['bulk_read.alerted:site', 'bulk_read.rejected:party']);

    app.clock.advance(10 * MINUTE);
    expect((await user.sites('masowa')).status).toBe(200); // the window moved on
  });

  it('EVM-021 AC7 the order is limiter, validation, meter, query, record: an invalid phrase never reaches the meter; another user is not affected', async () => {
    const heavy = await newUser();
    for (let index = 0; index < 3; index += 1) expect((await heavy.sites('masowa')).status).toBe(200);
    expect((await heavy.sites('masowa')).status).toBe(429);
    const rejected = counters()['bulk_read_rejected'];
    expect((await heavy.sites('ab')).status).toBe(400); // validation answers before the meter would say 429
    expect((await heavy.parties('ab')).status).toBe(400);
    expect(counters()['bulk_read_rejected']).toBe(rejected);

    const other = await newUser();
    expect((await other.sites('masowa00')).status).toBe(200); // 1 record
    expect((await other.parties('kontrahent 01')).status).toBe(200);
  });

  it('EVM-021 AC7 the limit of 60 searches per kind comes BEFORE the meter: past it the answer is the limit (Retry-After within a minute) and the meter is not asked', async () => {
    const user = await newUser();
    for (let index = 0; index < 3; index += 1) await user.parties('masowy');
    for (let index = 0; index < 57; index += 1) expect((await user.parties('masowy')).status).toBe(429); // meter refusals, 3 + 57 = 60 searches
    const rejected = counters()['bulk_read_rejected'];
    const limited = await user.parties('masowy'); // the 61st
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(counters()['bulk_read_rejected']).toBe(rejected); // the meter was not asked
  });
});
