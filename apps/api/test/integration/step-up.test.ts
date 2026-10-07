import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PASSKEY_VERIFIER, type PasskeyVerifier } from '../../src/modules/identity/infrastructure/ports.ts';
import { SimpleWebAuthnPasskeys } from '../../src/modules/identity/infrastructure/simplewebauthn-passkeys.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { PATHS, passkeyOptions } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { enrolledAccount, signIn, type EnrolledAccount } from '../support/login-flows.ts';
import { sendStepUp, signedInAdministrator, STEP_UP, stepUp, stepUpOptions, MINUTES } from '../support/step-up-flows.ts';
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
const sessionsOf = (userId: string) =>
  db().selectFrom('identity.sessions').selectAll().where('user_id', '=', userId).orderBy('created_at').orderBy('id').execute();
const live = async (userId: string) => (await sessionsOf(userId)).filter((session) => session.revoked_at === null);
const events = async (userId: string, ...actions: string[]) =>
  (
    await sql<{
      action: string;
      outcome: string;
      reason_code: string | null;
      object_type: string;
      object_id: string | null;
      session_id: string | null;
      trace_id: string;
    }>`select action, outcome, reason_code, object_type, object_id, session_id, trace_id from audit.events
       where actor_user_id = ${userId} and action = any(${actions}) order by occurred_at, action, id`.execute(current.database.admin)
  ).rows;
const challenges = (sessionId: string) =>
  db().selectFrom('identity.webauthn_challenges').selectAll().where('session_id', '=', sessionId).orderBy('created_at').execute();
const minute = (): void => {
  current.clock.advance(61_000);
};
const readAudit = (panel: PanelClient) => panel.get(STEP_UP.audit);

describe('a step-up is required after 15 minutes (EVM-029 AC1; SR-SESS-08, ASVS V7.5.3)', () => {
  it('EVM-029 AC1 16 minutes after the sign-in with the key the log is 403 step_up_required; after a step-up the same request is 200', async () => {
    const account = await signedInAdministrator(current);
    current.clock.advance(MINUTES(16));
    const denied = await readAudit(account.panel);
    expect(denied.status).toBe(403);
    expect(denied.headers['content-type']).toContain('application/problem+json');
    expect(denied.body).toMatchObject({
      type: '/problems/step_up_required',
      title: 'Re-authentication required',
      status: 403,
      code: 'step_up_required',
    });
    expect(JSON.stringify(denied.body)).not.toContain('items');

    expect((await stepUp(account.panel, account.authenticator)).status).toBe(200);
    const retried = await readAudit(account.panel);
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ items: expect.any(Array) as unknown, nextCursor: null });
  });

  it('EVM-029 AC1 the denied request had no side effect: no audit.read event and no new session', async () => {
    const account = await signedInAdministrator(current);
    current.clock.advance(MINUTES(16));
    const count = async (): Promise<[string | undefined, string | undefined]> => [
      (await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(current.database.admin)).rows[0]?.n,
      (await sql<{ n: string }>`select count(*)::text as n from identity.sessions`.execute(current.database.admin)).rows[0]?.n,
    ];
    const before = await count();
    expect((await readAudit(account.panel)).status).toBe(403);
    // nothing was written: no audit.read (nor any other event) and no session — the denial has no side effect (SR-API-06)
    expect(await count()).toEqual(before);
    expect(await events(account.user.id, 'audit.read')).toEqual([]);
  });

  it('EVM-029 AC1 a request that is not allowed for another reason is never "step_up_required": no CSRF token is csrf_failed, no cookie is 401', async () => {
    const account = await signedInAdministrator(current);
    current.clock.advance(MINUTES(16));
    const noToken = await request(server())
      .post(STEP_UP.options)
      .set('Cookie', account.panel.cookie ?? '')
      .set('Origin', PANEL_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin');
    expect(noToken.status).toBe(403);
    expect(noToken.body).toMatchObject({ code: 'csrf_failed' });
    const anonymous = await request(server()).get(STEP_UP.audit);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: 'unauthenticated' });
  });
});

