import { createHash } from 'node:crypto';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PASSKEY_VERIFIER, type PasskeyVerifier } from '../../src/modules/identity/infrastructure/ports.ts';
import { SimpleWebAuthnPasskeys } from '../../src/modules/identity/infrastructure/simplewebauthn-passkeys.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { PATHS } from '../support/flows.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import {
  adopt,
  enrolledAccount,
  firstStep,
  LOGIN,
  loginOptions,
  secondStep,
  signIn,
  type EnrolledAccount,
} from '../support/login-flows.ts';
import type { PanelClient } from '../support/panel-client.ts';
import { VirtualAuthenticator, type AssertionKnobs } from '../support/virtual-authenticator.ts';

/** The real adapter with a hook that runs while an assertion is being verified (the moment a concurrent request can slip in). */
class HookedPasskeys implements PasskeyVerifier {
  readonly real = new SimpleWebAuthnPasskeys({ rpId: 'panel.evia.test', rpName: 'EVia Manager', origin: PANEL_ORIGIN });
  duringAssertion: (() => Promise<void>) | undefined;
  registrationOptions = this.real.registrationOptions.bind(this.real);
  verifyRegistration = this.real.verifyRegistration.bind(this.real);
  authenticationOptions = this.real.authenticationOptions.bind(this.real);
  async verifyAuthentication(...args: Parameters<PasskeyVerifier['verifyAuthentication']>) {
    const result = await this.real.verifyAuthentication(...args);
    await this.duringAssertion?.();
    return result;
  }
}

