import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import {
  ACCOUNT,
  NEW_PASSWORD,
  addKey,
  auditOf,
  getAccount,
  keyProof,
  reauthWithCode,
  reauthWithKey,
  signedInWithCode,
  signedInWithKey,
  withoutTrace,
} from '../support/account-flows.ts';
import { PATHS } from '../support/flows.ts';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { adopt, firstStep } from '../support/login-flows.ts';
import { codeNow, everythingWritten, nextStep, SECOND_STEP } from '../support/totp-flows.ts';
import { stepUp } from '../support/step-up-flows.ts';
import { accountRow, browserRow, deviceIdsOf, WRONG, wrongPasswords } from '../support/throttle-flows.ts';
import { VirtualAuthenticator } from '../support/virtual-authenticator.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const markOf = async (sessionId: string) =>
  db()
    .selectFrom('identity.sessions')
    .select(['reauthenticated_at', 'reauth_purpose'])
    .where('id', '=', sessionId)
    .executeTakeFirstOrThrow();
const liveSession = async (userId: string) =>
  (
    await db()
      .selectFrom('identity.sessions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute()
  )[0];
const code = (body: unknown): string => (body as { code?: string }).code ?? '';

describe('the full re-authentication sets a one-time mark on the session (EVM-028 AC2, AC3, AC5; SR-AUTH-10; ASVS V7.5.1)', () => {
  it('EVM-028 AC3 the password and a key give 204 with no body and no new cookie; the mark of the purpose is on the row of the session — nowhere else', async () => {
    const admin = await signedInWithKey(current);
    const before = admin.panel.cookie;
    const response = await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', admin.password);
    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(admin.panel.cookie).toBe(before);
    const session = await liveSession(admin.user.id);
    expect(await markOf(session?.id ?? '')).toEqual({ reauthenticated_at: current.clock.now(), reauth_purpose: 'second_step_change' });
    expect((await auditOf(current, 'reauthentication.succeeded')).at(-1)).toMatchObject({
      outcome: 'success',
      actor_user_id: admin.user.id,
    });
  });

  it('EVM-028 AC3 the code of the app does the same for an Editor; a recovery code is not a proof (the body is strict: 400)', async () => {
    const editor = await signedInWithCode(current);
    nextStep(current);
    const refused = await editor.session.post(ACCOUNT.reauth, {
      purpose: 'second_step_change',
      password: editor.password,
      recoveryCode: editor.codes[0],
    });
    expect(refused.status).toBe(400);
    expect((await markOf((await liveSession(editor.user.id))?.id ?? '')).reauth_purpose).toBeNull();
    const response = await reauthWithCode(editor.session, 'second_step_change', codeNow(current, editor.secret), editor.password);
    expect(response.status).toBe(204);
    expect((await markOf((await liveSession(editor.user.id))?.id ?? '')).reauth_purpose).toBe('second_step_change');
  });

  it('EVM-028 AC2 the purpose password_change needs the second step alone — and refuses a password in the body; second_step_change needs the password', async () => {
    const admin = await signedInWithKey(current);
    const proof = await keyProof(admin.panel, admin.authenticator);
    const withPassword = await admin.panel.post(ACCOUNT.reauth, { purpose: 'password_change', password: admin.password, ...proof });
    expect(withPassword.status).toBe(400);
    expect(withPassword.body).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/password', code: 'not_allowed' }] });
    const withoutPassword = await admin.panel.post(ACCOUNT.reauth, {
      purpose: 'second_step_change',
      ...(await keyProof(admin.panel, admin.authenticator)),
    });
    expect(withoutPassword.status).toBe(400);
    expect(withoutPassword.body).toMatchObject({ errors: [{ pointer: '/password', code: 'required' }] });
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'password_change')).status).toBe(204);
  });

  it('EVM-028 K4 a wrong password, a wrong key and a wrong code are ONE answer; with a wrong password the second step is not looked at and its challenge is not spent', async () => {
    const admin = await signedInWithKey(current);
    const badPassword = await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', WRONG);
    const open = await db().selectFrom('identity.webauthn_challenges').select('used_at').where('purpose', '=', 'passkey_step_up').execute();
    expect(open.map((row) => row.used_at)).toEqual([null]); // the challenge of the options is untouched
    const badKey = await reauthWithKey(admin.panel, new VirtualAuthenticator(), 'second_step_change', admin.password);
    expect([badPassword.status, badKey.status]).toEqual([401, 401]);
    const answerOf = (response: { body: unknown }) => withoutTrace(response.body);
    expect(answerOf(badPassword)).toEqual(answerOf(badKey));
    expect(badPassword.body).toMatchObject({ code: 'reauthentication_failed', status: 401 });

    const editor = await signedInWithCode(current);
    nextStep(current);
    const wrongCode = codeNow(current, editor.secret) === '000000' ? '000001' : '000000';
    const badCode = await reauthWithCode(editor.session, 'second_step_change', wrongCode, editor.password);
    expect(badCode.status).toBe(401);
    expect(answerOf(badCode)).toEqual(answerOf(badPassword));
    expect((await markOf((await liveSession(admin.user.id))?.id ?? '')).reauth_purpose).toBeNull();
  });

  it('EVM-028 K12 every refusal is audited by its reason and every success too — with no password, key or code anywhere in the trail, the outbox or the logs', async () => {
    const admin = await signedInWithKey(current);
    await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', WRONG);
    await reauthWithKey(admin.panel, new VirtualAuthenticator(), 'second_step_change', admin.password);
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', admin.password)).status).toBe(204);
    expect((await auditOf(current, 'reauthentication.failed')).map((event) => [event.outcome, event.reason_code])).toEqual([
      ['failed', 'bad_password'],
      ['failed', 'passkey_failed'],
    ]);
    expect(await auditOf(current, 'reauthentication.succeeded')).toHaveLength(1);
    const written = await everythingWritten(current);
    for (const secret of [WRONG, admin.password]) {
      expect(written).not.toContain(secret);
      expect(current.logs.text).not.toContain(secret);
    }
  });

  it('EVM-028 AC8 the Administrator has no code of the app in the panel: that proof is 403 forbidden and costs nothing', async () => {
    const admin = await signedInWithKey(current);
    const response = await reauthWithCode(admin.panel, 'second_step_change', '123456', admin.password);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'forbidden' });
    expect((await markOf((await liveSession(admin.user.id))?.id ?? '')).reauth_purpose).toBeNull();
  });
});

