import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOGIN_ATTEMPT_TTL_MS } from '../../src/modules/identity/domain/constants.ts';
import { PASSWORD_HASHER } from '../../src/modules/identity/infrastructure/ports.ts';
import { SLEEPER } from '../../src/platform/tokens.ts';
import { PATHS } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { auditActions, emailHarness, outboxRows } from '../support/invitation-fixtures.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import {
  APP_HEADERS,
  deviceRow,
  devicesOf,
  DEVICE,
  MOBILE,
  mobileSessionsOf,
  newPhone,
  signedInPhone,
  signInPhone,
  wrongCode,
} from '../support/mobile-flows.ts';
import { CountingHasher, InspectingSleeper, WRONG, wrongPasswords } from '../support/throttle-flows.ts';
import { addTotp, codeNow, everythingWritten, nextStep, sendLoginTotp, startLogin, totpAccount } from '../support/totp-flows.ts';

let current: IdentityApp;
let hasher: CountingHasher;
beforeEach(async () => {
  hasher = new CountingHasher();
  const sleeper = new InspectingSleeper(() => current);
  hasher.sleeper = sleeper;
  current = await createIdentityApp({
    configure: (builder) => builder.overrideProvider(PASSWORD_HASHER).useValue(hasher).overrideProvider(SLEEPER).useValue(sleeper),
  });
});
afterEach(async () => {
  await current.close();
});

const noCookies = (response: { headers: Record<string, unknown> }): void => {
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.headers['cache-control']).toBe('no-store');
};
const problemOf = (response: { body: unknown }): string => (response.body as { code: string }).code;
const comparable = (response: { body: unknown }): unknown => {
  const { traceId, ...rest } = response.body as Record<string, unknown>;
  expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  return rest;
};

