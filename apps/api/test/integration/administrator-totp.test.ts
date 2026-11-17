/**
 * The Administrator with a code of the app in the panel (EVM-134; ADR-0023 A + K1): the limits and the alerts stay as they are for the new path (K2, AC5),
 * K1 end to end over HTTP on operations of the administration (AC4), and the matrix of roles and channels without any loosening (AC5). Synthetic data only.
 */
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STEP_UP_MAX_FAILED_CODES } from '../../src/modules/identity/domain/constants.ts';
import { PATHS } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { browserOf, invite, inviteBody, outboxRows, USERS, type Browser } from '../support/invitation-fixtures.ts';
import { adopt, enrolledAccount, firstStep } from '../support/login-flows.ts';
import { newPhone, signInPhone } from '../support/mobile-flows.ts';
import type { PanelClient } from '../support/panel-client.ts';
import { signedInAdministrator, STEP_UP, stepUp } from '../support/step-up-flows.ts';
import { accountRow, alertCodes, wrongPasswords } from '../support/throttle-flows.ts';
import {
  addTotp,
  codeNow,
  nextStep,
  SECOND_STEP,
  sendLoginRecoveryCode,
  sendLoginTotp,
  signInWithTotp,
  startLogin,
  totpAccount,
  type TotpAccount,
} from '../support/totp-flows.ts';
import { accountWithSessions, changeRole, revokedSessions } from '../support/user-access-fixtures.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const MINUTE = 60_000;
const wrongCode = (secret: string): string => (codeNow(current, secret) === '000000' ? '000001' : '000000');
const sendStepUp = (panel: PanelClient, code: string): Promise<Response> =>
  Promise.resolve(panel.post(SECOND_STEP.stepUp, { method: 'totp', code }));
const codeOf = (response: Response): string | undefined => (response.body as { code?: string }).code;
/** The browser of the Administrator as the fixtures of the administration expect it (only the panel is used). */
const browser = (account: TotpAccount, panel: PanelClient): Browser => ({ panel, user: account.user, sessionId: '' });
const sessionsOf = async (userId: string) =>
  (
    await sql<{
      revoked_at: Date | null;
      passkey_authenticated_at: Date | null;
      totp_authenticated_at: Date | null;
    }>`select revoked_at, passkey_authenticated_at, totp_authenticated_at from identity.sessions where user_id = ${userId} order by created_at`.execute(
      current.database.admin,
    )
  ).rows;

/** An Administrator whose only method is a code of the app, signed in with it in a new browser; `code` is the code of that sign-in. */
async function administratorSignedInWithCode(options: { withCodes?: boolean } = {}) {
  const account = await totpAccount(current, { role: 'administrator', ...options });
  const code = codeNow(current, account.secret);
  const panel = current.panel();
  const signedIn = await sendLoginTotp(panel, await startLogin(panel, account), code);
  expect(signedIn.status).toBe(200);
  adopt(panel, signedIn);
  return { account, panel, code };
}

/** Three operations of the administration with `stepUp: true`, from two modules: the invitation and the role (identity), the audit log (audit). */
async function sensitiveOperations(account: TotpAccount, panel: PanelClient, round: number): Promise<number[]> {
  const editor = await accountWithSessions(current, { role: 'editor', count: 0 });
  const invited = await invite(browser(account, panel), inviteBody({ email: `zaproszona.${round}@example.com` }));
  const audit = await panel.get(STEP_UP.audit);
  const role = await changeRole(current, browser(account, panel), editor.user.id, 'read_only');
  return [invited.status, audit.status, role.status];
}

