import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PurgeSessionsJob } from '../../src/modules/identity/index.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { auditActions, browserOf, emailHarness, outboxRows } from '../support/invitation-fixtures.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import { deliverReset, NEW_PASSWORD, RESET } from '../support/password-reset-fixtures.ts';
import {
  deviceRow,
  devicesOf,
  MOBILE,
  mobileSessionsOf,
  newPhone,
  setDeviceState,
  signedInPhone,
  signInPhone,
  type Phone,
} from '../support/mobile-flows.ts';
import { addTotp, totpAccount, type TotpAccount } from '../support/totp-flows.ts';
import { changeRole, deactivate, endSessions } from '../support/user-access-fixtures.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const DAY = 24 * 3_600_000;
const problemOf = (response: { body: unknown }): string => (response.body as { code: string }).code;
const noCookies = (response: { headers: Record<string, unknown> }): void => {
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.headers['cache-control']).toBe('no-store');
};
const sessionOf = async (userId: string) => (await mobileSessionsOf(current, userId)).at(-1);
const config = (phone: Phone, token: string | undefined = phone.accessToken) =>
  phone.get(MOBILE.config, { Authorization: `Bearer ${token ?? ''}` });

describe('rotation of the refresh token (EVM-094 AC4; SR-SESS-09, ASVS V7.2.x)', () => {
  it('EVM-094 AC4 a refresh gives a NEW pair, the old access token stops at once and the old refresh token is spent; no secret in the answer', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const [access, refresh] = [phone.accessToken, phone.refreshToken];
    current.clock.advance(5 * 60_000);
    const response = await phone.refresh();
    expect(response.status).toBe(200);
    noCookies(response);
    const body = response.body as { accessToken: string; refreshToken: string; installationSecret?: string; deviceId: string };
    expect(body.installationSecret).toBeUndefined();
    expect(body.accessToken).not.toBe(access);
    expect(body.refreshToken).not.toBe(refresh);
    expect(body.deviceId).toBe(phone.deviceId);
    expect((await config(phone, access)).status).toBe(401);
    phone.adopt(response);
    expect((await config(phone)).status).toBe(200);
    // the session slides: the idle deadline is 14 days from the refresh
    const session = await sessionOf(account.user.id);
    expect((session?.idle_expires_at as Date).getTime()).toBe(current.clock.now().getTime() + 14 * DAY);
  });

  it('EVM-094 AC4 the direct predecessor is accepted again within 30 seconds (a lost answer): another pair, the first successor not yet used', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const first = await phone.refresh();
    current.clock.advance(20_000);
    const again = await phone.refresh(phone.refreshToken);
    expect(again.status).toBe(200);
    expect((again.body as { refreshToken: string }).refreshToken).not.toBe((first.body as { refreshToken: string }).refreshToken);
    expect((await sessionOf(account.user.id))?.revoked_at).toBeNull();
  });

  it('EVM-094 AC4 the first used successor invalidates its siblings: using the other answer to the lost response is a reuse', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const original = phone.refreshToken;
    const one = await phone.refresh(original);
    current.clock.advance(5000);
    const two = await phone.refresh(original);
    expect([one.status, two.status]).toEqual([200, 200]);
    const used = await phone.refresh((one.body as { refreshToken: string }).refreshToken);
    expect(used.status).toBe(200);
    const sibling = await phone.refresh((two.body as { refreshToken: string }).refreshToken);
    expect(sibling.status).toBe(401);
    expect(problemOf(sibling)).toBe('session_revoked');
    expect((await sessionOf(account.user.id))?.revoke_reason).toBe('refresh_reuse');
  });

  it('EVM-094 AC4 a predecessor after 30 seconds, or once a successor was used, is a REUSE: the session ends, the device stays registered, the audit and ONE alert to the Administrators', async () => {
    const administrator = await createUser(current.database.admin, current.clock, { role: 'administrator' });
    const second = await createUser(current.database.admin, current.clock, { role: 'administrator' });
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const old = phone.refreshToken;
    phone.adopt(await phone.refresh());
    current.clock.advance(31_000);
    const reuse = await phone.refresh(old);
    expect(reuse.status).toBe(401);
    expect(problemOf(reuse)).toBe('session_revoked');
    noCookies(reuse);
    const session = await sessionOf(account.user.id);
    expect(session).toMatchObject({ revoke_reason: 'refresh_reuse' });
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ state: 'active', removed_at: null });
    // the access token of the family is dead at once, the newest refresh token too
    expect((await config(phone)).status).toBe(401);
    expect(problemOf(await config(phone))).toBe('session_revoked');
    expect(problemOf(await phone.refresh())).toBe('session_revoked');
    const audit = (await auditActions(current)).filter((event) => event.reason_code === 'refresh_reuse');
    expect(audit).toMatchObject([{ action: 'session.revoked', outcome: 'denied', actor_user_id: account.user.id }]);
    const alerts = (await outboxRows(current, { kind: 'administrator_alert' })).filter(
      (row) => row.variant === 'administrator_refresh_reuse',
    );
    expect(alerts.map((row) => row.recipient_user_id).sort()).toEqual([administrator.id, second.id].sort());
    // replays of the ended family send nothing more (a flood of mail is no use to an attacker)
    await phone.refresh(old);
    await phone.refresh(old);
    expect(
      (await outboxRows(current, { kind: 'administrator_alert' })).filter((row) => row.variant === 'administrator_refresh_reuse'),
    ).toHaveLength(2);
    // the sign-in again is open: the same installation comes back and gets a new session
    const back = await phone.firstStep(account, { pair: true });
    expect(back.status).toBe(200);
  });

  it('EVM-094 AC4 the reuse alert reads as an alert for Administrators: no person, no token, no address', async () => {
    await createUser(current.database.admin, current.clock, { role: 'administrator', email: 'szef@example.com' });
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const old = phone.refreshToken;
    phone.adopt(await phone.refresh());
    current.clock.advance(60_000);
    await phone.refresh(old);
    const harness = emailHarness(current);
    const row = (await outboxRows(current, { kind: 'administrator_alert' })).find((item) => item.variant === 'administrator_refresh_reuse');
    await harness.job.run({ ids: [row?.id ?? ''] });
    expect(harness.sender.sent).toHaveLength(1);
    expect(harness.sender.sent[0]?.to).toBe('szef@example.com');
    expect(harness.sender.sent[0]?.text).toContain('poświadczenia odświeżania');
    expect(harness.sender.sent[0]?.text).not.toMatch(/evia_rt_|@evia\.invalid|token/i);
  });

  it('EVM-094 AC4 two parallel requests with one refresh token are answered from the lock: both within the window, never two sessions ended', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const results = await Promise.all([phone.refresh(), phone.refresh()]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect((await sessionOf(account.user.id))?.revoked_at).toBeNull();
    const fresh = results.map((response) => (response.body as { refreshToken: string }).refreshToken);
    expect(new Set(fresh).size).toBe(2);
  });

  it('EVM-094 AC4 an unknown, malformed, expired and revoked token are one answer — 401 session_revoked — with the same body', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const revokedFamily = await signedInPhone(current, account);
    await revokedFamily.post(MOBILE.logout, undefined, revokedFamily.authorised());
    const answers = [
      await phone.refresh(`evia_rt_${'A'.repeat(43)}`),
      await phone.refresh('not a token '.repeat(4)),
      await phone.refresh('x'.repeat(40)),
      await phone.refresh(revokedFamily.refreshToken),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(problemOf(answer)).toBe('session_revoked');
      noCookies(answer);
    }
    const bodies = answers.map((answer) => {
      const { traceId, ...rest } = answer.body as Record<string, unknown>;
      return { traceId, rest: JSON.stringify(rest) };
    });
    expect(new Set(bodies.map((body) => body.rest)).size).toBe(1);
    // 14 days without a refresh and 30 days from the sign-in end the session: a full sign-in is needed
    current.clock.advance(15 * DAY);
    const idle = await phone.refresh();
    expect(idle.status).toBe(401);
    expect(problemOf(idle)).toBe('session_revoked');
  });

  it('EVM-094 AC4 the session never outlives 30 days from the sign-in, however often it is refreshed', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    for (let day = 0; day < 3; day += 1) {
      current.clock.advance(10 * DAY + 60_000);
      const response = await phone.refresh();
      if (day < 2) {
        expect(response.status, `day ${day}`).toBe(200);
        phone.adopt(response);
      } else {
        expect(response.status).toBe(401);
      }
    }
  });

  it('EVM-094 AC4 the state of the account is read on every call: a deactivated or changed account is refused by the very next refresh and request', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    await sql`update identity.users set role = 'read_only' where id = ${account.user.id}`.execute(current.database.admin);
    const forbidden = await config(phone);
    expect(forbidden.status).toBe(403);
    expect(problemOf(forbidden)).toBe('forbidden');
    expect(problemOf(await phone.refresh())).toBe('session_revoked');
    await sql`update identity.users set role = 'editor', status = 'deactivated' where id = ${account.user.id}`.execute(
      current.database.admin,
    );
    expect(problemOf(await config(phone))).toBe('session_revoked');
  });

  it('EVM-094 AC8 a refresh is audited: the granted one and the refused ones for a known session (session_revoked, device_wipe_required); never the token', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const old = phone.refreshToken;
    phone.adopt(await phone.refresh());
    const refreshed = (await auditActions(current)).filter((event) => event.action === 'session.refreshed');
    expect(refreshed).toMatchObject([{ outcome: 'success', actor_user_id: account.user.id, reason_code: null }]);
    // an unknown token has no session to point at: no row
    await phone.refresh(`evia_rt_${'A'.repeat(43)}`);
    expect((await auditActions(current)).filter((event) => event.action === 'session.refreshed')).toHaveLength(1);
    // the session ends (account deactivated) → the refusal is recorded against the session
    await sql`update identity.users set status = 'deactivated' where id = ${account.user.id}`.execute(current.database.admin);
    expect(problemOf(await phone.refresh())).toBe('session_revoked');
    // a device ordered to wipe
    const other = await signedInPhone(current, await totpAccount(current));
    await setDeviceState(current, other.deviceId ?? '', 'wipe_required');
    expect(problemOf(await other.refresh())).toBe('device_wipe_required');
    const denied = (await auditActions(current)).filter((event) => event.action === 'session.refreshed' && event.outcome === 'denied');
    expect(denied.map((event) => event.reason_code).sort()).toEqual(['device_wipe_required', 'session_revoked']);
    const { rows } = await sql<{
      text: string;
    }>`select to_jsonb(t)::text as text from audit.events t where action = 'session.refreshed'`.execute(current.database.admin);
    for (const row of rows) expect(row.text).not.toContain(old);
  });
});