describe('sign-in of the phone in two steps (EVM-094 AC1; SR-AUTH-07, ASVS V6.3.1)', () => {
  it('EVM-094 AC1 the password gives a challenge of 256 bits for 5 minutes at the most, the code gives the device, the tokens and the secret — and never a cookie', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const first = await phone.firstStep(account);
    expect(first.status).toBe(200);
    noCookies(first);
    const { challengeToken, challengeExpiresAt } = first.body as { challengeToken: string; challengeExpiresAt: string };
    expect(challengeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(challengeExpiresAt).getTime() - current.clock.now().getTime()).toBeLessThanOrEqual(LOGIN_ATTEMPT_TTL_MS);
    expect(LOGIN_ATTEMPT_TTL_MS).toBeLessThanOrEqual(5 * 60_000);

    const second = await phone.secondStep(challengeToken, codeNow(current, account.secret));
    expect(second.status).toBe(200);
    noCookies(second);
    expect(second.body).toMatchObject({
      accessToken: expect.stringMatching(/^evia_at_[A-Za-z0-9_-]{43}$/) as string,
      refreshToken: expect.stringMatching(/^evia_rt_[A-Za-z0-9_-]{43}$/) as string,
      installationSecret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as string,
      user: { id: account.user.id, role: 'editor' },
    });
    const session = second.body as { deviceId: string; accessTokenExpiresAt: string; refreshTokenExpiresAt: string; serverTime: string };
    expect(new Date(session.accessTokenExpiresAt).getTime() - new Date(session.serverTime).getTime()).toBe(15 * 60_000);
    expect(new Date(session.refreshTokenExpiresAt).getTime() - new Date(session.serverTime).getTime()).toBe(14 * 24 * 3_600_000);
  });

  it('EVM-094 AC1 the server writes the device (description, last contact, version) and a session of the mobile channel bound to it; only hashes are stored', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account, { device: { ...DEVICE, model: 'Pixel 8 Pro' } });
    const row = await deviceRow(current, phone.deviceId ?? '');
    expect(row).toMatchObject({
      user_id: account.user.id,
      state: 'active',
      model: 'Pixel 8 Pro',
      os_version: '14',
      platform: 'android',
      app_version: '1.2.0',
      pending_items_reported: 0,
    });
    expect((row?.last_contact_at as Date).toISOString()).toBe(current.clock.now().toISOString());
    const sessions = await mobileSessionsOf(current, account.user.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ channel: 'mobile', state: 'active', device_id: phone.deviceId, user_agent: null });
    // 14 days idle, 30 days absolute: not the 60 minutes and 12 hours of the panel
    const created = (sessions[0]?.created_at as Date).getTime();
    expect((sessions[0]?.idle_expires_at as Date).getTime() - created).toBe(14 * 24 * 3_600_000);
    expect((sessions[0]?.absolute_expires_at as Date).getTime() - created).toBe(30 * 24 * 3_600_000);
    // no token, no secret and no code anywhere the story writes
    const written = [
      await everythingWritten(current),
      JSON.stringify((await sql`select to_jsonb(t) as r from identity.devices t`.execute(current.database.admin)).rows),
      JSON.stringify((await sql`select to_jsonb(t) as r from identity.access_tokens t`.execute(current.database.admin)).rows),
      JSON.stringify((await sql`select to_jsonb(t) as r from identity.refresh_tokens t`.execute(current.database.admin)).rows),
      JSON.stringify((await sql`select to_jsonb(t) as r from identity.sessions t`.execute(current.database.admin)).rows),
      current.logs.text,
    ].join('\n');
    for (const secret of [phone.accessToken, phone.refreshToken, phone.installationSecret, account.password]) {
      expect(written).not.toContain(secret ?? 'unreachable');
    }
  });

  it('EVM-094 AC1 the identity of later requests is the session: user and device come from the token, never from the body', async () => {
    const account = await totpAccount(current);
    const other = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const response = await phone.get(MOBILE.config, phone.authorised());
    expect(response.status).toBe(200);
    // a logout names nobody: a body is refused and the session of the token ends, the other account's device is untouched
    const stranger = await signedInPhone(current, other);
    const refused = await phone.post(MOBILE.logout, { userId: other.user.id, deviceId: stranger.deviceId }, phone.authorised());
    expect([204, 400, 415]).toContain(refused.status);
    expect((await mobileSessionsOf(current, other.user.id)).every((session) => session.revoked_at === null)).toBe(true);
  });

  it('EVM-094 AC1 a challenge is used once: the second use of a spent challenge is the same 401 as a wrong code', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const { challengeToken } = (await phone.firstStep(account)).body as { challengeToken: string };
    expect((await phone.secondStep(challengeToken, codeNow(current, account.secret))).status).toBe(200);
    nextStep(current);
    const again = await phone.secondStep(challengeToken, codeNow(current, account.secret));
    expect(again.status).toBe(401);
    expect(problemOf(again)).toBe('invalid_credentials');
    expect(await devicesOf(current, account.user.id)).toHaveLength(1);
  });

  it('EVM-094 AC1 a challenge expires with its 5 minutes: the same 401 as a wrong code, nothing is created', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const { challengeToken } = (await phone.firstStep(account)).body as { challengeToken: string };
    current.clock.advance(LOGIN_ATTEMPT_TTL_MS + 1000);
    const late = await phone.secondStep(challengeToken, codeNow(current, account.secret));
    expect(late.status).toBe(401);
    expect(problemOf(late)).toBe('invalid_credentials');
    expect(await devicesOf(current, account.user.id)).toEqual([]);
  });

  it('EVM-094 AC1 five wrong codes end the challenge: the sixth try with the right code is refused', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const { challengeToken } = (await phone.firstStep(account)).body as { challengeToken: string };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await phone.secondStep(challengeToken, wrongCode(current, account.secret));
      expect(wrong.status, `${attempt}`).toBe(401);
      expect(problemOf(wrong)).toBe('invalid_credentials');
    }
    const last = await phone.secondStep(challengeToken, codeNow(current, account.secret));
    expect(last.status).toBe(401);
    expect(await devicesOf(current, account.user.id)).toEqual([]);
  });

  it('EVM-094 AC1 the challenge belongs to the channel it was made for: a challenge of the phone does not open the panel, a loginToken of the panel does not open the phone', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const { challengeToken } = (await phone.firstStep(account)).body as { challengeToken: string };
    const panel = current.panel();
    const asWeb = await sendLoginTotp(panel, challengeToken, codeNow(current, account.secret));
    expect(asWeb.status).toBe(401);
    expect(asWeb.headers['set-cookie']).toBeUndefined();
    const webToken = await startLogin(current.panel(), account);
    const asMobile = await phone.secondStep(webToken, codeNow(current, account.secret));
    expect(asMobile.status).toBe(401);
    expect(problemOf(asMobile)).toBe('invalid_credentials');
    expect(await mobileSessionsOf(current, account.user.id)).toEqual([]);
  });

  it('EVM-094 AC1 the challenge is void when the password changed between the steps (the stamp of the credentials, CWE-367) and is spent', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const { challengeToken } = (await phone.firstStep(account)).body as { challengeToken: string };
    await sql`update identity.password_credentials set updated_at = updated_at + interval '1 second' where user_id = ${account.user.id}`.execute(
      current.database.admin,
    );
    const refused = await phone.secondStep(challengeToken, codeNow(current, account.secret));
    expect(refused.status).toBe(401);
    expect(await devicesOf(current, account.user.id)).toEqual([]);
    const retry = await phone.secondStep(challengeToken, codeNow(current, account.secret));
    expect(retry.status).toBe(401);
  });

  it('EVM-094 AC1 a code spent in the panel does not work on the phone: the last used step is shared (SR-AUTH-07)', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const web = current.panel();
    const loginToken = await startLogin(web, account);
    const { challengeToken } = (await phone.firstStep(account)).body as { challengeToken: string };
    const code = codeNow(current, account.secret);
    expect((await sendLoginTotp(web, loginToken, code)).status).toBe(200);
    const same = await phone.secondStep(challengeToken, code);
    expect(same.status).toBe(401);
    expect(problemOf(same)).toBe('invalid_credentials');
  });

  it('EVM-094 AC1 an Administrator signs in on the phone too, and the Administrators and the owner are told about the new device', async () => {
    const admin = await enrolledAccount(current, { role: 'administrator' });
    const secret = await addTotp(current, admin);
    const account = { ...admin, secret } as unknown as Parameters<typeof signInPhone>[2];
    const phone = newPhone(current);
    const { second } = await signInPhone(current, phone, account);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ user: { role: 'administrator' } });
    expect((await outboxRows(current, { recipient: admin.user.id, kind: 'new_device' })).map((row) => row.state)).toEqual(['pending']);
    expect((await outboxRows(current, { recipient: admin.user.id, kind: 'administrator_alert' })).map((row) => row.variant)).toEqual([
      'administrator_new_device',
    ]);
  });
});

