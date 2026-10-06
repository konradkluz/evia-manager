import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimpleWebAuthnPasskeys } from '../../src/modules/identity/infrastructure/simplewebauthn-passkeys.ts';
import { PASSKEY_VERIFIER, type PasskeyVerifier } from '../../src/modules/identity/infrastructure/ports.ts';
import { hashToken } from '../../src/modules/identity/domain/tokens.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { POLICY_SOURCE } from '../../src/modules/authorization/index.ts';
import { activateAdministrator, passkeyOptions, PATHS, registerPasskey, setPassword } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { ProtectedRouteModule, TEST_POLICIES } from '../support/test-routes.ts';
import { VirtualAuthenticator } from '../support/virtual-authenticator.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp({
    imports: [ProtectedRouteModule],
    configure: (builder) => builder.overrideProvider(POLICY_SOURCE).useValue(TEST_POLICIES),
  });
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const audit = async () =>
  (
    await sql<{ action: string; outcome: string; reason_code: string | null }>`
      select action, outcome, reason_code from audit.events order by occurred_at, id`.execute(current.database.admin)
  ).rows;

/** A browser that has set the password and now waits in W-03. */
async function enrolling(linkTtlMs?: number) {
  const { user, link } = await current.pendingAdministrator(linkTtlMs === undefined ? {} : { ttlMs: linkTtlMs });
  const panel = current.panel();
  expect((await setPassword(panel, link.token)).status).toBe(200);
  return { user, link, panel };
}

describe('only the passkey while the account has none (EVM-016 AC4; SR-AUTH-06, P1)', () => {
  it('EVM-016 AC4 every operation outside the enrolment list answers 403 mfa_enrollment_required to the enrolment session', async () => {
    const { panel } = await enrolling();
    const response = await panel.get('/api/v1/work-orders');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'mfa_enrollment_required', status: 403 });
  });

  it('EVM-016 AC4 the session view works in the enrolment state and says so (the panel recovers its CSRF token after a reload)', async () => {
    const { panel, user } = await enrolling();
    const csrfToken = panel.csrfToken;
    const view = await panel.get(PATHS.session);
    expect(view.status).toBe(200);
    expect(view.body).toEqual({
      user: { id: user.id, displayName: expect.any(String) as unknown, role: 'administrator' },
      state: 'mfa_enrollment',
      channel: 'web',
      csrfToken,
    });
  });

  it('EVM-016 AC4 the options ask for user verification, carry the configured RP and a one-time challenge stored only as a hash for 5 minutes', async () => {
    const { panel, user } = await enrolling();
    const { response, options } = await passkeyOptions(panel);
    expect(response.status).toBe(200);
    expect(options.rp).toEqual({ id: 'panel.evia.test', name: 'EVia Manager' });
    expect(options.authenticatorSelection).toMatchObject({ userVerification: 'required' });
    expect(options.attestation).toBe('none');
    expect(options.user.name).toBe(
      (await db().selectFrom('identity.users').select('email').where('id', '=', user.id).executeTakeFirstOrThrow()).email,
    );
    expect(options.user.id).not.toContain('@');

    const challenge = await db().selectFrom('identity.webauthn_challenges').selectAll().executeTakeFirstOrThrow();
    expect(challenge.challenge_hash.equals(hashToken(options.challenge))).toBe(true);
    expect(challenge).toMatchObject({ user_id: user.id, purpose: 'passkey_registration', used_at: null });
    expect(challenge.expires_at.getTime() - challenge.created_at.getTime()).toBe(5 * 60_000);
    expect(JSON.stringify(challenge)).not.toContain(options.challenge);
  });

  it('EVM-016 AC4 asking again retires the earlier challenge: only the newest can be answered', async () => {
    const { panel } = await enrolling();
    const first = (await passkeyOptions(panel)).options;
    const second = (await passkeyOptions(panel)).options;
    const authenticator = new VirtualAuthenticator();
    expect((await registerPasskey(panel, first, authenticator)).status).toBe(400);
    expect((await registerPasskey(panel, second, authenticator)).status).toBe(201);
  });
});