describe('every way of ending a session ends the phone at once (EVM-094 AC4; SR-AUTH-11, SR-AUTH-13, SR-SESS-06, SR-SESS-09)', () => {
  it('EVM-094 AC4 a deactivation by an Administrator, the end of the sessions of a user and a change of the role end the next request and the next refresh', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    for (const act of [
      (userId: string) => deactivate(current, admin, userId),
      (userId: string) => endSessions(admin, userId),
      (userId: string) => changeRole(current, admin, userId, 'read_only'),
    ]) {
      const account = await totpAccount(current);
      const phone = await signedInPhone(current, account);
      expect((await config(phone)).status).toBe(200);
      const done = await act(account.user.id);
      expect(done.status, JSON.stringify(done.body)).toBeLessThan(300);
      const refused = await config(phone);
      expect(refused.status).toBe(401);
      expect(problemOf(refused)).toBe('session_revoked');
      expect(problemOf(await phone.refresh())).toBe('session_revoked');
    }
  });

  it('EVM-094 AC4 a reset of the password ends the sessions of the phone too (SR-AUTH-11)', async () => {
    const enrolled = await enrolledAccount(current, { role: 'editor' });
    const secret = await addTotp(current, enrolled);
    const account = { ...enrolled, secret } as unknown as TotpAccount;
    const phone = await signedInPhone(current, account);
    expect((await config(phone)).status).toBe(200);
    const delivered = await deliverReset(current, enrolled);
    const completed = await current.panel().post(RESET.complete, { token: delivered.token, password: NEW_PASSWORD });
    expect(completed.status).toBe(200);
    const refused = await config(phone);
    expect(refused.status).toBe(401);
    expect(problemOf(refused)).toBe('session_revoked');
    expect(problemOf(await phone.refresh())).toBe('session_revoked');
    expect((await sessionOf(enrolled.user.id))?.revoke_reason).toBe('password_reset');
  });
});