describe('the same installation and the limit of devices (EVM-094 AC2; SR-SESS-04, CWE-362)', () => {
  it('EVM-094 AC2 a phone that introduces itself with its pair is the same device: no new place, a NEW secret, the earlier session replaced', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const [deviceId, secret] = [phone.deviceId, phone.installationSecret];
    const { second } = await signInPhone(current, phone, account, { pair: true });
    expect(second.status).toBe(200);
    expect(phone.deviceId).toBe(deviceId);
    expect(phone.installationSecret).not.toBe(secret);
    expect(await devicesOf(current, account.user.id)).toHaveLength(1);
    const sessions = await mobileSessionsOf(current, account.user.id);
    expect(sessions.map((session) => session.revoke_reason)).toEqual(['rotated', null]);
  });

  it('EVM-094 AC2 two-phase rotation: when the answer with the new secret was lost, the phone still comes back with the previous one — same device, no place taken, no second device', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const proven = phone.installationSecret;
    // the phone proves the first secret by using its tokens, then signs in again; the answer of that second sign-in is lost
    expect((await phone.get(MOBILE.config, phone.authorised())).status).toBe(200);
    const lost = newPhone(current);
    lost.deviceId = phone.deviceId;
    lost.installationSecret = phone.installationSecret;
    const second = await signInPhone(current, lost, account, { pair: true });
    expect(second.second.status).toBe(200);
    const unseen = lost.installationSecret;
    expect(unseen).not.toBe(proven);
    // the phone never saw `unseen`: it presents the one it holds
    const again = newPhone(current);
    again.deviceId = phone.deviceId;
    again.installationSecret = proven;
    const recovered = await signInPhone(current, again, account, { pair: true });
    expect(recovered.second.status).toBe(200);
    expect(again.deviceId).toBe(phone.deviceId);
    expect(await devicesOf(current, account.user.id)).toHaveLength(1);
    expect(
      (await auditActions(current)).filter((event) => event.action === 'device.recognized').map((event) => event.reason_code),
    ).toContain('previous_secret');
  });

  it('EVM-094 AC2 at most two secrets are valid: a secret issued and never proved stops working when the next is issued', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account); // secret 1 (unproven)
    const first = phone.installationSecret;
    const second = newPhone(current);
    second.deviceId = phone.deviceId;
    second.installationSecret = first;
    await signInPhone(current, second, account, { pair: true }); // presents 1 (proves it), issues 2
    const third = newPhone(current);
    third.deviceId = phone.deviceId;
    third.installationSecret = second.installationSecret;
    await signInPhone(current, third, account, { pair: true }); // presents 2, issues 3: 1 is the previous
    const stale = newPhone(current);
    stale.deviceId = phone.deviceId;
    stale.installationSecret = first;
    const { second: staleSecond } = await signInPhone(current, stale, account, { pair: true });
    expect(staleSecond.status).toBe(200);
    // the secret `first` was valid only as the "previous" of the second sign-in and is not any more: a NEW device was registered
    expect(stale.deviceId).not.toBe(phone.deviceId);
  });

  it('EVM-094 AC2 a wrong secret, an unknown deviceId and the pair of another account are ignored: a new device is registered and the mismatch is audited', async () => {
    const account = await totpAccount(current);
    const other = await totpAccount(current);
    const phone = await signedInPhone(current, other);
    const bad = newPhone(current);
    bad.deviceId = phone.deviceId; // a device of ANOTHER account
    bad.installationSecret = phone.installationSecret;
    const { second } = await signInPhone(current, bad, account, { pair: true });
    expect(second.status).toBe(200);
    expect(bad.deviceId).not.toBe(phone.deviceId);
    const wrongSecret = newPhone(current);
    wrongSecret.deviceId = bad.deviceId;
    wrongSecret.installationSecret = 'A'.repeat(43);
    expect((await signInPhone(current, wrongSecret, account, { pair: true })).second.status).toBe(200);
    expect(wrongSecret.deviceId).not.toBe(bad.deviceId);
    const events = (await auditActions(current)).filter(
      (event) => event.action === 'device.registered' && event.actor_user_id === account.user.id,
    );
    expect(events.map((event) => event.reason_code)).toEqual(['secret_mismatch', 'secret_mismatch']);
    // the other account's device is untouched
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ user_id: other.user.id, state: 'active' });
  });

  it('EVM-094 AC2 a third phone gets 403 device_limit_reached only after the right code — nothing is created, the challenge is spent, the refusal is audited', async () => {
    const account = await totpAccount(current);
    await signedInPhone(current, account);
    await signedInPhone(current, account);
    const third = newPhone(current);
    nextStep(current);
    const { challengeToken } = (await third.firstStep(account)).body as { challengeToken: string };
    // a wrong code is not the limit: it is the same 401 as anywhere
    expect(problemOf(await third.secondStep(challengeToken, wrongCode(current, account.secret)))).toBe('invalid_credentials');
    const limited = await third.secondStep(challengeToken, codeNow(current, account.secret));
    expect(limited.status).toBe(403);
    expect(problemOf(limited)).toBe('device_limit_reached');
    noCookies(limited);
    expect(await devicesOf(current, account.user.id)).toHaveLength(2);
    expect(await mobileSessionsOf(current, account.user.id)).toHaveLength(2);
    expect((await auditActions(current)).filter((event) => event.reason_code === 'device_limit_reached')).toMatchObject([
      { action: 'login.failed', outcome: 'denied', actor_user_id: account.user.id },
    ]);
    nextStep(current);
    const spent = await third.secondStep(challengeToken, codeNow(current, account.secret));
    expect(spent.status).toBe(401);
  });

  it('EVM-094 AC2 a device whose session ended or that was ordered to wipe takes no place; a known device comes back when two others are in use', async () => {
    const account = await totpAccount(current);
    const first = await signedInPhone(current, account);
    const second = await signedInPhone(current, account);
    await sql`update identity.sessions set revoked_at = now(), revoke_reason = 'logout' where device_id = ${second.deviceId ?? null}`.execute(
      current.database.admin,
    );
    const third = await signedInPhone(current, account);
    expect(third.deviceId).not.toBe(first.deviceId);
    // the second device wants back, but the other two are in use: the limit holds for it as well
    const { second: back } = await signInPhone(current, second, account, { pair: true });
    expect(back.status).toBe(403);
    expect(problemOf(back)).toBe('device_limit_reached');
  });

  it('EVM-094 AC2 two phones finishing the second step at once never pass the limit of two (the account is locked first, A1)', async () => {
    const account = await totpAccount(current);
    await signedInPhone(current, account);
    const [a, b] = [newPhone(current), newPhone(current)];
    nextStep(current);
    const { challengeToken: tokenA } = (await a.firstStep(account)).body as { challengeToken: string };
    const { challengeToken: tokenB } = (await b.firstStep(account)).body as { challengeToken: string };
    const results = await Promise.all([
      a.secondStep(tokenA, codeNow(current, account.secret)),
      b.secondStep(tokenB, codeNow(current, account.secret, 1)),
    ]);
    expect(results.filter((response) => response.status === 200).length).toBeLessThanOrEqual(1);
    expect((await devicesOf(current, account.user.id)).length).toBeLessThanOrEqual(2);
    expect((await mobileSessionsOf(current, account.user.id)).filter((session) => session.revoked_at === null).length).toBeLessThanOrEqual(
      2,
    );
  });

  it('EVM-094 AC2 the web limit of five sessions counts the web channel only: signing in to the panel does not end the sessions of phones', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    for (let index = 0; index < 6; index += 1) {
      const panel = current.panel();
      nextStep(current);
      const loginToken = await startLogin(panel, account);
      await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    }
    const sessions = await mobileSessionsOf(current, account.user.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.revoked_at).toBeNull();
    expect((await phone.get(MOBILE.config, phone.authorised())).status).toBe(200);
  });
});