let current: IdentityApp;
let passkeys: HookedPasskeys;
beforeEach(async () => {
  passkeys = new HookedPasskeys();
  current = await createIdentityApp({ configure: (builder) => builder.overrideProvider(PASSKEY_VERIFIER).useValue(passkeys) });
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const server = () => current.app.getHttpServer();
const metrics = () => current.app.get<MetricsRegistry>(METRICS, { strict: false });
const minute = (): void => {
  current.clock.advance(61_000);
};

const failures = async () =>
  (
    await sql<{ reason_code: string; actor_user_id: string | null; session_id: string | null }>`
      select reason_code, actor_user_id, session_id from audit.events where action = 'login.failed' order by occurred_at, id`.execute(
      current.database.admin,
    )
  ).rows;
const live = async (userId: string) => (await sessionsOf(userId)).filter((session) => session.revoked_at === null);
const rotated = async (userId: string) => (await sessionsOf(userId)).filter((session) => session.revoke_reason === 'rotated').length;
const sessionsOf = (userId: string) =>
  db().selectFrom('identity.sessions').selectAll().where('user_id', '=', userId).orderBy('created_at').execute();

/** The first step and the options of a second step (a fresh browser, as another person's would be). */
async function begin(account: EnrolledAccount, panel: PanelClient = current.panel()) {
  const step1 = await firstStep(panel, account.email, account.password);
  expect(step1.status).toBe(200);
  const { loginToken } = step1.body as { loginToken: string };
  const { options } = await loginOptions(panel, loginToken);
  return { panel, loginToken, options };
}

describe('the second step creates the session (EVM-067 AC1, AC7; SR-SESS-01, SR-SESS-02, SR-AUTH-14, CWE-384)', () => {
  it('EVM-067 AC1 password and key give a new session: cookie, CSRF token, lastLoginAt, key counter, audit — and the previous session of the cookie is revoked as rotated', async () => {
    const account = await enrolledAccount(current);
    const oldCookie = account.panel.cookie ?? '';
    const [before] = await live(account.user.id);
    const rotatedBefore = await rotated(account.user.id);
    const started = current.clock.now();
    const { loginToken, options } = await begin(account, account.panel);
    const response = await secondStep(account.panel, loginToken, account.authenticator, options);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ state: 'active', csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown });
    expect(response.headers['set-cookie']).toEqual([
      expect.stringMatching(
        /^__Host-evia_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200$/,
      ) as unknown,
    ]);
    expect(response.headers['cache-control']).toBe('no-store');
    adopt(account.panel, response);

    const sessions = await sessionsOf(account.user.id);
    expect(await rotated(account.user.id)).toBe(rotatedBefore + 1);
    const old = sessions.find((session) => session.id === before?.id);
    const [created] = await live(account.user.id);
    expect(await live(account.user.id)).toHaveLength(1);
    expect(old).toMatchObject({ revoke_reason: 'rotated', revoked_at: started });
    expect(created?.id).not.toBe(old?.id);
    expect(created).toMatchObject({ channel: 'web', state: 'active', one_time_link_id: null, revoked_at: null, revoke_reason: null });
    expect(created?.idle_expires_at).toEqual(new Date(started.getTime() + 3_600_000));
    expect(created?.absolute_expires_at).toEqual(new Date(started.getTime() + 12 * 3_600_000));
    expect(created?.user_agent).toContain('synthetic test browser');
    expect(created?.token_hash.toString('base64url')).not.toBe((account.panel.cookie ?? '').split('=')[1]);

    expect(
      (await db().selectFrom('identity.users').select('last_login_at').where('id', '=', account.user.id).executeTakeFirstOrThrow())
        .last_login_at,
    ).toEqual(started);
    const key = await db()
      .selectFrom('identity.passkeys')
      .select(['counter', 'last_used_at'])
      .where('user_id', '=', account.user.id)
      .executeTakeFirstOrThrow();
    expect(key).toEqual({ counter: '1', last_used_at: started });
    expect(await db().selectFrom('identity.login_attempts').select('used_at').executeTakeFirstOrThrow()).toEqual({ used_at: started });
    expect(
      await db()
        .selectFrom('identity.webauthn_challenges')
        .select('used_at')
        .where('login_attempt_id', 'is not', null)
        .executeTakeFirstOrThrow(),
    ).toEqual({ used_at: started });

    const audit = (
      await sql<{
        action: string;
        reason_code: string | null;
        session_id: string | null;
        trace_id: string;
        object_id: string | null;
        ip_prefix: string | null;
      }>`
        select action, reason_code, session_id, trace_id, object_id, ip_prefix::text as ip_prefix from audit.events
        where action in ('login.succeeded', 'session.created', 'session.revoked') and occurred_at = ${started} order by action`.execute(
        current.database.admin,
      )
    ).rows;
    expect(audit.map((row) => [row.action, row.reason_code])).toEqual([
      ['login.succeeded', null],
      ['session.created', null],
      ['session.revoked', 'rotated'],
    ]);
    expect(new Set(audit.map((row) => row.trace_id)).size).toBe(1);
    expect(audit[0]).toMatchObject({ session_id: created?.id, object_id: created?.id });
    expect(audit[0]?.ip_prefix).toMatch(/\/(24|48)$/);

    // the new session works, the old cookie does not
    expect((await account.panel.get(PATHS.session)).body).toMatchObject({ state: 'active', user: { id: account.user.id } });
    const stale = await request(server()).get(PATHS.session).set('Cookie', oldCookie);
    expect(stale.status).toBe(401);
    expect(stale.body).toMatchObject({ code: 'session_revoked' });
    const logs = current.logs.text;
    expect(logs).not.toContain(loginToken);
    expect(logs).not.toContain(options.challenge);
  });

  it('EVM-067 AC1 without a cookie nothing is revoked; with two session cookies in the request (one may be planted) nothing is revoked either', async () => {
    const account = await enrolledAccount(current);
    const other = await enrolledAccount(current, { role: 'editor' });
    const { loginToken, options } = await begin(account);
    expect((await secondStep(current.panel(), loginToken, account.authenticator, options)).status).toBe(200);
    expect(await live(account.user.id)).toHaveLength(2);

    minute();
    const second = await begin(account);
    const doubled = current.panel();
    doubled.cookie = `${account.panel.cookie};${other.panel.cookie}`;
    expect((await secondStep(doubled, second.loginToken, account.authenticator, second.options)).status).toBe(200);
    expect(await live(account.user.id)).toHaveLength(3);
    expect(await live(other.user.id)).toHaveLength(1);
  });

  it('EVM-067 AC1 a cookie of another person in the same browser is replaced too: that session ends as rotated', async () => {
    const first = await enrolledAccount(current);
    const second = await enrolledAccount(current, { role: 'editor' });
    const browser = current.panel();
    browser.cookie = first.panel.cookie;
    const { loginToken, options } = await begin(second, browser);
    expect((await secondStep(browser, loginToken, second.authenticator, options)).status).toBe(200);
    expect(await live(first.user.id)).toEqual([]);
    expect(await rotated(first.user.id)).toBe(2); // the enrolment session of the activation and this one
  });

  it('EVM-067 AC1 the loginToken is single-use: a replay of the whole second step, and new options, are 401 unauthenticated and create nothing', async () => {
    const account = await enrolledAccount(current);
    const { panel, loginToken, options } = await begin(account);
    const body = { loginToken, credential: account.authenticator.assert(options) };
    expect((await panel.post(LOGIN.passkey, body)).status).toBe(200);
    const sessions = (await sessionsOf(account.user.id)).length;
    for (const replay of [await panel.post(LOGIN.passkey, body), await panel.post(LOGIN.options, { loginToken })]) {
      expect(replay.status).toBe(401);
      expect(replay.body).toMatchObject({ code: 'unauthenticated' });
      expect(replay.headers['set-cookie']).toBeUndefined();
    }
    expect(await sessionsOf(account.user.id)).toHaveLength(sessions);
  });

  it('EVM-067 AC1 every role signs in and the session carries the role (Administrator, Editor, Read-only)', async () => {
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const account = await enrolledAccount(current, { role });
      const panel = current.panel();
      const response = await signIn(panel, account);
      expect(response.status, role).toBe(200);
      expect((await panel.get(PATHS.session)).body, role).toMatchObject({
        state: 'active',
        channel: 'web',
        user: { id: account.user.id, role },
      });
    }
  });
});