describe('the channels do not mix (EVM-094 AC3; SR-AUTHZ-12, SR-SESS-10, ASVS V3.5)', () => {
  it('EVM-094 AC3 a cookie of the panel on an operation of the phone is 401 and sets nothing; a Bearer token on an operation of the panel is 401', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const cookie = account.panel.cookieHeader() ?? '';
    const asCookie = await phone.post(MOBILE.logout, undefined, {
      Cookie: cookie,
      Origin: PANEL_ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      'X-CSRF-Token': account.panel.csrfToken ?? '',
    });
    expect(asCookie.status).toBe(401);
    noCookies(asCookie);
    expect((await phone.get(MOBILE.config, { Cookie: cookie })).status).toBe(401);
    const onWeb = await request(current.app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${phone.accessToken}`);
    expect(onWeb.status).toBe(401);
    const logoutWeb = await request(current.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${phone.accessToken}`)
      .set('Origin', PANEL_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin');
    expect(logoutWeb.status).toBe(401);
    // and the session of the phone is still alive
    expect((await config(phone)).status).toBe(200);
  });

  it('EVM-094 AC3 with both credentials only the one of the channel of the operation counts: the cookie on the panel, the token on the phone', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const cookie = account.panel.cookieHeader() ?? '';
    const web = await request(current.app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', cookie)
      .set('Authorization', 'Bearer evia_at_garbage');
    expect(web.status).toBe(200);
    const mobile = await phone.get(MOBILE.config, { Cookie: 'garbage=1', Authorization: `Bearer ${phone.accessToken}` });
    expect(mobile.status).toBe(200);
    const badBearer = await phone.get(MOBILE.config, { Cookie: cookie, Authorization: 'Bearer evia_at_garbage' });
    expect(badBearer.status).toBe(401);
  });

  it('EVM-094 AC3 the phone needs no Origin or CSRF token, but a header of the client never buys that: X-Client-Platform on a panel mutation does not skip the checks', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    expect((await phone.post(MOBILE.logout, undefined, phone.authorised())).status).toBe(204);
    const forged = await request(current.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', account.panel.cookieHeader() ?? '')
      .set('X-Client-Platform', 'android')
      .set('X-Client-Version', '9.9.9');
    expect(forged.status).toBe(403);
    expect(problemOf(forged)).toBe('csrf_failed');
  });

  it('EVM-094 AC3 an access token put into the cookie of the panel opens nothing (the session of a phone has no cookie)', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const response = await request(current.app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', `__Host-evia_session=${phone.accessToken}`);
    expect(response.status).toBe(401);
  });
});

