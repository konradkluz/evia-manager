import { hash, verify } from '@node-rs/argon2';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from '../../src/modules/identity/domain/common-passwords.ts';
import { hashToken, newToken } from '../../src/modules/identity/domain/tokens.ts';
import { PASSWORD_HASHER, type PasswordHasher } from '../../src/modules/identity/infrastructure/ports.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { PASSWORD, PATHS, setPassword } from '../support/flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const nextMinute = (): void => {
  current.clock.advance(61_000);
};

describe('setting the password with a link (EVM-016 AC3; SR-AUTH-01, SR-AUTH-02, SR-AUTH-04, SR-ERR-02)', () => {
  it('EVM-016 AC3 a valid link and a good password open an enrolment session: Argon2id hash, cookie, CSRF token, nothing else changes', async () => {
    const { user, link } = await current.pendingAdministrator();
    const panel = current.panel();
    const response = await setPassword(panel, link.token);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body as object)).toEqual(['csrfToken']);
    expect(response.headers['cache-control']).toBe('no-store');
    const cookie = String((response.headers['set-cookie'] as string[] | undefined)?.[0]);
    expect(cookie).toMatch(/^__Host-evia_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200$/);
    expect(cookie).not.toMatch(/Domain/i);

    const credential = await db()
      .selectFrom('identity.password_credentials')
      .selectAll()
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(credential.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verify(credential.password_hash, PASSWORD)).toBe(true);
    expect(credential.updated_at).toEqual(new Date(ISSUED_AT));

    const session = await db().selectFrom('identity.sessions').selectAll().where('user_id', '=', user.id).executeTakeFirstOrThrow();
    const sessionToken = cookie.split(';')[0]?.split('=')[1] ?? '';
    expect(session).toMatchObject({ channel: 'web', state: 'mfa_enrollment', one_time_link_id: link.id, revoked_at: null });
    expect(session.token_hash.equals(hashToken(sessionToken))).toBe(true);
    expect(session.token_hash.toString('base64url')).not.toBe(sessionToken);
    expect(session.idle_expires_at).toEqual(new Date('2026-10-01T09:00:00Z'));
    expect(session.absolute_expires_at).toEqual(new Date('2026-10-01T20:00:00Z'));
    expect(session.ip_address).toMatch(/127\.0\.0\.1$/);
    expect(session.user_agent).toBe('Mozilla/5.0 (synthetic test browser)');

    const stored = await db().selectFrom('identity.one_time_links').selectAll().where('id', '=', link.id).executeTakeFirstOrThrow();
    expect(stored).toMatchObject({ used_at: null, superseded_at: null });
    expect(await db().selectFrom('identity.users').select('status').where('id', '=', user.id).executeTakeFirstOrThrow()).toEqual({
      status: 'invited',
    });
  });

  it('EVM-016 AC3 the user agent kept with the session is cut to 512 characters (P9)', async () => {
    const { user, link } = await current.pendingAdministrator();
    const response = await current
      .panel()
      .post(PATHS.password, { token: link.token, password: PASSWORD })
      .set('User-Agent', 'U'.repeat(600));
    expect(response.status).toBe(200);
    const session = await db()
      .selectFrom('identity.sessions')
      .select('user_agent')
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(session.user_agent).toHaveLength(512);
  });

  it('EVM-016 AC3 a client without a user agent still gets a session (the agent is optional data)', async () => {
    const { user, link } = await current.pendingAdministrator();
    const response = await current.panel().post(PATHS.password, { token: link.token, password: PASSWORD }).unset('User-Agent');
    expect(response.status).toBe(200);
    const session = await db()
      .selectFrom('identity.sessions')
      .select('user_agent')
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(session.user_agent).toBeNull();
  });

  it.each([
    ['14 characters', 'Zq9-lamp-Orbi4', 'too_short'],
    ['an empty password', '', 'too_short'],
    ['the product name from the story (EviaCharge2026!, 15 characters)', 'EviaCharge2026!', 'too_weak'],
    ['a common password', COMMON_PASSWORDS[0] ?? '', 'too_weak'],
    ['the local part of the address', 'xx-administrator-xx', 'too_weak'],
    ['257 characters', 'Zq9-lamp-Orbit-'.padEnd(257, 'k'), 'too_long'],
  ])('EVM-016 AC3 %s is rejected with %s on /password and nothing is stored', async (_label, password, code) => {
    const { user, link } = await current.pendingAdministrator({ email: 'administrator@evia.invalid' });
    const before = await current.snapshot();
    const response = await setPassword(current.panel(), link.token, password);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed', status: 400, errors: [{ pointer: '/password', code }] });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.text).not.toContain(password.slice(0, 30) || 'never-empty');
    expect(await current.snapshot()).toBe(before);
    expect(user.id).toBeDefined();
  });

  it('EVM-016 AC3 a password found by Pwned Passwords is rejected as too_weak; only the NFC form was asked for', async () => {
    const { link } = await current.pendingAdministrator();
    current.breaches.result = 'breached';
    const decomposed = 'Zq9-zażółć-Orbit-4'.normalize('NFD');
    const response = await setPassword(current.panel(), link.token, decomposed);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ errors: [{ pointer: '/password', code: 'too_weak' }] });
    expect(current.breaches.checked).toEqual([decomposed.normalize('NFC')]);
  });

  it('EVM-016 AC3 when Pwned Passwords is unavailable the local checks decide, the activation goes on and a warning is logged without data', async () => {
    const { link } = await current.pendingAdministrator();
    current.breaches.result = 'unavailable';
    const response = await setPassword(current.panel(), link.token);
    expect(response.status).toBe(200);
    const warning = current.logs.entries.find(
      (entry) => entry['msg'] === 'pwned passwords unavailable; the local password checks were used',
    );
    expect(warning).toMatchObject({ level: 'warn' });
    expect(Object.keys(warning ?? {}).sort()).toEqual(['level', 'msg', 'time', 'traceId']);
    expect(current.logs.text).not.toContain(PASSWORD);
    // the local list still applies while the service is down
    nextMinute();
    const weak = await setPassword(current.panel(), link.token, 'EviaCharge2026!');
    expect(weak.status).toBe(400);
  });

  it('EVM-016 AC3 any Unicode password of 15 characters is accepted — emoji, spaces, decomposed letters — and is hashed in NFC', async () => {
    const cases = ['\u{1F600}'.repeat(15), '   spacje   dookola ', 'zażółć gęślą jaźń!'.normalize('NFD')];
    for (const password of cases) {
      const { user, link } = await current.pendingAdministrator();
      nextMinute();
      const response = await setPassword(current.panel(), link.token, password);
      expect(response.status, password).toBe(200);
      const credential = await db()
        .selectFrom('identity.password_credentials')
        .select('password_hash')
        .where('user_id', '=', user.id)
        .executeTakeFirstOrThrow();
      expect(await verify(credential.password_hash, password.normalize('NFC'))).toBe(true);
    }
  });

  it('EVM-016 AC3 an invalid link costs no Pwned Passwords request and no hashing: the token is checked first', async () => {
    const before = await current.snapshot();
    const response = await setPassword(current.panel(), newToken());
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'activation_link_invalid' });
    expect(current.breaches.checked).toEqual([]);
    expect(await current.snapshot()).toBe(before);
    // a weak password with an invalid link is reported as an invalid link, not as a weak password
    expect((await setPassword(current.panel(), newToken(), 'short')).body).toMatchObject({ code: 'activation_link_invalid' });
  });

  it('EVM-016 AC3 setting the password again with the same link replaces it and ends every earlier session of the account (A1c)', async () => {
    const { user, link } = await current.pendingAdministrator();
    const first = current.panel();
    expect((await setPassword(first, link.token)).status).toBe(200);
    nextMinute();
    const second = current.panel();
    expect((await setPassword(second, link.token, 'Another-Orbit-Lamp-7')).status).toBe(200);
    const stale = await first.get(PATHS.session);
    expect(stale.status).toBe(401);
    expect(stale.body).toMatchObject({ code: 'session_revoked' });
    expect((await second.get(PATHS.session)).status).toBe(200);
    const credential = await db()
      .selectFrom('identity.password_credentials')
      .select('password_hash')
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(await verify(credential.password_hash, 'Another-Orbit-Lamp-7')).toBe(true);
    expect(await verify(credential.password_hash, PASSWORD)).toBe(false);
    const sessions = await db()
      .selectFrom('identity.sessions')
      .select(['state', 'revoke_reason'])
      .where('user_id', '=', user.id)
      .orderBy('created_at')
      .execute();
    expect(sessions).toEqual([
      { state: 'mfa_enrollment', revoke_reason: 'rotated' },
      { state: 'mfa_enrollment', revoke_reason: null },
    ]);
  });

  it('EVM-016 AC3 a link that disappears while the password is hashed is refused as invalid, nothing is stored', async () => {
    await current.close();
    const vanishing: PasswordHasher = {
      hash: async (password) => {
        await db().deleteFrom('identity.one_time_links').execute();
        return hash(password);
      },
    };
    current = await createIdentityApp({ configure: (builder) => builder.overrideProvider(PASSWORD_HASHER).useValue(vanishing) });
    const { link } = await current.pendingAdministrator();
    const response = await setPassword(current.panel(), link.token);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'activation_link_invalid' });
    expect(await db().selectFrom('identity.password_credentials').selectAll().execute()).toEqual([]);
  });

  it('EVM-016 AC3 a link that stops being valid while the password is hashed is re-checked under a row lock: no credentials, no session (W8)', async () => {
    await current.close();
    const slow: PasswordHasher = {
      hash: async (password) => {
        // the administrator issues a new link while this request is hashing
        await db().updateTable('identity.one_time_links').set({ superseded_at: current.clock.now() }).execute();
        return hash(password);
      },
    };
    current = await createIdentityApp({ configure: (builder) => builder.overrideProvider(PASSWORD_HASHER).useValue(slow) });
    const { link } = await current.pendingAdministrator();
    const response = await setPassword(current.panel(), link.token);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'activation_link_invalid' });
    const counts = await sql<{ credentials: string; sessions: string; events: string }>`
      select (select count(*) from identity.password_credentials)::text as credentials,
             (select count(*) from identity.sessions)::text as sessions,
             (select count(*) from audit.events)::text as events`.execute(current.database.admin);
    expect(counts.rows[0]).toEqual({ credentials: '0', sessions: '0', events: '0' });
  });
});