describe('the options of the second step (EVM-067 AC4; SR-AUTH-09, ASVS V6.3.3, V11.6.1)', () => {
  it('EVM-067 AC4 the options require user verification, name the configured RP and only the keys of the account; the challenge is 128+ bits, stored as a hash, 5 minutes', async () => {
    const account = await enrolledAccount(current);
    const stranger = await enrolledAccount(current, { role: 'editor' });
    const { loginToken, options } = await begin(account);
    expect(options).toMatchObject({ rpId: 'panel.evia.test', userVerification: 'required' });
    expect(options.allowCredentials?.map((credential) => credential.id)).toEqual([
      account.authenticator.credentialId.toString('base64url'),
    ]);
    expect(JSON.stringify(options)).not.toContain(stranger.authenticator.credentialId.toString('base64url'));
    expect(Buffer.from(options.challenge, 'base64url').length).toBeGreaterThanOrEqual(16);
    const rows = await db().selectFrom('identity.webauthn_challenges').selectAll().where('login_attempt_id', 'is not', null).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'passkey_authentication', session_id: null, used_at: null, user_id: account.user.id });
    expect(rows[0]?.challenge_hash).toEqual(createHash('sha256').update(options.challenge, 'utf8').digest());
    expect((rows[0]?.expires_at.getTime() ?? 0) - (rows[0]?.created_at.getTime() ?? 0)).toBe(5 * 60_000);
    expect(loginToken).not.toBe(options.challenge);
  });

  it('EVM-067 AC4 asking for new options retires the earlier challenge: an assertion over the old one is refused, the new one works', async () => {
    const account = await enrolledAccount(current);
    const { panel, loginToken, options } = await begin(account);
    const { options: fresh } = await loginOptions(panel, loginToken);
    expect(fresh.challenge).not.toBe(options.challenge);
    const open = await db()
      .selectFrom('identity.webauthn_challenges')
      .select('used_at')
      .where('login_attempt_id', 'is not', null)
      .execute();
    expect(open.filter((row) => row.used_at === null)).toHaveLength(1);
    const stale = await secondStep(panel, loginToken, account.authenticator, options);
    expect(stale.status).toBe(401);
    expect(stale.body).toMatchObject({ code: 'passkey_failed' });
    // the failed verification spent the open challenge as well, so the key needs fresh options (a challenge is used once)
    const { options: again } = await loginOptions(panel, loginToken);
    expect((await secondStep(panel, loginToken, account.authenticator, again)).status).toBe(200);
  });

  it('EVM-067 AC4 an account whose keys are gone gets no options (401), and nothing is stored', async () => {
    const account = await enrolledAccount(current);
    const step1 = await firstStep(current.panel(), account.email, account.password);
    await db().deleteFrom('identity.passkeys').where('user_id', '=', account.user.id).execute();
    const response = await current.panel().post(LOGIN.options, { loginToken: (step1.body as { loginToken: string }).loginToken });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
    expect(await db().selectFrom('identity.webauthn_challenges').select('id').where('login_attempt_id', 'is not', null).execute()).toEqual(
      [],
    );
  });
});

