import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { PATHS } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { emailHarness } from '../support/invitation-fixtures.ts';
import { enrolledAccount, firstStep, LOGIN } from '../support/login-flows.ts';
import { NEW_PASSWORD, processPending, requestReset, RESET } from '../support/password-reset-fixtures.ts';
import {
  codeNow,
  everythingWritten,
  insertTotpFactor,
  nextStep,
  SECOND_STEP,
  sendLoginRecoveryCode,
  sendLoginTotp,
  signInWithTotp,
  startLogin,
  totpAccount,
} from '../support/totp-flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const failures = async () =>
  (
    await sql<{ reason_code: string; actor_user_id: string | null }>`
      select reason_code, actor_user_id from audit.events where action = 'login.failed' order by occurred_at, id`.execute(
      current.database.admin,
    )
  ).rows;
const sessionsOf = (userId: string) =>
  db().selectFrom('identity.sessions').selectAll().where('user_id', '=', userId).orderBy('created_at').execute();
const wrongCode = (secret: string): string => (codeNow(current, secret) === '000000' ? '000001' : '000000');

describe('sign-in with a code of the app (EVM-023 AC2; SR-AUTH-07, SR-AUTH-06)', () => {
  it('EVM-023 AC2 the first step of an account with an active code offers the code; the second step with the current code is a session that opens the window of step-up', async () => {
    const account = await totpAccount(current);
    const panel = current.panel();
    const first = await firstStep(panel, account.email, account.password);
    expect(first.body).toMatchObject({ state: 'second_step', methods: ['totp'] });
    const { loginToken } = first.body as { loginToken: string };
    const response = await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ state: 'active' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeDefined();

    const sessions = (await sessionsOf(account.user.id)).filter((session) => session.revoked_at === null);
    expect(sessions).toHaveLength(2); // the one of the enrolment (still live: nobody ended it) and this one
    const signedIn = sessions.at(-1);
    expect(signedIn?.state).toBe('active');
    expect(signedIn?.totp_authenticated_at).not.toBeNull();
    expect(signedIn?.passkey_authenticated_at).toBeNull();
  });

  it('EVM-023 AC2 the same code used a second time is refused, a code of the next step is accepted', async () => {
    const account = await totpAccount(current);
    const first = await signInWithTotp(current, account);
    expect(first.response.status).toBe(200);
    const again = current.panel();
    const loginToken = await startLogin(again, account);
    const replay = await sendLoginTotp(again, loginToken, codeNow(current, account.secret));
    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({ code: 'totp_failed' });
    nextStep(current);
    const later = current.panel();
    const token = await startLogin(later, account);
    expect((await sendLoginTotp(later, token, codeNow(current, account.secret))).status).toBe(200);
  });

  it('EVM-023 AC2 C1 one step of tolerance either way is accepted, two steps are not', async () => {
    for (const steps of [1, -1]) {
      const account = await totpAccount(current);
      expect((await signInWithTotp(current, account, steps)).response.status, `${steps}`).toBe(200);
    }
    for (const steps of [2, -2]) {
      const account = await totpAccount(current);
      const { response } = await signInWithTotp(current, account, steps);
      expect(response.status, `${steps}`).toBe(401);
      expect(response.body).toMatchObject({ code: 'totp_failed' });
    }
  });

  it('EVM-023 AC2 C1 a code of the right shape but of another account is refused (the account is the one of the loginToken)', async () => {
    const owner = await totpAccount(current);
    const other = await totpAccount(current);
    const panel = current.panel();
    const loginToken = await startLogin(panel, owner);
    const response = await sendLoginTotp(panel, loginToken, codeNow(current, other.secret));
    expect(response.status).toBe(401);
    expect((await sessionsOf(other.user.id)).filter((session) => session.revoked_at === null)).toHaveLength(1); // only its own, from the confirmation
  });

  it('EVM-023 AC2 C1 two parallel requests with the same code give exactly one session (the step is spent by an atomic UPDATE)', async () => {
    const account = await totpAccount(current);
    const [one, two] = [current.panel(), current.panel()];
    const [tokenOne, tokenTwo] = [await startLogin(one, account), await startLogin(two, account)];
    const code = codeNow(current, account.secret);
    const before = (await sessionsOf(account.user.id)).length;
    const results = await Promise.all([sendLoginTotp(one, tokenOne, code), sendLoginTotp(two, tokenTwo, code)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    expect((await sessionsOf(account.user.id)).length).toBe(before + 1);
  });

  it('EVM-023 AC2 the same loginToken sent twice in parallel gives one session and the attempt is spent', async () => {
    const account = await totpAccount(current);
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    const code = codeNow(current, account.secret);
    const before = (await sessionsOf(account.user.id)).length;
    const results = await Promise.all([sendLoginTotp(panel, loginToken, code), sendLoginTotp(panel, loginToken, code)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    expect((await sessionsOf(account.user.id)).length).toBe(before + 1);
    nextStep(current);
    const spent = await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    expect(spent.status).toBe(401);
    expect(spent.body).toMatchObject({ code: 'unauthenticated' });
  });

  it('EVM-023 AC2 the cookie of an earlier session of the browser is replaced (rotation), exactly like after a key', async () => {
    const account = await totpAccount(current);
    const panel = account.panel; // still holds the session of the enrolment
    const enrolment = panel.cookie;
    const loginToken = await startLogin(panel, account);
    const response = await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    expect(response.status).toBe(200);
    panel.adopt(response.headers['set-cookie']);
    expect(panel.cookie).not.toBe(enrolment);
    const rows = await sessionsOf(account.user.id);
    expect(rows.filter((row) => row.revoke_reason === 'rotated')).toHaveLength(2); // the enrolment session and the session of the first confirmation
  });
});

describe('failed codes and the loginToken (EVM-023 AC2, AC8; SR-AUTH-05; B3)', () => {
  it('EVM-023 AC2 B3 a wrong code is 401 totp_failed, does not spend the loginToken, and every failure is audited with the account', async () => {
    const account = await totpAccount(current);
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    const response = await sendLoginTotp(panel, loginToken, wrongCode(account.secret));
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'totp_failed' });
    expect(await failures()).toEqual([{ reason_code: 'totp_failed', actor_user_id: account.user.id }]);
    expect((await sendLoginTotp(panel, loginToken, codeNow(current, account.secret))).status).toBe(200); // the person may retry
  });

  it('EVM-023 AC2 B3 the fifth wrong code ends the attempt: even the right code then finds no first step (the password has to be entered again)', async () => {
    const account = await totpAccount(current);
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await sendLoginTotp(panel, loginToken, wrongCode(account.secret));
      expect(response.status, `${attempt}`).toBe(401);
      expect(response.body, `${attempt}`).toMatchObject({ code: 'totp_failed' });
    }
    const right = await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    expect(right.status).toBe(401);
    expect(right.body).toMatchObject({ code: 'unauthenticated' });
    expect((await failures()).filter((row) => row.reason_code === 'totp_failed')).toHaveLength(5);
    // a new first step is a new attempt
    expect((await sendLoginTotp(panel, await startLogin(panel, account), codeNow(current, account.secret))).status).toBe(200);
  });

  it('EVM-023 AC5 B3 the budget of failures is ONE for all methods: wrong codes of the app and wrong recovery codes add up to five', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    for (let attempt = 0; attempt < 3; attempt += 1) await sendLoginTotp(panel, loginToken, wrongCode(account.secret));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await sendLoginRecoveryCode(panel, loginToken, 'ABCDEFGHIJKLMNOPQRST');
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'recovery_code_failed' });
    }
    const right = await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    expect(right.body).toMatchObject({ code: 'unauthenticated' });
    expect((await failures()).map((row) => row.reason_code)).toEqual([
      'totp_failed',
      'totp_failed',
      'totp_failed',
      'recovery_code_failed',
      'recovery_code_failed',
    ]);
  });

  it('EVM-023 AC2 AC8 an unknown, a spent and an expired loginToken are refused without telling why (unknown and spent: the same 401; expired: the audited login_expired)', async () => {
    const account = await totpAccount(current);
    const panel = current.panel();
    const code = codeNow(current, account.secret);
    const unknown = await sendLoginTotp(panel, randomBytes(32).toString('base64url'), code);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toMatchObject({ code: 'unauthenticated' });

    const spentToken = await startLogin(panel, account);
    expect((await sendLoginTotp(panel, spentToken, code)).status).toBe(200);
    nextStep(current);
    const spent = await sendLoginTotp(current.panel(), spentToken, codeNow(current, account.secret));
    expect(spent.status).toBe(401);
    const withoutTrace = (body: unknown) => ({ ...(body as object), traceId: undefined });
    expect(withoutTrace(spent.body)).toEqual(withoutTrace(unknown.body)); // one answer for both

    nextStep(current);
    const expiredToken = await startLogin(panel, account);
    current.clock.advance(5 * 60_000 + 1);
    const expired = await sendLoginTotp(panel, expiredToken, codeNow(current, account.secret));
    expect(expired.status).toBe(401);
    expect(expired.body).toMatchObject({ code: 'login_expired' });
    expect((await failures()).some((row) => row.reason_code === 'login_expired')).toBe(true);
  });

  it('EVM-023 AC2 the body is strict: no account can be named, the code is six digits, the token has its shape', async () => {
    const account = await totpAccount(current);
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    const code = codeNow(current, account.secret);
    const bodies: unknown[] = [
      { loginToken, code, userId: account.user.id },
      { loginToken, code: '12345' },
      { loginToken, code: '12345a' },
      { loginToken, code: 123_456 },
      { code },
      { loginToken: 'short', code },
    ];
    for (const body of bodies) {
      const response = await panel.post(SECOND_STEP.loginTotp, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    // none of the refused requests cost the person a failure
    expect(await failures()).toEqual([]);
    expect((await sendLoginTotp(panel, loginToken, code)).status).toBe(200);
  });

  it('EVM-023 AC2 the answer of a deactivated account is the same 401 as no first step: no session', async () => {
    const account = await totpAccount(current);
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    await sql`update identity.users set status = 'deactivated', deactivated_at = ${current.clock.now()} where id = ${account.user.id}`.execute(
      current.database.admin,
    );
    const before = (await sessionsOf(account.user.id)).length;
    const response = await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
    expect((await sessionsOf(account.user.id)).length).toBe(before);
  });
});