/** The device is removed, or wiped (the secrets burned), behind the back of the sign-in. */
const markDevice = async (change: 'removed' | 'wiped', id: string): Promise<void> => {
  if (change === 'removed') await sql`update identity.devices set removed_at = now() where id = ${id}`.execute(current.database.admin);
  else await sql`update identity.devices set state = 'wiped' where id = ${id}`.execute(current.database.admin);
};

describe('the state of the account and of the device between the steps (EVM-094 AC1, AC2; CWE-367)', () => {
  it('EVM-094 AC1 an account deactivated between the steps gets the one 401 and no device; the refusal is audited as not_active', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const { challengeToken } = (await phone.firstStep(account)).body as { challengeToken: string };
    await sql`update identity.users set status = 'deactivated' where id = ${account.user.id}`.execute(current.database.admin);
    const refused = await phone.secondStep(challengeToken, codeNow(current, account.secret));
    expect(refused.status).toBe(401);
    expect(problemOf(refused)).toBe('invalid_credentials');
    expect(await devicesOf(current, account.user.id)).toEqual([]);
    expect((await auditActions(current)).filter((event) => event.reason_code === 'not_active')).toHaveLength(1);
  });

  it('EVM-094 AC2 a device removed or wiped between the steps is no longer recognised: the phone is registered as a new device (a wiped device has no valid secret)', async () => {
    for (const change of ['removed', 'wiped'] as const) {
      const account = await totpAccount(current);
      const phone = await signedInPhone(current, account);
      const known = phone.deviceId;
      nextStep(current);
      const { challengeToken } = (await phone.firstStep(account, { pair: true })).body as { challengeToken: string };
      await markDevice(change, known ?? '');
      const second = await phone.secondStep(challengeToken, codeNow(current, account.secret));
      expect(second.status, change).toBe(200);
      expect((second.body as { deviceId: string }).deviceId, change).not.toBe(known);
    }
  });

  it('EVM-094 AC1 the notice of a new device for an account that has no such device is obsolete: nothing is sent', async () => {
    const account = await totpAccount(current);
    await sql`insert into platform.email_outbox (kind, variant, recipient_user_id, created_at) values ('new_device', null, ${account.user.id}, ${current.clock.now()})`.execute(
      current.database.admin,
    );
    const harness = emailHarness(current);
    const rows = await outboxRows(current, { recipient: account.user.id, kind: 'new_device' });
    await harness.job.run({ ids: rows.map((row) => row.id) });
    expect(harness.sender.sent).toEqual([]);
    expect((await outboxRows(current, { recipient: account.user.id, kind: 'new_device' })).map((row) => row.state)).toEqual(['superseded']);
  });
});

