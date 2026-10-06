import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Argon2PasswordHasher, ARGON2_PARAMETERS } from '../../src/modules/identity/infrastructure/argon2-password-hasher.ts';
import { PASSWORD_HASHER } from '../../src/modules/identity/infrastructure/ports.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { setPassword } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createLink, createUser } from '../support/identity-fixtures.ts';
import { enrolledAccount, firstStep, LOGIN, PASSWORD } from '../support/login-flows.ts';

/** Records every verification: the hash it ran against (the stored one or the dummy) and the password it was given. */
class CountingHasher extends Argon2PasswordHasher {
  readonly verifications: Array<{ hash: string; password: string }> = [];

  override verify(hashed: string, password: string): Promise<boolean> {
    this.verifications.push({ hash: hashed, password });
    return super.verify(hashed, password);
  }
}

let current: IdentityApp;
let hasher: CountingHasher;
beforeEach(async () => {
  hasher = new CountingHasher();
  current = await createIdentityApp({ configure: (builder) => builder.overrideProvider(PASSWORD_HASHER).useValue(hasher) });
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const server = () => current.app.getHttpServer();
const metrics = () => current.app.get<MetricsRegistry>(METRICS, { strict: false });

const auditRows = async () =>
  (
    await sql<{
      action: string;
      outcome: string;
      reason_code: string | null;
      actor_type: string;
      actor_user_id: string | null;
      object_id: string | null;
    }>`
      select action, outcome, reason_code, actor_type, actor_user_id, object_id from audit.events
      where action = 'login.failed' order by occurred_at, id`.execute(current.database.admin)
  ).rows;

/** The four failures of AC2 on accounts that exist or not (a fresh account each: the invited one has a password, never a key). */
async function failureCases() {
  const known = await enrolledAccount(current);
  const invited = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
  const link = await createLink(current.database.admin, current.clock, invited.id);
  expect((await setPassword(current.panel(), link.token)).status).toBe(200);
  const deactivated = await enrolledAccount(current, { role: 'read_only' });
  await db().updateTable('identity.users').set({ status: 'deactivated' }).where('id', '=', deactivated.user.id).execute();
  current.clock.advance(61_000);
  return [
    { label: 'a wrong password', email: known.email, password: 'Wrong-pass-0000-x', userId: known.user.id, reason: 'bad_password' },
    { label: 'an unknown e-mail', email: 'nobody@evia.invalid', password: PASSWORD, userId: undefined, reason: 'unknown_user' },
    { label: 'an invited account', email: invited.email, password: PASSWORD, userId: invited.id, reason: 'not_active' },
    { label: 'a deactivated account', email: deactivated.email, password: PASSWORD, userId: deactivated.user.id, reason: 'not_active' },
  ] as const;
}

describe('the first step answers every failure the same way (EVM-067 AC2; SR-AUTH-05, ASVS V6.3.1, CWE-204, CWE-208)', () => {
  it('EVM-067 AC2 a wrong password, an unknown e-mail, an invited and a deactivated account get the same status, code, body shape and headers', async () => {
    const cases = await failureCases();
    const answers: Response[] = [];
    for (const attempt of cases) {
      const response = await firstStep(current.panel(), attempt.email, attempt.password);
      current.clock.advance(61_000);
      expect(response.status, attempt.label).toBe(401);
      expect(response.body, attempt.label).toMatchObject({ code: 'invalid_credentials', status: 401, title: 'Invalid email or password' });
      expect(JSON.stringify(response.body), attempt.label).not.toContain(attempt.email);
      expect(response.headers['set-cookie'], attempt.label).toBeUndefined();
      answers.push(response);
    }
    const comparable = (response: Response) => {
      const { traceId, ...body } = response.body as Record<string, unknown>;
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      const { date, etag, ...headers } = response.headers;
      expect([typeof date, typeof etag]).toEqual(['string', 'string']);
      return { body, headers };
    };
    for (const response of answers.slice(1)) expect(comparable(response)).toEqual(comparable(answers[0] as Response));
  });

  it('EVM-067 AC2 exactly one Argon2id verification per attempt, whatever the case: the stored hash for an active account, the dummy otherwise', async () => {
    const cases = await failureCases();
    const dummyRuns: string[] = [];
    for (const attempt of cases) {
      hasher.verifications.length = 0;
      await firstStep(current.panel(), attempt.email, attempt.password);
      current.clock.advance(61_000);
      expect(hasher.verifications, attempt.label).toHaveLength(1);
      const [run] = hasher.verifications;
      const stored = attempt.userId === undefined || attempt.reason === 'not_active' ? undefined : run?.hash;
      if (attempt.reason === 'bad_password') {
        const row = await db()
          .selectFrom('identity.password_credentials')
          .select('password_hash')
          .where('user_id', '=', attempt.userId)
          .executeTakeFirstOrThrow();
        expect(run?.hash, attempt.label).toBe(row.password_hash);
      } else {
        expect(stored, attempt.label).toBeUndefined();
        dummyRuns.push(run?.hash ?? '');
      }
      expect(run?.password, attempt.label).toBe(attempt.password.normalize('NFC'));
    }
    // the dummy is made once at start, with the current parameters, and is not any account's hash
    expect(new Set(dummyRuns).size).toBe(1);
    const { memoryCost, timeCost, parallelism } = ARGON2_PARAMETERS;
    expect(dummyRuns[0]).toMatch(new RegExp(`^\\$argon2id\\$v=19\\$m=${memoryCost},t=${timeCost},p=${parallelism}\\$`));
    const stored = await db().selectFrom('identity.password_credentials').select('password_hash').execute();
    expect(stored.map((row) => row.password_hash)).not.toContain(dummyRuns[0]);
  });

  it('EVM-067 AC2 the response times are comparable (the fastest of five attempts of each case within a factor of two)', async () => {
    const cases = await failureCases();
    const fastest = new Map<string, number>();
    for (let round = 0; round < 5; round += 1) {
      for (const attempt of cases) {
        const started = performance.now();
        await firstStep(current.panel(), attempt.email, attempt.password);
        const elapsed = performance.now() - started;
        fastest.set(attempt.label, Math.min(fastest.get(attempt.label) ?? Infinity, elapsed));
        current.clock.advance(61_000);
      }
    }
    const times = [...fastest.values()];
    expect(Math.max(...times) / Math.min(...times)).toBeLessThan(2);
  });

  it('EVM-067 AC2 the password is normalised to NFC and otherwise left as typed: no trimming, no case folding, no policy at sign-in', async () => {
    const composed = 'Zażółć-gęślą-jaźń-12';
    const account = await enrolledAccount(current, { password: composed });
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    const ok = await firstStep(current.panel(), account.email, decomposed);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ state: 'second_step', methods: ['passkey'] });
    for (const wrong of [` ${composed}`, `${composed} `, composed.toUpperCase(), composed.slice(0, -1), `${composed}\u0000`]) {
      current.clock.advance(61_000);
      const response = await firstStep(current.panel(), account.email, wrong);
      expect(response.status, JSON.stringify(wrong)).toBe(401);
    }
    // the minimum length of the activation policy is not applied: a short wrong password is an ordinary 401, not a 400
    current.clock.advance(61_000);
    expect((await firstStep(current.panel(), account.email, 'x')).status).toBe(401);
  });

  it('EVM-067 AC2 the e-mail is matched in its stored form (NFC, trimmed, lower case)', async () => {
    const account = await enrolledAccount(current);
    const response = await firstStep(current.panel(), `  ${account.email.toUpperCase()} `, account.password);
    expect(response.status).toBe(200);
  });

  it('EVM-067 AC2 the failure reasons stay inside: the audit trail has a code per case and no e-mail, password or fragment of either', async () => {
    const cases = await failureCases();
    for (const attempt of cases) {
      await firstStep(current.panel(), attempt.email, attempt.password);
      current.clock.advance(61_000);
    }
    const rows = await auditRows();
    expect(rows.map((row) => [row.reason_code, row.actor_type, row.actor_user_id, row.object_id, row.outcome])).toEqual(
      cases.map((attempt) => [
        attempt.reason,
        attempt.userId === undefined ? 'anonymous' : 'user',
        attempt.userId ?? null,
        attempt.userId ?? null,
        'failed',
      ]),
    );
    const all = JSON.stringify((await sql`select to_jsonb(t) as row from audit.events t`.execute(current.database.admin)).rows);
    for (const secret of [PASSWORD, 'Wrong-pass', 'nobody', '@evia.invalid', 'evia.invalid', 'Zq9']) expect(all).not.toContain(secret);
    expect(all).not.toMatch(/\$argon2/);
  });

  it('EVM-067 AC2 failed sign-ins are counted with the single label reason (no account, e-mail or address) and logged without secrets', async () => {
    const cases = await failureCases();
    for (const attempt of cases) {
      await firstStep(current.panel(), attempt.email, attempt.password);
      current.clock.advance(61_000);
    }
    const samples = metrics().snapshot();
    expect(samples.map((sample) => [sample.name, sample.labels, sample.value])).toEqual([
      ['evia_login_failures_total', { reason: 'bad_password' }, 1],
      ['evia_login_failures_total', { reason: 'unknown_user' }, 1],
      ['evia_login_failures_total', { reason: 'not_active' }, 2],
    ]);
    const logs = current.logs.text;
    for (const secret of [PASSWORD, 'Wrong-pass', 'nobody@', '@evia.invalid', 'Zq9']) expect(logs).not.toContain(secret);
  });
});

