import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { ACCOUNT, auditOf, outboxOf, signedInWithKey, withoutTrace } from '../support/account-flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, type UserFixture } from '../support/identity-fixtures.ts';
import { emailHarness } from '../support/invitation-fixtures.ts';
import { firstStep, signIn } from '../support/login-flows.ts';
import { nextStep, sendLoginRecoveryCode, startLogin, totpAccount } from '../support/totp-flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
const EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

/** `count` more sessions of the account, each a second later than the one before (the order of the start is what the limit goes by). */
async function moreSessions(user: UserFixture, count: number, options: { channel?: 'web' | 'mobile' } = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    current.clock.advance(1000);
    ids.push((await createSession(current.database.admin, current.clock, user, options)).id);
  }
  return ids;
}

const alive = (userId: string) =>
  db()
    .selectFrom('identity.sessions')
    .select(['id', 'revoke_reason'])
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .where('channel', '=', 'web')
    .where('state', '=', 'active')
    .execute();
const keys = (body: unknown): string[] => Object.keys(body as object).sort();
/** The one session of the account that is open (the session of the sign-in; the ones before it were rotated). */
const openSession = (userId: string) =>
  db().selectFrom('identity.sessions').select('id').where('user_id', '=', userId).where('revoked_at', 'is', null).executeTakeFirstOrThrow();