describe('registering the passkey (EVM-016 AC4; SR-AUTH-09, SR-SESS-02, ASVS V6.3.3, V7.2.4)', () => {
  it('EVM-016 AC4 a good response activates the account, uses the link up and replaces the session with a new identifier', async () => {
    const { panel, user, link } = await enrolling();
    const oldCookie = panel.cookie;
    const { options } = await passkeyOptions(panel);
    const response = await registerPasskey(panel, options);

    expect(response.status).toBe(201);
    expect(Object.keys(response.body as object).sort()).toEqual(['backedUp', 'createdAt', 'deviceType', 'id']);
    expect(response.body).toMatchObject({ deviceType: 'single_device', backedUp: false });
    expect(JSON.stringify(response.body)).not.toMatch(/csrf|session|token|publicKey/i);

    expect(panel.cookie).toBeDefined();
    expect(panel.cookie).not.toBe(oldCookie);
    const stale = current.panel();
    stale.cookie = oldCookie;
    const old = await stale.get(PATHS.session);
    expect(old.status).toBe(401);
    expect(old.body).toMatchObject({ code: 'session_revoked' });

    const session = await panel.get(PATHS.session);
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ state: 'active', channel: 'web', user: { id: user.id, role: 'administrator' } });

    expect(
      await db()
        .selectFrom('identity.users')
        .select(['status', 'version', 'last_login_at'])
        .where('id', '=', user.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      status: 'active',
      version: 2,
      last_login_at: current.clock.now(),
    });
    expect(
      (await db().selectFrom('identity.one_time_links').select('used_at').where('id', '=', link.id).executeTakeFirstOrThrow()).used_at,
    ).toEqual(current.clock.now());
    expect(await db().selectFrom('identity.passkeys').select(['user_id', 'device_type', 'counter']).execute()).toEqual([
      { user_id: user.id, device_type: 'single_device', counter: '0' },
    ]);
    expect(await db().selectFrom('identity.webauthn_challenges').select('used_at').execute()).toEqual([{ used_at: current.clock.now() }]);

    // the link no longer works (AC4: "link przestaje działać")
    const reuse = await current.panel().post(PATHS.check, { token: link.token });
    expect(reuse.status).toBe(400);
    expect(reuse.body).toMatchObject({ code: 'activation_link_invalid' });
    expect((await current.panel().post(PATHS.password, { token: link.token, password: 'Another-Orbit-Lamp-7' })).body).toMatchObject({
      code: 'activation_link_invalid',
    });
  });

  it('EVM-016 AC4 the new session has the new CSRF token and nothing of the enrolment session survives', async () => {
    const { panel } = await enrolling();
    const enrolmentToken = panel.csrfToken;
    const { options } = await passkeyOptions(panel);
    await registerPasskey(panel, options);
    const view = await panel.get(PATHS.session);
    const fresh = (view.body as { csrfToken: string }).csrfToken;
    expect(fresh).not.toBe(enrolmentToken);
    panel.csrfToken = enrolmentToken;
    expect((await panel.post(PATHS.logout)).status).toBe(403);
    panel.csrfToken = fresh;
    expect((await panel.post(PATHS.logout)).status).toBe(204);
  });

  it.each([
    ['an origin of another site', { origin: 'https://panel.evia.invalid' }],
    ['another RP ID', { rpId: 'evia.invalid' }],
    ['no user verification', { userVerified: false }],
    ['no user presence', { userPresent: false }],
    ['the wrong ceremony type', { type: 'webauthn.get' }],
  ])(
    'EVM-016 AC4 a response with %s is 400 passkey_verification_failed, the account stays unchanged and the attempt is audited as failed',
    async (_label, knobs) => {
      const { panel, user, link } = await enrolling();
      const { options } = await passkeyOptions(panel);
      const before = await db().selectFrom('identity.users').selectAll().where('id', '=', user.id).executeTakeFirstOrThrow();
      const response = await registerPasskey(panel, options, new VirtualAuthenticator(), knobs);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'passkey_verification_failed', status: 400 });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await db().selectFrom('identity.users').selectAll().where('id', '=', user.id).executeTakeFirstOrThrow()).toEqual(before);
      expect(await db().selectFrom('identity.passkeys').selectAll().execute()).toEqual([]);
      expect(
        (await db().selectFrom('identity.one_time_links').select('used_at').where('id', '=', link.id).executeTakeFirstOrThrow()).used_at,
      ).toBeNull();
      const events = await audit();
      expect(events.at(-1)).toMatchObject({ action: 'passkey.registered', outcome: 'failed', reason_code: 'verification_failed' });
      // the session still works and a correct response is still accepted afterwards
      expect((await panel.get(PATHS.session)).status).toBe(200);
      expect((await registerPasskey(panel, options)).status).toBe(201);
    },
  );

  it('EVM-016 AC4 a challenge is used once: of two parallel registrations with the same response exactly one wins', async () => {
    const { panel } = await enrolling();
    const { options } = await passkeyOptions(panel);
    const credential = new VirtualAuthenticator().register(options, { origin: 'https://panel.evia.test' });
    const [first, second] = await Promise.all([panel.post(PATHS.passkeys, { credential }), panel.post(PATHS.passkeys, { credential })]);
    expect([first.status, second.status].filter((status) => status === 201)).toHaveLength(1);
    expect([first.status, second.status].filter((status) => status !== 201)[0]).toBeGreaterThanOrEqual(400);
    expect(await db().selectFrom('identity.passkeys').selectAll().execute()).toHaveLength(1);
    expect(await db().selectFrom('identity.users').select('version').where('status', '=', 'active').execute()).toEqual([{ version: 2 }]);
  });

  it('EVM-016 AC4 parallel registrations with different challenges of one session: the session and the link allow exactly one (A1b)', async () => {
    const { panel } = await enrolling();
    const first = (await passkeyOptions(panel)).options;
    // two answers to the same challenge are the only way to have two valid ones (a new options call retires the old challenge)
    const credential = new VirtualAuthenticator().register(first, { origin: 'https://panel.evia.test' });
    const other = new VirtualAuthenticator().register(first, { origin: 'https://panel.evia.test' });
    const results = await Promise.all([panel.post(PATHS.passkeys, { credential }), panel.post(PATHS.passkeys, { credential: other })]);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(await db().selectFrom('identity.passkeys').selectAll().execute()).toHaveLength(1);
  });

  it('EVM-016 AC4 the challenge of another session cannot be answered (IDOR of the ceremony)', async () => {
    const victim = await enrolling();
    const attacker = await enrolling();
    const { options } = await passkeyOptions(victim.panel);
    const before = await db().selectFrom('identity.users').selectAll().execute();
    const response = await registerPasskey(attacker.panel, options);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'passkey_verification_failed' });
    expect(await db().selectFrom('identity.users').selectAll().execute()).toEqual(before);
    expect(await db().selectFrom('identity.passkeys').selectAll().execute()).toEqual([]);
    // the victim's challenge is untouched and still works for the victim
    expect((await registerPasskey(victim.panel, options)).status).toBe(201);
  });

  it('EVM-016 AC4 the body cannot name a user or a session: userId, sessionId and any other field are validation errors', async () => {
    const { panel, user } = await enrolling();
    const { options } = await passkeyOptions(panel);
    const credential = new VirtualAuthenticator().register(options, { origin: 'https://panel.evia.test' });
    for (const extra of [{ userId: user.id }, { sessionId: user.id }, { role: 'administrator' }]) {
      const response = await panel.post(PATHS.passkeys, { credential, ...extra });
      expect(response.status, JSON.stringify(extra)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    const nested = await panel.post(PATHS.passkeys, { credential: { ...credential, userId: user.id } });
    expect(nested.body).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/credential/userId', code: 'unknown_field' }] });
    expect(await db().selectFrom('identity.passkeys').selectAll().execute()).toEqual([]);
  });

  it('EVM-016 AC4 the challenge expires after 5 minutes: answering after 5:01 is refused, before 5:00 it is accepted', async () => {
    const late = await enrolling();
    const { options: lateOptions } = await passkeyOptions(late.panel);
    current.clock.advance(5 * 60_000 + 1000);
    const refused = await registerPasskey(late.panel, lateOptions);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'passkey_verification_failed' });
    const timely = await enrolling();
    const { options } = await passkeyOptions(timely.panel);
    current.clock.advance(4 * 60_000 + 59_000);
    expect((await registerPasskey(timely.panel, options)).status).toBe(201);
  });

  it('EVM-016 AC4 a credential cannot be registered for two accounts (credential_id is unique)', async () => {
    const authenticator = new VirtualAuthenticator();
    const first = await enrolling();
    expect((await registerPasskey(first.panel, (await passkeyOptions(first.panel)).options, authenticator)).status).toBe(201);
    const second = await enrolling();
    const { options } = await passkeyOptions(second.panel);
    const response = await registerPasskey(second.panel, options, authenticator);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'passkey_verification_failed' });
    expect(
      (await db().selectFrom('identity.users').select('status').where('id', '=', second.user.id).executeTakeFirstOrThrow()).status,
    ).toBe('invited');
    expect(
      (await db().selectFrom('identity.one_time_links').select('used_at').where('id', '=', second.link.id).executeTakeFirstOrThrow())
        .used_at,
    ).toBeNull();
    expect((await audit()).at(-1)).toMatchObject({ action: 'passkey.registered', outcome: 'failed' });
  });

  it('EVM-016 AC4 an active account cannot register a further key here (that is EVM-028)', async () => {
    const { panel } = await activateAdministrator(current);
    const { options } = await passkeyOptions(panel);
    const response = await registerPasskey(panel, options);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'forbidden' });
    expect(await db().selectFrom('identity.passkeys').selectAll().execute()).toHaveLength(1);
  });
});