describe('the window of 15 minutes (EVM-029 AC2; SR-SESS-08)', () => {
  it('EVM-029 AC2 14 minutes after the key the log opens without a step-up; at exactly 15:00 it asks for one', async () => {
    const account = await signedInAdministrator(current);
    current.clock.advance(MINUTES(14));
    expect((await readAudit(account.panel)).status).toBe(200);
    current.clock.advance(MINUTES(1) - 1);
    expect((await readAudit(account.panel)).status).toBe(200);
    current.clock.advance(1);
    const response = await readAudit(account.panel);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'step_up_required' });
  });

  it('EVM-029 AC2 a session that did not come from a key (activation, password; a recovery code in EVM-023) asks for a step-up within the 15 minutes too', async () => {
    const account = await enrolledAccount(current); // the session of the activation: no authentication with a key
    expect((await sessionsOf(account.user.id)).filter((session) => session.revoked_at === null)[0]?.passkey_authenticated_at).toBeNull();
    const response = await readAudit(account.panel);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'step_up_required' });

    const user = await createUser(current.database.admin, current.clock, { role: 'administrator' });
    const fixture = await createSession(current.database.admin, current.clock, user, { passkeyAuthenticatedAt: null });
    const other = await request(server()).get(STEP_UP.audit).set('Cookie', fixture.cookie);
    expect(other.status).toBe(403);
    expect(other.body).toMatchObject({ code: 'step_up_required' });
    const fresh = await createSession(current.database.admin, current.clock, user, { passkeyAuthenticatedAt: current.clock.now() });
    expect((await request(server()).get(STEP_UP.audit).set('Cookie', fresh.cookie)).status).toBe(200);
  });

  it('EVM-029 AC2 signing in with a key starts the window, and so does a step-up; the registration of a key does not', async () => {
    const account = await enrolledAccount(current);
    const enrolment = (await live(account.user.id))[0];
    expect(enrolment?.passkey_authenticated_at).toBeNull();
    const started = current.clock.now();
    expect((await signIn(account.panel, account)).status).toBe(200);
    expect((await live(account.user.id))[0]?.passkey_authenticated_at).toEqual(started);
  });

  it('EVM-029 AC2 a session that existed before the migration (no value) is not fresh — fail closed', async () => {
    const account = await signedInAdministrator(current);
    await sql`update identity.sessions set passkey_authenticated_at = null where user_id = ${account.user.id}`.execute(
      current.database.admin,
    );
    expect((await readAudit(account.panel)).status).toBe(403);
  });
});