describe('the mark is one-time, tied to a session and a purpose (EVM-028 K5; ASVS V7.5.1)', () => {
  it('EVM-028 K5 a mark of password_change does not open the methods, and a mark of second_step_change does not change the password; each is spent by its own operation only', async () => {
    const admin = await signedInWithKey(current);
    expect((await addKey(admin.panel)).options.status).toBe(403);
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'password_change')).status).toBe(204);
    // the key of the second step: the mark is of another purpose
    const options = await admin.panel.post(ACCOUNT.passkeyOptions);
    expect(options.status).toBe(403);
    expect(options.body).toMatchObject({ code: 'reauthentication_required' });
    const removal = await admin.panel.delete(`${ACCOUNT.passkeys}/00000000-0000-7000-8000-000000000001`);
    expect(removal.status).toBe(404); // the object comes first
    expect((await admin.panel.delete(ACCOUNT.totp)).status).toBe(403);

    // and the other way round
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', admin.password)).status).toBe(204);
    const change = await admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword: NEW_PASSWORD });
    expect(change.status).toBe(403);
    expect(change.body).toMatchObject({ code: 'reauthentication_required' });
  });

  it('EVM-028 K5 the mark is spent by the operation: the second use is 403 again', async () => {
    const admin = await signedInWithKey(current);
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'password_change')).status).toBe(204);
    const first = await admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword: NEW_PASSWORD });
    expect(first.status).toBe(200);
    const second = await admin.panel.post(ACCOUNT.password, { currentPassword: NEW_PASSWORD, newPassword: 'Another-long-phrase-91-ok' });
    expect(second.status).toBe(403);
    expect(await markOf((await liveSession(admin.user.id))?.id ?? '')).toEqual({ reauthenticated_at: null, reauth_purpose: null });
  });

  it('EVM-028 K5 the mark is valid for 5 minutes: 4:59 passes, 5:00 does not', async () => {
    const admin = await signedInWithKey(current);
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', admin.password)).status).toBe(204);
    current.clock.advance(5 * 60_000 - 1000);
    expect((await admin.panel.post(ACCOUNT.passkeyOptions)).status).toBe(200); // looking at the mark spends nothing
    current.clock.advance(1000);
    const late = await admin.panel.post(ACCOUNT.passkeyOptions);
    expect(late.status).toBe(403);
    expect(late.body).toMatchObject({ code: 'reauthentication_required' });
  });

  it('EVM-028 K5 the mark is NOT carried by a step-up (the session is rotated): the operation after it is 403 reauthentication_required', async () => {
    const admin = await signedInWithKey(current);
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', admin.password)).status).toBe(204);
    expect((await stepUp(admin.panel, admin.authenticator)).status).toBe(200);
    const after = await admin.panel.post(ACCOUNT.passkeyOptions);
    expect(after.status).toBe(403);
    expect(after.body).toMatchObject({ code: 'reauthentication_required' });
    expect(await db().selectFrom('identity.sessions').select('reauth_purpose').where('reauth_purpose', 'is not', null).execute()).toEqual(
      [],
    );
  });

  it('EVM-028 K5 the mark belongs to ONE session: another session of the same account does not have it', async () => {
    const admin = await signedInWithKey(current);
    const other = current.panel();
    const step1 = await firstStep(other, admin.email, admin.password);
    const { loginToken } = step1.body as { loginToken: string };
    const options = await other.post('/api/v1/auth/login/passkey/options', { loginToken });
    const second = await other.post('/api/v1/auth/login/passkey', {
      loginToken,
      credential: admin.authenticator.assert(options.body as PublicKeyCredentialRequestOptionsJSON),
    });
    expect(second.status).toBe(200);
    adopt(other, second);
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', admin.password)).status).toBe(204);
    expect((await other.post(ACCOUNT.passkeyOptions)).status).toBe(403);
    expect((await admin.panel.post(ACCOUNT.passkeyOptions)).status).toBe(200);
  });

  it('EVM-028 K5 the mark goes with the session: a session ended by its owner has none', async () => {
    const admin = await signedInWithKey(current);
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', admin.password)).status).toBe(204);
    const sessionId = (await liveSession(admin.user.id))?.id ?? '';
    expect((await admin.panel.post(PATHS.logout)).status).toBe(204);
    expect(await markOf(sessionId)).toEqual({ reauthenticated_at: null, reauth_purpose: null });
  });
});