describe('K1 end to end on the operations of the administration (EVM-134 AC4; ADR-0023, SR-SESS-08, TM-90)', () => {
  it('EVM-134 AC4 K1 after a sign-in with a code the invitation, the audit log and the change of a role are 403 step_up_required; the code of the sign-in is refused; a NEW code opens the window for 15 minutes', async () => {
    const { account, panel, code } = await administratorSignedInWithCode();
    const editor = await accountWithSessions(current, { role: 'editor', count: 0 });

    const refused = [
      await invite(browser(account, panel), inviteBody({ email: 'pierwsza@example.com' })),
      await panel.get(STEP_UP.audit),
      await changeRole(current, browser(account, panel), editor.user.id, 'read_only'),
    ];
    for (const response of refused) {
      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('step_up_required');
    }

    const replayed = await sendStepUp(panel, code);
    expect(replayed.status).toBe(401);
    expect(codeOf(replayed)).toBe('totp_failed');
    expect((await panel.get(STEP_UP.audit)).status).toBe(403);

    nextStep(current);
    const fresh = await sendStepUp(panel, codeNow(current, account.secret));
    expect(fresh.status).toBe(200);
    adopt(panel, fresh);
    expect(await sensitiveOperations(account, panel, 1)).toEqual([201, 200, 200]);

    current.clock.advance(15 * MINUTE);
    const late = await invite(browser(account, panel), inviteBody({ email: 'pozniej@example.com' }));
    expect(late.status).toBe(403);
    expect(codeOf(late)).toBe('step_up_required');
  });

  it('EVM-134 AC4 K1 after a sign-in with a code a passkey of the account opens the window as well', async () => {
    const admin = await enrolledAccount(current, { role: 'administrator' });
    const secret = await addTotp(current, admin);
    nextStep(current);
    const panel = current.panel();
    const signedIn = await sendLoginTotp(panel, await startLogin(panel, admin), codeNow(current, secret));
    expect(signedIn.status).toBe(200);
    adopt(panel, signedIn);
    const account = { ...admin, secret } as unknown as TotpAccount;
    expect((await invite(browser(account, panel), inviteBody({ email: 'przed@example.com' }))).status).toBe(403);
    expect((await stepUp(panel, admin.authenticator)).status).toBe(200);
    expect(await sensitiveOperations(account, panel, 2)).toEqual([201, 200, 200]);
  });

  it('EVM-134 AC4 unchanged: a sign-in with a passkey opens the window at once', async () => {
    const admin = await signedInAdministrator(current);
    const account = admin as unknown as TotpAccount;
    expect(await sensitiveOperations(account, admin.panel, 3)).toEqual([201, 200, 200]);
  });

  it('EVM-134 AC4 major 5 unchanged: a sign-in of an Administrator with a recovery code opens no window, and a recovery code is no step-up', async () => {
    const account = await totpAccount(current, { role: 'administrator', withCodes: true });
    const panel = current.panel();
    const signedIn = await sendLoginRecoveryCode(panel, await startLogin(panel, account), account.codes[0] ?? '');
    expect(signedIn.status).toBe(200);
    adopt(panel, signedIn);
    expect((await sessionsOf(account.user.id)).at(-1)).toMatchObject({ passkey_authenticated_at: null, totp_authenticated_at: null });
    const refused = await invite(browser(account, panel), inviteBody({ email: 'odzyskane@example.com' }));
    expect(refused.status).toBe(403);
    expect(codeOf(refused)).toBe('step_up_required');
    const recovery = await panel.post(SECOND_STEP.stepUp, { method: 'recovery_code', code: account.codes[1] ?? '' });
    expect(recovery.status).toBe(400);
    expect(codeOf(recovery)).toBe('validation_failed');
  });

  it('EVM-134 AC4 K1 an Editor promoted to Administrator loses the sessions that had a window (role_changed); the next sign-in with a code has none', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const account = await totpAccount(current, { role: 'editor' });
    const before = await signInWithTotp(current, account);
    expect((await sessionsOf(account.user.id)).at(-1)?.totp_authenticated_at).not.toBeNull();
    expect((await changeRole(current, admin, account.user.id, 'administrator')).status).toBe(200);
    expect((await before.panel.get(PATHS.session)).status).toBe(401);
    expect((await revokedSessions(current, account.user.id)).map((row) => row.revoke_reason)).toContain('role_changed');
    nextStep(current);
    const { panel } = await signInWithTotp(current, account);
    expect((await sessionsOf(account.user.id)).at(-1)).toMatchObject({ revoked_at: null, totp_authenticated_at: null });
    expect(codeOf(await panel.get(STEP_UP.audit))).toBe('step_up_required');
  });
});