describe('a new session after the step-up (EVM-029 AC3; SR-SESS-02, ASVS V7.2.4, CWE-384)', () => {
  it('EVM-029 AC3 the identifier changes, the old session is dead at once, the new one has the time of the key; the absolute limit is kept', async () => {
    const account = await signedInAdministrator(current);
    current.clock.advance(MINUTES(20));
    const [before] = await live(account.user.id);
    const oldCookie = account.panel.cookie ?? '';
    const oldCsrf = account.panel.csrfToken;
    const started = current.clock.now();

    const response = await stepUp(account.panel, account.authenticator);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown });
    expect(response.headers['cache-control']).toBe('no-store');
    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^__Host-evia_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    expect((response.body as { csrfToken: string }).csrfToken).not.toBe(oldCsrf);

    const sessions = await sessionsOf(account.user.id);
    const old = sessions.find((session) => session.id === before?.id);
    const [created] = await live(account.user.id);
    expect(await live(account.user.id)).toHaveLength(1);
    expect(created?.id).not.toBe(before?.id);
    expect(old).toMatchObject({ revoke_reason: 'rotated', revoked_at: started });
    expect(created).toMatchObject({
      user_id: account.user.id,
      channel: 'web',
      state: 'active',
      one_time_link_id: null,
      revoked_at: null,
      revoke_reason: null,
      created_at: started,
      last_seen_at: started,
      last_authenticated_at: started,
      passkey_authenticated_at: started,
    });
    expect(created?.absolute_expires_at).toEqual(before?.absolute_expires_at);
    expect(created?.idle_expires_at).toEqual(new Date(started.getTime() + 3_600_000));
    expect(created?.token_hash.equals(before?.token_hash ?? Buffer.alloc(0))).toBe(false);
    expect(Number(/Max-Age=(\d+)/.exec(cookie)?.[1])).toBe(
      Math.floor(((before?.absolute_expires_at.getTime() ?? 0) - started.getTime()) / 1000),
    );

    // the old cookie is dead at once, with the old CSRF token too; the new one works
    const stale = await request(server()).get(STEP_UP.audit).set('Cookie', oldCookie);
    expect(stale.status).toBe(401);
    expect(stale.body).toMatchObject({ code: 'session_revoked' });
    expect((await account.panel.get(PATHS.session)).body).toMatchObject({
      state: 'active',
      user: { id: account.user.id },
      csrfToken: (response.body as { csrfToken: string }).csrfToken,
    });
  });

  it('EVM-029 AC3 the audit trail has session.revoked (rotated), session.created and step_up.succeeded, with the same trace id', async () => {
    const account = await signedInAdministrator(current);
    const [before] = await live(account.user.id);
    minute();
    const started = current.clock.now();
    expect((await stepUp(account.panel, account.authenticator)).status).toBe(200);
    const [created] = await live(account.user.id);
    const rows = (
      await sql<{
        action: string;
        outcome: string;
        reason_code: string | null;
        object_id: string | null;
        session_id: string | null;
        trace_id: string;
        ip_prefix: string | null;
      }>`select action, outcome, reason_code, object_id, session_id, trace_id, ip_prefix::text as ip_prefix from audit.events
         where occurred_at = ${started} and actor_user_id = ${account.user.id} order by action`.execute(current.database.admin)
    ).rows;
    expect(rows.map((row) => [row.action, row.outcome, row.reason_code, row.object_id, row.session_id])).toEqual([
      ['session.created', 'success', null, created?.id, created?.id],
      ['session.revoked', 'success', 'rotated', before?.id, before?.id],
      ['step_up.succeeded', 'success', null, created?.id, created?.id],
    ]);
    expect(new Set(rows.map((row) => row.trace_id)).size).toBe(1);
    expect(rows.every((row) => /\/(24|48)$/.test(row.ip_prefix ?? ''))).toBe(true);
  });

  it('EVM-029 AC3 the signature counter and the time of use of the key move', async () => {
    const account = await signedInAdministrator(current);
    const key = () =>
      db()
        .selectFrom('identity.passkeys')
        .select(['counter', 'last_used_at'])
        .where('user_id', '=', account.user.id)
        .executeTakeFirstOrThrow();
    const before = await key();
    minute();
    const started = current.clock.now();
    expect((await stepUp(account.panel, account.authenticator)).status).toBe(200);
    const after = await key();
    expect(Number(after.counter)).toBe(Number(before.counter) + 1);
    expect(after.last_used_at).toEqual(started);
  });

  it('EVM-029 AC3 a step-up does not extend the life of the session: the 12-hour limit counts from the sign-in (idle deadline never past it)', async () => {
    const account = await signedInAdministrator(current);
    const [before] = await live(account.user.id);
    const nearEnd = new Date(current.clock.now().getTime() + MINUTES(30));
    await sql`update identity.sessions set absolute_expires_at = ${nearEnd} where id = ${before?.id ?? ''}`.execute(current.database.admin);
    const response = await stepUp(account.panel, account.authenticator);
    expect(response.status).toBe(200);
    const [created] = await live(account.user.id);
    expect(created?.absolute_expires_at).toEqual(nearEnd);
    expect(created?.idle_expires_at).toEqual(nearEnd);
    expect(Number(/Max-Age=(\d+)/.exec(response.headers['set-cookie']?.[0] ?? '')?.[1])).toBe(30 * 60);
  });

  it('EVM-029 AC3 two parallel step-ups with the same assertion: exactly one wins, one live session remains', async () => {
    const account = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    const body = { credential: account.authenticator.assert(options) };
    const [first, second] = await Promise.all([account.panel.post(STEP_UP.verify, body), account.panel.post(STEP_UP.verify, body)]);
    expect([first.status, second.status].sort()).toEqual([200, 401]);
    // the loser is refused either by the guard (the winner has already ended the session) or by the spent challenge
    const loser = first.status === 401 ? first : second;
    expect(['passkey_failed', 'session_revoked']).toContain((loser.body as { code: string }).code);
    expect(await live(account.user.id)).toHaveLength(1);
    expect((await events(account.user.id, 'step_up.succeeded')).length).toBe(1);
  });

  it('EVM-029 AC3 a verification that passed the guard while another one is still running finds the challenge spent: 401 passkey_failed, one session', async () => {
    const account = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    const body = { credential: account.authenticator.assert(options) };
    let slowed = false;
    passkeys.duringAssertion = async () => {
      // the first verification holds its (uncommitted) transaction open long enough for the second to pass the guard
      if (slowed) return;
      slowed = true;
      await new Promise((resolve) => setTimeout(resolve, 400));
    };
    const winner = Promise.resolve(account.panel.post(STEP_UP.verify, body));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const loser = await account.panel.post(STEP_UP.verify, body);
    expect((await winner).status).toBe(200);
    expect(loser.status).toBe(401);
    expect(loser.body).toMatchObject({ code: 'passkey_failed' });
    expect(await live(account.user.id)).toHaveLength(1);
    expect((await events(account.user.id, 'step_up.succeeded')).length).toBe(1);
    expect((await events(account.user.id, 'step_up.failed')).length).toBe(1);
  });

  it('EVM-029 AC3 a session that ended between the guard and the rotation gets 401 session_revoked and no new session', async () => {
    const account = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    const [before] = await live(account.user.id);
    passkeys.duringAssertion = async () => {
      await sql`update identity.sessions set revoked_at = ${current.clock.now()}, revoke_reason = 'logout' where id = ${before?.id ?? ''}`.execute(
        current.database.admin,
      );
    };
    const sessionsBefore = (await sessionsOf(account.user.id)).length;
    const response = await sendStepUp(account.panel, account.authenticator, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'session_revoked' });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await sessionsOf(account.user.id)).toHaveLength(sessionsBefore);
    expect(await events(account.user.id, 'step_up.succeeded')).toEqual([]);
  });

  it('EVM-029 AC3 a session that ran out of idle time is not rotated: the guard answers 401 session_expired first', async () => {
    const account = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    current.clock.advance(MINUTES(61));
    const response = await sendStepUp(account.panel, account.authenticator, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'session_expired' });
    expect(await live(account.user.id)).toHaveLength(0);
  });

  it('EVM-029 AC3 the old cookie cannot start another step-up: 401 session_revoked and nothing is created', async () => {
    const account = await signedInAdministrator(current);
    const oldCookie = account.panel.cookie ?? '';
    const oldCsrf = account.panel.csrfToken ?? '';
    expect((await stepUp(account.panel, account.authenticator)).status).toBe(200);
    const sessions = (await sessionsOf(account.user.id)).length;
    const replay = await request(server())
      .post(STEP_UP.options)
      .set('Cookie', oldCookie)
      .set('X-CSRF-Token', oldCsrf)
      .set('Origin', PANEL_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin');
    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({ code: 'session_revoked' });
    expect(await sessionsOf(account.user.id)).toHaveLength(sessions);
  });
});

