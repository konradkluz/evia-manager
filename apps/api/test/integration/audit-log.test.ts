import { randomBytes } from 'node:crypto';
import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { sql, type KyselyPlugin } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserDirectory } from '../../src/modules/identity/index.ts';
import { createDatabase } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createUser, type UserFixture } from '../support/identity-fixtures.ts';
import type { EnrolledAccount } from '../support/login-flows.ts';
import { MINUTES, signedInAdministrator, STEP_UP } from '../support/step-up-flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const DAY = 86_400_000;
const server = () => current.app.getHttpServer();
const admin = () => current.database.admin;

interface Item {
  id: string;
  occurredAt: string;
  actor: { userId: string; displayName: string | null } | null;
  action: string;
  outcome: string;
  reasonCode: string | null;
  objectType: string;
  objectId: string | null;
  ipPrefix: string | null;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

/** An event written the way the application writes them, at a chosen time (synthetic data). */
async function seed(event: {
  at: Date;
  actor: UserFixture | null;
  action: string;
  outcome?: string;
  reason?: string | null;
  ip?: string | null;
  objectType?: string;
}): Promise<void> {
  await sql`
    insert into audit.events (occurred_at, actor_type, actor_user_id, session_id, ip_prefix, origin, action, outcome, reason_code, object_type, object_id, trace_id)
    values (${event.at}, ${event.actor === null ? 'system' : 'user'}, ${event.actor?.id ?? null}, ${null}, ${event.ip ?? null}::cidr, 'web',
            ${event.action}, ${event.outcome ?? 'success'}, ${event.reason ?? null}, ${event.objectType ?? 'session'}, ${null}, ${randomBytes(16).toString('hex')})`.execute(
    admin(),
  );
}

const audits = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from audit.events where action = 'audit.read'`.execute(admin())).rows[0]?.n);

/** The Administrator of the scenario with an open window, and two synthetic people with 40 days of history. */
async function scenario() {
  const reader = await signedInAdministrator(current, { email: 'reader@evia.invalid' });
  const anna = await createUser(admin(), current.clock, {
    displayName: 'Anna Testowa',
    email: 'anna.testowa@evia.invalid',
    role: 'editor',
  });
  const jan = await createUser(admin(), current.clock, {
    displayName: 'Jan Testowy',
    email: 'jan.testowy@evia.invalid',
    role: 'read_only',
  });
  const now = current.clock.now();
  const actions = ['login.succeeded', 'login.failed', 'session.created', 'session.revoked'] as const;
  for (let day = 1; day <= 40; day += 1) {
    await seed({
      at: new Date(now.getTime() - day * DAY - 3 * MINUTES(60)),
      actor: day % 2 === 0 ? anna : jan,
      action: actions[day % 4] ?? 'login.succeeded',
      outcome: day % 4 === 1 ? 'failed' : 'success',
      reason: day % 4 === 1 ? 'bad_password' : null,
      ip: day % 3 === 0 ? '2001:db8:abcd::/48' : '203.0.113.0/24',
    });
  }
  return { reader, anna, jan, now };
}

const list = async (
  account: EnrolledAccount,
  query = '',
): Promise<{ status: number; body: Page & { code?: string }; raw: request.Response }> => {
  const raw = await account.panel.get(`${STEP_UP.audit}${query}`);
  return { status: raw.status, body: raw.body as Page & { code?: string }, raw };
};

describe('the audit log for the Administrator (EVM-029 AC5; W-18, P9)', () => {
  it('EVM-029 AC5 events of the last 30 days, newest first: time, person (displayName), action, outcome, object, IP prefix', async () => {
    const { reader, anna, jan } = await scenario();
    const response = await list(reader, '?limit=100');
    expect(response.status).toBe(200);
    expect(response.raw.headers['cache-control']).toBe('no-store');
    const { items } = response.body;
    // days 1..29 of the seeded history (each 3 hours before the full day: day 30 and older are outside the 30 days) plus the reader's own events
    const seeded = items.filter((item) => item.actor?.userId === anna.id || item.actor?.userId === jan.id);
    expect(seeded).toHaveLength(29);
    for (let index = 1; index < items.length; index += 1) {
      const [newer, older] = [items[index - 1], items[index]];
      expect(Date.parse(newer?.occurredAt ?? '') >= Date.parse(older?.occurredAt ?? '')).toBe(true);
    }
    const names = new Map(seeded.map((item) => [item.actor?.userId, item.actor?.displayName]));
    expect(names.get(anna.id)).toBe('Anna Testowa');
    expect(names.get(jan.id)).toBe('Jan Testowy');
    expect(seeded[0]).toMatchObject({
      action: expect.stringMatching(/^[a-z_]+\.[a-z_]+$/) as unknown,
      objectType: 'session',
      objectId: null,
      ipPrefix: expect.stringMatching(/^(203\.0\.113\.0\/24|2001:db8:abcd::\/48)$/) as unknown,
    });
    const oldest = seeded.at(-1);
    expect(Date.parse(oldest?.occurredAt ?? '')).toBeGreaterThanOrEqual(current.clock.now().getTime() - 30 * DAY);
    // the events written by the application itself (the reader's sign-in) carry an address prefix too
    const own = items.filter((item) => item.actor?.userId === reader.user.id);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((item) => /^127\.0\.0\.0\/24$/.test(item.ipPrefix ?? ''))).toBe(true);
  });

  it('EVM-029 AC5 filters: action, person, outcome and period each narrow the list, and they combine', async () => {
    const { reader, anna, jan, now } = await scenario();
    const only = async (query: string) => (await list(reader, query)).body.items;

    const failed = await only('?action=login.failed&limit=100');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((item) => item.action === 'login.failed')).toBe(true);

    const byAnna = await only(`?actorUserId=${anna.id}&limit=100`);
    expect(byAnna).toHaveLength(14);
    expect(byAnna.every((item) => item.actor?.userId === anna.id)).toBe(true);
    expect((await only(`?actorUserId=${jan.id}&limit=100`)).every((item) => item.actor?.userId === jan.id)).toBe(true);

    const outcomes = await only(`?outcome=failed&actorUserId=${jan.id}&limit=100`);
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every((item) => item.outcome === 'failed' && item.actor?.userId === jan.id && item.reasonCode === 'bad_password')).toBe(
      true,
    );

    const window = await only(
      `?actorUserId=${anna.id}&from=${encodeURIComponent(new Date(now.getTime() - 10 * DAY).toISOString())}&to=${encodeURIComponent(new Date(now.getTime() - 4 * DAY).toISOString())}&limit=100`,
    );
    expect(window).toHaveLength(3); // the even days 4, 6 and 8 of Anna (each 3 hours before the full day)
    const older = await only(
      `?actorUserId=${anna.id}&from=${encodeURIComponent(new Date(now.getTime() - 40 * DAY).toISOString())}&to=${encodeURIComponent(new Date(now.getTime() - 31 * DAY).toISOString())}&limit=100`,
    );
    expect(older).toHaveLength(4); // days 32, 34, 36 and 38: a wider period shows what the default hides
  });

  it('EVM-029 AC5 a period without events is an empty list, not an error: items [] and nextCursor null', async () => {
    const { reader } = await scenario();
    const response = await list(reader, '?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], nextCursor: null });
  });

  it('EVM-029 AC5 a cursor walks the whole list without a gap or a duplicate, also across events that share one instant', async () => {
    const { reader, anna, now } = await scenario();
    const tie = new Date(now.getTime() - 2 * DAY);
    for (let index = 0; index < 12; index += 1) await seed({ at: tie, actor: anna, action: 'session.created' });
    // the period ends 1 second before now: the audit.read events of these very reads (written at now) are not part of the walk
    const until = `to=${encodeURIComponent(new Date(now.getTime() - 1000).toISOString())}`;
    const everything = (await list(reader, `?limit=100&${until}`)).body.items.map((item) => item.id);
    expect(new Set(everything).size).toBe(everything.length);

    const walked: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { body: Page } = await list(reader, `?limit=7&${until}${cursor === null ? '' : `&cursor=${cursor}`}`);
      walked.push(...page.body.items.map((item) => item.id));
      cursor = page.body.nextCursor;
      pages += 1;
      expect(page.body.items.length).toBeLessThanOrEqual(7);
    } while (cursor !== null && pages < 50);
    expect(walked).toEqual(everything);
    expect(pages).toBe(Math.ceil(everything.length / 7));
  });

  it('EVM-029 AC5 the limit is 1..100, default 50; a page of exactly the limit with nothing after it has no nextCursor', async () => {
    const { reader, now } = await scenario();
    const until = `to=${encodeURIComponent(new Date(now.getTime() - 1000).toISOString())}`;
    expect((await list(reader, `?${until}`)).body.items.length).toBeLessThanOrEqual(50);
    const all = (await list(reader, `?limit=100&${until}`)).body.items.length;
    const exact = await list(reader, `?limit=${Math.min(all, 100)}&${until}`);
    expect(exact.body.items).toHaveLength(Math.min(all, 100));
    if (all <= 100) expect(exact.body.nextCursor).toBeNull();
    const one = await list(reader, `?limit=1&${until}`);
    expect(one.body.items).toHaveLength(1);
    expect(one.body.nextCursor).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]+$/) as unknown);
  });
});

describe('what the log may show (EVM-029 AC5; SR-DATA-03, SR-LOG-03, P9; ASVS V15.3.1, V8.2.3)', () => {
  const ALLOWED = ['action', 'actor', 'id', 'ipPrefix', 'objectId', 'objectType', 'occurredAt', 'outcome', 'reasonCode'];
  const FORBIDDEN = [
    'email',
    'mail',
    'session',
    'sessionid',
    'session_id',
    'trace',
    'traceid',
    'trace_id',
    'useragent',
    'user_agent',
    'ip',
    'ipaddress',
    'token',
    'hash',
    'password',
    'csrf',
    'cookie',
    'secret',
  ];

  const deepKeys = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(deepKeys)
      : typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, inner]) => [key, ...deepKeys(inner)])
        : [];

  it('EVM-029 AC5 only the listed fields leave: a person is {userId, displayName}; no e-mail, session, trace, user agent or full address', async () => {
    const { reader } = await scenario();
    // a real sign-in leaves a user agent in the sessions table and a session / trace id in the trail: none of it may be shown
    const response = await list(reader, '?limit=100');
    const keys = new Set(deepKeys(response.body));
    for (const item of response.body.items) {
      expect(Object.keys(item).sort()).toEqual(ALLOWED);
      if (item.actor !== null) expect(Object.keys(item.actor).sort()).toEqual(['displayName', 'userId']);
    }
    for (const forbidden of FORBIDDEN)
      expect(
        [...keys].map((key) => key.toLowerCase()),
        forbidden,
      ).not.toContain(forbidden);
    const text = JSON.stringify(response.body);
    expect(text).not.toContain('@');
    expect(text).not.toContain('synthetic test browser');
    expect(text).not.toMatch(/\b127\.0\.0\.1\b/);
    expect(text).not.toMatch(/\b203\.0\.113\.[1-9]\d*\b/);
  });

  it('EVM-029 AC5 the address is only the stored prefix (/24 for IPv4, /48 for IPv6) and the trace identifiers are not in the response', async () => {
    const { reader } = await scenario();
    const items = (await list(reader, '?limit=100')).body.items;
    expect(items.every((item) => item.ipPrefix === null || /\/(24|48)$/.test(item.ipPrefix))).toBe(true);
    const traces = (await sql<{ trace_id: string }>`select distinct trace_id from audit.events`.execute(admin())).rows;
    expect(traces.length).toBeGreaterThan(0);
    const text = JSON.stringify(items);
    for (const { trace_id: traceId } of traces) expect(text).not.toContain(traceId);
  });

  it('EVM-029 AC5 a person that no longer exists in the directory is shown by identifier with displayName null (the response stays valid)', async () => {
    const { reader } = await scenario();
    const ghost = '0190a1b2-0000-7000-8000-0000000000ff';
    await sql`insert into audit.events (occurred_at, actor_type, actor_user_id, origin, action, outcome, object_type, trace_id)
              values (${current.clock.now()}, 'user', ${ghost}, 'web', 'login.succeeded', 'success', 'session', ${randomBytes(16).toString('hex')})`.execute(
      admin(),
    );
    const items = (await list(reader, `?actorUserId=${ghost}`)).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]?.actor).toEqual({ userId: ghost, displayName: null });
  });
});

describe('Polish characters in the person shown in the log (EVM-029 AC5)', () => {
  it('EVM-029 AC5 a displayName with Polish letters (ąćęłńóśźż) comes back unchanged and the person filter finds the events', async () => {
    const { reader } = await scenario();
    const name = 'Zażółć Gęślą Jaźń';
    const person = await createUser(admin(), current.clock, { displayName: name, email: 'polish.letters@evia.invalid', role: 'editor' });
    await seed({ at: new Date(current.clock.now().getTime() - 60_000), actor: person, action: 'login.succeeded' });
    const items = (await list(reader, `?actorUserId=${person.id}`)).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]?.actor).toEqual({ userId: person.id, displayName: name });
  });
});

describe('the input of the query (EVM-029 AC5; SR-API-02, SR-API-04, ASVS V2.2.1, CWE-89, CWE-20)', () => {
  it('EVM-029 AC5 anything outside the schema is 400, with the field named and the value never echoed', async () => {
    const { reader } = await scenario();
    const cursor = Buffer.from('["2026-10-01T00:00:00.000Z","x"]').toString('base64url');
    const cases: Array<[string, string, string]> = [
      ['unknown parameter', '?email=anna.testowa@evia.invalid', 'unknown_parameter'],
      ['a repeated parameter', '?action=login.failed&action=login.succeeded', 'duplicate_parameter'],
      ['an action outside the list', '?action=account.deleted', 'validation_failed'],
      ['an outcome outside the list', '?outcome=maybe', 'validation_failed'],
      ['a person that is not an id', '?actorUserId=anna.testowa@evia.invalid', 'validation_failed'],
      ['an instant that is not ISO 8601', '?from=yesterday', 'validation_failed'],
      ['from after to', '?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z', 'validation_failed'],
      ['a period longer than 2 years', '?from=2024-01-01T00:00:00Z&to=2026-10-01T00:00:00Z', 'validation_failed'],
      ['a limit of 0', '?limit=0', 'validation_failed'],
      ['a limit of 101', '?limit=101', 'validation_failed'],
      ['a limit that is not a number', '?limit=many', 'validation_failed'],
      ['a cursor that is no cursor', '?cursor=not-a-cursor', 'validation_failed'],
      ['a cursor with a wrong payload', `?cursor=${cursor}`, 'validation_failed'],
      ['an empty cursor', '?cursor=', 'validation_failed'],
    ];
    for (const [label, query, code] of cases) {
      const response = await list(reader, query);
      expect(response.status, label).toBe(400);
      expect(response.body.code, label).toBe(code);
      expect(response.raw.headers['content-type'], label).toContain('application/problem+json');
      expect(response.raw.text, label).not.toContain('anna.testowa');
    }
    // none of the refused requests was a read of the log
    expect(await audits()).toBe(0);
  });

  it('EVM-029 AC5 a filter value that is an SQL fragment is a 400 and the table is intact (parameterised queries only)', async () => {
    const { reader } = await scenario();
    const attack = encodeURIComponent("x'; drop table audit.events; --");
    for (const query of [`?action=${attack}`, `?actorUserId=${attack}`, `?outcome=${attack}`, `?cursor=${attack}`, `?from=${attack}`]) {
      expect((await list(reader, query)).status, query).toBe(400);
    }
    const count = Number((await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin())).rows[0]?.n);
    expect(count).toBeGreaterThan(40);
    expect((await list(reader, "?actorUserId=0190a1b2-0000-7000-8000-000000000001' or '1'='1")).status).toBe(400);
  });
});

describe('reading the log is audited, and the trail cannot be changed (EVM-029 AC6; SR-LOG-03, SR-LOG-04, ASVS V16.2.1, V16.4.2)', () => {
  it('EVM-029 AC6 every read, filtered or not, leaves audit.read: who, from where, which session — and no value of any filter', async () => {
    const { reader, anna } = await scenario();
    expect(await audits()).toBe(0);
    expect((await list(reader)).status).toBe(200);
    expect(await audits()).toBe(1);
    const filtered = `?actorUserId=${anna.id}&action=login.failed&outcome=failed&from=2026-09-20T00:00:00Z&to=2026-09-30T00:00:00Z`;
    expect((await list(reader, filtered)).status).toBe(200);
    expect(await audits()).toBe(2);

    const rows = (
      await sql<
        Record<string, unknown>
      >`select *, ip_prefix::text as ip_prefix_text from audit.events where action = 'audit.read' order by occurred_at, id`.execute(admin())
    ).rows;
    expect(rows).toHaveLength(2);
    const [session] = (
      await sql<{ id: string }>`select id from identity.sessions where user_id = ${reader.user.id} and revoked_at is null`.execute(admin())
    ).rows;
    for (const row of rows) {
      expect(row).toMatchObject({
        actor_type: 'user',
        actor_user_id: reader.user.id,
        session_id: session?.id,
        origin: 'web',
        action: 'audit.read',
        outcome: 'success',
        reason_code: null,
        object_type: 'audit',
        object_id: null,
        ip_prefix_text: '127.0.0.0/24',
      });
      const text = JSON.stringify(row);
      for (const value of [anna.id, 'login.failed', 'failed', '2026-09-20', '2026-09-30']) {
        expect(text, value).not.toContain(value);
      }
    }
  });

  it('EVM-029 AC6 the page does not contain the event of its own read (the read is written in the same transaction, after the page)', async () => {
    const { reader } = await scenario();
    const first = await list(reader, '?limit=100');
    expect(first.body.items.some((item) => item.action === 'audit.read')).toBe(false);
    const second = await list(reader, '?limit=100');
    expect(second.body.items.filter((item) => item.action === 'audit.read')).toHaveLength(1);
    const read = second.body.items.find((item) => item.action === 'audit.read');
    expect(read).toMatchObject({
      actor: { userId: reader.user.id },
      outcome: 'success',
      objectType: 'audit',
      objectId: null,
      reasonCode: null,
    });
  });

  it('EVM-029 AC6 the read is not served when it cannot be audited (fail closed): 500 problem+json, no item, nothing half-written', async () => {
    const { reader } = await scenario();
    await sql`revoke insert on audit.events from evia_app`.execute(admin());
    try {
      const response = await list(reader);
      expect(response.status).toBe(500);
      expect(response.raw.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toMatchObject({ code: 'internal_error', status: 500 });
      expect(response.raw.text).not.toContain('items');
      expect(response.raw.text).not.toMatch(/permission|audit\.events|evia_app/i);
    } finally {
      await sql`grant insert on audit.events to evia_app`.execute(admin());
    }
    expect(await audits()).toBe(0);
    expect((await list(reader)).status).toBe(200);
    expect(await audits()).toBe(1);
  });

  it('EVM-029 AC6 the contract has no operation under /audit that changes or deletes an event, and the router answers none either', async () => {
    const { reader } = await scenario();
    const operations = Object.entries(AUTHZ_MANIFEST).filter(([, operation]) => operation.path.startsWith('/api/v1/audit'));
    expect(operations.map(([id, operation]) => [id, operation.method, operation.path])).toEqual([
      ['listAuditEvents', 'get', '/api/v1/audit/events'],
    ]);
    const before = Number((await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin())).rows[0]?.n);
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      for (const path of ['/api/v1/audit/events', '/api/v1/audit/events/0190a1b2-0000-7000-8000-000000000001', '/api/v1/audit']) {
        const agent = request(server());
        const response = await agent[method](path)
          .set('Cookie', reader.panel.cookie ?? '')
          .set('X-CSRF-Token', reader.panel.csrfToken ?? '')
          .set('Origin', PANEL_ORIGIN)
          .set('Sec-Fetch-Site', 'same-origin')
          .send({});
        expect([404, 405], `${method} ${path}`).toContain(response.status);
      }
    }
    expect(Number((await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin())).rows[0]?.n)).toBe(before);
  });

  it('EVM-029 AC6 the role of the application cannot update, delete or truncate an event (permission denied), and the owner is stopped by the triggers (EV001)', async () => {
    await scenario();
    const app = createDatabase({ url: current.database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 1 } });
    try {
      for (const statement of [
        sql`update audit.events set outcome = 'success'`,
        sql`delete from audit.events`,
        sql`truncate audit.events`,
      ]) {
        await expect(statement.execute(app)).rejects.toMatchObject({ code: '42501' });
      }
    } finally {
      await app.destroy();
    }
    await expect(sql`update audit.events set outcome = 'success'`.execute(admin())).rejects.toMatchObject({ code: 'EV001' });
    await expect(sql`delete from audit.events`.execute(admin())).rejects.toMatchObject({ code: 'EV001' });
  });
});

describe('who may read the log (EVM-029 AC7; SR-AUTHZ-11, SR-AUTHZ-05)', () => {
  it('EVM-029 AC7 Editor and Read-only are 403 forbidden — never step_up_required — with or without a recent key; the log is not read', async () => {
    for (const role of ['editor', 'read_only'] as const) {
      const account = await signedInAdministrator(current, { role });
      expect((await list(account)).body, `${role} fresh`).toMatchObject({ code: 'forbidden' });
      current.clock.advance(MINUTES(20));
      const stale = await list(account);
      expect(stale.status, `${role} stale`).toBe(403);
      expect(stale.body, `${role} stale`).toMatchObject({ code: 'forbidden' });
    }
    expect(await audits()).toBe(0);
  });

  it('EVM-029 AC7 an anonymous caller is 401 and a revoked session is 401 session_revoked; no event is read', async () => {
    const anonymous = await request(server()).get(STEP_UP.audit);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: 'unauthenticated' });
    const account = await signedInAdministrator(current);
    expect((await account.panel.post('/api/v1/auth/logout')).status).toBe(204);
    const revoked = await request(server())
      .get(STEP_UP.audit)
      .set('Cookie', account.panel.cookie ?? '');
    expect(revoked.status).toBe(401);
    expect(revoked.body).toMatchObject({ code: 'session_revoked' });
    expect(await audits()).toBe(0);
  });

  it('EVM-029 AC7 an Administrator on the mobile channel is 403 forbidden (a step-up operation is web only), whatever the key says', async () => {
    const account = await signedInAdministrator(current);
    await sql`update identity.sessions set channel = 'mobile' where user_id = ${account.user.id} and revoked_at is null`.execute(admin());
    const response = await list(account);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'forbidden' });
    expect(await audits()).toBe(0);
  });
});

describe('the name of a person for other modules (EVM-029; facade of identity)', () => {
  const countingPlugin = (counter: { n: number }): KyselyPlugin => ({
    transformQuery: ({ node }) => {
      counter.n += 1;
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  });

  it('EVM-029 displayNamesOf answers a whole batch (up to 100 people) with one query and returns nothing but the identifier and the display name', async () => {
    const people: UserFixture[] = [];
    for (let index = 0; index < 100; index += 1) people.push(await createUser(admin(), current.clock, { displayName: `Osoba ${index}` }));
    const counter = { n: 0 };
    const directory = new UserDirectory(admin().withPlugin(countingPlugin(counter)));
    const names = await directory.displayNamesOf([...people.map((person) => person.id), people[0]?.id ?? '']);
    expect(counter.n).toBe(1);
    expect(names.size).toBe(100);
    expect(names.get(people[7]?.id ?? '')).toBe('Osoba 7');
    expect([...names.values()].every((value) => typeof value === 'string' && !value.includes('@'))).toBe(true);
  });

  it('EVM-029 displayNamesOf: an unknown identifier is absent, an empty batch asks nothing, more than 100 people is refused', async () => {
    const person = await createUser(admin(), current.clock, { displayName: 'Anna Testowa' });
    const counter = { n: 0 };
    const directory = new UserDirectory(admin().withPlugin(countingPlugin(counter)));
    expect((await directory.displayNamesOf([])).size).toBe(0);
    expect(counter.n).toBe(0);
    const names = await directory.displayNamesOf([person.id, '0190a1b2-0000-7000-8000-0000000000ff']);
    expect([...names.entries()]).toEqual([[person.id, 'Anna Testowa']]);
    const many = Array.from({ length: 101 }, (_, index) => `0190a1b2-0000-7000-8000-${index.toString(16).padStart(12, '0')}`);
    await expect(directory.displayNamesOf(many)).rejects.toThrow(RangeError);
    // the default handle of the facade is the pool of the application
    expect([...(await current.app.get(UserDirectory).displayNamesOf([person.id])).keys()]).toEqual([person.id]);
  });
});
