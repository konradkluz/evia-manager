import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryBulkReadMeter } from '../../src/platform/bulk-read/bulk-read-meter.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { BULK_READ_METER, CLOCK, METRICS } from '../../src/platform/tokens.ts';
import { MINUTE } from '../support/clock.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

const PATH = '/api/v1/work-orders';

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
  await insertWorkOrders(
    app.database.admin,
    Array.from({ length: 100 }, (_, index) => ({ number: numberOf(2026, index + 1), title: 'Jan Przykładowy — wallbox' })),
  );
});
afterAll(async () => {
  await app.close();
});

async function newUser() {
  const user = await createUser(app.database.admin, app.clock, { role: 'editor' });
  const session = await createSession(app.database.admin, app.clock, user);
  return { userId: user.id, get: (query = '') => request(app.app.getHttpServer()).get(`${PATH}${query}`).set('Cookie', session.cookie) };
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
const codeOf = (response: request.Response) => (response.body as { code: string }).code;

describe('mass read (EVM-017 AC5; SR-API-02, SR-LOG-06, SR-LOG-07, P10, RR-13)', () => {
  it('EVM-017 AC5 after the threshold the next page raises ONE alert without personal data; past the block it is 429 with Retry-After', async () => {
    const user = await newUser();
    const before = securityAlerts().length;
    expect((await user.get('?view=all_open&limit=25')).status).toBe(200); // 25 records
    expect((await user.get('?view=all_open&limit=25')).status).toBe(200); // 50: over the alert threshold
    expect(securityAlerts().length).toBe(before); // the alert is raised by the NEXT read
    expect((await user.get('?view=all_open&limit=25')).status).toBe(200); // 75: the alert; the answer is still given
    const alerts = securityAlerts().slice(before);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ alert: 'security', alertCode: 'bulk_read', level: 'error' });
    expect(String(alerts[0]?.['traceId'])).toMatch(/^[0-9a-f]{32}$/);
    const serialised = JSON.stringify(alerts);
    for (const forbidden of [user.userId, 'Przykładowy', 'all_open', 'limit=25'])
      expect(serialised.includes(forbidden), forbidden).toBe(false);

    const blocked = await user.get('?view=all_open&limit=25');
    expect(blocked.status).toBe(429);
    expect(codeOf(blocked)).toBe('rate_limited');
    expect(blocked.headers['retry-after']).toMatch(/^[1-9][0-9]*$/);
    expect(Number(blocked.headers['retry-after'])).toBe(600); // the clock stands at the start of a minute: the bucket leaves in 10 minutes
    expect(JSON.stringify(blocked.body)).not.toContain('ZL-');
    expect((await user.get('?view=all_open&limit=25')).status).toBe(429);
    expect(securityAlerts().slice(before)).toHaveLength(1); // once per window, not per request
    expect(counters()).toEqual({ bulk_read_alert: 1, bulk_read_rejected: 2 });

    app.clock.advance(10 * MINUTE);
    expect((await user.get('?view=all_open&limit=25')).status).toBe(200); // the window moved on
  });

  it('EVM-017 AC5 the refused request is not counted, an invalid request is not counted, and another user is not affected', async () => {
    const heavy = await newUser();
    const light = await newUser();
    for (let index = 0; index < 3; index += 1) await heavy.get('?limit=25');
    expect((await heavy.get('?limit=25')).status).toBe(429);
    expect((await light.get('?limit=25')).status).toBe(200);
    // while blocked, a malformed query is still a 400 of its own (validation comes first) and nothing is added
    expect((await heavy.get('?limit=0')).status).toBe(400);
    app.clock.advance(10 * MINUTE);
    expect((await heavy.get('?limit=25')).status).toBe(200);
    expect((await heavy.get('?cursor=garbage')).status).toBe(400);
    expect((await heavy.get('?limit=25')).status).toBe(200);
  });

  it('EVM-017 AC5 an empty page counts nothing and an unauthenticated request never reaches the meter', async () => {
    const user = await newUser();
    // every order of the fixture is `new`: the filter returns nothing, however many times it is asked
    for (let index = 0; index < 5; index += 1)
      expect(((await user.get('?status=settled&limit=25')).body as { items: unknown[] }).items).toEqual([]);
    expect((await user.get('?limit=25')).status).toBe(200);
    expect((await user.get('?limit=25')).status).toBe(200);
    const anonymous = await request(app.app.getHttpServer()).get(PATH);
    expect(anonymous.status).toBe(401);
  });
});

describe('mass read leaves a trace of the person (EVM-017 AC5; SR-LOG-03, SR-LOG-06, RR-13)', () => {
  const trail = async (userId: string) =>
    (
      await sql<{
        action: string;
        outcome: string;
        object_type: string;
        object_id: string | null;
        actor_type: string;
        session_id: string | null;
        trace_id: string;
      }>`
        select action, outcome, object_type, object_id, actor_type, session_id, trace_id from audit.events
        where actor_user_id = ${userId} and action like 'bulk_read.%' order by occurred_at, id`.execute(app.database.admin)
    ).rows;

  it('EVM-017 AC5 alert and 429 leave one audit event each, with the actor, the session and the trace — and no filter value', async () => {
    const user = await newUser();
    for (let index = 0; index < 3; index += 1) expect((await user.get('?view=all_open&limit=25')).status).toBe(200);
    expect((await user.get('?view=all_open&limit=25')).status).toBe(429);
    expect((await user.get('?view=all_open&limit=25')).status).toBe(429);
    const events = await trail(user.userId);
    expect(events.map((event) => [event.action, event.outcome])).toEqual([
      ['bulk_read.alerted', 'success'],
      ['bulk_read.rejected', 'denied'],
    ]);
    for (const event of events) {
      expect(event).toMatchObject({ actor_type: 'user', object_type: 'work_order', object_id: null });
      expect(event.session_id).not.toBeNull();
      expect(event.trace_id).toMatch(/^[0-9a-f]{32}$/);
    }
    app.clock.advance(10 * MINUTE);
    expect((await user.get('?view=all_open&limit=25')).status).toBe(200);
  });
});