describe('the passkey is the only method and a failed key keeps the dialog (EVM-029 AC4; decision 16, SR-AUTH-09)', () => {
  const MISTAKES: Array<[string, AssertionKnobs]> = [
    ['a wrong origin', { origin: 'https://evil.invalid' }],
    ['a wrong RP ID', { rpId: 'evil.invalid' }],
    ['no user verification', { userVerified: false }],
    ['no user presence', { userPresent: false }],
    ['a wrong ceremony type', { type: 'webauthn.create' }],
    ['a challenge that was never issued', { challenge: 'Z'.repeat(43) }],
    ['a forged signature (another key signs for this credential id)', { signWith: new VirtualAuthenticator() }],
    ['a signature counter that did not move forward', { counter: 0 }],
  ];

  it.each(MISTAKES)(
    'EVM-029 AC4 %s: 401 passkey_failed, the session is unchanged and works, one step_up.failed, no rotation',
    async (_label, knobs) => {
      const account = await signedInAdministrator(current);
      current.clock.advance(MINUTES(16));
      const [before] = await live(account.user.id);
      const cookie = account.panel.cookie;
      const { options } = await stepUpOptions(account.panel);
      const response = await sendStepUp(account.panel, account.authenticator, options, knobs);
      expect(response.status).toBe(401);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toMatchObject({ type: '/problems/passkey_failed', status: 401, code: 'passkey_failed' });
      expect(response.headers['set-cookie']).toBeUndefined();
      // the dialog stays: the same session is still the session, with no new passkey authentication
      expect((await live(account.user.id)).map((session) => [session.id, session.token_hash, session.passkey_authenticated_at])).toEqual([
        [before?.id, before?.token_hash, before?.passkey_authenticated_at],
      ]);
      expect(account.panel.cookie).toBe(cookie);
      expect((await account.panel.get(PATHS.session)).status).toBe(200);
      expect((await readAudit(account.panel)).body).toMatchObject({ code: 'step_up_required' });
      const failed = await events(account.user.id, 'step_up.failed');
      expect(failed).toEqual([
        expect.objectContaining({
          action: 'step_up.failed',
          outcome: 'failed',
          reason_code: 'passkey_failed',
          object_type: 'session',
          object_id: before?.id,
        }),
      ]);
      expect(await events(account.user.id, 'step_up.succeeded')).toEqual([]);
      // and a fresh attempt with the right key works (a counter that moves forward, whatever the mistake did to the authenticator)
      const { options: again } = await stepUpOptions(account.panel);
      expect((await sendStepUp(account.panel, account.authenticator, again, { counter: 5000 })).status).toBe(200);
    },
  );

  it('EVM-029 AC4 a recovery code is not a method: a body with recoveryCode is 400 validation_failed, alone or next to a credential', async () => {
    const account = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    const credential = account.authenticator.assert(options);
    for (const body of [{ recoveryCode: 'ABCD-EFGH-IJKL' }, { credential, recoveryCode: 'ABCD-EFGH-IJKL' }, { code: '123456' }, {}]) {
      const response = await account.panel.post(STEP_UP.verify, body);
      expect(response.status, JSON.stringify(Object.keys(body))).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
      expect(JSON.stringify(response.body)).not.toContain('ABCD');
    }
    expect(await live(account.user.id)).toHaveLength(1);
    expect((await events(account.user.id, 'step_up.succeeded', 'step_up.failed')).length).toBe(0);
    // the unspent challenge still serves the real attempt: a malformed body is not a verification
    expect((await account.panel.post(STEP_UP.verify, { credential })).status).toBe(200);
  });

  it('EVM-029 AC4 other fields of the credential are refused too (a strict schema)', async () => {
    const account = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    const credential = account.authenticator.assert(options);
    const response = await account.panel.post(STEP_UP.verify, { credential: { ...credential, userId: account.user.id } });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/credential/userId', code: 'unknown_field' }] });
  });

  it('EVM-029 AC4 the options list only the keys of the user of the session, with user verification required and the configured RP', async () => {
    const account = await signedInAdministrator(current);
    const stranger = await signedInAdministrator(current);
    const { response, options } = await stepUpOptions(account.panel);
    expect(response.status).toBe(200);
    expect(options).toMatchObject({ rpId: 'panel.evia.test', userVerification: 'required' });
    expect(options.allowCredentials?.map((entry) => entry.id)).toEqual([account.authenticator.credentialId.toString('base64url')]);
    expect(JSON.stringify(options)).not.toContain(stranger.authenticator.credentialId.toString('base64url'));
    expect(Buffer.from(options.challenge, 'base64url').length).toBeGreaterThanOrEqual(16);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('EVM-029 AC4 the key of another account is no key at all (IDOR): 401 passkey_failed, even with a valid signature and a real challenge', async () => {
    const account = await signedInAdministrator(current);
    const stranger = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    const response = await sendStepUp(account.panel, stranger.authenticator, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'passkey_failed' });
    expect(await live(account.user.id)).toHaveLength(1);
    expect((await live(stranger.user.id))[0]?.passkey_authenticated_at).not.toBeNull();
  });

  it("EVM-029 AC4 a userHandle that is not the account's is refused", async () => {
    const account = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    const response = await sendStepUp(account.panel, account.authenticator, options, {
      userHandle: Buffer.from('somebody else').toString('base64url'),
    });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'passkey_failed' });
  });

  it('EVM-029 AC4 a response never discloses why the key was refused: the same body for every cause, no library text', async () => {
    const account = await signedInAdministrator(current);
    const bodies: string[] = [];
    for (const [, knobs] of MISTAKES.slice(0, 3)) {
      minute();
      const { options } = await stepUpOptions(account.panel);
      const response = await sendStepUp(account.panel, account.authenticator, options, knobs);
      bodies.push(JSON.stringify({ ...(response.body as object), traceId: '' }));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toMatch(/origin|rpid|verification|signature|counter|challenge/i);
  });
});