describe('a key that fails, and a second step without a first (EVM-067 AC4; SR-AUTH-09)', () => {
  const MISTAKES: Array<[string, (account: EnrolledAccount) => AssertionKnobs]> = [
    ['a wrong origin', () => ({ origin: 'https://evil.invalid' })],
    ['a wrong RP ID', () => ({ rpId: 'evil.invalid' })],
    ['no user verification', () => ({ userVerified: false })],
    ['no user presence', () => ({ userPresent: false })],
    ['a wrong ceremony type', () => ({ type: 'webauthn.create' })],
    ['a challenge that was never issued', () => ({ challenge: 'Z'.repeat(43) })],
    ['a forged signature (another key signs for this credential id)', () => ({ signWith: new VirtualAuthenticator() })],
  ];

  it.each(MISTAKES)(
    'EVM-067 AC4 %s: 401 passkey_failed, no session, the loginToken stays usable, the audit trail has login.failed',
    async (_label, knobs) => {
      const account = await enrolledAccount(current);
      const { panel, loginToken, options } = await begin(account);
      const response = await secondStep(panel, loginToken, account.authenticator, options, knobs(account));
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'passkey_failed', status: 401 });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await live(account.user.id)).toHaveLength(1);
      expect(await db().selectFrom('identity.login_attempts').select(['used_at', 'failed_attempts']).executeTakeFirstOrThrow()).toEqual({
        used_at: null,
        failed_attempts: 1,
      });
      expect(await failures()).toEqual([{ reason_code: 'passkey_failed', actor_user_id: account.user.id, session_id: null }]);
      expect(
        metrics()
          .snapshot()
          .map((sample) => [sample.labels, sample.value]),
      ).toEqual([[{ reason: 'passkey_failed' }, 1]]);
      // retry (AC4): the same loginToken with fresh options and the right key
      const { options: fresh } = await loginOptions(panel, loginToken);
      expect((await secondStep(panel, loginToken, account.authenticator, fresh)).status).toBe(200);
    },
  );

  it('EVM-067 AC4 an assertion whose clientDataJSON carries no readable challenge is refused, and it still counts as a failed key', async () => {
    const account = await enrolledAccount(current);
    const { panel, loginToken, options } = await begin(account);
    for (const clientDataJSON of [
      'e30',
      Buffer.from('not json').toString('base64url'),
      Buffer.from('{"challenge":5}').toString('base64url'),
    ]) {
      const credential = account.authenticator.assert(options);
      const response = await panel.post(LOGIN.passkey, {
        loginToken,
        credential: { ...credential, response: { ...credential.response, clientDataJSON } },
      });
      expect(response.status, clientDataJSON).toBe(401);
      expect(response.body, clientDataJSON).toMatchObject({ code: 'passkey_failed' });
    }
    expect((await db().selectFrom('identity.login_attempts').select('failed_attempts').executeTakeFirstOrThrow()).failed_attempts).toBe(3);
  });

  it('EVM-067 AC4 an assertion without any issued challenge, and a challenge that expired, are refused', async () => {
    const account = await enrolledAccount(current);
    const step1 = await firstStep(current.panel(), account.email, account.password);
    const { loginToken } = step1.body as { loginToken: string };
    const options: PublicKeyCredentialRequestOptionsJSON = {
      challenge: 'Q'.repeat(43),
      rpId: 'panel.evia.test',
      userVerification: 'required',
    };
    expect((await secondStep(current.panel(), loginToken, account.authenticator, options)).status).toBe(401);

    const { options: real } = await loginOptions(current.panel(), loginToken);
    await db()
      .updateTable('identity.webauthn_challenges')
      .set({ created_at: new Date(current.clock.now().getTime() - 2), expires_at: new Date(current.clock.now().getTime() - 1) })
      .where('used_at', 'is', null)
      .execute();
    const response = await secondStep(current.panel(), loginToken, account.authenticator, real);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'passkey_failed' });
  });

  it('EVM-067 AC4 an assertion whose signature counter does not go forward (a cloned key) is refused', async () => {
    const account = await enrolledAccount(current);
    expect((await signIn(current.panel(), account)).status).toBe(200);
    minute();
    const { panel, loginToken, options } = await begin(account);
    const response = await secondStep(panel, loginToken, account.authenticator, options, { counter: 1 });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'passkey_failed' });
    expect((await db().selectFrom('identity.passkeys').select('counter').executeTakeFirstOrThrow()).counter).toBe('1');
  });

  it('EVM-067 AC4 the fifth failed key ends the attempt: the next call, even with the right key, is 401 unauthenticated and the password has to be entered again', async () => {
    const account = await enrolledAccount(current);
    const { panel, loginToken, options: first } = await begin(account);
    let options = first;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await secondStep(panel, loginToken, account.authenticator, options, { signWith: new VirtualAuthenticator() });
      expect(response.body, `failure ${attempt}`).toMatchObject({ code: 'passkey_failed' });
      if (attempt < 5) options = (await loginOptions(panel, loginToken)).options;
    }
    expect(await db().selectFrom('identity.login_attempts').select(['failed_attempts', 'used_at']).executeTakeFirstOrThrow()).toEqual({
      failed_attempts: 5,
      used_at: current.clock.now(),
    });
    const ended = await panel.post(LOGIN.options, { loginToken });
    expect(ended.status).toBe(401);
    expect(ended.body).toMatchObject({ code: 'unauthenticated' });
    expect((await secondStep(panel, loginToken, account.authenticator, options)).body).toMatchObject({ code: 'unauthenticated' });
    expect(await live(account.user.id)).toHaveLength(1);
  });

  it('EVM-067 AC4 after 5 minutes the second step is 401 login_expired (options and verification), audited and counted — and only after a correct password', async () => {
    const account = await enrolledAccount(current);
    const { panel, loginToken, options } = await begin(account);
    current.clock.advance(5 * 60_000 + 1000);
    for (const response of [
      await panel.post(LOGIN.options, { loginToken }),
      await secondStep(panel, loginToken, account.authenticator, options),
    ]) {
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'login_expired', title: 'Sign-in took too long' });
    }
    expect((await failures()).map((row) => row.reason_code)).toEqual(['login_expired', 'login_expired']);
    expect(await live(account.user.id)).toHaveLength(1);
    expect(
      metrics()
        .snapshot()
        .map((sample) => [sample.labels, sample.value]),
    ).toEqual([[{ reason: 'login_expired' }, 2]]);
    // an unknown token says nothing about expiry: no step 1, no login_expired
    const unknown = await current.panel().post(LOGIN.options, { loginToken: 'B'.repeat(43) });
    expect(unknown.body).toMatchObject({ code: 'unauthenticated' });
  });

  it('EVM-067 AC4 the second step without a valid first one is 401 unauthenticated: an unknown token, a missing one is a malformed request', async () => {
    const credential = new VirtualAuthenticator().assert({
      challenge: 'Q'.repeat(43),
      rpId: 'panel.evia.test',
      userVerification: 'required',
    });
    for (const response of [
      await current.panel().post(LOGIN.options, { loginToken: 'B'.repeat(43) }),
      await current.panel().post(LOGIN.passkey, { loginToken: 'B'.repeat(43), credential }),
    ]) {
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'unauthenticated' });
    }
    expect((await current.panel().post(LOGIN.passkey, { credential })).status).toBe(400);
    expect((await current.panel().post(LOGIN.passkey, { loginToken: 'short', credential })).status).toBe(400);
    expect((await current.panel().post(LOGIN.passkey, { loginToken: 'B'.repeat(43), credential, userId: 'x' })).body).toMatchObject({
      code: 'validation_failed',
    });
  });
});