describe('opening a link (EVM-016 AC5; SR-API-04, SR-LOG-02)', () => {
  const check = (token: string) => current.panel().post(PATHS.check, { token });

  it('EVM-016 AC5 checking a valid link returns the address and the role and does not use the link up, however often it is opened', async () => {
    const { user, link } = await current.pendingAdministrator({ email: 'administrator@evia.invalid' });
    const before = await current.snapshot();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await check(link.token);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ email: 'administrator@evia.invalid', role: 'administrator' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await current.snapshot()).toBe(before);
    const stored = await db()
      .selectFrom('identity.one_time_links')
      .select('used_at')
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(stored.used_at).toBeNull();
  });

  it('EVM-016 AC5 a used, changed, superseded, expired and unknown link get one and the same answer, and the database does not change', async () => {
    const make = async () => (await current.pendingAdministrator()).link;
    const used = await make();
    await db()
      .updateTable('identity.one_time_links')
      .set({ used_at: new Date(ISSUED_AT) })
      .where('id', '=', used.id)
      .execute();
    const superseded = await make();
    await db()
      .updateTable('identity.one_time_links')
      .set({ superseded_at: new Date(ISSUED_AT) })
      .where('id', '=', superseded.id)
      .execute();
    const live = await make();
    const changed = `${live.token.slice(0, 42)}${live.token.endsWith('A') ? 'B' : 'A'}`;
    const expired = (await current.pendingAdministrator({ ttlMs: 1000 })).link;
    const wrongState = await current.pendingAdministrator();
    await db().updateTable('identity.users').set({ status: 'active' }).where('id', '=', wrongState.user.id).execute();
    current.clock.advance(2000);
    const before = await current.snapshot();

    const answers: Array<{ label: string; status: number; body: string; length: string | undefined; type: string | undefined }> = [];
    for (const [label, token] of [
      ['used', used.token],
      ['changed', changed],
      ['superseded', superseded.token],
      ['expired', expired.token],
      ['account no longer waiting', wrongState.link.token],
      ['unknown', newToken()],
    ] as const) {
      nextMinute();
      const response = await check(token);
      // the trace id differs per request; everything else must be identical
      const body = JSON.stringify({ ...(response.body as object), traceId: 'x'.repeat(32) });
      answers.push({
        label,
        status: response.status,
        body,
        length: response.headers['content-length'],
        type: response.headers['content-type'],
      });
    }
    expect(answers.map((answer) => answer.status)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(new Set(answers.map(({ body, length, type }) => `${body}|${length}|${type}`)).size).toBe(1);
    expect(JSON.parse(answers[0]?.body ?? '{}')).toMatchObject({ code: 'activation_link_invalid', status: 400 });
    expect(answers[0]?.body).not.toMatch(/@|administrator|invited|account/i);
    expect(await current.snapshot()).toBe(before);
  });

  it.each([
    ['2026-10-04T07:59:59Z', 200, '3 days less a second, 09:59:59 Warsaw'],
    ['2026-10-04T08:00:00Z', 400, 'exactly 72 hours, 10:00 Warsaw'],
    ['2026-10-04T08:01:00Z', 400, '2026-10-04 10:01 Warsaw — the case of the story'],
  ])('EVM-016 AC5 link issued 2026-10-01 10:00 Warsaw, opened at %s: %i (%s)', async (opened, status) => {
    const { link } = await current.pendingAdministrator();
    current.clock.set(opened);
    expect((await check(link.token)).status).toBe(status);
  });

  it('EVM-016 AC5 72 hours are real hours: a link issued before the clock change of 2026-10-25 expires an hour "earlier" on the wall clock', async () => {
    current.clock.set('2026-10-23T10:00:00Z'); // 12:00 CEST
    const { link } = await current.pendingAdministrator();
    // 2026-10-26 11:00 CET is exactly 72 hours later (the clocks went back on 2026-10-25 03:00); 3 calendar days would be 12:00 CET
    current.clock.set('2026-10-26T09:59:59Z');
    expect((await check(link.token)).status).toBe(200);
    current.clock.set('2026-10-26T10:00:00Z');
    nextMinute();
    expect((await check(link.token)).status).toBe(400);
    current.clock.set('2026-10-26T11:00:00Z'); // 12:00 CET, three calendar days later
    nextMinute();
    expect((await check(link.token)).status).toBe(400);
  });

  it('EVM-016 AC5 the token never appears in the logs, the headers or the error bodies of the requests it was sent in', async () => {
    const { link } = await current.pendingAdministrator();
    const ok = await check(link.token);
    const bad = await check(newToken());
    const password = await setPassword(current.panel(), link.token);
    nextMinute();
    const invalidPassword = await setPassword(current.panel(), link.token, 'short');
    for (const response of [ok, bad, password, invalidPassword]) {
      expect(JSON.stringify([response.headers, response.text])).not.toContain(link.token);
    }
    expect(current.logs.text).not.toContain(link.token);
    expect(current.logs.text).not.toContain(PASSWORD);
    expect(current.logs.text).not.toContain('Zq9');
    const requests = current.logs.entries.filter((entry) => entry['msg'] === 'request completed');
    expect(requests.map((entry) => entry['route'])).toEqual([PATHS.check, PATHS.check, PATHS.password, PATHS.password]);
  });
});