describe('role, channel and the order of the checks (EVM-094 AC3; SR-AUTHZ-12, SR-AUTH-05)', () => {
  it('EVM-094 AC3 a read-only account gets the challenge for a correct password (the password does not tell the role) and 403 channel_not_allowed only after the right code', async () => {
    const account = await totpAccount(current, { role: 'read_only' });
    const phone = newPhone(current);
    nextStep(current);
    const first = await phone.firstStep(account);
    expect(first.status).toBe(200);
    const { challengeToken } = first.body as { challengeToken: string };
    const refused = await phone.secondStep(challengeToken, codeNow(current, account.secret));
    expect(refused.status).toBe(403);
    expect(problemOf(refused)).toBe('channel_not_allowed');
    noCookies(refused);
    expect(await devicesOf(current, account.user.id)).toEqual([]);
    expect(await mobileSessionsOf(current, account.user.id)).toEqual([]);
    expect((await auditActions(current)).filter((event) => event.reason_code === 'channel_not_allowed')).toHaveLength(1);
  });

  it('EVM-094 AC3 an account with a key only gets 403 totp_not_configured and one with no second step 403 mfa_enrollment_required — after a correct password, never before', async () => {
    const keyOnly = await enrolledAccount(current, { role: 'editor' });
    const none = await totpAccount(current);
    await sql`delete from identity.totp_factors where user_id = ${none.user.id}`.execute(current.database.admin);
    const phone = newPhone(current);
    nextStep(current);
    const onlyKey = await phone.firstStep(keyOnly);
    expect(onlyKey.status).toBe(403);
    expect(problemOf(onlyKey)).toBe('totp_not_configured');
    const noSecondStep = await phone.firstStep(none);
    expect(noSecondStep.status).toBe(403);
    expect(problemOf(noSecondStep)).toBe('mfa_enrollment_required');
    for (const account of [keyOnly, none]) {
      const wrong = await phone.firstStep({ email: account.email, password: WRONG });
      expect(wrong.status).toBe(401);
      expect(problemOf(wrong)).toBe('invalid_credentials');
    }
    expect(await devicesOf(current, none.user.id)).toEqual([]);
  });

  it('EVM-094 AC3 every failure of the first step is the one 401 invalid_credentials: a wrong password, an unknown address, an invited and a deactivated account answer alike', async () => {
    const account = await totpAccount(current);
    const off = await totpAccount(current);
    await sql`update identity.users set status = 'deactivated' where id = ${off.user.id}`.execute(current.database.admin);
    const phone = newPhone(current);
    nextStep(current);
    const answers = [
      await phone.firstStep({ email: account.email, password: WRONG }),
      await phone.firstStep({ email: 'nikt@evia.invalid', password: WRONG }),
      await phone.firstStep({ email: off.email, password: off.password }),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(401);
      noCookies(answer);
    }
    expect(new Set(answers.map((answer) => JSON.stringify(comparable(answer)))).size).toBe(1);
    // exactly one Argon2id verification per try, against the stored hash or the dummy
    expect(hasher.verifications.slice(-3)).toHaveLength(3);
  });

  it('EVM-094 AC3 the credential of the other channel is ignored: a cookie of the panel changes nothing on the sign-in of the phone, and sets nothing', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const response = await phone.firstStep(account, { headers: { Cookie: account.panel.cookieHeader() ?? '' } });
    expect(response.status).toBe(200);
    noCookies(response);
    const second = await phone.secondStep((response.body as { challengeToken: string }).challengeToken, codeNow(current, account.secret), {
      Cookie: account.panel.cookieHeader() ?? '',
    });
    expect(second.status).toBe(200);
    noCookies(second);
  });

  it('EVM-094 AC3 the body is limited to 8 KB even with a cookie of the panel (413), and only JSON is read (415)', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    const big = await phone.post(
      MOBILE.login,
      { email: account.email, password: 'x'.repeat(9000), device: DEVICE },
      { Cookie: account.panel.cookieHeader() ?? '' },
    );
    expect(big.status).toBe(413);
    const plain = await phone.post(MOBILE.login).set('Content-Type', 'text/plain').send('email=a&password=b');
    expect(plain.status).toBe(415);
    noCookies(plain);
    const form = await phone.post(MOBILE.login).set('Content-Type', 'application/x-www-form-urlencoded').send('email=a&password=b');
    expect(form.status).toBe(415);
  });
});

