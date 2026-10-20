import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/argon2-password-hasher.ts';
import { PASSWORD_HASHER, type PasswordHasher } from '../../src/modules/identity/infrastructure/ports.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { emailHarness, outboxRows } from '../support/invitation-fixtures.ts';
import { enrolledAccount, firstStep, signIn } from '../support/login-flows.ts';
import { NEW_PASSWORD, processPending, requestReset, RESET } from '../support/password-reset-fixtures.ts';
import { stepUp, signedInAdministrator } from '../support/step-up-flows.ts';
import {
  codeNow,
  everythingWritten,
  generateCodes,
  insertTotpFactor,
  nextStep,
  SECOND_STEP,
  sendLoginRecoveryCode,
  sendLoginTotp,
  signInWithTotp,
  startLogin,
  totpAccount,
} from '../support/totp-flows.ts';

/** The real hasher, counted: what is verified is the cost of a request (CWE-400). */
class CountingHasher implements PasswordHasher {
  readonly real = new Argon2PasswordHasher();
  verifications = 0;
  /** Runs while a verification is under way — the moment the world can change between the first look at the token and the decision. */
  during: (() => void) | undefined;
  hash(password: string): Promise<string> {
    return this.real.hash(password);
  }
  async verify(hash: string, password: string): Promise<boolean> {
    this.verifications += 1;
    const result = await this.real.verify(hash, password);
    this.during?.();
    return result;
  }
}

