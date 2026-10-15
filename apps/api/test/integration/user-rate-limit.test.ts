import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEARCH_RATE_BUCKET } from '../../src/modules/customers/application/search-customers.service.ts';
import { RATE_LIMITER, type RateLimiter } from '../../src/platform/http/rate-limiter.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { MINUTE } from '../support/clock.ts';
import { clearCustomers, insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role, type UserFixture } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { uuidv7 } from '../support/uuid.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await clearCustomers(current.database.admin);
  await sql`truncate platform.idempotency_records`.execute(current.database.admin);
  // every test starts in a fresh minute: the per-IP limit (1200/min) is shared by all the synthetic users of a test
  current.clock.advance(MINUTE);
});

const LIST = '/api/v1/customers';
const SEARCH = '/api/v1/customers/search';
const LIMIT = 300;
const admin = () => current.database.admin;

async function openSession(user: UserFixture, channel: 'web' | 'mobile') {
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, sessionId: session.id, panel };
}

/** A signed-in browser of a NEW user of the role. */
async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  return { user, ...(await openSession(user, channel)) };
}
type Browser = Awaited<ReturnType<typeof openSession>>;

const read = (browser: Browser) => browser.panel.get(LIST);
const create = (browser: Browser, body: unknown, key = uuidv7()) => browser.panel.post(LIST, body, { 'Idempotency-Key': key });
const search = (browser: Browser) => browser.panel.post(SEARCH, { query: 'przykl' });
const customer = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  kind: 'person',
  firstName: 'Jan',
  lastName: 'Przykładowy',
  phone: '600 000 001',
  ...overrides,
});

/** Sends `count` requests one after another and returns the statuses. */
async function repeat(count: number, send: () => PromiseLike<{ status: number }>): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) statuses.push((await send()).status);
  return statuses;
}
const only = (count: number, status: number) => Array.from({ length: count }, () => status);
const count = async (table: 'customers.customers' | 'platform.idempotency_records' | 'audit.events') => {
  const { rows } =
    table === 'customers.customers'
      ? await sql<{ n: string }>`select count(*)::text as n from customers.customers`.execute(admin())
      : table === 'audit.events'
        ? await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin())
        : await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin());
  return Number(rows[0]?.n);
};
const lastSeen = async (sessionId: string) =>
  (await sql<{ last_seen_at: Date }>`select last_seen_at from identity.sessions where id = ${sessionId}`.execute(admin())).rows[0]
    ?.last_seen_at;

/** The 429 of the per-IP limit of anonymous operations (60/min), for comparison of the shape. */
async function anonymousLimited() {
  const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  let response = await anonymous.get('/api/health');
  for (let index = 0; index < 70 && response.status !== 429; index += 1) response = await anonymous.get('/api/health');
  expect(response.status).toBe(429);
  return response;
}