describe('K2: the limits and the alerts of the code path hold for the Administrator (EVM-134 AC5; SR-AUTH-05, SR-AUTH-07, SR-AUTH-15, SR-LOG-07)', () => {
  it('EVM-134 AC5 K2 five wrong codes end the loginToken of an Administrator: the sixth try, with the right code, is 401 unauthenticated and makes no session', async () => {
    const account = await totpAccount(current, { role: 'administrator' });
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const wrong = await sendLoginTotp(panel, loginToken, wrongCode(account.secret));
      expect(wrong.status, `wrong code ${attempt}`).toBe(401);
      expect(codeOf(wrong)).toBe('totp_failed');
    }
    const sessions = (await sessionsOf(account.user.id)).length;
    const right = await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    expect(right.status).toBe(401);
    expect(codeOf(right)).toBe('unauthenticated');
    expect((await sessionsOf(account.user.id)).length).toBe(sessions);
  });

  it('EVM-134 AC5 K2 five wrong passwords and five wrong codes lock an Administrator for 15 minutes with the e-mail; the right code during the lock is 429 and makes no session', async () => {
    const account = await totpAccount(current, { role: 'administrator' });
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    await wrongPasswords(current, account.email, 5);
    for (let attempt = 0; attempt < 5; attempt += 1) await sendLoginTotp(panel, loginToken, wrongCode(account.secret));
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 10, second_step_failures: 5, lock_cause: 'second_step' });
    expect((await outboxRows(current, { recipient: account.user.id, kind: 'account_locked' })).map((row) => row.variant)).toEqual([
      'second_step',
    ]);

    const sessions = (await sessionsOf(account.user.id)).length;
    const locked = await firstStep(current.panel(), account.email, account.password);
    expect(locked.status).toBe(429);
    expect(codeOf(locked)).toBe('rate_limited');
    expect((await sessionsOf(account.user.id)).length).toBe(sessions);
    current.clock.advance(15 * MINUTE + 1000);
    expect((await signInWithTotp(current, account)).response.status).toBe(200);
  });

  it("EVM-134 AC5 K2 three failures of an Administrator's second step raise one second_step_failure_spike alert", async () => {
    const account = await totpAccount(current, { role: 'administrator' });
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    for (let attempt = 0; attempt < 2; attempt += 1) await sendLoginTotp(panel, loginToken, wrongCode(account.secret));
    expect(await alertCodes(current)).toEqual([]);
    await sendLoginTotp(panel, loginToken, wrongCode(account.secret));
    expect(await alertCodes(current)).toEqual(['second_step_failure_spike']);
  });

  it('EVM-134 AC5 K2 an Administrator signing in with a code from a new browser: e-mail new_browser to the owner and the alert to every active Administrator', async () => {
    const other = await browserOf(current, { role: 'administrator' });
    const account = await totpAccount(current, { role: 'administrator' });
    const before = (await outboxRows(current, { kind: 'administrator_alert' })).filter(
      (row) => row.variant === 'administrator_new_browser',
    );
    const mailsBefore = (await outboxRows(current, { recipient: account.user.id, kind: 'new_browser' })).length;
    expect((await signInWithTotp(current, account)).response.status).toBe(200);
    expect(await outboxRows(current, { recipient: account.user.id, kind: 'new_browser' })).toHaveLength(mailsBefore + 1);
    const alerts = (await outboxRows(current, { kind: 'administrator_alert' }))
      .filter((row) => row.variant === 'administrator_new_browser')
      .slice(before.length);
    expect(alerts.map((row) => row.recipient_user_id).sort()).toEqual([account.user.id, other.user.id].sort());
  });

  it('EVM-134 AC5 K2 five wrong step-up codes of an Administrator end the session: 401 session_revoked, revoke_reason step_up_failed', async () => {
    const { account, panel } = await administratorSignedInWithCode();
    nextStep(current);
    const answers: Array<string | undefined> = [];
    for (let attempt = 0; attempt < STEP_UP_MAX_FAILED_CODES; attempt += 1)
      answers.push(codeOf(await sendStepUp(panel, wrongCode(account.secret))));
    expect(answers).toEqual([...Array.from({ length: STEP_UP_MAX_FAILED_CODES - 1 }, () => 'totp_failed'), 'session_revoked']);
    expect((await panel.get(PATHS.session)).status).toBe(401);
    expect((await revokedSessions(current, account.user.id)).map((row) => row.revoke_reason)).toContain('step_up_failed');
  });
});