describe('the challenge of a step-up (EVM-029 AC4; SR-AUTH-09, ASVS V7.5.3, CWE-294)', () => {
  it('EVM-029 AC4 the challenge is stored as a hash with the purpose passkey_step_up, tied to the session, valid 5 minutes', async () => {
    const account = await signedInAdministrator(current);
    const [session] = await live(account.user.id);
    const { options } = await stepUpOptions(account.panel);
    const rows = (await challenges(session?.id ?? '')).filter((row) => row.purpose === 'passkey_step_up');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: account.user.id, session_id: session?.id, login_attempt_id: null, used_at: null });
    expect(rows[0]?.challenge_hash).toEqual(createHash('sha256').update(options.challenge, 'utf8').digest());
    expect((rows[0]?.expires_at.getTime() ?? 0) - (rows[0]?.created_at.getTime() ?? 0)).toBe(5 * 60_000);
    expect(JSON.stringify(rows)).not.toContain(options.challenge);
  });

  it('EVM-029 AC4 asking for new options retires the earlier challenge: an assertion over the old one is refused', async () => {
    const account = await signedInAdministrator(current);
    const { options: first } = await stepUpOptions(account.panel);
    const { options: second } = await stepUpOptions(account.panel);
    expect(second.challenge).not.toBe(first.challenge);
    const [session] = await live(account.user.id);
    expect((await challenges(session?.id ?? '')).filter((row) => row.purpose === 'passkey_step_up' && row.used_at === null)).toHaveLength(
      1,
    );
    expect((await sendStepUp(account.panel, account.authenticator, first)).status).toBe(401);
  });

  it('EVM-029 AC4 a challenge is used once, also when the first use failed: the next assertion over it is refused', async () => {
    const account = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    expect((await sendStepUp(account.panel, account.authenticator, options, { userVerified: false })).status).toBe(401);
    const [session] = await live(account.user.id);
    expect(
      (await challenges(session?.id ?? '')).filter((row) => row.purpose === 'passkey_step_up').every((row) => row.used_at !== null),
    ).toBe(true);
    const replay = await sendStepUp(account.panel, account.authenticator, options);
    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({ code: 'passkey_failed' });
    expect((await live(account.user.id)).map((live) => live.id)).toEqual([session?.id]);
  });

  it('EVM-029 AC4 a challenge that expired (5 minutes) is refused, exactly at the deadline too', async () => {
    const account = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    current.clock.advance(MINUTES(5));
    const response = await sendStepUp(account.panel, account.authenticator, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'passkey_failed' });
    const fresh = await stepUpOptions(account.panel);
    current.clock.advance(MINUTES(5) - 1);
    expect((await sendStepUp(account.panel, account.authenticator, fresh.options)).status).toBe(200);
  });

  it('EVM-029 AC4 the challenge of another session of the same user is no challenge of this one', async () => {
    const account = await signedInAdministrator(current);
    const other = current.panel();
    minute();
    expect((await signIn(other, account)).status).toBe(200);
    const { options } = await stepUpOptions(account.panel);
    const response = await sendStepUp(other, account.authenticator, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'passkey_failed' });
    expect(await live(account.user.id)).toHaveLength(2);
    expect((await sendStepUp(account.panel, account.authenticator, (await stepUpOptions(account.panel)).options)).status).toBe(200);
  });

  it('EVM-029 AC4 a registration challenge cannot serve a step-up: it stays open and the step-up is refused', async () => {
    const account = await signedInAdministrator(current);
    const [session] = await live(account.user.id);
    const challenge = 'R'.repeat(43);
    await db()
      .insertInto('identity.webauthn_challenges')
      .values({
        user_id: account.user.id,
        session_id: session?.id ?? '',
        purpose: 'passkey_registration',
        challenge_hash: createHash('sha256').update(challenge, 'utf8').digest(),
        created_at: current.clock.now(),
        expires_at: new Date(current.clock.now().getTime() + MINUTES(5)),
        used_at: null,
      })
      .execute();
    const { options } = await stepUpOptions(account.panel);
    const response = await sendStepUp(account.panel, account.authenticator, { ...options, challenge });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'passkey_failed' });
    const rows = await challenges(session?.id ?? '');
    expect(rows.filter((row) => row.purpose === 'passkey_registration').map((row) => row.used_at)).toEqual([null]);
  });

  it('EVM-029 AC4 a step-up challenge cannot serve the registration of a key: it stays open and the registration is refused', async () => {
    const pending = await current.pendingAdministrator();
    const panel = current.panel();
    const activated = await panel.post(PATHS.password, { token: pending.link.token, password: 'Zq9-lamp-Orbit-4' });
    expect(activated.status).toBe(200);
    panel.adopt(activated.headers['set-cookie']);
    panel.csrfToken = (activated.body as { csrfToken: string }).csrfToken;
    const [session] = await live(pending.user.id);
    const challenge = 'S'.repeat(43);
    await db()
      .insertInto('identity.webauthn_challenges')
      .values({
        user_id: pending.user.id,
        session_id: session?.id ?? '',
        purpose: 'passkey_step_up',
        challenge_hash: createHash('sha256').update(challenge, 'utf8').digest(),
        created_at: current.clock.now(),
        expires_at: new Date(current.clock.now().getTime() + MINUTES(5)),
        used_at: null,
      })
      .execute();
    const { options } = await passkeyOptions(panel);
    const response = await panel.post(PATHS.passkeys, { credential: new VirtualAuthenticator().register({ ...options, challenge }) });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'passkey_verification_failed' });
    expect((await challenges(session?.id ?? '')).filter((row) => row.purpose === 'passkey_step_up').map((row) => row.used_at)).toEqual([
      null,
    ]);
  });

  it('EVM-029 AC4 an account without keys gets no options (403) and nothing is stored', async () => {
    const account = await signedInAdministrator(current);
    await db().deleteFrom('identity.passkeys').where('user_id', '=', account.user.id).execute();
    const response = await account.panel.post(STEP_UP.options);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'forbidden' });
    const [session] = await live(account.user.id);
    expect((await challenges(session?.id ?? '')).filter((row) => row.purpose === 'passkey_step_up')).toEqual([]);
  });

  it('EVM-029 AC4 the options take no body (a body naming anything is 400)', async () => {
    const account = await signedInAdministrator(current);
    const response = await account.panel.post(STEP_UP.options, { userId: account.user.id });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
  });
});

