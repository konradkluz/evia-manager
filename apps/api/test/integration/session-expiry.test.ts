import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../../src/modules/identity/index.ts';
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/argon2-password-hasher.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { passkeyOptions, PATHS, registerPasskey, setPassword } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { enrolledAccount, firstStep, LOGIN, PASSWORD, signIn } from '../support/login-flows.ts';
import { HOUR, MINUTE } from '../support/clock.ts';
import type { PanelClient } from '../support/panel-client.ts';
import { VirtualAuthenticator } from '../support/virtual-authenticator.ts';

/** The session of the story (AC5): started 2026-10-05 08:00 UTC (10:00 Europe/Warsaw, CEST), the clock is controlled. */
const START = '2026-10-05T08:00:00.000Z';
const at = (time: string): string => `2026-10-05T${time}:00.000Z`;

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp({ now: '2026-10-05T07:00:00.000Z' });
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const server = () => current.app.getHttpServer();

/** A signed-in browser whose session started exactly at START. */
async function signedIn(role: 'administrator' | 'editor' | 'read_only' = 'administrator') {
  const account = await enrolledAccount(current, { role });
  current.clock.set(START);
  const panel = current.panel();
  expect((await signIn(panel, account)).status).toBe(200);
  const [session] = await db()
    .selectFrom('identity.sessions')
    .selectAll()
    .where('user_id', '=', account.user.id)
    .orderBy('created_at', 'desc')
    .limit(1)
    .execute();
  return { account, panel, sessionId: session?.id ?? '' };
}

const sessionRow = (sessionId: string) =>
  db().selectFrom('identity.sessions').selectAll().where('id', '=', sessionId).executeTakeFirstOrThrow();
const expiredAudit = async () =>
  (
    await sql<{
      session_id: string;
      actor_user_id: string;
      reason_code: string;
    }>`select session_id, actor_user_id, reason_code from audit.events where action = 'session.expired'`.execute(current.database.admin)
  ).rows;
/** An activity of the session that is not passive: asking for the options of a key (any role, any state). */
const activity = (panel: PanelClient) => panel.post(PATHS.options);
const at$ = (time: string): void => {
  current.clock.set(at(time));
};