describe('validation of the input (EVM-094; ASVS V2.2.1, SR-API-02, SR-API-01)', () => {
  it('EVM-094 AC1 the body is strict: an unknown field, a user id, a missing half of the pair and an impossible date are 400 — and the answer repeats no value', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const base = { email: account.email, password: account.password, device: DEVICE };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...base, userId: account.user.id }, '/userId'],
      [{ ...base, deviceId: '0193a000-0000-7000-8000-0000000000d1' }, '/installationSecret'],
      [{ ...base, installationSecret: 'A'.repeat(43) }, '/deviceId'],
      [{ ...base, device: { ...DEVICE, securityPatch: '2026-13-45' } }, '/device/securityPatch'],
      [{ ...base, device: { ...DEVICE, model: 'Pixel\u0000<script>' } }, '/device/model'],
      [{ ...base, device: { ...DEVICE, osVersion: '14'.repeat(20) } }, '/device/osVersion'],
      [{ ...base, device: { model: 'Pixel 8' } }, '/device/osVersion'],
    ];
    for (const [body, pointer] of cases) {
      const response = await phone.post(MOBILE.login, body);
      expect(response.status, pointer).toBe(400);
      expect(problemOf(response)).toBe('validation_failed');
      expect((response.body as { errors: Array<{ pointer: string }> }).errors.map((error) => error.pointer)).toContain(pointer);
      expect(JSON.stringify(response.body)).not.toMatch(/script|2026-13|000000|password/i);
    }
    const bad = await phone.post(MOBILE.totp, { challengeToken: 'short', code: '12345a' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain('12345a');
    const recovery = await phone.post(MOBILE.totp, { challengeToken: 'A'.repeat(43), code: '123456', recoveryCode: 'abcd-efgh' });
    expect(recovery.status).toBe(400);
  });
});