describe('the methods of the account and the Administrator in the panel (EVM-023 AC3; P1; B2, C3)', () => {
  it('EVM-023 AC3 an Administrator with a passkey AND a saved code of the app is offered the key only; the code is refused by the API (403) and counted', async () => {
    const account = await enrolledAccount(current, { role: 'administrator' });
    const { secret } = await insertTotpFactor(current, account.user.id);
    const panel = current.panel();
    const first = await firstStep(panel, account.email, account.password);
    expect(first.body).toMatchObject({ state: 'second_step', methods: ['passkey'] });
    const { loginToken } = first.body as { loginToken: string };
    const response = await sendLoginTotp(panel, loginToken, codeNow(current, secret));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'forbidden' });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await sessionsOf(account.user.id)).filter((session) => session.revoked_at === null).length).toBe(1);
    expect((await failures()).map((row) => row.reason_code)).toEqual(['totp_failed']);
    // the sixth refused try ends the attempt as well
    for (let attempt = 0; attempt < 4; attempt += 1) await sendLoginTotp(panel, loginToken, codeNow(current, secret));
    expect((await sendLoginTotp(panel, loginToken, codeNow(current, secret))).body).toMatchObject({ code: 'unauthenticated' });
  });

  it('EVM-023 AC3 B2 an Administrator whose only factor is a code of the app has no method in the panel: no loginToken, only the session that cannot enrol', async () => {
    const account = await enrolledAccount(current, { role: 'administrator' });
    await insertTotpFactor(current, account.user.id);
    await sql`delete from identity.passkeys where user_id = ${account.user.id}`.execute(current.database.admin);
    const first = await firstStep(current.panel(), account.email, account.password);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ state: 'mfa_enrollment' });
    expect((first.body as { loginToken?: string }).loginToken).toBeUndefined();
  });

  it('EVM-023 AC2 B2 an Editor whose only factor is a code of the app is offered the code, and a pending factor is no method at all (the account still has to enrol)', async () => {
    const account = await enrolledAccount(current, { role: 'editor' });
    await sql`delete from identity.passkeys where user_id = ${account.user.id}`.execute(current.database.admin);
    await insertTotpFactor(current, account.user.id, { state: 'pending' });
    const pending = await firstStep(current.panel(), account.email, account.password);
    expect(pending.body).toMatchObject({ state: 'mfa_enrollment' });
    await sql`update identity.totp_factors set state = 'active', confirmed_at = ${current.clock.now()} where user_id = ${account.user.id}`.execute(
      current.database.admin,
    );
    current.clock.advance(61_000);
    const active = await firstStep(current.panel(), account.email, account.password);
    expect(active.body).toMatchObject({ state: 'second_step', methods: ['totp'] });
  });

  it('EVM-023 AC3 C3 the role is read from the database when the code arrives, not remembered: an Editor promoted after the first step gets 403', async () => {
    const account = await totpAccount(current);
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    await sql`update identity.users set role = 'administrator' where id = ${account.user.id}`.execute(current.database.admin);
    const response = await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'forbidden' });
  });

  it('EVM-023 AC8 a Read-only user signs in with a code of the app like the others', async () => {
    const account = await totpAccount(current, { role: 'read_only' });
    expect((await signInWithTotp(current, account)).response.status).toBe(200);
  });

  it('EVM-023 AC2 B2 the second step with a code works after a password reset too: the loginToken of the reset is a first step like any other', async () => {
    const account = await totpAccount(current, { email: 'ewa.reset@example.com' });
    expect((await requestReset(current.panel(), account.email)).status).toBe(202);
    const delivered = await processPending(current, account.user.id, emailHarness(current));
    const panel = current.panel();
    const completed = await panel.post(RESET.complete, { token: delivered.token, password: NEW_PASSWORD });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ state: 'second_step', methods: ['totp'] });
    const { loginToken } = completed.body as { loginToken: string };
    nextStep(current);
    const response = await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ state: 'active' });
  });
});