describe('expiry of the session (EVM-067 AC5; SR-SESS-03, ASVS V7.3.1, V7.3.2, CWE-613)', () => {
  it('EVM-067 AC5 the session of 2026-10-05 08:00 works at 08:59 and is 401 session_expired after 60 minutes without activity, at once and on every later request', async () => {
    const { panel, sessionId } = await signedIn();
    expect((await sessionRow(sessionId)).idle_expires_at).toEqual(new Date(at('09:00')));
    current.clock.set('2026-10-05T08:59:59.999Z');
    expect((await panel.get(PATHS.session)).status).toBe(200);
    current.clock.set(at('09:00')); // the deadline itself is already over
    for (const attempt of [1, 2]) {
      const response = await panel.get(PATHS.session);
      expect(response.status, `request ${attempt}`).toBe(401);
      expect(response.body, `request ${attempt}`).toMatchObject({ code: 'session_expired', title: 'Session expired' });
    }
    current.clock.set(at('09:01'));
    expect((await panel.get(PATHS.session)).body).toMatchObject({ code: 'session_expired' });
    expect(await sessionRow(sessionId)).toMatchObject({ revoke_reason: 'expired', revoked_at: new Date(at('09:00')) });
    // a mutation of an expired session is refused for the same reason (the CSRF token is checked only for a live session)
    expect((await panel.post(LOGIN.extend)).body).toMatchObject({ code: 'session_expired' });
  });

  it('EVM-067 AC5 session.expired is audited exactly once, however many requests find the session expired, even at the same moment', async () => {
    const { panel, account, sessionId } = await signedIn();
    current.clock.set(at('10:30'));
    const answers = await Promise.all([1, 2, 3, 4, 5].map(() => panel.get(PATHS.session)));
    expect(answers.map((answer) => (answer.body as { code: string }).code)).toEqual(Array<string>(5).fill('session_expired'));
    expect(await panel.get(PATHS.session)).toMatchObject({ status: 401 });
    expect(await expiredAudit()).toEqual([{ session_id: sessionId, actor_user_id: account.user.id, reason_code: 'expired' }]);
  });

  it('EVM-067 AC5 activity keeps the session alive, but never past 12 hours from the sign-in: at 20:00 it is 401 even though the last request was half an hour earlier', async () => {
    const { panel, sessionId } = await signedIn();
    for (let minutes = 30; minutes < 12 * 60; minutes += 30) {
      current.clock.set(new Date(new Date(START).getTime() + minutes * MINUTE));
      const response = await activity(panel);
      expect(response.status, `+${minutes} min`).toBe(200);
      current.clock.advance(61_000); // another minute for the limit of the key ceremony; harmless for the session
    }
    // the last activity was at 19:30: the idle deadline is capped by the absolute one
    expect((await sessionRow(sessionId)).idle_expires_at).toEqual(new Date(at('20:00')));
    expect((await sessionRow(sessionId)).absolute_expires_at).toEqual(new Date(at('20:00')));
    current.clock.set('2026-10-05T19:59:59.000Z');
    expect((await panel.get(PATHS.session)).status).toBe(200);
    current.clock.set(at('20:00'));
    const response = await panel.get(PATHS.session);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'session_expired' });
  });

  it('EVM-067 AC5 the idle deadline follows the activity (60 minutes from it) and is written at most every 30 seconds', async () => {
    const { panel, sessionId } = await signedIn();
    current.clock.set('2026-10-05T08:10:00.000Z');
    expect((await activity(panel)).status).toBe(200);
    expect(await sessionRow(sessionId)).toMatchObject({
      last_seen_at: new Date('2026-10-05T08:10:00.000Z'),
      idle_expires_at: new Date('2026-10-05T09:10:00.000Z'),
    });
    current.clock.set('2026-10-05T08:10:29.000Z'); // within 30 seconds: not written
    expect((await activity(panel)).status).toBe(200);
    expect((await sessionRow(sessionId)).last_seen_at).toEqual(new Date('2026-10-05T08:10:00.000Z'));
    current.clock.set('2026-10-05T08:10:30.000Z');
    expect((await activity(panel)).status).toBe(200);
    expect(await sessionRow(sessionId)).toMatchObject({
      last_seen_at: new Date('2026-10-05T08:10:30.000Z'),
      idle_expires_at: new Date('2026-10-05T09:10:30.000Z'),
    });
  });

  it('EVM-067 AC5 reading the session (the passive request of the warning) does not move the deadlines, so polling cannot keep a session alive', async () => {
    const { panel, sessionId } = await signedIn();
    for (const time of ['08:20', '08:40', '08:59']) {
      at$(time);
      const response = await panel.get(PATHS.session);
      expect(response.body).toMatchObject({ idleExpiresAt: at('09:00'), absoluteExpiresAt: at('20:00') });
    }
    expect(await sessionRow(sessionId)).toMatchObject({ last_seen_at: new Date(START), idle_expires_at: new Date(at('09:00')) });
    at$('09:01');
    expect((await panel.get(PATHS.session)).status).toBe(401);
  });

  it('EVM-067 AC5 a session revoked and then past its deadline is session_revoked (revoked is decided before expired), and a revoked one is not audited as expired', async () => {
    const { panel } = await signedIn();
    expect((await panel.post(PATHS.logout)).status).toBe(204);
    at$('11:00');
    expect((await panel.get(PATHS.session)).body).toMatchObject({ code: 'session_revoked' });
    expect(await expiredAudit()).toEqual([]);
  });

  it('EVM-067 AC5 an expired session never comes back: neither a late activity record nor an extension revives it', async () => {
    const { panel, sessionId } = await signedIn();
    const sessions = current.app.get(SessionService, { strict: false });
    const context = { origin: 'web', traceId: 'a'.repeat(32) } as const;
    current.clock.set('2026-10-05T08:59:00.000Z');
    const authentication = await sessions.authenticate(panel.cookie, context);
    if (authentication.principal === null) throw new Error('the session should be alive at 08:59');
    current.clock.set('2026-10-05T09:00:01.000Z'); // it runs out while the request is being handled
    await authentication.touch?.();
    await expect(sessions.extend(authentication.principal)).rejects.toMatchObject({ code: 'session_expired' });
    await expect(sessions.extend(authentication.principal)).rejects.toBeInstanceOf(ProblemException);
    expect(await sessionRow(sessionId)).toMatchObject({
      last_seen_at: new Date(START),
      idle_expires_at: new Date(at('09:00')),
      revoked_at: null,
    });
    expect((await panel.get(PATHS.session)).body).toMatchObject({ code: 'session_expired' });
  });
});