describe('the log of a request that is refused (EVM-094 AC8; SR-LOG-02, ASVS V16.2.5)', () => {
  it('EVM-094 AC8 the body of a refused request is nowhere in the log: neither the password, nor the code, nor the Authorization header', async () => {
    const phone = newPhone(current);
    await phone.post(MOBILE.login, { email: 'x@evia.invalid', password: 'LOGMARK', device: {} });
    await phone.post(MOBILE.totp, { challengeToken: 'LOGMARK', code: 'LOGMARK' });
    await phone.post(MOBILE.token, { refreshToken: 'LOGMARK' }, { Authorization: 'Bearer LOGMARK' });
    await phone.get(MOBILE.config, { Authorization: 'Bearer LOGMARK' });
    expect(current.logs.text).not.toContain('LOGMARK');
  });
});

describe('guessing and the notice of a new device (EVM-094 AC5; SR-AUTH-05, SR-AUTH-15)', () => {
  it('EVM-094 AC5 the counter is shared with the panel: ten failed passwords lock the account for the phone too (429 with Retry-After), still one verification', async () => {
    const account = await totpAccount(current);
    await wrongPasswords(current, account.email, 10);
    const phone = newPhone(current);
    const before = hasher.verifications.length;
    const locked = await phone.firstStep(account);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    noCookies(locked);
    expect(hasher.verifications.length - before).toBe(1);
  });

  it('EVM-094 AC5 a phone the account knows has its own counter: a lock caused by strangers does not switch it off (a second pool for whoever holds the secret, RR-28)', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    await wrongPasswords(current, account.email, 10);
    nextStep(current);
    const stranger = newPhone(current);
    expect((await stranger.firstStep(account)).status).toBe(429);
    const known = await phone.firstStep(account, { pair: true });
    expect(known.status).toBe(200);
    // a pair of ANOTHER account does not get the pool of the known device: it is counted in the account's, which is locked
    const other = await totpAccount(current);
    const foreign = newPhone(current);
    foreign.deviceId = (await signedInPhone(current, other)).deviceId;
    foreign.installationSecret = 'A'.repeat(43);
    expect((await foreign.firstStep(account, { pair: true })).status).toBe(429);
  });

  it('EVM-094 AC5 wrong codes are counted like in the panel: ten wrong second steps lock the sign-in, even for the right code', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    for (let round = 0; round < 2; round += 1) {
      const { challengeToken } = (await phone.firstStep(account)).body as { challengeToken: string };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await phone.secondStep(challengeToken, wrongCode(current, account.secret))).status).toBe(401);
      }
      current.clock.advance(3000);
    }
    const locked = await phone.firstStep(account);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('EVM-094 AC5 a sign-in from a new device writes the notice to the owner: model, system and time, no IP, no token and no identifier of the device', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account, { device: { ...DEVICE, model: 'Galaxy S24 (SM-S921B)' } });
    const harness = emailHarness(current);
    const rows = await outboxRows(current, { recipient: account.user.id, kind: 'new_device' });
    expect(rows).toHaveLength(1);
    await harness.job.run({ ids: [rows[0]?.id ?? ''] });
    expect(harness.sender.sent).toHaveLength(1);
    const mail = harness.sender.sent[0];
    expect(mail?.to).toBe(account.email);
    expect(mail?.text).toContain('Galaxy S24 (SM-S921B), Android 14');
    expect(mail?.text).not.toMatch(/\d+\.\d+\.\d+\.\d+|evia_(at|rt)_/);
    expect(mail?.text).not.toContain(phone.deviceId ?? 'unreachable');
    expect(mail?.text).not.toContain(phone.installationSecret ?? 'unreachable');
    // the same phone again is not a new device: no second notice
    await signInPhone(current, phone, account, { pair: true });
    expect(await outboxRows(current, { recipient: account.user.id, kind: 'new_device' })).toHaveLength(1);
  });
});