describe('the key must belong to the account of the loginToken (EVM-067 AC4; SR-AUTH-09, ASVS V6.3.3, CWE-287, CWE-639)', () => {
  it("EVM-067 AC4 the loginToken of account A with a valid assertion of account B's key is 401: no session for anybody, B's key untouched, login.failed for A", async () => {
    const victim = await enrolledAccount(current);
    const insider = await enrolledAccount(current, { role: 'editor' });
    const { panel, loginToken, options } = await begin(victim); // the victim's password was obtained, the insider holds his own key
    const response = await secondStep(panel, loginToken, insider.authenticator, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'passkey_failed' });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await live(victim.user.id)).toHaveLength(1);
    expect(await live(insider.user.id)).toHaveLength(1);
    const keys = await db().selectFrom('identity.passkeys').select(['user_id', 'counter', 'last_used_at']).execute();
    expect(keys.every((key) => key.counter === '0' && key.last_used_at === null)).toBe(true);
    expect(await failures()).toEqual([{ reason_code: 'passkey_failed', actor_user_id: victim.user.id, session_id: null }]);
    expect(
      (await db().selectFrom('identity.users').select('last_login_at').where('id', '=', victim.user.id).executeTakeFirstOrThrow())
        .last_login_at,
    ).toEqual(new Date(ISSUED_AT)); // still the time of the activation
  });

  it("EVM-067 AC4 the challenge of the attempt of A does not work with the loginToken of B, and A's attempt stays usable", async () => {
    const accountA = await enrolledAccount(current);
    const accountB = await enrolledAccount(current, { role: 'editor' });
    const a = await begin(accountA);
    const b = await begin(accountB);
    const response = await secondStep(b.panel, b.loginToken, accountB.authenticator, a.options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'passkey_failed' });
    // A's challenge was not spent by B's attempt
    expect((await secondStep(a.panel, a.loginToken, accountA.authenticator, a.options)).status).toBe(200);
    expect(await live(accountB.user.id)).toHaveLength(1);
  });

  it("EVM-067 AC4 a userHandle that is not the account's is refused; the account's own handle is accepted", async () => {
    const accountA = await enrolledAccount(current);
    const accountB = await enrolledAccount(current, { role: 'editor' });
    const handleOf = async (userId: string) =>
      (
        await db().selectFrom('identity.users').select('webauthn_user_handle').where('id', '=', userId).executeTakeFirstOrThrow()
      ).webauthn_user_handle.toString('base64url');
    const first = await begin(accountA);
    const foreign = await secondStep(first.panel, first.loginToken, accountA.authenticator, first.options, {
      userHandle: await handleOf(accountB.user.id),
    });
    expect(foreign.status).toBe(401);
    const { options } = await loginOptions(first.panel, first.loginToken);
    const own = await secondStep(first.panel, first.loginToken, accountA.authenticator, options, {
      userHandle: await handleOf(accountA.user.id),
    });
    expect(own.status).toBe(200);
  });
});