describe('the matrix of roles and channels of the code path, without any loosening (EVM-134 AC5; SR-AUTHZ-05, SR-AUTHZ-06, SR-AUTHZ-12)', () => {
  it("EVM-134 AC5 in the panel every role signs in with a code; only the Administrator's session has no window (K1); an anonymous caller gets 401 everywhere", async () => {
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const account = await totpAccount(current, { role });
      const { response } = await signInWithTotp(current, account);
      expect(response.status, role).toBe(200);
      const window = (await sessionsOf(account.user.id)).at(-1)?.totp_authenticated_at ?? null;
      expect(window === null, role).toBe(role === 'administrator');
      nextStep(current);
    }
    const anonymous = current.panel();
    for (const [path, body] of [
      [SECOND_STEP.stepUp, { method: 'totp', code: '123456' }],
      [SECOND_STEP.setup, {}],
      [SECOND_STEP.confirm, { code: '123456' }],
    ] as const)
      expect((await anonymous.post(path, body)).status, path).toBe(401);
    expect((await anonymous.post(SECOND_STEP.loginTotp, { loginToken: 'C'.repeat(43), code: '123456' })).status).toBe(401);
  });

  it('EVM-134 AC5 SR-AUTHZ-12 the phone: the Administrator and the Editor sign in with the code; the sign-in of Tylko odczyt is 403 channel_not_allowed (the rule role × channel); the token of the Administrator on an operation of the panel or of its second step is 401 unauthenticated (a web operation does not read the Bearer token)', async () => {
    const phones: Record<string, ReturnType<typeof newPhone>> = {};
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const account = await totpAccount(current, { role });
      const phone = newPhone(current);
      const { second } = await signInPhone(current, phone, account);
      if (role === 'read_only') {
        expect(second.status, role).toBe(403);
        expect(codeOf(second)).toBe('channel_not_allowed');
      } else expect(second.status, role).toBe(200);
      phones[role] = phone;
    }
    const phone = phones['administrator'];
    if (phone === undefined) throw new Error('no phone');
    // a web operation never reads the Bearer token (SR-AUTHZ-12): the token of the phone is no credential of the panel at all
    const calls: Array<[string, () => PromiseLike<Response>]> = [
      ['listUsers', () => phone.get(USERS, phone.authorised())],
      [
        'inviteUser',
        () =>
          phone.post(
            USERS,
            inviteBody({ email: 'z.telefonu@example.com' }),
            phone.authorised({ 'Idempotency-Key': '0190a1b2-0000-7000-8000-0000000000aa' }),
          ),
      ],
      ['listAuditEvents', () => phone.get(STEP_UP.audit, phone.authorised())],
      ['stepUp', () => phone.post(SECOND_STEP.stepUp, { method: 'totp', code: '123456' }, phone.authorised())],
      ['startTotpEnrolment', () => phone.post(SECOND_STEP.setup, undefined, phone.authorised())],
    ];
    const answers: Record<string, string> = {};
    for (const [id, call] of calls) {
      const response = await call();
      answers[id] = `${response.status} ${codeOf(response) ?? ''}`;
    }
    expect(answers).toEqual(Object.fromEntries(calls.map(([id]) => [id, '401 unauthenticated'])));
  });
});
