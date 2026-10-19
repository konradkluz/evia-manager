import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATHS, passkeyOptions, registerPasskey } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createPasskey, createSession } from '../support/identity-fixtures.ts';
import { USERS, browserOf, emailHarness, linksOf, outboxRows } from '../support/invitation-fixtures.ts';
import { adopt, enrolledAccount, firstStep, loginOptions, secondStep, signIn } from '../support/login-flows.ts';
import { RESET, deliverReset, requestReset } from '../support/password-reset-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import {
  SECOND_STEP,
  codeNow,
  confirmTotp,
  everythingWritten,
  sendLoginRecoveryCode,
  sendLoginTotp,
  startLogin,
  totpAccount,
} from '../support/totp-flows.ts';
import {
  accountWithSessions,
  auditOf,
  deactivate,
  etag,
  reactivate,
  resetSecondStep,
  sessionAnswer,
  userRow,
  versionOf,
} from '../support/user-access-fixtures.ts';
import { VirtualAuthenticator } from '../support/virtual-authenticator.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => current.database.admin;
const HOUR = 3_600_000;
const REVOKED = { status: 401, code: 'session_revoked' };

type Counted = 'passkeys' | 'totp' | 'sessions';
const count = async (table: Counted, userId: string): Promise<number> => {
  const query = {
    passkeys: sql<{ n: string }>`select count(*)::text as n from identity.passkeys where user_id = ${userId}`,
    totp: sql<{ n: string }>`select count(*)::text as n from identity.totp_factors where user_id = ${userId}`,
    sessions: sql<{ n: string }>`select count(*)::text as n from identity.sessions where user_id = ${userId}`,
  }[table];
  return Number((await query.execute(db())).rows[0]?.n);
};

/** The password sign-in of an account in its window: a browser that holds the session `mfa_enrollment`. */
async function enterWindow(account: { email: string; password: string }): Promise<PanelClient> {
  current.clock.advance(61_000);
  const panel = current.panel();
  const response = await firstStep(panel, account.email, account.password);
  if (response.status !== 200 || (response.body as { state?: string }).state !== 'mfa_enrollment') {
    throw new Error(`no window session: ${response.status} ${JSON.stringify(response.body)}`);
  }
  adopt(panel, response);
  return panel;
}

async function windows(userId: string) {
  return (await linksOf(current, userId)).filter((link) => link.issued_by === 'mfa_reset');
}