describe('the role matrix of the new operations (EVM-094 AC8; SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-12, ASVS V8.2.1)', () => {
  it('EVM-094 AC8 getClientConfig and mobileLogout: Administrator and Editor with a token — yes; Read-only — 403; no token, an expired one and a revoked one — 401', async () => {
    const enrolled = await enrolledAccount(current, { role: 'administrator' });
    const secret = await addTotp(current, enrolled);
    const adminPhone = await signedInPhone(current, { ...enrolled, secret } as unknown as TotpAccount);
    const editor = await totpAccount(current, { role: 'editor' });
    const editorPhone = await signedInPhone(current, editor);
    const readOnly = await totpAccount(current, { role: 'editor' });
    const readOnlyPhone = await signedInPhone(current, readOnly);
    await sql`update identity.users set role = 'read_only' where id = ${readOnly.user.id}`.execute(current.database.admin);

    for (const phone of [adminPhone, editorPhone]) {
      const response = await config(phone);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        offlineContactWindowDays: 7,
        closedWorkOrdersInScopeDays: 30,
        periodicResyncDays: 7,
        scopeRuleVersion: 1,
      });
      noCookies(response);
    }
    expect((await config(readOnlyPhone)).status).toBe(403);
    expect(problemOf(await config(readOnlyPhone))).toBe('forbidden');
    expect((await readOnlyPhone.post(MOBILE.logout, undefined, readOnlyPhone.authorised())).status).toBe(403);
    // unauthenticated, malformed and unknown tokens
    const anonymous = newPhone(current);
    expect((await anonymous.get(MOBILE.config)).status).toBe(401);
    expect((await config(anonymous, `evia_at_${'A'.repeat(43)}`)).status).toBe(401);
    expect((await anonymous.get(MOBILE.config, { Authorization: 'Basic abc' })).status).toBe(401);
    expect((await anonymous.post(MOBILE.logout)).status).toBe(401);
    // an expired access token is unauthenticated (the app refreshes); the logout of the device A ends A only
    current.clock.advance(16 * 60_000);
    const expired = await config(editorPhone);
    expect(expired.status).toBe(401);
    expect(problemOf(expired)).toBe('unauthenticated');
  });

  it('EVM-094 AC8 the logout ends the session of the token and no other: the other device of the same user and the device of another user stay', async () => {
    const account = await totpAccount(current);
    const other = await totpAccount(current);
    const [a, b] = [await signedInPhone(current, account), await signedInPhone(current, account)];
    const foreign = await signedInPhone(current, other);
    const done = await a.post(MOBILE.logout, undefined, a.authorised());
    expect(done.status).toBe(204);
    noCookies(done);
    expect(problemOf(await config(a))).toBe('session_revoked');
    expect(problemOf(await a.refresh())).toBe('session_revoked');
    expect((await config(b)).status).toBe(200);
    expect((await config(foreign)).status).toBe(200);
    expect((await devicesOf(current, account.user.id)).map((device) => device.state)).toEqual(['active', 'active']);
    expect(
      (await auditActions(current)).filter((event) => event.action === 'session.revoked' && event.reason_code === 'logout'),
    ).toHaveLength(1);
    // the second logout of the same token is a revoked session
    expect(problemOf(await a.post(MOBILE.logout, undefined, a.authorised()))).toBe('session_revoked');
  });

  it('EVM-094 AC6 the logout is refused for an old app (426) and the configuration is not: the app must be able to read the minimum', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const old = { 'X-Client-Version': '1.0.0' };
    expect((await phone.post(MOBILE.logout, undefined, phone.authorised(old))).status).toBe(426);
    expect((await phone.get(MOBILE.config, phone.authorised(old))).status).toBe(200);
    expect((await sessionOf(account.user.id))?.revoked_at).toBeNull();
    // 426 comes after authentication: an anonymous call to a protected operation learns nothing about versions
    expect((await newPhone(current).post(MOBILE.logout, undefined, old)).status).toBe(401);
  });

  it('EVM-094 AC8 the public operations of the phone never set a cookie, whoever calls them and whatever the answer', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const calls = [
      await phone.post(MOBILE.login, { email: 'x', password: 'y', device: {} }),
      await phone.post(MOBILE.totp, { challengeToken: 'x', code: 'y' }),
      await phone.post(MOBILE.token, { refreshToken: 'x' }),
      await phone.post(MOBILE.wipe, { deviceId: 'x', installationSecret: 'y' }),
      await phone.post(MOBILE.token, { refreshToken: phone.refreshToken }),
    ];
    for (const call of calls) noCookies(call);
  });
});