describe('access to the step-up operations (EVM-029 AC7; SR-AUTHZ-01, SR-AUTHZ-12, SR-API-02)', () => {
  it('EVM-029 AC7 Editor and Read-only are 403 forbidden on both operations, anonymous is 401, a session in mfa_enrollment is 403 mfa_enrollment_required', async () => {
    for (const role of ['editor', 'read_only'] as const) {
      const account = await signedInAdministrator(current, { role });
      for (const path of [STEP_UP.options, STEP_UP.verify]) {
        const response = await account.panel.post(path, path === STEP_UP.verify ? { credential: {} } : undefined);
        expect(response.status, `${role} ${path}`).toBe(403);
        expect(response.body, `${role} ${path}`).toMatchObject({ code: 'forbidden' });
      }
    }
    for (const path of [STEP_UP.options, STEP_UP.verify]) {
      const anonymous = await request(server()).post(path).set('Origin', PANEL_ORIGIN).set('Sec-Fetch-Site', 'same-origin').send({});
      expect(anonymous.status).toBe(401);
    }
    const pending = await current.pendingAdministrator();
    const panel = current.panel();
    const activated = await panel.post(PATHS.password, { token: pending.link.token, password: 'Zq9-lamp-Orbit-4' });
    panel.adopt(activated.headers['set-cookie']);
    panel.csrfToken = (activated.body as { csrfToken: string }).csrfToken;
    for (const path of [STEP_UP.options, STEP_UP.verify]) {
      const response = await panel.post(path, path === STEP_UP.verify ? { credential: {} } : undefined);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'mfa_enrollment_required' });
    }
  });

  it('EVM-029 AC4 both operations need the CSRF token and the Origin of the panel, like every mutation with a session', async () => {
    const account = await signedInAdministrator(current);
    const cookie = account.panel.cookie ?? '';
    for (const path of [STEP_UP.options, STEP_UP.verify]) {
      const noToken = await request(server())
        .post(path)
        .set('Cookie', cookie)
        .set('Origin', PANEL_ORIGIN)
        .set('Sec-Fetch-Site', 'same-origin')
        .send({});
      expect(noToken.body, path).toMatchObject({ code: 'csrf_failed' });
      const foreign = await request(server())
        .post(path)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', account.panel.csrfToken ?? '')
        .set('Origin', 'https://evil.invalid')
        .set('Sec-Fetch-Site', 'cross-site')
        .send({});
      expect(foreign.body, path).toMatchObject({ code: 'csrf_failed' });
    }
  });

  it('EVM-029 AC8 both operations are limited to 20 requests a minute per address (429 with Retry-After), counted before the database', async () => {
    const account = await signedInAdministrator(current);
    minute();
    const results: number[] = [];
    let last = await account.panel.post(STEP_UP.options);
    results.push(last.status);
    for (let index = 1; index < 21; index += 1) {
      last = await account.panel.post(STEP_UP.options);
      results.push(last.status);
    }
    expect(results.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(results[20]).toBe(429);
    expect(last.headers['retry-after']).toMatch(/^[0-9]+$/);
    expect(last.headers['content-type']).toContain('application/problem+json');
    expect(last.body).toMatchObject({ code: 'rate_limited', status: 429 });

    minute();
    const verify: number[] = [];
    let denied = await account.panel.post(STEP_UP.verify, { credential: {} });
    verify.push(denied.status);
    for (let index = 1; index < 21; index += 1) {
      denied = await account.panel.post(STEP_UP.verify, { credential: {} });
      verify.push(denied.status);
    }
    expect(verify.slice(0, 20).every((status) => status === 400)).toBe(true);
    expect(verify[20]).toBe(429);
    expect(denied.headers['retry-after']).toMatch(/^[0-9]+$/);
  });
});