describe('the reset of the second step (EVM-027 AC4; SR-AUTH-13, SR-SESS-06, ASVS V6.4.4)', () => {
  it('EVM-027 AC4 the keys and the authenticator are deleted, the recovery codes are retired, the sessions end, the window of 24 hours opens, the owner is told and the event is audited', async () => {
    const admin = await browserOf(current);
    const anna = await totpAccount(current, { role: 'editor', withCodes: true });
    await createPasskey(db(), current.clock, anna.user);
    const version = await versionOf(current, anna.user.id);

    const response = await resetSecondStep(current, admin, anna.user.id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: anna.user.id, status: 'active', secondStepMethods: [], version: version + 1 });
    expect(response.headers['etag']).toBe(`"${version + 1}"`);
    expect(await count('passkeys', anna.user.id)).toBe(0);
    expect(await count('totp', anna.user.id)).toBe(0);
    const codes = await sql<{
      superseded_at: Date | null;
    }>`select superseded_at from identity.recovery_codes where user_id = ${anna.user.id}`.execute(db());
    expect(codes.rows).toHaveLength(10); // retired, not deleted (the audit of the generations stays)
    expect(codes.rows.every((row) => row.superseded_at !== null)).toBe(true);
    expect(await sessionAnswer(anna.panel)).toEqual(REVOKED);

    const [window, ...others] = await windows(anna.user.id);
    expect(others).toEqual([]);
    expect(window).toMatchObject({ used_at: null, superseded_at: null });
    expect((window?.expires_at.getTime() ?? 0) - (window?.issued_at.getTime() ?? 0)).toBe(24 * HOUR);
    expect((await outboxRows(current, { recipient: anna.user.id, kind: 'mfa_changed' })).at(-1)).toMatchObject({
      variant: 'second_step_reset',
      state: 'pending',
    });
    expect(await auditOf(current, 'user.second_step_reset')).toEqual([
      {
        actor_user_id: admin.user.id,
        object_id: anna.user.id,
        outcome: 'success',
        reason_code: 'identity_verified_in_person',
        from_code: null,
        to_code: null,
      },
    ]);
    expect((await auditOf(current, 'session.revoked')).filter((event) => event.reason_code === 'second_step_reset')).toHaveLength(1);
  });

  it('EVM-027 AC4 after the reset the old code of the app, an old recovery code and an old key sign nobody in: the sign-in that was under way is dead, and the new one has no second step to offer', async () => {
    const admin = await browserOf(current);
    const anna = await totpAccount(current, { role: 'editor', withCodes: true });
    const waiting = current.panel();
    const loginToken = await startLogin(waiting, anna);

    expect((await resetSecondStep(current, admin, anna.user.id)).status).toBe(200);

    for (const response of [
      await sendLoginTotp(waiting, loginToken, codeNow(current, anna.secret)),
      await sendLoginRecoveryCode(waiting, loginToken, anna.codes[0] ?? ''),
    ]) {
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'unauthenticated' });
    }
    // a new first step gives no loginToken: the only thing the password opens is the window (no code of the old authenticator can be sent)
    current.clock.advance(61_000);
    const again = await firstStep(current.panel(), anna.email, anna.password);
    expect(again.body).toMatchObject({ state: 'mfa_enrollment' });
    expect((again.body as { loginToken?: string }).loginToken).toBeUndefined();
    expect((await sendLoginTotp(current.panel(), 'A'.repeat(43), codeNow(current, anna.secret))).status).toBe(401);
  });

  it('EVM-027 AC4 an old passkey signs nobody in either: the loginToken and the ceremony that were under way are dead', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    const panel = current.panel();
    const { loginToken } = (await firstStep(panel, anna.email, anna.password)).body as { loginToken: string };
    const { options } = await loginOptions(panel, loginToken);

    expect((await resetSecondStep(current, admin, anna.user.id)).status).toBe(200);

    const attempt = await secondStep(panel, loginToken, anna.authenticator, options);
    expect(attempt.status).toBe(401);
    expect(attempt.headers['set-cookie']).toBeUndefined();
    expect(await count('passkeys', anna.user.id)).toBe(0);
  });

  it('EVM-027 AC4 the session of the window cannot make a step-up with an old code: only the setup of a second step is allowed (403 mfa_enrollment_required)', async () => {
    const admin = await browserOf(current);
    const anna = await totpAccount(current, { role: 'editor' });
    expect((await resetSecondStep(current, admin, anna.user.id)).status).toBe(200);
    const panel = await enterWindow(anna);
    const stepUp = await panel.post(SECOND_STEP.stepUp, { code: codeNow(current, anna.secret, 1) });
    expect(stepUp.status).toBe(403);
    expect(stepUp.body).toMatchObject({ code: 'mfa_enrollment_required' });
  });

  it('EVM-027 AC4 a reset of the second step of an Administrator by ANOTHER Administrator works (and alerts them all); by themselves it is 409 own_account_not_allowed', async () => {
    const admin = await browserOf(current);
    const other = await accountWithSessions(current, { role: 'administrator', count: 0, key: true });
    expect((await resetSecondStep(current, admin, admin.user.id)).status).toBe(409);
    const response = await resetSecondStep(current, admin, other.user.id);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ role: 'administrator', secondStepMethods: [] });
  });

  it('EVM-027 AC4 only an active account has a second step to reset: an invited and a deactivated one are 409 invalid_state_transition, nothing is written', async () => {
    const admin = await browserOf(current);
    const invited = await accountWithSessions(current, { status: 'invited', count: 0 });
    const off = await accountWithSessions(current, { status: 'deactivated', count: 0 });
    const before = await current.snapshot();
    for (const target of [invited, off]) {
      const response = await resetSecondStep(current, admin, target.user.id);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'invalid_state_transition' });
    }
    expect(await current.snapshot()).toBe(before);
  });

  it('EVM-027 AC4 SR-INPUT-07 the confirmation of the identity is one of two codes — no free text: a note, another value and a missing value are 400 and nothing is written', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { count: 1, key: true });
    const before = await current.snapshot();
    const headers = { 'If-Match': etag(await versionOf(current, anna.user.id)) };
    for (const [body, pointer, code] of [
      [{ identityVerification: 'phone' }, '/identityVerification', 'invalid_value'],
      [{}, '/identityVerification', 'invalid_value'],
      [{ identityVerification: 'in_person', note: 'Jan Kowalski, dowód' }, '/note', 'unknown_field'],
    ] as const) {
      const response = await admin.panel.post(`${USERS}/${anna.user.id}/second-step-reset`, body, headers);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed', errors: expect.arrayContaining([{ pointer, code }]) as unknown });
      expect(JSON.stringify(response.body)).not.toMatch(/Kowalski|dowód/);
    }
    expect(await current.snapshot()).toBe(before);
    expect((await admin.panel.post(`${USERS}/${anna.user.id}/second-step-reset`, { identityVerification: 'video_call' })).status).toBe(428);
  });

  it('EVM-027 AC4 the e-mail to the owner is a fixed text sent to the address of the account: what happened, until when — no link that signs in or sets a password, no person', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { count: 0, key: true, email: 'anna.utracona@example.com' });
    await resetSecondStep(current, admin, anna.user.id);
    const { job, sender } = emailHarness(current);
    const [row] = await outboxRows(current, { recipient: anna.user.id, kind: 'mfa_changed' });
    await job.run({ ids: [row?.id ?? ''] });

    const [message] = sender.sent;
    expect(message?.to).toBe('anna.utracona@example.com');
    expect(message?.subject).toBe('EVia Manager: zmiana drugiego kroku logowania');
    expect(message?.text).toContain('zresetowano drugi krok logowania w panelu administracji. Wszystkie sesje konta zostały zakończone.');
    // 2026-10-01 08:00Z + 24 h = 2026-10-02 08:00Z = 10:00 in Europe/Warsaw (CEST)
    expect(message?.text).toContain('Skonfiguruj drugi krok do 02.10.2026, 10:00 — po tym czasie poproś administratora o ponowny reset.');
    expect(message?.text).not.toMatch(/#[A-Za-z0-9_-]{20}|login\/reset|reset-password|Użytkownik|anna\.utracona/i);
  });
});