describe('the state of the device on every call (EVM-094 AC4; SR-SESS-09)', () => {
  it('EVM-094 AC4 a device that was removed or wiped ends the token at once and the refresh too: session_revoked', async () => {
    for (const change of ['removed', 'wiped'] as const) {
      const account = await totpAccount(current);
      const phone = await signedInPhone(current, account);
      expect((await config(phone)).status, change).toBe(200);
      if (change === 'removed')
        await sql`update identity.devices set removed_at = now() where id = ${phone.deviceId ?? ''}`.execute(current.database.admin);
      else await sql`update identity.devices set state = 'wiped' where id = ${phone.deviceId ?? ''}`.execute(current.database.admin);
      expect(problemOf(await config(phone)), change).toBe('session_revoked');
      expect(problemOf(await phone.refresh()), change).toBe('session_revoked');
    }
  });

  it('EVM-094 AC4 an access token of a session that is not of the mobile channel opens nothing (defence in depth), and a deleted account is refused', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    await sql`update identity.sessions set channel = 'web', device_id = null where user_id = ${account.user.id} and channel = 'mobile'`.execute(
      current.database.admin,
    );
    const refused = await config(phone);
    expect(refused.status).toBe(401);
    expect(problemOf(refused)).toBe('unauthenticated');
    const other = await totpAccount(current);
    const second = await signedInPhone(current, other);
    await sql`update identity.users set deleted_at = now() where id = ${other.user.id}`.execute(current.database.admin);
    expect(problemOf(await config(second))).toBe('session_revoked');
    expect(problemOf(await second.refresh())).toBe('session_revoked');
  });
});