let current: IdentityApp;
let hasher: CountingHasher;
beforeEach(async () => {
  hasher = new CountingHasher();
  current = await createIdentityApp({ configure: (builder) => builder.overrideProvider(PASSWORD_HASHER).useValue(hasher) });
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const codeRows = (userId: string) =>
  db().selectFrom('identity.recovery_codes').selectAll().where('user_id', '=', userId).orderBy('created_at').orderBy('id').execute();
const audit = async (action: string) =>
  (
    await sql<{ outcome: string; actor_user_id: string | null; object_id: string | null }>`
      select outcome, actor_user_id, object_id from audit.events where action = ${action} order by occurred_at, id`.execute(
      current.database.admin,
    )
  ).rows;

describe('the recovery codes of the third step (EVM-023 AC4, AC6; SR-AUTH-08, SR-AUTH-10)', () => {
  it('EVM-023 AC4 ten different codes of 20 characters of base32 are shown once, never cached, and the database holds only Argon2id hashes', async () => {
    const account = await totpAccount(current);
    const { response, codes } = await generateCodes(account.panel);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{20}$/);

    const rows = await codeRows(account.user.id);
    expect(rows).toHaveLength(10);
    for (const row of rows) expect(row.code_hash).toMatch(/^\$argon2id\$/);
    const dump = JSON.stringify(rows) + (await everythingWritten(current)) + current.logs.text;
    for (const code of codes) expect(dump).not.toContain(code);
    expect(await Promise.all(rows.map((row, index) => hasher.real.verify(row.code_hash, codes.at(index) ?? '')))).toContain(true);
  });

  it('EVM-023 AC4 there is no way to read the codes again: the only operation is the POST that makes new ones', async () => {
    const account = await totpAccount(current);
    await generateCodes(account.panel);
    for (const path of [SECOND_STEP.recoveryCodes, `${SECOND_STEP.recoveryCodes}/current`]) {
      const response = await account.panel.get(path);
      expect([404, 405]).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toMatch(/[A-Z2-7]{20}/);
    }
  });

  it('EVM-023 AC4 B4 refreshing the third step in the same session makes ten new codes and retires the earlier ones in the same transaction', async () => {
    const account = await totpAccount(current);
    const first = (await generateCodes(account.panel)).codes;
    const second = (await generateCodes(account.panel)).codes;
    expect(second).toHaveLength(10);
    expect(second.some((code) => first.includes(code))).toBe(false);
    const rows = await codeRows(account.user.id);
    expect(rows).toHaveLength(20);
    expect(rows.filter((row) => row.superseded_at === null)).toHaveLength(10);
    expect(new Set(rows.filter((row) => row.superseded_at === null).map((row) => row.generation_id)).size).toBe(1);
    nextStep(current);
    const panel = current.panel();
    const response = await sendLoginRecoveryCode(panel, await startLogin(panel, account), first[0] ?? '');
    expect(response.status).toBe(401); // the earlier generation no longer works
    expect(response.body).toMatchObject({ code: 'recovery_code_failed' });
  });

  it('EVM-023 AC6 the generation is audited and mailed without the codes, their hashes or their positions', async () => {
    const account = await totpAccount(current, { email: 'basia.edytor@example.com' });
    const { codes } = await generateCodes(account.panel);
    expect(await audit('mfa.recovery_codes_generated')).toEqual([
      expect.objectContaining({ outcome: 'success', actor_user_id: account.user.id, object_id: account.user.id }),
    ]);
    expect(await outboxRows(current, { recipient: account.user.id, kind: 'mfa_changed' })).toEqual([
      expect.objectContaining({ variant: 'totp_enrolled' }),
      expect.objectContaining({ variant: 'recovery_codes_generated' }),
    ]);
    const written = await everythingWritten(current);
    for (const row of await codeRows(account.user.id)) expect(written).not.toContain(row.code_hash);
    for (const code of codes) expect(written).not.toContain(code);

    const harness = emailHarness(current);
    await harness.job.run({ ids: (await outboxRows(current, { recipient: account.user.id, kind: 'mfa_changed' })).map((row) => row.id) });
    const texts = harness.sender.sent.map((message) => message.text);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain('wygenerowano nowe kody odzyskiwania');
    expect(texts[0]).toContain('dodano kod z aplikacji uwierzytelniającej');
    for (const text of texts) {
      for (const code of codes) expect(text).not.toContain(code);
      expect(text).not.toContain(account.secret);
      expect(text).toContain('Jeśli to nie Ty');
    }
    expect(harness.sender.sent.every((message) => message.to === 'basia.edytor@example.com')).toBe(true);
  });

  it('EVM-023 AC4 B4 an account that never had codes gets them in a fresh session of the code of the app (case a), and a stale window asks for a new proof first', async () => {
    const account = await totpAccount(current);
    const { panel } = await signInWithTotp(current, account);
    expect((await generateCodes(panel)).response.status).toBe(200);

    const other = await totpAccount(current);
    current.clock.advance(16 * 60_000);
    const stale = await generateCodes(other.panel);
    expect(stale.response.status).toBe(403);
    expect(stale.response.body).toMatchObject({ code: 'step_up_required' });
    expect(await codeRows(other.user.id)).toHaveLength(0);
  });

  it('EVM-023 AC4 B4 a session that did not make the current codes cannot make new ones, however fresh it is: 403, the codes stay (a hijacked session cannot take the account for good)', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const before = await codeRows(account.user.id);
    const { panel, response } = await signInWithTotp(current, account);
    expect(response.status).toBe(200); // a fresh session: the code of the app was just proved
    const attempt = await generateCodes(panel);
    expect(attempt.response.status).toBe(403);
    expect(attempt.response.body).toMatchObject({ code: 'recovery_codes_regeneration_unavailable' });
    expect(await codeRows(account.user.id)).toEqual(before);
    expect(await audit('mfa.recovery_codes_generated')).toHaveLength(1);
  });

  it('EVM-023 AC5 B4 a session that came from a recovery code never makes codes: it has no fresh proof (step_up_required), and after a step-up the codes are still not its to replace', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const panel = current.panel();
    const login = await sendLoginRecoveryCode(panel, await startLogin(panel, account), account.codes[0] ?? '');
    expect(login.status).toBe(200);
    panel.adopt(login.headers['set-cookie']);
    panel.csrfToken = (login.body as { csrfToken: string }).csrfToken;
    const first = await generateCodes(panel);
    expect(first.response.status).toBe(403);
    expect(first.response.body).toMatchObject({ code: 'step_up_required' });
    nextStep(current);
    const stepped = await panel.post(SECOND_STEP.stepUp, { method: 'totp', code: codeNow(current, account.secret) });
    expect(stepped.status).toBe(200);
    panel.adopt(stepped.headers['set-cookie']);
    panel.csrfToken = (stepped.body as { csrfToken: string }).csrfToken;
    const second = await generateCodes(panel);
    expect(second.response.status).toBe(403);
    expect(second.response.body).toMatchObject({ code: 'recovery_codes_regeneration_unavailable' });
  });

  it('EVM-023 AC4 B4 an Editor who enrolled with a passkey asks for a step-up first (the enrolment opens no window), and a sign-in with the key opens it', async () => {
    const account = await enrolledAccount(current, { role: 'editor' });
    expect((await signIn(account.panel, account)).status).toBe(200);
    expect((await generateCodes(account.panel)).response.status).toBe(200); // the sign-in with the key opened the window itself

    const second = await enrolledAccount(current, { role: 'read_only' });
    const refused = await generateCodes(second.panel);
    expect(refused.response.status).toBe(403); // the session of the enrolment: no window yet
    expect(refused.response.body).toMatchObject({ code: 'step_up_required' });
    expect((await stepUp(second.panel, second.authenticator)).status).toBe(200); // the options of a step-up are open to every role
    expect((await generateCodes(second.panel)).response.status).toBe(200);
  });

  it('EVM-023 AC4 the operation needs a session and a body that names nothing', async () => {
    const anonymous = await current.panel().post(SECOND_STEP.recoveryCodes);
    expect(anonymous.status).toBe(401);
    const account = await totpAccount(current);
    const response = await account.panel.post(SECOND_STEP.recoveryCodes, { userId: account.user.id });
    expect(response.status).toBe(400);
    expect(await codeRows(account.user.id)).toHaveLength(0);
  });

  it('EVM-023 AC4 two parallel requests of one session are serialised: one set of codes is current afterwards', async () => {
    const account = await totpAccount(current);
    const results = await Promise.all([generateCodes(account.panel), generateCodes(account.panel)]);
    expect(results.map((result) => result.response.status)).toEqual([200, 200]);
    const rows = await codeRows(account.user.id);
    expect(rows.filter((row) => row.superseded_at === null)).toHaveLength(10);
    expect(rows).toHaveLength(20);
  });
});