describe('what is logged (EVM-029; SR-LOG-02, SR-LOG-05; CWE-532)', () => {
  it('EVM-029 neither the application log nor an error carries the assertion, a session token or a CSRF token of a step-up (success and failure)', async () => {
    const account = await signedInAdministrator(current);
    const { options } = await stepUpOptions(account.panel);
    const bad = account.authenticator.assert(options, { userVerified: false });
    expect((await account.panel.post(STEP_UP.verify, { credential: bad })).status).toBe(401);
    const { options: fresh } = await stepUpOptions(account.panel);
    const good = account.authenticator.assert(fresh);
    const response = await account.panel.post(STEP_UP.verify, { credential: good });
    expect(response.status).toBe(200);
    const token = /^__Host-evia_session=([^;]+)/.exec(response.headers['set-cookie']?.[0] ?? '')?.[1] ?? '';
    const logs = current.logs.text;
    for (const secret of [
      token,
      (response.body as { csrfToken: string }).csrfToken,
      good.response.signature,
      good.response.clientDataJSON,
      good.response.authenticatorData,
      bad.response.signature,
      options.challenge,
      fresh.challenge,
      account.panel.csrfToken ?? '',
    ]) {
      expect(secret.length).toBeGreaterThan(10);
      expect(logs).not.toContain(secret);
    }
  });
});