describe('the proof of the installation secret by the tokens (EVM-094 AC2; B4)', () => {
  it('EVM-094 AC2 the first request with the tokens of the newest sign-in proves its secret: the previous one stops working; a device that proved it is not written to on every request', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const proven = phone.installationSecret;
    const again = newPhone(current);
    again.deviceId = phone.deviceId;
    again.installationSecret = proven;
    expect((await signInPhone(current, again, account, { pair: true })).second.status).toBe(200);
    // the previous secret (the one of the first sign-in) is valid until the newest is proven …
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ secret_proven: false });
    expect((await config(again)).status).toBe(200);
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({
      secret_proven: true,
      previous_secret_hash: null,
      previous_valid_until: null,
    });
    const written = (await deviceRow(current, phone.deviceId ?? ''))?.last_contact_at as Date;
    // … and a request 10 seconds later does not write the contact again (at most every 30 seconds)
    current.clock.advance(10_000);
    expect((await config(again)).status).toBe(200);
    expect(((await deviceRow(current, phone.deviceId ?? ''))?.last_contact_at as Date).getTime()).toBe(written.getTime());
    current.clock.advance(31_000);
    expect((await config(again)).status).toBe(200);
    expect(((await deviceRow(current, phone.deviceId ?? ''))?.last_contact_at as Date).getTime()).toBeGreaterThan(written.getTime());
  });
});