describe('sign-in with a recovery code (EVM-023 AC5; SR-AUTH-08, SR-AUTH-15)', () => {
  it('EVM-023 AC5 the first step offers the recovery code beside the code of the app; the code signs in, 9 remain, and the answer is never cached', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const panel = current.panel();
    const first = await firstStep(panel, account.email, account.password);
    expect(first.body).toMatchObject({ methods: ['totp', 'recovery_code'] });
    const response = await sendLoginRecoveryCode(panel, (first.body as { loginToken: string }).loginToken, account.codes[3] ?? '');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ state: 'active', remainingCodes: 9 });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('EVM-023 AC5 the same code a second time is refused (single use) and the next one counts 8', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const [one, two] = [current.panel(), current.panel()];
    expect((await sendLoginRecoveryCode(one, await startLogin(one, account), account.codes[0] ?? '')).status).toBe(200);
    const replay = await sendLoginRecoveryCode(two, await startLogin(two, account), account.codes[0] ?? '');
    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({ code: 'recovery_code_failed' });
    const third = current.panel();
    const next = await sendLoginRecoveryCode(third, await startLogin(third, account), account.codes[1] ?? '');
    expect(next.body).toMatchObject({ remainingCodes: 8 });
  });

  it('EVM-023 AC5 the code is taken as it is copied or printed: lower case, spaces and hyphens are ignored', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const code = account.codes[0] ?? '';
    const typed = `${code.slice(0, 5)}-${code.slice(5, 10)} ${code.slice(10, 15)}-${code.slice(15)}`.toLowerCase();
    const panel = current.panel();
    expect((await sendLoginRecoveryCode(panel, await startLogin(panel, account), typed)).status).toBe(200);
  });

  it('EVM-023 AC5 the use is audited (the account, no code) and mailed with the number of codes left; the session has no window of step-up (SR-SESS-08)', async () => {
    const account = await totpAccount(current, { withCodes: true, email: 'celina.edytor@example.com' });
    const panel = current.panel();
    const response = await sendLoginRecoveryCode(panel, await startLogin(panel, account), account.codes[0] ?? '');
    panel.adopt(response.headers['set-cookie']);
    expect(await audit('login.recovery_code_used')).toEqual([
      expect.objectContaining({ outcome: 'success', actor_user_id: account.user.id, object_id: account.user.id }),
    ]);
    const session = (
      await db().selectFrom('identity.sessions').selectAll().where('user_id', '=', account.user.id).orderBy('created_at', 'desc').execute()
    )[0];
    expect(session).toMatchObject({ state: 'active', passkey_authenticated_at: null, totp_authenticated_at: null });
    expect((await generateCodes(panel)).response.status).toBe(403);

    const rows = await outboxRows(current, { recipient: account.user.id, kind: 'recovery_code_used' });
    expect(rows).toHaveLength(1);
    const harness = emailHarness(current);
    await harness.job.run({ ids: rows.map((row) => row.id) });
    const text = harness.sender.sent.at(-1)?.text ?? '';
    expect(harness.sender.sent.at(-1)?.subject).toBe('EVia Manager: użyto kodu odzyskiwania');
    expect(text).toContain('Pozostało 9 kodów.');
    for (const code of account.codes) expect(text).not.toContain(code);
    expect(await everythingWritten(current)).not.toContain(account.codes[0] ?? 'x');
  });

  it('EVM-023 AC5 C2 the order of the checks: no loginToken costs nothing, a shape that cannot be a code costs no hash, a wrong code costs at most ten, a right one stops at its place', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const panel = current.panel();

    hasher.verifications = 0;
    const unknown = await sendLoginRecoveryCode(panel, randomBytes(32).toString('base64url'), account.codes[0] ?? '');
    expect(unknown.status).toBe(401);
    expect(hasher.verifications).toBe(0);

    const loginToken = await startLogin(panel, account);
    hasher.verifications = 0;
    for (const garbage of ['short', 'ABCDEFGHIJKLMNOPQRS1', `${account.codes[0] ?? ''}A`, '!!!!!']) {
      const response = await sendLoginRecoveryCode(panel, loginToken, garbage);
      expect(response.status, garbage).toBe(401);
    }
    expect(hasher.verifications).toBe(0);

    const wrong = account.codes[0]?.replace(/^./, (first) => (first === 'A' ? 'B' : 'A')) ?? '';
    await sendLoginRecoveryCode(panel, loginToken, wrong);
    expect(hasher.verifications).toBe(10);

    // five failures ended that attempt: the right code is tried on a new one
    const second = await startLogin(panel, account);
    hasher.verifications = 0;
    const right = await sendLoginRecoveryCode(panel, second, account.codes[2] ?? '');
    expect(right.status).toBe(200);
    expect(hasher.verifications).toBe(3); // it stops at the third hash, in the order the codes were made
  });

  it('EVM-023 AC5 B3 five wrong codes end the attempt; every failure is audited with the account and never with the input', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await sendLoginRecoveryCode(panel, loginToken, 'ABCDEFGHIJKLMNOPQRST');
      expect(response.body).toMatchObject({ code: 'recovery_code_failed' });
    }
    const right = await sendLoginRecoveryCode(panel, loginToken, account.codes[0] ?? '');
    expect(right.body).toMatchObject({ code: 'unauthenticated' });
    const failures = (
      await sql<{
        reason_code: string;
        actor_user_id: string;
      }>`select reason_code, actor_user_id from audit.events where action = 'login.failed'`.execute(current.database.admin)
    ).rows;
    expect(failures).toHaveLength(5);
    expect(failures.every((row) => row.reason_code === 'recovery_code_failed' && row.actor_user_id === account.user.id)).toBe(true);
    expect(await everythingWritten(current)).not.toContain('ABCDEFGHIJKLMNOPQRST');
  });

  it('EVM-023 AC5 C2 two parallel requests with the same code give exactly one session and one use', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const [one, two] = [current.panel(), current.panel()];
    const [tokenOne, tokenTwo] = [await startLogin(one, account), await startLogin(two, account)];
    const before = (await db().selectFrom('identity.sessions').select('id').where('user_id', '=', account.user.id).execute()).length;
    const code = account.codes[5] ?? '';
    const results = await Promise.all([sendLoginRecoveryCode(one, tokenOne, code), sendLoginRecoveryCode(two, tokenTwo, code)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    expect((await db().selectFrom('identity.sessions').select('id').where('user_id', '=', account.user.id).execute()).length).toBe(
      before + 1,
    );
    expect((await codeRows(account.user.id)).filter((row) => row.used_at !== null)).toHaveLength(1);
    expect(await audit('login.recovery_code_used')).toHaveLength(1);
  });

  it('EVM-023 AC5 C2 a loginToken that ran out while the hashes were computed is refused at the decision: no session, the code stays unused', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    hasher.during = () => {
      current.clock.advance(5 * 60_000 + 1);
    };
    const response = await sendLoginRecoveryCode(panel, loginToken, account.codes[0] ?? '');
    hasher.during = undefined;
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
    expect((await codeRows(account.user.id)).every((row) => row.used_at === null)).toBe(true);
  });

  it('EVM-023 AC5 C2 an account deactivated while the hashes were computed gets no session and the code is not spent (the whole decision is rolled back)', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    const deactivate = sql`update identity.users set status = 'deactivated', deactivated_at = ${current.clock.now()} where id = ${account.user.id}`;
    let done: Promise<unknown> | undefined;
    hasher.during = () => {
      done = deactivate.execute(current.database.admin);
    };
    const response = await sendLoginRecoveryCode(panel, loginToken, account.codes[0] ?? '');
    hasher.during = undefined;
    await done;
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
    expect((await codeRows(account.user.id)).every((row) => row.used_at === null)).toBe(true);
  });

  it('EVM-023 AC5 C2 the same loginToken used at the same moment with two different codes gives one session: the second finds the attempt spent and its code stays unused', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    const results = await Promise.all([
      sendLoginRecoveryCode(panel, loginToken, account.codes[0] ?? ''),
      sendLoginRecoveryCode(panel, loginToken, account.codes[1] ?? ''),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    expect((await codeRows(account.user.id)).filter((row) => row.used_at !== null)).toHaveLength(1);
  });

  it('EVM-023 AC5 a code of another account does not sign in anyone: the account is the one of the loginToken', async () => {
    const owner = await totpAccount(current, { withCodes: true });
    const other = await totpAccount(current, { withCodes: true });
    const panel = current.panel();
    const response = await sendLoginRecoveryCode(panel, await startLogin(panel, owner), other.codes[0] ?? '');
    expect(response.status).toBe(401);
    expect((await codeRows(other.user.id)).every((row) => row.used_at === null)).toBe(true);
  });

  it('EVM-023 AC5 the code works after a password reset too, and so does the code of the app (the loginToken of the reset is a first step like any other)', async () => {
    const account = await totpAccount(current, { withCodes: true, email: 'dorota.reset@example.com' });
    const harness = emailHarness(current);
    expect((await requestReset(current.panel(), account.email)).status).toBe(202);
    const delivered = await processPending(current, account.user.id, harness);
    const panel = current.panel();
    const completed = await panel.post(RESET.complete, { token: delivered.token, password: NEW_PASSWORD });
    expect(completed.body).toMatchObject({ state: 'second_step', methods: ['totp', 'recovery_code'] });
    const response = await sendLoginRecoveryCode(panel, (completed.body as { loginToken: string }).loginToken, account.codes[0] ?? '');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ remainingCodes: 9 });
  });

  it('EVM-023 AC5 a recovery code is no second step for the Administrator in the panel unless the account has a factor, and with a key it works (the hint is the screen)', async () => {
    const admin = await signedInAdministrator(current);
    const generated = await generateCodes(admin.panel);
    expect(generated.response.status).toBe(200);
    const panel = current.panel();
    const first = await firstStep(panel, admin.email, admin.password);
    expect(first.body).toMatchObject({ methods: ['passkey', 'recovery_code'] });
    const response = await sendLoginRecoveryCode(panel, (first.body as { loginToken: string }).loginToken, generated.codes[0] ?? '');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ remainingCodes: 9 });

    // an account that has codes but no factor at all is not offered a second step: it still has to enrol — and, with no window opened by a reset
    // of the second step, the password alone gives it no session at all (EVM-027 D2)
    const lone = await totpAccount(current, { withCodes: true });
    await sql`delete from identity.totp_factors where user_id = ${lone.user.id}`.execute(current.database.admin);
    const alone = await firstStep(current.panel(), lone.email, lone.password);
    expect(alone.status).toBe(403);
    expect(alone.body).toMatchObject({ code: 'mfa_setup_expired' });
    expect((alone.body as { loginToken?: string }).loginToken).toBeUndefined();
  });

  it('EVM-023 AC5 the body is strict and the answer of a code of the wrong kind never leaks the codes', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    for (const body of [
      { loginToken, code: '' },
      { loginToken, code: 'A'.repeat(65) },
      { loginToken, code: 5 },
      { code: 'ABCDEFGHIJKLMNOPQRST' },
      { loginToken, code: 'ABCDEFGHIJKLMNOPQRST', userId: account.user.id },
    ]) {
      const response = await panel.post(SECOND_STEP.loginRecoveryCode, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect((await sendLoginTotp(panel, loginToken, codeNow(current, account.secret))).status).toBe(200);
  });

  it('EVM-023 AC5 a code of the app typed into the field of the recovery code is refused (and the other way round)', async () => {
    const account = await totpAccount(current, { withCodes: true });
    const panel = current.panel();
    const loginToken = await startLogin(panel, account);
    expect((await sendLoginRecoveryCode(panel, loginToken, codeNow(current, account.secret))).status).toBe(401);
    expect((await sendLoginTotp(panel, loginToken, '123456')).status).toBe(401);
  });

  it('EVM-023 AC5 the factor of an account that is only written in the database does not need the codes to work: a code of the app signs in', async () => {
    const account = await enrolledAccount(current, { role: 'editor' });
    await sql`delete from identity.passkeys where user_id = ${account.user.id}`.execute(current.database.admin);
    const { secret } = await insertTotpFactor(current, account.user.id);
    const panel = current.panel();
    expect((await sendLoginTotp(panel, await startLogin(panel, account), codeNow(current, secret))).status).toBe(200);
  });
});