describe('the version of the app (EVM-094 AC6; SR-API-08)', () => {
  it('EVM-094 AC6 an old app gets 426 with the minimum version BEFORE the limits and the hashing of the password; a missing or forged header is 426 too', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const before = hasher.verifications.length;
    const olds: Array<Record<string, string>> = [
      { 'X-Client-Version': '1.1.9' },
      { 'X-Client-Version': '0.0.1' },
      { 'X-Client-Platform': 'ios', 'X-Client-Version': '1.0.0' },
      { 'X-Client-Platform': 'windows' },
    ];
    for (const headers of olds) {
      const response = await phone.firstStep(account, { headers });
      expect(response.status, JSON.stringify(headers)).toBe(426);
      expect(problemOf(response)).toBe('client_version_unsupported');
      expect(response.body).toMatchObject({ minSupportedVersion: { android: '1.2.0', ios: '1.1.0' } });
      noCookies(response);
    }
    const bare = await phone
      .post(MOBILE.login, { email: account.email, password: account.password, device: DEVICE })
      .unset('X-Client-Version')
      .unset('X-Client-Platform');
    expect(bare.status).toBe(426);
    expect(hasher.verifications.length).toBe(before);
    const fresh = await phone.firstStep(account, { headers: { 'X-Client-Version': '1.2.1' } });
    expect(fresh.status).toBe(200);
  });

  it('EVM-094 AC6 the second step and the renewal are refused for an old app too, and the session is not ended by it', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    const old = await phone.refresh(phone.refreshToken, { 'X-Client-Version': '1.0.0' });
    expect(old.status).toBe(426);
    const secondOld = await phone.secondStep('A'.repeat(43), '123456', { 'X-Client-Version': '1.0.0' });
    expect(secondOld.status).toBe(426);
    const ok = await phone.refresh();
    expect(ok.status).toBe(200);
    expect((await mobileSessionsOf(current, account.user.id))[0]?.revoked_at).toBeNull();
  });
});

describe('the wipe before the password (EVM-094 AC7)', () => {
  it('EVM-094 AC7 a pair that fits a device ordered to wipe gets 401 device_wipe_required BEFORE the password is looked at — no hashing, no counter, nothing about the account', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    await sql`update identity.devices set state = 'wipe_required' where id = ${phone.deviceId ?? null}`.execute(current.database.admin);
    const before = hasher.verifications.length;
    nextStep(current);
    const response = await phone.firstStep({ email: 'nikt@evia.invalid', password: WRONG }, { pair: true });
    expect(response.status).toBe(401);
    expect(problemOf(response)).toBe('device_wipe_required');
    noCookies(response);
    expect(hasher.verifications.length).toBe(before);
    // a wrong secret for the same device does not get the signal: it is a stranger (one answer, as for any wrong password)
    const stranger = newPhone(current);
    stranger.deviceId = phone.deviceId;
    stranger.installationSecret = 'A'.repeat(43);
    const wrong = await stranger.firstStep({ email: 'nikt@evia.invalid', password: WRONG }, { pair: true });
    expect(problemOf(wrong)).toBe('invalid_credentials');
  });

  it('EVM-094 AC7 a wipe ordered between the two steps is the signal after the right code; the challenge is spent', async () => {
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    nextStep(current);
    const { challengeToken } = (await phone.firstStep(account, { pair: true })).body as { challengeToken: string };
    await sql`update identity.devices set state = 'wipe_required' where id = ${phone.deviceId ?? null}`.execute(current.database.admin);
    const response = await phone.secondStep(challengeToken, codeNow(current, account.secret));
    expect(response.status).toBe(401);
    expect(problemOf(response)).toBe('device_wipe_required');
    expect(PATHS).toBeDefined();
  });
});

describe('the headers of every answer (EVM-094 AC7, B9)', () => {
  it('EVM-094 AC7 every answer of the sign-in — success, 400, 401, 403, 413, 415, 426, 429 — is no-store and sets no cookie', async () => {
    const account = await totpAccount(current);
    const phone = newPhone(current);
    nextStep(current);
    const answers = [
      await phone.firstStep(account),
      await phone.post(MOBILE.login, { bad: true }),
      await phone.firstStep({ email: account.email, password: WRONG }),
      await phone.post(MOBILE.login, { email: account.email, password: 'x'.repeat(9000), device: DEVICE }),
      await phone.post(MOBILE.login).set('Content-Type', 'text/plain').send('x'),
      await phone.firstStep(account, { headers: { 'X-Client-Version': '1.0.0' } }),
      await phone.secondStep('A'.repeat(43), '123456'),
    ];
    for (const answer of answers) noCookies(answer);
    expect(answers.map((answer) => answer.status)).toEqual([200, 400, 401, 413, 415, 426, 401]);
    expect(APP_HEADERS['X-Client-Version']).toBe('1.2.0');
  });
});