describe('the confirmation of the wipe (EVM-094 AC7; SR-AUTH-14)', () => {
  const confirm = (phone: Phone, body: Record<string, unknown>) => phone.post(MOBILE.wipe, body);

  it('EVM-094 AC7 the right pair of a device ordered to wipe turns it into "wiped" (204), burns both secrets and writes the audit — without the secret', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    await setDeviceState(current, phone.deviceId ?? '', 'wipe_required');
    const response = await confirm(phone, { deviceId: phone.deviceId, installationSecret: phone.installationSecret });
    expect(response.status).toBe(204);
    noCookies(response);
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ state: 'wiped', previous_secret_hash: null });
    expect((await auditActions(current)).filter((event) => event.action === 'device.wipe_confirmed')).toMatchObject([
      { object_id: phone.deviceId, actor_user_id: account.user.id, outcome: 'success' },
    ]);
    // idempotent: the same pair again is 204 and changes nothing — and after the burn the pair is no pair at all
    expect((await confirm(phone, { deviceId: phone.deviceId, installationSecret: phone.installationSecret })).status).toBe(401);
    expect(JSON.stringify((await sql`select to_jsonb(t) as r from audit.events t`.execute(current.database.admin)).rows)).not.toContain(
      phone.installationSecret ?? 'x',
    );
  });

  it('EVM-094 AC7 a device that is not waiting for the wipe answers 204 and keeps its state; the previous secret of the two-phase rotation confirms too', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    expect((await confirm(phone, { deviceId: phone.deviceId, installationSecret: phone.installationSecret })).status).toBe(204);
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ state: 'active' });
    // two-phase: the secret the phone proved is the previous one after the next sign-in
    expect((await config(phone)).status).toBe(200);
    const proven = phone.installationSecret;
    await signInPhone(current, phone, account, { pair: true });
    expect(phone.installationSecret).not.toBe(proven);
    await setDeviceState(current, phone.deviceId ?? '', 'wipe_required');
    expect((await confirm(phone, { deviceId: phone.deviceId, installationSecret: proven })).status).toBe(204);
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ state: 'wiped' });
  });

  it("EVM-094 AC7 an unknown device, a wrong secret and a device of nobody's are ONE answer (401 invalid_credentials) with the same body — no enumeration of devices", async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    await setDeviceState(current, phone.deviceId ?? '', 'wipe_required');
    const answers = [
      await confirm(phone, { deviceId: '0193a000-0000-7000-8000-0000000000d1', installationSecret: phone.installationSecret }),
      await confirm(phone, { deviceId: phone.deviceId, installationSecret: 'A'.repeat(43) }),
      await confirm(phone, { deviceId: '0193a000-0000-7000-8000-0000000000d2', installationSecret: 'A'.repeat(43) }),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(problemOf(answer)).toBe('invalid_credentials');
      noCookies(answer);
    }
    expect(new Set(answers.map((answer) => JSON.stringify({ ...answer.body, traceId: 0 }))).size).toBe(1);
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ state: 'wipe_required' });
    expect((await confirm(phone, { deviceId: 'x' })).status).toBe(400);
    expect((await confirm(phone, { deviceId: phone.deviceId, installationSecret: 'A'.repeat(43), extra: 1 })).status).toBe(400);
  });

  it('EVM-094 AC7 a device ordered to wipe answers every call with device_wipe_required — a request with the token, the refresh (even a spent token) and the sign-in', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const old = phone.refreshToken;
    phone.adopt(await phone.refresh());
    await setDeviceState(current, phone.deviceId ?? '', 'wipe_required');
    await sql`update identity.sessions set revoked_at = now(), revoke_reason = 'device_wipe' where device_id = ${phone.deviceId ?? null}`.execute(
      current.database.admin,
    );
    for (const answer of [await config(phone), await phone.refresh(), await phone.refresh(old), await config(phone, phone.accessToken)]) {
      expect(answer.status).toBe(401);
      expect(problemOf(answer)).toBe('device_wipe_required');
      noCookies(answer);
    }
  });

  it('EVM-094 AC7 the confirmation takes no version of the app and shares the limit of 20 a minute with the sign-in (429 with Retry-After)', async () => {
    const phone = newPhone(current);
    const noVersion = await phone
      .post(MOBILE.wipe, { deviceId: '0193a000-0000-7000-8000-0000000000d1', installationSecret: 'A'.repeat(43) })
      .unset('X-Client-Version');
    expect(noVersion.status).toBe(401);
    let last = noVersion;
    for (let index = 0; index < 25 && last.status !== 429; index += 1) {
      last = await confirm(phone, { deviceId: '0193a000-0000-7000-8000-0000000000d1', installationSecret: 'A'.repeat(43) });
    }
    expect(last.status).toBe(429);
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('retention of the mobile channel (EVM-094 AC4; P2)', () => {
  it('EVM-094 AC4 thirty days without contact end the sessions of the device (audited, once); the device and the queue stay; expired access tokens go after a day', async () => {
    const account = await totpAccount(current);
    const idle = await signedInPhone(current, account);
    const busy = await signedInPhone(current, account);
    current.clock.advance(31 * DAY);
    await sql`update identity.devices set last_contact_at = ${current.clock.now()} where id = ${busy.deviceId ?? null}`.execute(
      current.database.admin,
    );
    const job = current.app.get(PurgeSessionsJob, { strict: false });
    await job.run();
    const sessions = await mobileSessionsOf(current, account.user.id);
    const byDevice = new Map(sessions.map((session) => [session.device_id, session.revoke_reason]));
    expect(byDevice.get(idle.deviceId)).toBe('device_inactive');
    expect(byDevice.get(busy.deviceId)).toBeNull();
    expect((await devicesOf(current, account.user.id)).map((device) => device.state)).toEqual(['active', 'active']);
    expect((await auditActions(current)).filter((event) => event.reason_code === 'device_inactive')).toHaveLength(1);
    await job.run();
    expect((await auditActions(current)).filter((event) => event.reason_code === 'device_inactive')).toHaveLength(1);
    const left = await sql<{ total: string }>`select count(*)::text as total from identity.access_tokens`.execute(current.database.admin);
    expect(Number(left.rows[0]?.total)).toBeLessThanOrEqual(2);
  });
});