describe('extension of the session, the warning P-11 (EVM-067 AC6; SR-SESS-03, SR-WEB-05)', () => {
  it('EVM-067 AC6 the extension restarts the idle time from now, without changing the absolute limit, and the session then lives as long as the new deadline says', async () => {
    const { panel, sessionId } = await signedIn();
    at$('08:50');
    const response = await panel.post(LOGIN.extend);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ idleExpiresAt: at('09:50'), absoluteExpiresAt: at('20:00') });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await sessionRow(sessionId)).toMatchObject({
      idle_expires_at: new Date(at('09:50')),
      absolute_expires_at: new Date(at('20:00')),
    });
    current.clock.set('2026-10-05T09:49:59.000Z');
    expect((await panel.get(PATHS.session)).status).toBe(200);
    at$('09:50');
    expect((await panel.get(PATHS.session)).body).toMatchObject({ code: 'session_expired' });
  });

  it('EVM-067 AC6 the extension never goes past 12 hours from the sign-in', async () => {
    const { panel } = await signedIn();
    let response = await panel.post(LOGIN.extend);
    for (let minutes = 50; minutes < 12 * 60; minutes += 50) {
      current.clock.set(new Date(new Date(START).getTime() + minutes * MINUTE));
      response = await panel.post(LOGIN.extend);
      expect(response.status, `+${minutes} min`).toBe(200);
    }
    // the last extension (at 19:40) would end at 20:40, but the sign-in is 12 hours old at 20:00
    expect(response.body).toEqual({ idleExpiresAt: at('20:00'), absoluteExpiresAt: at('20:00') });
    at$('20:00');
    expect((await panel.post(LOGIN.extend)).body).toMatchObject({ code: 'session_expired' });
  });

  it('EVM-067 AC6 every role may extend its own session; the session of another person is untouched and the body names no session', async () => {
    const { panel, sessionId } = await signedIn('editor');
    const reader = await signedIn('read_only');
    const readerBefore = await sessionRow(reader.sessionId);
    at$('08:40');
    expect((await panel.post(LOGIN.extend)).status).toBe(200);
    expect(await sessionRow(reader.sessionId)).toEqual(readerBefore);
    for (const body of [{ sessionId: reader.sessionId }, { sessionId }, { userId: 'x' }, []]) {
      const refused = await panel.post(LOGIN.extend, body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(refused.body).toMatchObject({ code: 'validation_failed' });
    }
    expect(await sessionRow(reader.sessionId)).toEqual(readerBefore);
    expect((await panel.post(LOGIN.extend, {})).status).toBe(200);
    expect((await reader.panel.post(LOGIN.extend)).status).toBe(200);
  });

  it('EVM-067 AC6 the extension needs a session and the CSRF protection: 401 without one, 403 csrf_failed without Origin, fetch metadata or a right token', async () => {
    const { panel } = await signedIn();
    const anonymous = await request(server()).post(LOGIN.extend).set({ Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: 'unauthenticated' });
    const token = panel.csrfToken ?? '';
    const cookie = panel.cookie ?? '';
    const attempts: Array<[string, Record<string, string>]> = [
      ['no CSRF token', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin' }],
      ['a wrong CSRF token', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Token': `${token.slice(1)}x` }],
      ['no Origin', { 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Token': token }],
      ['a foreign Origin', { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Token': token }],
      ['a cross-site fetch', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'cross-site', 'X-CSRF-Token': token }],
    ];
    at$('08:40');
    for (const [label, headers] of attempts) {
      const response = await request(server()).post(LOGIN.extend).set('Cookie', cookie).set(headers);
      expect(response.status, label).toBe(403);
      expect(response.body, label).toMatchObject({ code: 'csrf_failed' });
    }
    expect((await panel.get(PATHS.session)).body).toMatchObject({ idleExpiresAt: at('09:00') });
  });
});

describe('a session that has no second step yet (EVM-067 AC8; SR-AUTH-06, AB-01)', () => {
  /** An active account with a password and no key: the first step gives it a limited session without a link. */
  async function passwordOnly() {
    const user = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'active' });
    const hash = await new Argon2PasswordHasher().hash(PASSWORD);
    await db()
      .insertInto('identity.password_credentials')
      .values({ user_id: user.id, password_hash: hash, updated_at: current.clock.now() })
      .execute();
    const panel = current.panel();
    const response = await firstStep(panel, user.email, PASSWORD);
    panel.adopt(response.headers['set-cookie']);
    panel.csrfToken = (response.body as { csrfToken: string }).csrfToken;
    return { user, panel, response };
  }

  it('EVM-067 AC8 only the enrolment operations work (403 mfa_enrollment_required elsewhere), the session expires like any other, and it can be extended and ended', async () => {
    const { panel } = await passwordOnly();
    expect((await panel.get(PATHS.session)).body).toMatchObject({ state: 'mfa_enrollment', channel: 'web' });
    const start = current.clock.now().getTime();
    current.clock.set(new Date(start + 59 * MINUTE));
    expect((await panel.post(LOGIN.extend)).status).toBe(200);
    current.clock.set(new Date(start + 59 * MINUTE + 61 * MINUTE));
    expect((await panel.get(PATHS.session)).body).toMatchObject({ code: 'session_expired' });
  });

  it('EVM-067 AC8 the absolute limit of 12 hours holds in this state too', async () => {
    const { panel } = await passwordOnly();
    const start = current.clock.now().getTime();
    for (let minutes = 50; minutes < 12 * 60; minutes += 50) {
      current.clock.set(new Date(start + minutes * MINUTE));
      expect((await panel.post(LOGIN.extend)).status, `+${minutes} min`).toBe(200);
    }
    current.clock.set(new Date(start + 12 * HOUR));
    expect((await panel.post(LOGIN.extend)).body).toMatchObject({ code: 'session_expired' });
  });

  it('EVM-067 AC8 a password alone cannot register a factor: the key is refused, nothing is stored, the account stays as it was (the session has no link)', async () => {
    const { user, panel } = await passwordOnly();
    const { response, options } = await passkeyOptions(panel);
    expect(response.status).toBe(200);
    const refused = await registerPasskey(panel, options, new VirtualAuthenticator());
    expect(refused.status).toBe(401);
    expect(refused.body).toMatchObject({ code: 'session_revoked' });
    expect(await db().selectFrom('identity.passkeys').select('id').where('user_id', '=', user.id).execute()).toEqual([]);
    expect((await db().selectFrom('identity.users').select('status').where('id', '=', user.id).executeTakeFirstOrThrow()).status).toBe(
      'active',
    );
    expect(
      (await db().selectFrom('identity.sessions').select('revoked_at').where('user_id', '=', user.id).execute()).every(
        (row) => row.revoked_at === null,
      ),
    ).toBe(true);
    expect((await panel.post(PATHS.logout)).status).toBe(204);
  });

  it('EVM-067 AC8 a limited session of an invited or deactivated account is revoked: it has no link that would keep it valid', async () => {
    for (const status of ['invited', 'deactivated'] as const) {
      const user = await createUser(current.database.admin, current.clock, { role: 'editor', status });
      const session = await createSession(current.database.admin, current.clock, user, { state: 'mfa_enrollment' });
      const response = await request(server()).get(PATHS.session).set('Cookie', session.cookie);
      expect(response.status, status).toBe(401);
      expect(response.body, status).toMatchObject({ code: 'session_revoked' });
    }
  });

  it('EVM-067 AC8 the enrolment session of an invitation expires by idle time as well, though its link is still valid for 72 hours', async () => {
    const { link } = await current.pendingAdministrator();
    const panel = current.panel();
    expect((await setPassword(panel, link.token)).status).toBe(200);
    current.clock.advance(59 * MINUTE);
    expect((await panel.get(PATHS.session)).status).toBe(200);
    current.clock.advance(2 * MINUTE);
    expect((await panel.get(PATHS.session)).body).toMatchObject({ code: 'session_expired' });
    expect((await current.panel().post(PATHS.check, { token: link.token })).status).toBe(200);
  });
});