describe('every other way of starting a session leaves the window closed (EVM-029 AC2; SR-SESS-08)', () => {
  const account = async (): Promise<EnrolledAccount> => enrolledAccount(current);

  it('EVM-029 AC2 activation, enrolment and a password-only session have no passkey authentication; only the second step of the sign-in and a step-up set it', async () => {
    const pending = await current.pendingAdministrator();
    const panel = current.panel();
    const activated = await panel.post(PATHS.password, { token: pending.link.token, password: 'Zq9-lamp-Orbit-4' });
    expect(activated.status).toBe(200);
    expect((await live(pending.user.id)).map((session) => [session.state, session.passkey_authenticated_at])).toEqual([
      ['mfa_enrollment', null],
    ]);
    panel.adopt(activated.headers['set-cookie']);
    panel.csrfToken = (activated.body as { csrfToken: string }).csrfToken;
    const { options } = await passkeyOptions(panel);
    const registered = await panel.post(PATHS.passkeys, { credential: new VirtualAuthenticator().register(options) });
    expect(registered.status).toBe(201);
    expect((await live(pending.user.id)).map((session) => [session.state, session.passkey_authenticated_at])).toEqual([['active', null]]);

    const enrolled = await account();
    const loggedIn = enrolled.panel;
    expect((await live(enrolled.user.id))[0]?.passkey_authenticated_at).toBeNull();
    expect((await signIn(loggedIn, enrolled)).status).toBe(200);
    expect((await live(enrolled.user.id))[0]?.passkey_authenticated_at).not.toBeNull();
  });
});