describe('one use, one session (EVM-067 AC1, AC4; ASVS V7.2.4, CWE-294)', () => {
  it('EVM-067 AC1 two parallel verifications of the same assertion create exactly one session', async () => {
    const account = await enrolledAccount(current);
    const { loginToken, options } = await begin(account);
    const body = { loginToken, credential: account.authenticator.assert(options) };
    const [one, two] = await Promise.all([current.panel().post(LOGIN.passkey, body), current.panel().post(LOGIN.passkey, body)]);
    expect([one.status, two.status].sort()).toEqual([200, 401]);
    expect(await live(account.user.id)).toHaveLength(2); // the activation one is not replaced: no cookie
    expect((await db().selectFrom('identity.passkeys').select('counter').executeTakeFirstOrThrow()).counter).toBe('1');
    const succeeded = await sql<{ n: string }>`select count(*)::text as n from audit.events where action = 'login.succeeded'`.execute(
      current.database.admin,
    );
    expect(succeeded.rows[0]?.n).toBe('1');
  });

  it('EVM-067 AC1 a loginToken spent by a concurrent request while the assertion is verified gives no second session (atomic UPDATE in the transaction)', async () => {
    const account = await enrolledAccount(current);
    const { loginToken, options } = await begin(account);
    passkeys.duringAssertion = async () => {
      await db().updateTable('identity.login_attempts').set({ used_at: current.clock.now() }).execute();
    };
    const response = await secondStep(current.panel(), loginToken, account.authenticator, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
    expect(await live(account.user.id)).toHaveLength(1);
    expect((await db().selectFrom('identity.users').select('last_login_at').executeTakeFirstOrThrow()).last_login_at).toEqual(
      new Date(ISSUED_AT),
    ); // still the time of the activation
  });

  it('EVM-067 AC1 an account deactivated between the steps gets no session; the attempt is spent and login.failed (not_active) is audited', async () => {
    const account = await enrolledAccount(current);
    const { panel, loginToken, options } = await begin(account);
    await db().updateTable('identity.users').set({ status: 'deactivated' }).where('id', '=', account.user.id).execute();
    const response = await secondStep(panel, loginToken, account.authenticator, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await live(account.user.id)).toHaveLength(1);
    expect((await failures()).map((row) => row.reason_code)).toEqual(['not_active']);
    expect((await db().selectFrom('identity.login_attempts').select('used_at').executeTakeFirstOrThrow()).used_at).not.toBeNull();
  });

  it('EVM-067 AC1 the sign-in is all or nothing: when the audit write fails there is no session, no lastLoginAt, no spent token, challenge or counter', async () => {
    const account = await enrolledAccount(current);
    const { panel, loginToken, options } = await begin(account);
    await sql`revoke insert on audit.events from evia_app`.execute(current.database.admin);
    const response = await secondStep(panel, loginToken, account.authenticator, options);
    expect(response.status).toBe(500);
    expect(await live(account.user.id)).toHaveLength(1);
    expect((await db().selectFrom('identity.users').select('last_login_at').executeTakeFirstOrThrow()).last_login_at).toEqual(
      new Date(ISSUED_AT),
    ); // still the time of the activation
    expect(await db().selectFrom('identity.login_attempts').select('used_at').executeTakeFirstOrThrow()).toEqual({ used_at: null });
    expect(
      await db()
        .selectFrom('identity.webauthn_challenges')
        .select('used_at')
        .where('login_attempt_id', 'is not', null)
        .executeTakeFirstOrThrow(),
    ).toEqual({ used_at: null });
    expect(await db().selectFrom('identity.passkeys').select(['counter', 'last_used_at']).executeTakeFirstOrThrow()).toEqual({
      counter: '0',
      last_used_at: null,
    });
  });
});

describe('the second step is a public operation with CSRF protection (EVM-067 AC7; SR-SESS-10, ASVS V3.5.1-3, CWE-352)', () => {
  it('EVM-067 AC7 options and verification without Origin, from another Origin or cross-site are 403 csrf_failed and change nothing (login CSRF)', async () => {
    const account = await enrolledAccount(current);
    const { loginToken, options } = await begin(account);
    const before = await current.snapshot();
    const credential = account.authenticator.assert(options);
    const attempts: Array<[string, Record<string, string>]> = [
      ['no Origin', { 'Sec-Fetch-Site': 'same-origin' }],
      ['a foreign Origin', { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'same-origin' }],
      ['a cross-site fetch', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'cross-site' }],
      ['no Sec-Fetch-Site', { Origin: PANEL_ORIGIN }],
    ];
    for (const [label, headers] of attempts) {
      for (const [path, body] of [
        [LOGIN.options, { loginToken }],
        [LOGIN.passkey, { loginToken, credential }],
      ] as const) {
        const response = await request(server()).post(path).set(headers).send(body);
        expect(response.status, `${label} ${path}`).toBe(403);
        expect(response.body, `${label} ${path}`).toMatchObject({ code: 'csrf_failed' });
      }
    }
    expect(await current.snapshot()).toBe(before);
  });
});