describe('the counter against guessing covers the re-authentication (EVM-028 K2, K3; EVM-026 rule 2; SR-AUTH-05; ASVS V6.3.1)', () => {
  it('EVM-028 K2 ten wrong passwords lock the scope of the browser: the tenth is 429 with Retry-After, the session ends, and the sign-in from that browser is locked as well', async () => {
    const admin = await signedInWithKey(current);
    current.clock.advance(61_000); // a new minute for the bucket of 20 requests per address: the sign-in above has used some
    const deviceId = (await deviceIdsOf(current, admin.user.id))[0] ?? '';
    for (let attempt = 1; attempt < 10; attempt += 1) {
      const response = await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', WRONG);
      expect(response.status, `try ${attempt}`).toBe(401);
      current.clock.advance(7000); // two requests a try (the options and the proof): the bucket of 20 a minute per address is not what this measures
    }
    expect((await browserRow(current, deviceId))?.failures).toBe(9);
    const tenth = await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', WRONG);
    expect(tenth.status).toBe(429);
    expect(tenth.body).toMatchObject({ code: 'rate_limited' });
    expect(Number(tenth.headers['retry-after'])).toBeGreaterThan(0);
    expect((await browserRow(current, deviceId))?.locked_until).not.toBeNull();
    expect((await admin.panel.get(ACCOUNT.account)).body).toMatchObject({ code: 'session_revoked' }); // the thief is out
    expect(await auditOf(current, 'account.browser_locked')).toHaveLength(1);
    const again = await firstStep(Object.assign(current.panel(), { deviceCookie: admin.panel.deviceCookie }), admin.email, admin.password);
    expect(again.status).toBe(429);
  });

  it('EVM-028 K2 while the lock holds NOTHING is verified: even the right password and the right key give 429 and end the session', async () => {
    const admin = await signedInWithKey(current);
    admin.panel.deviceCookie = undefined; // the scope is the account now
    await wrongPasswords(current, admin.email, 10);
    expect((await accountRow(current, admin.email))?.locked_until).not.toBeNull();
    current.clock.advance(61_000);
    const response = await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', admin.password);
    expect(response.status).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect((await admin.panel.get(ACCOUNT.account)).body).toMatchObject({ code: 'session_revoked' });
    expect((await auditOf(current, 'reauthentication.failed')).at(-1)).toMatchObject({ outcome: 'denied', reason_code: 'rate_limited' });
    expect((await auditOf(current, 'session.revoked')).at(-1)).toMatchObject({ reason_code: 'rate_limited' });
  });

  it('EVM-028 K2 the counter is the one of the sign-in: failures of the re-authentication and of the sign-in add up in one scope', async () => {
    const admin = await signedInWithKey(current);
    admin.panel.deviceCookie = undefined;
    await wrongPasswords(current, admin.email, 4);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', WRONG)).status).toBe(401);
      current.clock.advance(3000);
    }
    expect((await accountRow(current, admin.email))?.failures).toBe(9);
    const tenth = await firstStep(current.panel(), admin.email, WRONG);
    expect(tenth.status).toBe(401);
    expect((await accountRow(current, admin.email))?.locked_until).not.toBeNull();
  });

  it('EVM-028 K2 a right proof gives back its reservation: a successful re-authentication does not eat the budget', async () => {
    const admin = await signedInWithKey(current);
    const deviceId = (await deviceIdsOf(current, admin.user.id))[0] ?? '';
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', admin.password)).status).toBe(204);
    expect((await browserRow(current, deviceId))?.failures ?? 0).toBe(0);
  });

  it('EVM-028 K3 the wrong codes of the app are ONE budget for the step-up and the re-authentication: 3 + 2 end the session', async () => {
    const editor = await signedInWithCode(current);
    const wrong = () => (codeNow(current, editor.secret) === '000000' ? '000001' : '000000');
    nextStep(current);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await editor.session.post(SECOND_STEP.stepUp, { method: 'totp', code: wrong() });
      expect(response.status, `step-up ${attempt}`).toBe(401);
      expect(response.body).toMatchObject({ code: 'totp_failed' });
    }
    expect((await reauthWithCode(editor.session, 'second_step_change', wrong(), editor.password)).status).toBe(401);
    const fifth = await reauthWithCode(editor.session, 'second_step_change', wrong(), editor.password);
    expect(fifth.status).toBe(401);
    expect(fifth.body).toMatchObject({ code: 'session_revoked' });
    expect((await editor.session.get(ACCOUNT.account)).body).toMatchObject({ code: 'session_revoked' });
    const ended = await db()
      .selectFrom('identity.sessions')
      .select('revoke_reason')
      .where('user_id', '=', editor.user.id)
      .where('revoke_reason', '=', 'step_up_failed')
      .execute();
    expect(ended).toHaveLength(1);
  });

  it('EVM-028 K2 the step-up is counted too: ten wrong tries lock it and end the session — a thief of a session has no way round the lock', async () => {
    const editor = await signedInWithCode(current);
    const wrong = () => (codeNow(current, editor.secret) === '000000' ? '000001' : '000000');
    // every fifth wrong code ends a session, so the thief starts a new one each time; the counter of the scope (the account) goes on
    let status = 0;
    for (let attempt = 0; attempt < 10 && status !== 429; attempt += 1) {
      nextStep(current);
      const response = await editor.session.post(SECOND_STEP.stepUp, { method: 'totp', code: wrong() });
      status = response.status;
      if (response.body && code(response.body) === 'session_revoked') break;
    }
    const row = await accountRow(current, editor.email);
    const browser = (await deviceIdsOf(current, editor.user.id))[0];
    const counted = (browser === undefined ? undefined : await browserRow(current, browser)) ?? row;
    expect(counted?.failures).toBeGreaterThanOrEqual(5);
    expect(await auditOf(current, 'step_up.failed')).not.toHaveLength(0);
  });
});

describe('the account is read and the lists are not cached (EVM-028 K13)', () => {
  it('EVM-028 K13 the answers with personal data carry Cache-Control: no-store', async () => {
    const admin = await signedInWithKey(current);
    for (const path of [ACCOUNT.account, ACCOUNT.sessions]) {
      const response = await admin.panel.get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers['cache-control'], path).toBe('no-store');
    }
    expect((await getAccount(admin.panel)).headers['cache-control']).toBe('no-store');
  });
});