describe('the limit of requests per user (EVM-082 AC1; SR-API-02, ADR-0004)', () => {
  it.each<Role>(['administrator', 'editor', 'read_only'])(
    'EVM-082 AC1 %s: 300 requests in a minute pass, the 301st is 429 rate_limited with Retry-After; ANOTHER user of the same address is not affected; after the window requests pass again',
    async (role) => {
      const heavy = await signIn(role);
      const other = await signIn(role);
      expect(await repeat(LIMIT, () => read(heavy))).toEqual(only(LIMIT, 200));
      const refused = await read(heavy);
      expect(refused.status).toBe(429);
      expect(refused.body).toMatchObject({ code: 'rate_limited' });
      expect(refused.headers['retry-after']).toMatch(/^[1-9][0-9]*$/);
      expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
      expect(refused.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(Object.keys(refused.headers).filter((name) => /ratelimit|x-rate/i.test(name))).toEqual([]);
      expect((await read(heavy)).status).toBe(429);
      expect((await read(other)).status).toBe(200);
      current.clock.advance(MINUTE);
      expect((await read(heavy)).status).toBe(200);
    },
  );

  it('EVM-082 AC1 all sessions of a user, web and mobile, share one counter — a second session is no way round the limit', async () => {
    const web = await signIn('editor', 'web');
    const mobile = await openSession(web.user, 'mobile');
    const secondWeb = await openSession(web.user, 'web');
    expect(await repeat(150, () => read(web))).toEqual(only(150, 200));
    // a mobile session on a web-only operation is 403 — and counts all the same (AC2)
    expect(await repeat(100, () => read(mobile))).toEqual(only(100, 403));
    expect(await repeat(50, () => read(secondWeb))).toEqual(only(50, 200));
    expect((await read(web)).status).toBe(429);
    expect((await read(mobile)).status).toBe(429);
    expect((await read(secondWeb)).status).toBe(429);
  });

  it('EVM-082 AC1 a refused request has the shape of every other 429 (no counter, no limit, no identifier in it)', async () => {
    const heavy = await signIn('read_only');
    await repeat(LIMIT, () => read(heavy));
    const refused = await read(heavy);
    expect(refused.status).toBe(429);
    expect(Object.keys(refused.body as object).sort()).toEqual(Object.keys((await anonymousLimited()).body as object).sort());
    expect(JSON.stringify(refused.body)).not.toContain(heavy.userId);
  });
});

describe('what is counted (EVM-082 AC2; SR-API-02)', () => {
  it('EVM-082 AC2 requests refused by the validation (400) count like successful ones', async () => {
    const browser = await signIn('editor');
    expect(await repeat(LIMIT, () => create(browser, { kind: 'person' }))).toEqual(only(LIMIT, 400));
    expect((await create(browser, { kind: 'person' })).status).toBe(429);
    expect((await read(browser)).status).toBe(429);
  });

  it('EVM-082 AC2 requests refused for lack of permission (403) count like successful ones', async () => {
    const browser = await signIn('read_only');
    expect(await repeat(LIMIT, () => create(browser, customer()))).toEqual(only(LIMIT, 403));
    expect((await create(browser, customer())).status).toBe(429);
  });

  it('EVM-082 AC2 requests without a valid session (401) and public operations use up nobody’s limit; health is not counted', async () => {
    const user = await signIn('editor');
    expect(await repeat(LIMIT - 1, () => read(user))).toEqual(only(LIMIT - 1, 200));
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    anonymous.cookie = '__Host-evia_session=not-a-session-token';
    expect(await repeat(100, () => anonymous.get(LIST))).toEqual(only(100, 401));
    // health with the valid session of the user: a public operation, not counted
    expect(await repeat(50, () => user.panel.get('/api/health'))).toEqual(only(50, 200));
    expect((await read(user)).status).toBe(200);
    expect((await read(user)).status).toBe(429);
  });

  it('EVM-082 AC2 a revoked session is 401 and is not counted', async () => {
    const user = await signIn('editor');
    expect(await repeat(LIMIT - 1, () => read(user))).toEqual(only(LIMIT - 1, 200));
    await sql`update identity.sessions set revoked_at = ${current.clock.now()}, revoke_reason = 'logout' where id = ${user.sessionId}`.execute(
      admin(),
    );
    expect(await repeat(10, () => read(user))).toEqual(only(10, 401));
    const second = await openSession(user.user, 'web');
    expect((await read(second)).status).toBe(200);
    expect((await read(second)).status).toBe(429);
  });
});

describe('a refused request has no effect (EVM-082 AC1; SR-API-02, ADR-0001)', () => {
  it('EVM-082 AC1 the 301st request, a mutation with an Idempotency-Key, is 429 and writes no customer, audit event, idempotency record and no activity of the session; the retry after the window gives 201', async () => {
    const browser = await signIn('editor');
    expect(await repeat(LIMIT, () => read(browser))).toEqual(only(LIMIT, 200));
    const seenBefore = await lastSeen(browser.sessionId);
    const auditBefore = await count('audit.events');
    current.clock.advance(30_000); // the activity of the session would be written now (touch interval) — unless the request is refused
    const body = customer();
    const key = uuidv7();
    const refused = await create(browser, body, key);
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBe('30');
    expect(await count('customers.customers')).toBe(0);
    expect(await count('platform.idempotency_records')).toBe(0);
    expect(await count('audit.events')).toBe(auditBefore);
    expect(await lastSeen(browser.sessionId)).toEqual(seenBefore);
    current.clock.advance(30_000);
    const retried = await create(browser, body, key);
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    expect(await count('customers.customers')).toBe(1);
  });
});

describe('the limits that were there before (EVM-082 AC3; P10, EVM-020 AC6)', () => {
  it('EVM-082 AC3 a search counts once in the user limit: 1 search and 299 reads pass, the next request is 429', async () => {
    await insertCustomer(admin(), {});
    const browser = await signIn('editor');
    expect((await search(browser)).status).toBe(200);
    expect(await repeat(LIMIT - 1, () => read(browser))).toEqual(only(LIMIT - 1, 200));
    expect((await read(browser)).status).toBe(429);
  });

  it('EVM-082 AC3 a search refused by its own limit (61st) counts once, not twice: 60 searches, the refused one and 239 reads make 300', async () => {
    await insertCustomer(admin(), {});
    const browser = await signIn('editor');
    expect(await repeat(60, () => search(browser))).toEqual(only(60, 200));
    const refused = await search(browser);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'rate_limited' });
    expect(await repeat(LIMIT - 61, () => read(browser))).toEqual(only(LIMIT - 61, 200));
    expect((await read(browser)).status).toBe(429);
  });

  it('EVM-082 AC3 a search refused by the user limit does not reach the search: its own counter is not used', async () => {
    const browser = await signIn('editor');
    expect(await repeat(59, () => search(browser))).toEqual(only(59, 200));
    expect(await repeat(LIMIT - 59, () => read(browser))).toEqual(only(LIMIT - 59, 200));
    expect((await search(browser)).status).toBe(429);
    const limiter = current.app.get<RateLimiter>(RATE_LIMITER, { strict: false });
    // had the refused search been counted, this would be the 61st search of the minute and be denied
    expect(limiter.consumeSubject(SEARCH_RATE_BUCKET, browser.userId, 60).allowed).toBe(true);
  });
});