describe('the window to set up a second step (EVM-027 D1, D2; SR-AUTH-13, AB-01, R4, R5, R12)', () => {
  it('EVM-027 D1 in the window the password gives the session of the setup (403 mfa_enrollment_required for the rest), and a passkey registered there ends the window: a new session, the e-mail, no second activation', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    const activated = (await userRow(current, anna.user.id))?.activated_at;
    expect((await resetSecondStep(current, admin, anna.user.id)).status).toBe(200);
    const version = await versionOf(current, anna.user.id);

    const panel = await enterWindow(anna);
    const rest = await panel.get('/api/v1/users/assignable');
    expect(rest.status).toBe(403);
    expect(rest.body).toMatchObject({ code: 'mfa_enrollment_required' });

    const { options } = await passkeyOptions(panel);
    const fresh = new VirtualAuthenticator();
    const registered = await registerPasskey(panel, options, fresh);
    expect(registered.status).toBe(201);

    const session = await panel.get(PATHS.session);
    expect(session.body).toMatchObject({ state: 'active' });
    const [window] = await windows(anna.user.id);
    expect(window?.used_at).not.toBeNull();
    expect(await userRow(current, anna.user.id)).toMatchObject({ status: 'active', version, activated_at: activated });
    expect((await auditOf(current, 'account.activated')).length).toBe(1); // the first activation only
    expect((await auditOf(current, 'passkey.registered')).length).toBe(2);
    expect((await outboxRows(current, { recipient: anna.user.id, kind: 'mfa_changed' })).map((row) => row.variant)).toEqual([
      'second_step_reset',
      'passkey_enrolled',
    ]);
    current.clock.advance(61_000);
    expect((await signIn(current.panel(), { ...anna, authenticator: fresh })).status).toBe(200);
  });

  it('EVM-027 D1 an Editor may set up a code of the app in the window: the setup and the confirmation end it, the e-mail says so', async () => {
    const admin = await browserOf(current);
    const anna = await totpAccount(current, { role: 'editor' });
    await resetSecondStep(current, admin, anna.user.id);
    const panel = await enterWindow(anna);

    const setup = await panel.post(SECOND_STEP.setup);
    expect(setup.status).toBe(200);
    const confirmed = await confirmTotp(panel, codeNow(current, (setup.body as { secret: string }).secret));
    expect(confirmed.status).toBe(200);

    expect((await windows(anna.user.id))[0]?.used_at).not.toBeNull();
    expect((await outboxRows(current, { recipient: anna.user.id, kind: 'mfa_changed' })).map((row) => row.variant)).toContain(
      'totp_enrolled',
    );
    expect((await panel.get(PATHS.session)).body).toMatchObject({ state: 'active' });
  });

  it('EVM-027 R12 in the window of an Administrator only a passkey may be registered: the code of the app is 403 forbidden, the key is accepted', async () => {
    const admin = await browserOf(current);
    const boss = await enrolledAccount(current, { role: 'administrator' });
    expect((await resetSecondStep(current, admin, boss.user.id)).status).toBe(200);
    const panel = await enterWindow(boss);

    const totp = await panel.post(SECOND_STEP.setup);
    expect(totp.status).toBe(403);
    expect(totp.body).toMatchObject({ code: 'forbidden' });
    const { options } = await passkeyOptions(panel);
    expect((await registerPasskey(panel, options)).status).toBe(201);
  });

  it('EVM-027 D2 R4 the window ends with its deadline: before it the sign-in gives the session, after it 403 mfa_setup_expired and no session — and a session started inside the window ends with it (401 session_revoked)', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    expect((await resetSecondStep(current, admin, anna.user.id)).status).toBe(200);

    current.clock.advance(23 * HOUR + 30 * 60_000);
    const inside = await enterWindow(anna);
    expect((await inside.get(PATHS.session)).status).toBe(200);

    current.clock.advance(31 * 60_000); // 24:01 after the reset
    expect(await sessionAnswer(inside)).toEqual(REVOKED);
    const { response: refused } = await passkeyOptions(inside);
    expect(refused.status).toBe(401);
    current.clock.advance(61_000);
    const late = await firstStep(current.panel(), anna.email, anna.password);
    expect(late.status).toBe(403);
    expect(late.body).toMatchObject({ code: 'mfa_setup_expired', status: 403 });
    expect(late.headers['set-cookie']).toBeUndefined();
    expect(await auditOf(current, 'login.failed')).toContainEqual(
      expect.objectContaining({ object_id: anna.user.id, outcome: 'failed', reason_code: 'mfa_setup_expired' }),
    );
  });

  it('EVM-027 D2 an active account that never had a second step gets 403 mfa_setup_expired for the right password — and only for it: a wrong password, an unknown address, an invited and a deactivated account stay the same 401', async () => {
    const lost = await enrolledAccount(current, { role: 'editor' });
    await sql`delete from identity.passkeys where user_id = ${lost.user.id}`.execute(db());
    const off = await enrolledAccount(current, { role: 'editor' });
    await sql`delete from identity.passkeys where user_id = ${off.user.id}`.execute(db());
    await sql`update identity.users set status = 'deactivated' where id = ${off.user.id}`.execute(db());
    current.clock.advance(61_000);
    const sessionsBefore = await count('sessions', lost.user.id);

    const right = await firstStep(current.panel(), lost.email, lost.password);
    expect(right.status).toBe(403);
    expect(right.body).toMatchObject({ code: 'mfa_setup_expired' });
    expect(JSON.stringify(right.body)).not.toContain(lost.email);
    for (const [email, password] of [
      [lost.email, 'Wrong-pass-0000-x'],
      ['nobody@evia.invalid', lost.password],
      [off.email, off.password],
    ] as const) {
      const wrong = await firstStep(current.panel(), email, password);
      expect(wrong.status, email).toBe(401);
      expect(wrong.body).toMatchObject({ code: 'invalid_credentials' });
    }
    expect(await count('sessions', lost.user.id)).toBe(sessionsBefore); // the sign-in made no session
  });

  it('EVM-027 R5 a window is used once: of a passkey and a code of the app registered at the same moment from two sessions of one window exactly one wins, the other is 401 session_revoked', async () => {
    const admin = await browserOf(current);
    const anna = await totpAccount(current, { role: 'editor' });
    await resetSecondStep(current, admin, anna.user.id);
    const keyBrowser = await enterWindow(anna);
    const codeBrowser = await enterWindow(anna);
    const { options } = await passkeyOptions(keyBrowser);
    const setup = await codeBrowser.post(SECOND_STEP.setup);
    const code = codeNow(current, (setup.body as { secret: string }).secret);
    const authenticator = new VirtualAuthenticator();

    const [key, app] = await Promise.all([registerPasskey(keyBrowser, options, authenticator), confirmTotp(codeBrowser, code)]);

    expect([key.status, app.status].filter((status) => status === 201 || status === 200)).toHaveLength(1);
    expect([key, app].find((response) => response.status === 401)?.body).toMatchObject({ code: 'session_revoked' });
    const stored =
      (await count('passkeys', anna.user.id)) +
      Number(
        (
          await sql<{
            n: string;
          }>`select count(*)::text as n from identity.totp_factors where user_id = ${anna.user.id} and state = 'active'`.execute(db())
        ).rows[0]?.n,
      );
    expect(stored).toBe(1);
    expect((await windows(anna.user.id))[0]?.used_at).not.toBeNull();
  });

  it('EVM-027 D1 a second reset replaces the window: the session of the first ends at once and the new window works', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    await resetSecondStep(current, admin, anna.user.id);
    const first = await enterWindow(anna);
    expect((await sessionAnswer(first)).status).toBe(200);

    expect((await resetSecondStep(current, admin, anna.user.id)).status).toBe(200);

    expect(await sessionAnswer(first)).toEqual(REVOKED);
    const links = await windows(anna.user.id);
    expect(links.map((link) => link.superseded_at !== null)).toEqual([true, false]);
    const second = await enterWindow(anna);
    const { options } = await passkeyOptions(second);
    expect((await registerPasskey(second, options)).status).toBe(201);
  });

  it('EVM-027 R4 a deactivation closes the window: the session of the setup ends, and the reactivated account is told 403 mfa_setup_expired — a new reset opens a new window', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    await resetSecondStep(current, admin, anna.user.id);
    const panel = await enterWindow(anna);

    expect((await deactivate(current, admin, anna.user.id)).status).toBe(200);
    expect(await sessionAnswer(panel)).toEqual(REVOKED);
    expect((await reactivate(current, admin, anna.user.id)).status).toBe(200);
    current.clock.advance(61_000);
    expect((await firstStep(current.panel(), anna.email, anna.password)).status).toBe(403);

    expect((await resetSecondStep(current, admin, anna.user.id)).status).toBe(200);
    const reopened = await enterWindow(anna);
    expect((await reopened.get(PATHS.session)).status).toBe(200);
  });

  it('EVM-027 R4 a session of the setup that is bound to no window enrols nothing (401 session_revoked) — the password alone never adds a second step', async () => {
    const admin = await browserOf(current);
    const a = await enrolledAccount(current, { role: 'editor' });
    await resetSecondStep(current, admin, a.user.id);

    const bare = await createSession(db(), current.clock, a.user, { state: 'mfa_enrollment' });
    const loose = current.panel();
    loose.cookie = bare.cookie;
    loose.csrfToken = bare.csrfToken;
    const { options } = await passkeyOptions(loose);
    expect((await registerPasskey(loose, options)).status).toBe(401);
  });

  it('EVM-027 the second step is erased in the database for good: no public key and no sealed secret of the account remains — and no secret, code or key is in the audit trail, the outbox or the sign-in attempts', async () => {
    const admin = await browserOf(current);
    const anna = await totpAccount(current, { role: 'editor', withCodes: true });
    await createPasskey(db(), current.clock, anna.user);
    await resetSecondStep(current, admin, anna.user.id);
    const written = await everythingWritten(current);
    expect(written).not.toContain(anna.secret);
    for (const code of anna.codes) expect(written).not.toContain(code);
    expect((await sql`select 1 from identity.totp_factors where user_id = ${anna.user.id}`.execute(db())).rows).toEqual([]);
    expect((await sql`select 1 from identity.passkeys where user_id = ${anna.user.id}`.execute(db())).rows).toEqual([]);
  });
});