describe('the first step succeeds (EVM-067 AC1, AC4; SR-AUTH-06, SR-AUTH-09)', () => {
  it('EVM-067 AC4 an Administrator with a key gets a single-use loginToken and only the passkey as the method; nothing is stored in clear text', async () => {
    const account = await enrolledAccount(current);
    const response = await firstStep(current.panel(), account.email, account.password);
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as { state: string; loginToken: string; methods: string[] };
    expect(body).toEqual({
      state: 'second_step',
      loginToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown,
      methods: ['passkey'],
    });
    const attempts = await db().selectFrom('identity.login_attempts').selectAll().execute();
    expect(attempts).toHaveLength(1);
    const [attempt] = attempts;
    expect(attempt).toMatchObject({ user_id: account.user.id, used_at: null, failed_attempts: 0 });
    expect(attempt?.token_hash.length).toBe(32);
    expect(attempt?.token_hash.toString('base64url')).not.toBe(body.loginToken);
    expect((attempt?.expires_at.getTime() ?? 0) - (attempt?.created_at.getTime() ?? 0)).toBe(5 * 60_000);
    expect(Object.keys(attempt ?? {}).sort()).toEqual([
      'created_at',
      'expires_at',
      'failed_attempts',
      'id',
      'token_hash',
      'used_at',
      'user_id',
    ]);
    expect(current.logs.text).not.toContain(body.loginToken);
  });

  it('EVM-067 AC4 expired attempts are deleted at the next first step, at the latest 24 hours after they expired (the challenges go with them)', async () => {
    const account = await enrolledAccount(current);
    expect((await firstStep(current.panel(), account.email, account.password)).status).toBe(200);
    current.clock.advance(5 * 60_000 + 23 * 3_600_000); // expired 23 h ago: kept
    expect((await firstStep(current.panel(), account.email, account.password)).status).toBe(200);
    expect(await db().selectFrom('identity.login_attempts').select('id').execute()).toHaveLength(2);
    current.clock.advance(2 * 3_600_000); // the first expired more than 24 h ago
    expect((await firstStep(current.panel(), account.email, account.password)).status).toBe(200);
    expect(await db().selectFrom('identity.login_attempts').select('id').execute()).toHaveLength(2);
  });

  it('EVM-067 AC8 an active account without a second step gets a limited session (mfa_enrollment) with the cookie, a new token and the channel web', async () => {
    const user = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'active' });
    const hash = await new Argon2PasswordHasher().hash(PASSWORD);
    await db()
      .insertInto('identity.password_credentials')
      .values({ user_id: user.id, password_hash: hash, updated_at: current.clock.now() })
      .execute();
    const response = await firstStep(current.panel(), user.email, PASSWORD);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ state: 'mfa_enrollment', csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown });
    expect(response.headers['set-cookie']).toEqual([
      expect.stringMatching(
        /^__Host-evia_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200$/,
      ) as unknown,
    ]);
    const [session] = await db().selectFrom('identity.sessions').selectAll().where('user_id', '=', user.id).execute();
    expect(session).toMatchObject({ channel: 'web', state: 'mfa_enrollment', one_time_link_id: null, revoked_at: null });
    expect(await db().selectFrom('identity.login_attempts').select('id').execute()).toEqual([]);
  });
});