describe('limits and secrets (EVM-023 AC8; SR-API-02, SR-LOG-02; B6, C6)', () => {
  const post = (path: string, body: unknown) =>
    request(current.app.getHttpServer())
      .post(path)
      .set('Origin', PANEL_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));
  const token = randomBytes(32).toString('base64url');

  it('EVM-023 AC8 the 21st second step with a code of the app within a minute from one address is 429 with Retry-After', async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1)
      expect((await post(SECOND_STEP.loginTotp, { loginToken: token, code: '123456' })).status, `${attempt}`).toBe(401);
    const limited = await post(SECOND_STEP.loginTotp, { loginToken: token, code: '123456' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body).toMatchObject({ code: 'rate_limited' });
    current.clock.advance(61_000);
    expect((await post(SECOND_STEP.loginTotp, { loginToken: token, code: '123456' })).status).toBe(401);
  });

  it('EVM-023 AC8 B6 the budget is shared with the password and the recovery code: no second bucket doubles it', async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) await post(LOGIN.login, { email: 'nikt@example.com', password: 'zle haslo' });
    for (let attempt = 1; attempt <= 10; attempt += 1) await post(SECOND_STEP.loginTotp, { loginToken: token, code: '123456' });
    const recovery = await post(SECOND_STEP.loginRecoveryCode, { loginToken: token, code: 'ABCDEFGHIJKLMNOPQRST' });
    expect(recovery.status).toBe(429);
    expect(recovery.headers['retry-after']).toBeDefined();
  });

  it('EVM-023 AC8 B6 the 21st recovery code within a minute is 429 as well', async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1)
      expect((await post(SECOND_STEP.loginRecoveryCode, { loginToken: token, code: 'ABCDEFGHIJKLMNOPQRST' })).status, `${attempt}`).toBe(
        401,
      );
    expect((await post(SECOND_STEP.loginRecoveryCode, { loginToken: token, code: 'ABCDEFGHIJKLMNOPQRST' })).status).toBe(429);
  });

  it('EVM-023 AC8 B6 the setup, the confirmation and the step-up with a code count in the same bucket: the 21st request within a minute is 429, from the first state of the answer', async () => {
    const account = await totpAccount(current);
    nextStep(current);
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await account.panel.post(SECOND_STEP.stepUp, { method: 'totp', code: '12345' }); // refused by the schema: no failure counted on the session
      expect(response.status, `${attempt}`).toBe(400);
    }
    const limited = await account.panel.post(SECOND_STEP.stepUp, { method: 'totp', code: '12345' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    // the confirmation of the setup shares the bucket (a session in the enrolment is checked the same way)
    const confirmation = await account.panel.post(SECOND_STEP.confirm, { code: '12345' });
    expect(confirmation.status).toBe(429);
    current.clock.advance(61_000);
    expect((await account.panel.post(SECOND_STEP.stepUp, { method: 'totp', code: '12345' })).status).toBe(400);
  });

  it('EVM-023 AC1 SR-CRYPTO-02 a sealed secret that does not open is an error of the server (500, no detail), never a wrong code and never a session', async () => {
    const account = await totpAccount(current);
    await sql`update identity.totp_factors set secret_ciphertext = set_byte(secret_ciphertext, 40, get_byte(secret_ciphertext, 40) # 1) where user_id = ${account.user.id}`.execute(
      current.database.admin,
    );
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    const before = (await sessionsOf(account.user.id)).length;
    const response = await sendLoginTotp(panel, loginToken, codeNow(current, account.secret));
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(response.body)).not.toMatch(/field encryption|ciphertext|totp/i);
    expect((await sessionsOf(account.user.id)).length).toBe(before);
    // the same account in another account's envelope: a ciphertext copied between accounts does not open either
    const other = await totpAccount(current);
    await sql`
      update identity.totp_factors set secret_ciphertext = (select secret_ciphertext from identity.totp_factors where user_id = ${other.user.id})
      where user_id = ${account.user.id}`.execute(current.database.admin);
    nextStep(current);
    const again = current.panel();
    const second = await sendLoginTotp(again, await startLogin(again, account), codeNow(current, other.secret));
    expect(second.status).toBe(500);
  });

  it('EVM-023 AC1 AC2 C6 neither the key, nor a code, nor the loginToken reach the log, the audit trail or the outbox', async () => {
    const account = await totpAccount(current);
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    const wrong = wrongCode(account.secret);
    await sendLoginTotp(panel, loginToken, wrong);
    const right = codeNow(current, account.secret);
    await sendLoginTotp(panel, loginToken, right);
    const logs = current.logs.text;
    for (const secret of [account.secret, loginToken]) expect(logs).not.toContain(secret);
    for (const code of [wrong, right]) expect(logs).not.toContain(`"${code}"`);
    const written = await everythingWritten(current);
    for (const secret of [account.secret, loginToken, account.password]) expect(written).not.toContain(secret);
    for (const code of [wrong, right]) expect(written).not.toContain(`"${code}"`);
  });

  it('EVM-023 AC2 the session of a sign-in with a code is read through the usual operation (the cookie works, the CSRF token is the one of the answer)', async () => {
    const account = await totpAccount(current);
    const { panel, response } = await signInWithTotp(current, account);
    expect(panel.csrfToken).toBe((response.body as { csrfToken: string }).csrfToken);
    expect((await panel.get(PATHS.session)).body).toMatchObject({ state: 'active', user: { role: 'editor' } });
  });
});