describe('the reset of the password does not open a way around the window (EVM-027 D4, K1, K6; EVM-025; CWE-640, CWE-308)', () => {
  it('EVM-027 D4 an account in the window gets NO link: the request is the answer for an unknown address and writes no message — the mailbox is not a factor', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    await resetSecondStep(current, admin, anna.user.id);
    current.clock.advance(61_000);

    const known = await requestReset(current.panel(), anna.email);
    const unknown = await requestReset(current.panel(), 'nobody@evia.invalid');

    expect(known.status).toBe(202);
    expect({ status: known.status, body: known.body as unknown }).toEqual({ status: unknown.status, body: unknown.body as unknown });
    expect(await outboxRows(current, { recipient: anna.user.id, kind: 'password_reset' })).toEqual([]);
  });

  it('EVM-027 K6 a reset link issued before the reset of the second step is dead after it: the check and the setting of the password are the answer for an invalid link', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    const delivered = await deliverReset(current, anna);
    expect((await current.panel().post(RESET.check, { token: delivered.token })).status).toBe(200);

    await resetSecondStep(current, admin, anna.user.id);

    const check = await current.panel().post(RESET.check, { token: delivered.token });
    expect(check.status).toBe(400);
    expect(check.body).toMatchObject({ code: 'password_reset_link_invalid' });
    const complete = await current.panel().post(RESET.complete, { token: delivered.token, password: 'meadow lantern copper river seven' });
    expect(complete.status).toBe(400);
  });
});