describe('limit of attempts from one address (EVM-067 AC3; SR-AUTH-05, SR-API-02, ASVS V2.4.1)', () => {
  it('EVM-067 AC3 the 21st attempt in a minute is 429 rate_limited with Retry-After — the same for an existing and an unknown account', async () => {
    const known = await enrolledAccount(current);
    const answers: Record<string, Response> = {};
    for (const [label, email] of [
      ['existing', known.email],
      ['unknown', 'nobody@evia.invalid'],
    ] as const) {
      current.clock.advance(61_000);
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        expect((await firstStep(current.panel(), email, 'Wrong-pass-0000-x')).status, `${label} ${attempt}`).toBe(401);
      }
      answers[label] = await firstStep(current.panel(), email, 'Wrong-pass-0000-x');
    }
    for (const response of Object.values(answers)) {
      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({ code: 'rate_limited', status: 429 });
      expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(60);
    }
    const strip = (response: Response) => ({ ...(response.body as object), traceId: undefined, retry: response.headers['retry-after'] });
    expect(strip(answers['existing'] as Response)).toEqual(strip(answers['unknown'] as Response));
  });

  it('EVM-067 AC3 the first step and the second step share one limit of 20 a minute', async () => {
    const token = 'A'.repeat(43);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await firstStep(current.panel(), 'nobody@evia.invalid', 'Wrong-pass-0000-x')).status).toBe(401);
      expect((await current.panel().post(LOGIN.options, { loginToken: token })).status).toBe(401);
    }
    const next = await current.panel().post(LOGIN.passkey, { loginToken: token, credential: {} });
    expect(next.status).toBe(429);
    expect(next.body).toMatchObject({ code: 'rate_limited' });
  });

  it('EVM-067 AC3 the limit is counted before the database is touched: with no access to the tables the 21st attempt is still 429, not 500', async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) await firstStep(current.panel(), 'nobody@evia.invalid', 'Wrong-pass-0000-x');
    await sql`revoke select on identity.users from evia_app`.execute(current.database.admin);
    const response = await firstStep(current.panel(), 'nobody@evia.invalid', 'Wrong-pass-0000-x');
    expect(response.status).toBe(429);
    expect(hasher.verifications).toHaveLength(20);
  });

  it('EVM-067 AC3 the address comes from the connection, never from a forged X-Forwarded-For: changing it does not escape the limit (no trusted proxy)', async () => {
    const known = await enrolledAccount(current);
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await request(server())
        .post(LOGIN.login)
        .set({ Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': `203.0.113.${attempt}` })
        .send({ email: known.email, password: 'Wrong-pass-0000-x' });
      expect(response.status).toBe(401);
    }
    const spoofed = await request(server())
      .post(LOGIN.login)
      .set({ Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': '198.51.100.7', Forwarded: 'for=198.51.100.8' })
      .send({ email: known.email, password: 'Wrong-pass-0000-x' });
    expect(spoofed.status).toBe(429);
  });
});

describe('input of the first step (EVM-067; SR-INPUT-06)', () => {
  const post = (body: unknown) =>
    request(server())
      .post(LOGIN.login)
      .set({ Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin' })
      .send(body as object);

  it('EVM-067 AC2 the schema is strict: unknown fields, missing fields, wrong types and over-long values are 400 validation_failed without the value', async () => {
    const cases: Array<[unknown, string]> = [
      [{ email: 'a@evia.invalid', password: 'x', userId: 'x' }, '/userId'],
      [{ email: 'a@evia.invalid' }, '/password'],
      [{ password: 'x' }, '/email'],
      [{ email: 5, password: 'x' }, '/email'],
      [{ email: `${'a'.repeat(250)}@evia.invalid`, password: 'x' }, '/email'],
      [{ email: 'a@evia.invalid', password: 'p'.repeat(1025) }, '/password'],
      [{ email: 'a@evia.invalid', password: '' }, '/password'],
      [{ email: '', password: 'x' }, '/email'],
    ];
    for (const [body, pointer] of cases) {
      current.clock.advance(61_000);
      const response = await post(body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
      expect((response.body as { errors: Array<{ pointer: string }> }).errors.map((error) => error.pointer)).toContain(pointer);
      expect(JSON.stringify(response.body)).not.toContain('evia.invalid');
    }
    // the longest password of the contract is hashed (no 400) and fails like any other
    current.clock.advance(61_000);
    expect((await post({ email: 'a@evia.invalid', password: 'p'.repeat(1024) })).status).toBe(401);
  });

  it('EVM-067 AC2 a body over the anonymous limit is 413 and a body that is not JSON is 415', async () => {
    const large = await request(server())
      .post(LOGIN.login)
      .set({ Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' })
      .send(JSON.stringify({ email: 'a@evia.invalid', password: 'p'.repeat(20_000) }));
    expect(large.status).toBe(413);
    const text = await request(server())
      .post(LOGIN.login)
      .set({ Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'text/plain' })
      .send('email=a');
    expect(text.status).toBe(415);
  });
});

describe('the first step is a public operation with CSRF protection (EVM-067 AC7; SR-SESS-10, ASVS V3.5.1-3, CWE-352)', () => {
  it('EVM-067 AC7 a request without Origin, from another Origin or cross-site is 403 csrf_failed and changes nothing', async () => {
    const account = await enrolledAccount(current);
    const before = await current.snapshot();
    const body = { email: account.email, password: account.password };
    const attempts: Array<[string, Record<string, string>]> = [
      ['no Origin and no fetch metadata', {}],
      ['no Origin', { 'Sec-Fetch-Site': 'same-origin' }],
      ['a foreign Origin', { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'same-origin' }],
      ['a cross-site fetch', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'cross-site' }],
      ['a same-site fetch', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-site' }],
      ['no Sec-Fetch-Site', { Origin: PANEL_ORIGIN }],
    ];
    for (const [label, headers] of attempts) {
      const response = await request(server()).post(LOGIN.login).set(headers).send(body);
      expect(response.status, label).toBe(403);
      expect(response.body, label).toMatchObject({ code: 'csrf_failed' });
    }
    expect(await current.snapshot()).toBe(before);
    expect(hasher.verifications).toHaveLength(0);
  });

  it('EVM-067 AC7 the session cookie of a sign-in has exactly the attributes of the contract', async () => {
    const user = await createUser(current.database.admin, current.clock, { role: 'read_only', status: 'active' });
    const hash = await new Argon2PasswordHasher().hash(PASSWORD);
    await db()
      .insertInto('identity.password_credentials')
      .values({ user_id: user.id, password_hash: hash, updated_at: current.clock.now() })
      .execute();
    const response = await firstStep(current.panel(), user.email, PASSWORD);
    const [cookie] = response.headers['set-cookie'] ?? [];
    const [pair, ...attributes] = (cookie ?? '').split('; ');
    expect(pair).toMatch(/^__Host-evia_session=[A-Za-z0-9_-]{43}$/);
    expect([...attributes].sort()).toEqual(['HttpOnly', 'Max-Age=43200', 'Path=/', 'SameSite=Strict', 'Secure']);
    expect(cookie).not.toMatch(/Domain=/i);
  });
});