describe('the limit of five sessions of the web channel (EVM-028 AC6; SR-SESS-04, K8)', () => {
  it('EVM-028 AC6 with five active sessions the sixth sign-in ends the OLDEST: its next request is 401 session_revoked, the reason is session_limit, the audit has the event and the owner gets e-mail 8', async () => {
    const admin = await signedInWithKey(current);
    const [oldest] = (await alive(admin.user.id)).map((row) => row.id);
    await moreSessions(admin.user, 4);
    expect(await alive(admin.user.id)).toHaveLength(5);

    nextStep(current);
    const sixth = current.panel();
    expect((await signIn(sixth, admin)).status).toBe(200);

    expect(await alive(admin.user.id)).toHaveLength(5);
    const ended = await db()
      .selectFrom('identity.sessions')
      .select(['revoke_reason', 'revoked_at'])
      .where('id', '=', oldest ?? '')
      .executeTakeFirstOrThrow();
    expect(ended.revoke_reason).toBe('session_limit');
    expect((await admin.panel.get(ACCOUNT.account)).body).toMatchObject({ code: 'session_revoked' });
    expect((await sixth.get(ACCOUNT.account)).status).toBe(200);
    expect((await auditOf(current, 'session.revoked')).at(-1)).toMatchObject({
      reason_code: 'session_limit',
      object_id: oldest,
      actor_user_id: admin.user.id,
    });
    expect(await outboxOf(current, admin.user.id, 'session_limit')).toEqual([{ kind: 'session_limit', variant: null }]);
  });

  it('EVM-028 AC6 e-mail 8 names the ended session and the new sign-in by browser, system and time — no IP, no raw user agent — and goes to the address of the account', async () => {
    const admin = await signedInWithKey(current);
    await db().updateTable('identity.sessions').set({ user_agent: EDGE, ip_address: '198.51.100.23' }).execute();
    await moreSessions(admin.user, 4);
    nextStep(current);
    expect((await signIn(current.panel(), admin)).status).toBe(200);
    const harness = emailHarness(current);
    const { rows } = await sql<{ id: string }>`
      select id from platform.email_outbox where recipient_user_id = ${admin.user.id} and kind = 'session_limit'`.execute(
      current.database.admin,
    );
    await harness.job.run({ ids: rows.map((row) => row.id) });
    expect(harness.sender.sent).toHaveLength(1);
    const sent = harness.sender.sent[0];
    expect(sent?.to).toBe(admin.email);
    expect(sent?.subject).toBe('EVia Manager: zakończono najstarszą sesję');
    expect(sent?.text).toContain('Zakończona sesja: Edge · Windows, ostatnia aktywność');
    expect(sent?.text).toContain('Nowe logowanie: Nieznana przeglądarka · Nieznany system,');
    expect(sent?.text).not.toMatch(/198\.51\.100\.23|Mozilla|AppleWebKit|synthetic/);
  });

  it('EVM-028 K8 the first step alone ends nobody: with five active sessions a password without the second step leaves all five (Z5)', async () => {
    const admin = await signedInWithKey(current);
    await moreSessions(admin.user, 4);
    nextStep(current);
    const step1 = await firstStep(current.panel(), admin.email, admin.password);
    expect(step1.status).toBe(200);
    expect(await alive(admin.user.id)).toHaveLength(5);
    expect(await outboxOf(current, admin.user.id, 'session_limit')).toEqual([]);
  });

  it('EVM-028 AC6 the sessions of the mobile channel, those waiting for a second step and those that ran out do not count', async () => {
    const admin = await signedInWithKey(current);
    await moreSessions(admin.user, 5, { channel: 'mobile' });
    await db()
      .updateTable('identity.sessions')
      .set({ idle_expires_at: new Date(current.clock.now().getTime() - 1000) })
      .where('channel', '=', 'mobile')
      .execute();
    await moreSessions(admin.user, 3);
    const enrolment = await createSession(current.database.admin, current.clock, admin.user, { state: 'mfa_enrollment' });
    expect(enrolment.id).toBeDefined();
    nextStep(current);
    expect((await signIn(current.panel(), admin)).status).toBe(200);
    expect(await alive(admin.user.id)).toHaveLength(5); // 1 + 3 + the new one: nobody is ended
    expect(await outboxOf(current, admin.user.id, 'session_limit')).toEqual([]);
  });

  it('EVM-028 AC6 K8 three parallel sign-ins with four sessions open: the account never ends with more than five, and exactly two sessions are ended', async () => {
    const account = await totpAccount(current, { role: 'editor', withCodes: true });
    await moreSessions(account.user, 3);
    expect(await alive(account.user.id)).toHaveLength(4);
    const browsers = [current.panel(), current.panel(), current.panel()];
    nextStep(current);
    const tokens: string[] = [];
    for (const browser of browsers) {
      tokens.push(await startLogin(browser, account));
      current.clock.advance(1000);
    }
    const responses = await Promise.all(
      browsers.map((browser, index) => sendLoginRecoveryCode(browser, tokens[index] ?? '', account.codes[index] ?? '')),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(await alive(account.user.id)).toHaveLength(5);
    const limited = await db()
      .selectFrom('identity.sessions')
      .select('id')
      .where('user_id', '=', account.user.id)
      .where('revoke_reason', '=', 'session_limit')
      .execute();
    expect(limited).toHaveLength(2);
  });
});

describe('"Moje sesje" (EVM-028 AC6; SR-SESS-07, SR-DATA-03, P9, K13)', () => {
  it('EVM-028 AC6 the list shows the browser and the system out of the dictionary, the FULL address, the last activity and "ta sesja" — and nothing else (no raw user agent, no token, no hash)', async () => {
    const admin = await signedInWithKey(current);
    const own = await openSession(admin.user.id);
    await db().updateTable('identity.sessions').set({ user_agent: FIREFOX, ip_address: '203.0.113.45' }).where('id', '=', own.id).execute();
    const [other] = await moreSessions(admin.user, 1);
    await db()
      .updateTable('identity.sessions')
      .set({ user_agent: CHROME_ANDROID, ip_address: '2001:db8:5::17' })
      .where('id', '=', other ?? '')
      .execute();
    // not listed: an enrolment session, a session that ran out, a session of the mobile channel
    await createSession(current.database.admin, current.clock, admin.user, { state: 'mfa_enrollment' });
    const [expired] = await moreSessions(admin.user, 1);
    await db()
      .updateTable('identity.sessions')
      .set({ idle_expires_at: new Date(current.clock.now().getTime() - 1000) })
      .where('id', '=', expired ?? '')
      .execute();
    await moreSessions(admin.user, 1, { channel: 'mobile' });

    const response = await admin.panel.get(ACCOUNT.sessions);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const items = (response.body as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((item) => item['id'])).toEqual([own.id, other]);
    expect(items[0]).toEqual({
      id: own.id,
      current: true,
      browser: 'Firefox',
      os: 'Windows',
      ipAddress: '203.0.113.45',
      lastSeenAt: expect.any(String) as string,
    });
    expect(items[1]).toMatchObject({ current: false, browser: 'Chrome', os: 'Android', ipAddress: '2001:db8:5::17' });
    for (const item of items) expect(keys(item)).toEqual(['browser', 'current', 'id', 'ipAddress', 'lastSeenAt', 'os']);
    const text = JSON.stringify(response.body);
    expect(text).not.toMatch(/Mozilla|AppleWebKit|Gecko|token|hash/i);
  });

  it('EVM-028 AC6 SR-SESS-08 the list needs a fresh step-up: 403 step_up_required after 15 minutes; ending sessions too', async () => {
    const admin = await signedInWithKey(current);
    const [other] = await moreSessions(admin.user, 1);
    current.clock.advance(16 * 60_000);
    for (const [method, path] of [
      ['get', ACCOUNT.sessions],
      ['delete', ACCOUNT.sessions],
      ['delete', `${ACCOUNT.sessions}/${other}`],
    ] as const) {
      const response = await (method === 'get' ? admin.panel.get(path) : admin.panel.delete(path));
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(response.body).toMatchObject({ code: 'step_up_required' });
    }
    expect(await alive(admin.user.id)).toHaveLength(2);
  });

  it('EVM-028 AC6 the owner ends a chosen session: 204, reason ended_by_user, the audit event, its next request is 401 session_revoked; ending it again is 404', async () => {
    const admin = await signedInWithKey(current);
    const second = current.panel();
    nextStep(current);
    expect((await signIn(second, admin)).status).toBe(200);
    const target = await db()
      .selectFrom('identity.sessions')
      .select('id')
      .where('user_id', '=', admin.user.id)
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow();
    expect((await admin.panel.delete(`${ACCOUNT.sessions}/${target.id}`)).status).toBe(204);
    expect((await second.get(ACCOUNT.account)).body).toMatchObject({ code: 'session_revoked' });
    const row = await db().selectFrom('identity.sessions').select('revoke_reason').where('id', '=', target.id).executeTakeFirstOrThrow();
    expect(row.revoke_reason).toBe('ended_by_user');
    expect((await auditOf(current, 'session.revoked')).at(-1)).toMatchObject({
      reason_code: 'ended_by_user',
      object_id: target.id,
      actor_user_id: admin.user.id,
    });
    expect((await admin.panel.delete(`${ACCOUNT.sessions}/${target.id}`)).status).toBe(404);
    expect((await admin.panel.get(ACCOUNT.account)).status).toBe(200);
  });

  it('EVM-028 AC8 K6 the session of somebody else and a session that does not exist are ONE answer; the other account keeps its session', async () => {
    const admin = await signedInWithKey(current);
    const stranger = await signedInWithKey(current, 'editor');
    const theirs = await db()
      .selectFrom('identity.sessions')
      .select('id')
      .where('user_id', '=', stranger.user.id)
      .executeTakeFirstOrThrow();
    const foreign = await admin.panel.delete(`${ACCOUNT.sessions}/${theirs.id}`);
    const missing = await admin.panel.delete(`${ACCOUNT.sessions}/00000000-0000-7000-8000-000000000001`);
    expect([foreign.status, missing.status]).toEqual([404, 404]);
    expect(withoutTrace(foreign.body)).toEqual(withoutTrace(missing.body));
    expect((await stranger.panel.get(ACCOUNT.account)).status).toBe(200);
  });

  it('EVM-028 AC6 the current session is not ended here: 409 current_session (it is ended by "Wyloguj")', async () => {
    const admin = await signedInWithKey(current);
    const own = await openSession(admin.user.id);
    const response = await admin.panel.delete(`${ACCOUNT.sessions}/${own.id}`);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'current_session' });
    expect((await admin.panel.get(ACCOUNT.account)).status).toBe(200);
  });

  it('EVM-028 AC6 "Zakończ pozostałe sesje" ends every other session of the account and keeps the current; a second call ends none; the audit has an event for each', async () => {
    const admin = await signedInWithKey(current);
    const others = await moreSessions(admin.user, 2);
    await moreSessions(admin.user, 1, { channel: 'mobile' });
    const stranger = await signedInWithKey(current, 'editor');
    const response = await admin.panel.delete(ACCOUNT.sessions);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ended: 3 });
    expect((await alive(admin.user.id)).map((row) => row.id)).toHaveLength(1);
    const reasons = await db().selectFrom('identity.sessions').select('revoke_reason').where('id', 'in', others).execute();
    expect(reasons.map((row) => row.revoke_reason)).toEqual(['ended_by_user', 'ended_by_user']);
    expect((await auditOf(current, 'session.revoked')).filter((event) => event.reason_code === 'ended_by_user')).toHaveLength(3);
    expect((await admin.panel.delete(ACCOUNT.sessions)).body).toEqual({ ended: 0 });
    expect((await admin.panel.get(ACCOUNT.account)).status).toBe(200);
    expect((await stranger.panel.get(ACCOUNT.account)).status).toBe(200); // the other account is not touched
  });
});