describe('the link and the enrolment session live and die together (EVM-016 AC4, AC5; A1)', () => {
  it('EVM-016 AC4 when the link expires during the ceremony the enrolment session is revoked: 401 session_revoked and nothing changes', async () => {
    const { panel, link } = await enrolling();
    const { options } = await passkeyOptions(panel);
    current.clock.set(new Date(current.clock.now().getTime() + 72 * 3_600_000));
    const before = await current.snapshot();
    const response = await registerPasskey(panel, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'session_revoked' });
    expect((await panel.get(PATHS.session)).body).toMatchObject({ code: 'session_revoked' });
    expect(await current.snapshot()).toBe(before);
    expect(link.id).toBeDefined();
  });

  it('EVM-016 AC4 a link superseded while the enrolment session exists revokes that session (a leaked link cannot finish the activation)', async () => {
    const { panel, link } = await enrolling();
    const { options } = await passkeyOptions(panel);
    await db().updateTable('identity.one_time_links').set({ superseded_at: current.clock.now() }).where('id', '=', link.id).execute();
    const response = await registerPasskey(panel, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'session_revoked' });
    expect(await db().selectFrom('identity.passkeys').selectAll().execute()).toEqual([]);
    expect((await db().selectFrom('identity.users').select('status').executeTakeFirstOrThrow()).status).toBe('invited');
  });

  it('EVM-016 AC4 a link that expires between verification and the transaction is refused inside the transaction (atomic UPDATE with :now)', async () => {
    await current.close();
    let real: SimpleWebAuthnPasskeys | undefined;
    const racing: PasskeyVerifier = {
      registrationOptions: (input) =>
        (real ??= new SimpleWebAuthnPasskeys({
          rpId: 'panel.evia.test',
          rpName: 'EVia Manager',
          origin: 'https://panel.evia.test',
        })).registrationOptions(input),
      verifyRegistration: async (response, challenge) => {
        real ??= new SimpleWebAuthnPasskeys({ rpId: 'panel.evia.test', rpName: 'EVia Manager', origin: 'https://panel.evia.test' });
        const verified = await real.verifyRegistration(response, challenge);
        current.clock.advance(4 * 60_000); // the link expires while the response was being verified
        return verified;
      },
    };
    current = await createIdentityApp({ configure: (builder) => builder.overrideProvider(PASSKEY_VERIFIER).useValue(racing) });
    // the link lives 3 minutes, the challenge 5: verification outlasts the link but not the challenge
    const { panel } = await enrolling(3 * 60_000);
    const { options } = await passkeyOptions(panel);
    const before = await db().selectFrom('identity.users').selectAll().execute();
    const response = await registerPasskey(panel, options);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'session_revoked' });
    expect(await db().selectFrom('identity.users').selectAll().execute()).toEqual(before);
    expect(await db().selectFrom('identity.passkeys').selectAll().execute()).toEqual([]);
    expect((await db().selectFrom('identity.webauthn_challenges').select('used_at').execute())[0]?.used_at).toBeNull();
  });
});
