import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD_HASHER } from '../../src/modules/identity/infrastructure/ports.ts';
import { OtpauthTotpEngine, TOTP_ENGINE } from '../../src/modules/identity/infrastructure/totp-engine.ts';
import { SLEEPER } from '../../src/platform/tokens.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { enrolledAccount, firstStep, loginOptions, LOGIN, secondStep } from '../support/login-flows.ts';
import { outboxRows } from '../support/invitation-fixtures.ts';
import { accountRow, alertCodes, CountingHasher, InspectingSleeper, lockEvents, wrongPasswords } from '../support/throttle-flows.ts';
import { codeNow, SECOND_STEP, sendLoginRecoveryCode, sendLoginTotp, startLogin, totpAccount } from '../support/totp-flows.ts';
import type { PanelClient } from '../support/panel-client.ts';
import { VirtualAuthenticator } from '../support/virtual-authenticator.ts';

const NINE = '2026-10-05T07:00:00.000Z';
const A_CODE = 'ABCDEFGHIJKLMNOPQRST'; // the shape of a recovery code, not one of the account's

/** Records, at every check of a code, how many waits the app had asked for by then. */
class RecordingEngine extends OtpauthTotpEngine {
  readonly waitsBefore: number[] = [];
  sleeper: InspectingSleeper | undefined;

  override match(secret: Buffer, code: string, now: Date): number | null {
    this.waitsBefore.push(this.sleeper?.slept.length ?? 0);
    return super.match(secret, code, now);
  }
}

let current: IdentityApp;
let hasher: CountingHasher;
let sleeper: InspectingSleeper;
let engine: RecordingEngine;
beforeEach(async () => {
  hasher = new CountingHasher();
  sleeper = new InspectingSleeper(() => current);
  hasher.sleeper = sleeper;
  engine = new RecordingEngine();
  engine.sleeper = sleeper;
  current = await createIdentityApp({
    now: NINE,
    configure: (builder) =>
      builder
        .overrideProvider(PASSWORD_HASHER)
        .useValue(hasher)
        .overrideProvider(SLEEPER)
        .useValue(sleeper)
        .overrideProvider(TOTP_ENGINE)
        .useValue(engine),
  });
});
afterEach(async () => {
  await current.close();
});

const sessionCount = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from identity.sessions`.execute(current.database.admin)).rows[0]?.n);
const openAttempts = async (): Promise<number> =>
  Number(
    (
      await sql<{ n: string }>`select count(*)::text as n from identity.login_attempts where used_at is null`.execute(
        current.database.admin,
      )
    ).rows[0]?.n,
  );
const wrongTotp = (secret: string): string => (codeNow(current, secret) === '000000' ? '000001' : '000000');

describe('the second step counts in the same budget (EVM-026 AC1, AC3; RR-26)', () => {
  it('EVM-026 AC3 totp_failed: five wrong passwords and five wrong codes lock; the open loginToken of the account ends at that moment, a CORRECT code is 429 and makes no session', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    const first = current.panel();
    const second = current.panel();
    const t1 = await startLogin(first, account);
    const t2 = await startLogin(second, account);
    await wrongPasswords(current, account.email, 5);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await sendLoginTotp(first, t1, wrongTotp(account.secret));
      expect(response.status, `wrong code ${attempt}`).toBe(401);
      expect(response.body).toMatchObject({ code: 'totp_failed' });
    }
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 10, second_step_failures: 5, lock_cause: 'second_step' });
    expect(await openAttempts()).toBe(0); // the lock ended t2 too

    const sessionsBefore = await sessionCount();
    const refused = await sendLoginTotp(second, t2, codeNow(current, account.secret));
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(refused.headers['set-cookie']).toBeUndefined();
    expect(await sessionCount()).toBe(sessionsBefore);
    // the first step with the right password is the same 429 (the account has one budget)
    const again = await firstStep(current.panel(), account.email, account.password);
    expect(again.status).toBe(429);
    expect(again.body).toMatchObject({ code: 'rate_limited' });

    // the same answer that the first step gives: nothing tells a lock of the second step from a lock of the password
    expect({ ...(refused.body as object), traceId: undefined }).toEqual({ ...(again.body as object), traceId: undefined });
  });

  it('EVM-026 AC3 recovery_code_failed: the same, with codes of recovery — a correct code of recovery is 429 and stays unused', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    const first = current.panel();
    const second = current.panel();
    const t1 = await startLogin(first, account);
    const t2 = await startLogin(second, account);
    await wrongPasswords(current, account.email, 5);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await sendLoginRecoveryCode(first, t1, A_CODE);
      expect(response.status, `wrong recovery code ${attempt}`).toBe(401);
      expect(response.body).toMatchObject({ code: 'recovery_code_failed' });
    }
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 10, second_step_failures: 5, lock_cause: 'second_step' });
    const sessionsBefore = await sessionCount();
    const refused = await sendLoginRecoveryCode(second, t2, account.codes[0] ?? '');
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'rate_limited' });
    expect(await sessionCount()).toBe(sessionsBefore);
    const used = await sql<{ n: string }>`select count(*)::text as n from identity.recovery_codes where used_at is not null`.execute(
      current.database.admin,
    );
    expect(used.rows[0]?.n).toBe('0');
  });

  it('EVM-026 AC3 passkey_failed: five wrong passwords and five rejected assertions lock; options and a CORRECT assertion of an open loginToken are 429', async () => {
    const account = await enrolledAccount(current);
    current.clock.set(NINE);
    const first = current.panel();
    const second = current.panel();
    const t1 = (await firstStep(first, account.email, account.password)).body as { loginToken: string };
    const t2 = (await firstStep(second, account.email, account.password)).body as { loginToken: string };
    await wrongPasswords(current, account.email, 5);
    const stranger = new VirtualAuthenticator();
    const { options } = await loginOptions(first, t1.loginToken);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await secondStep(first, t1.loginToken, account.authenticator, options, { signWith: stranger });
      expect(response.status, `rejected assertion ${attempt}`).toBe(401);
      expect(response.body).toMatchObject({ code: 'passkey_failed' });
    }
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 10, second_step_failures: 5, lock_cause: 'second_step' });
    const sessionsBefore = await sessionCount();
    const refusedOptions = await second.post(LOGIN.options, { loginToken: t2.loginToken });
    expect(refusedOptions.status).toBe(429);
    const refused = await second.post(LOGIN.passkey, { loginToken: t2.loginToken, credential: account.authenticator.assert(options) });
    expect(refused.status).toBe(429);
    expect(await sessionCount()).toBe(sessionsBefore);
  });

  it('EVM-026 AC1 only a rejected assertion is a failure of the passkey: asking for options, an unknown loginToken and an expired one count nothing', async () => {
    const account = await enrolledAccount(current);
    current.clock.set(NINE);
    const panel = current.panel();
    const { loginToken } = (await firstStep(panel, account.email, account.password)).body as { loginToken: string };
    await loginOptions(panel, loginToken);
    await panel.post(LOGIN.options, { loginToken: 'A'.repeat(43) });
    expect((await accountRow(current, account.email))?.failures).toBe(0);
    current.clock.advance(6 * 60_000); // the loginToken lives five minutes
    const expired = await sendLoginTotp(panel, loginToken, '123456');
    expect(expired.status).toBe(401);
    expect(expired.body).toMatchObject({ code: 'login_expired' });
    expect((await accountRow(current, account.email))?.failures).toBe(0);
  });

  it('EVM-026 AC1 login_expired and mfa_setup_expired are not guesses: the counter is as it was', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    const panel = current.panel();
    const token = await startLogin(panel, account);
    current.clock.advance(6 * 60_000);
    expect((await sendLoginTotp(panel, token, '123456')).body).toMatchObject({ code: 'login_expired' });
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 0 });
    // an account whose password is right but that has no second step and no window to set one up: 403, and the try is given back
    await sql`delete from identity.recovery_codes where user_id = ${account.user.id}`.execute(current.database.admin);
    await sql`delete from identity.totp_factors where user_id = ${account.user.id}`.execute(current.database.admin);
    const response = await firstStep(current.panel(), account.email, account.password);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'mfa_setup_expired' });
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 0 });
  });

  it('EVM-026 AC1 the six counted failures raise the counter, each by one, and the second step also its own count', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    const panel = current.panel();
    const token = await startLogin(panel, account);
    await sendLoginTotp(panel, token, wrongTotp(account.secret));
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 1, second_step_failures: 1 });
    await sendLoginRecoveryCode(panel, token, A_CODE);
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 2, second_step_failures: 2 });
    await wrongPasswords(current, account.email, 1);
    await wrongPasswords(current, 'nobody@evia.invalid', 1);
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 3, second_step_failures: 2 });
    expect(await accountRow(current, 'nobody@evia.invalid')).toMatchObject({ failures: 1, second_step_failures: 0 });
  });
});

describe('the order of a try (EVM-026 M1; CWE-307)', () => {
  it('EVM-026 AC1 a code of the app is checked only AFTER the wait: the sixth failure waits 1 s before the engine looks at the code', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    await wrongPasswords(current, account.email, 5);
    const panel = current.panel();
    const token = await startLogin(panel, account); // the correct password gives its reservation back — five failures stand
    sleeper.slept.length = 0;
    engine.waitsBefore.length = 0;
    expect((await sendLoginTotp(panel, token, wrongTotp(account.secret))).status).toBe(401);
    expect(sleeper.slept).toEqual([1000]);
    expect(engine.waitsBefore).toEqual([1]);
    expect(sleeper.openTransactions.at(-1)).toBe(0);
  });

  it('EVM-026 AC1 a recovery code is hashed only AFTER the wait', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    await wrongPasswords(current, account.email, 5);
    const panel = current.panel();
    const token = await startLogin(panel, account);
    sleeper.slept.length = 0;
    hasher.verifications.length = 0;
    expect((await sendLoginRecoveryCode(panel, token, A_CODE)).status).toBe(401);
    expect(sleeper.slept).toEqual([1000]);
    expect(hasher.verifications.length).toBeGreaterThan(0);
    expect(hasher.verifications.every((run) => run.waitsBefore === 1)).toBe(true);
  });

  it('EVM-026 AC1 a rejected assertion of the passkey also waits first', async () => {
    const account = await enrolledAccount(current);
    current.clock.set(NINE);
    await wrongPasswords(current, account.email, 5);
    const panel = current.panel();
    const { loginToken } = (await firstStep(panel, account.email, account.password)).body as { loginToken: string };
    const { options } = await loginOptions(panel, loginToken);
    sleeper.slept.length = 0;
    const response = await secondStep(panel, loginToken, account.authenticator, options, { signWith: new VirtualAuthenticator() });
    expect(response.status).toBe(401);
    expect(sleeper.slept).toEqual([1000]);
  });

  it('EVM-026 AC1 twenty parallel wrong codes: at most ten reach a verdict in the whole window, counting the failures before', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    // five tokens, each can fail four times (the fifth ends it): parallel tries over several tokens are the attack of RR-26
    const panels = Array.from({ length: 5 }, () => current.panel());
    const tokens: string[] = [];
    for (const panel of panels) tokens.push(await startLogin(panel, account));
    engine.waitsBefore.length = 0;
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        sendLoginTotp(panels[index % 5] as PanelClient, tokens[index % 5] as string, wrongTotp(account.secret)),
      ),
    );
    const verdicts = responses.map((response) => (response.body as { code: string }).code);
    expect(verdicts.filter((code) => code === 'totp_failed')).toHaveLength(10);
    expect(verdicts.filter((code) => code === 'rate_limited')).toHaveLength(10);
    expect(engine.waitsBefore).toHaveLength(10); // only the ten tries that were let through reached the code
    expect((await accountRow(current, account.email))?.failures).toBe(10);
    expect(await lockEvents(current)).toHaveLength(1);
    expect(await outboxRows(current, { recipient: account.user.id, kind: 'account_locked' })).toHaveLength(1);
  });
});

describe('the cause of a lock (EVM-026 AC3, AC4; M4)', () => {
  it('EVM-026 AC3 six wrong passwords and four wrong codes: the cause is the second step, in the audit event and in the e-mail', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    await wrongPasswords(current, account.email, 6);
    const panel = current.panel();
    const token = await startLogin(panel, account);
    for (let attempt = 0; attempt < 4; attempt += 1) await sendLoginTotp(panel, token, wrongTotp(account.secret));
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 10, second_step_failures: 4, lock_cause: 'second_step' });
    expect(await lockEvents(current)).toEqual([
      { action: 'account.locked', reason_code: 'second_step', object_id: account.user.id, actor_type: 'anonymous', outcome: 'denied' },
    ]);
    const mails = await outboxRows(current, { recipient: account.user.id, kind: 'account_locked' });
    expect(mails.map((row) => row.variant)).toEqual(['second_step']);
  });

  it('EVM-026 AC6 three failures of the second step in a window raise ONE critical alert, the fourth does not repeat it; the lock raises its own', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    const panel = current.panel();
    const token = await startLogin(panel, account);
    await sendLoginTotp(panel, token, wrongTotp(account.secret));
    await sendLoginTotp(panel, token, wrongTotp(account.secret));
    expect(await alertCodes(current)).toEqual([]);
    await sendLoginTotp(panel, token, wrongTotp(account.secret));
    expect(await alertCodes(current)).toEqual(['second_step_failure_spike']);
    await sendLoginTotp(panel, token, wrongTotp(account.secret));
    expect(await alertCodes(current)).toEqual(['second_step_failure_spike']);
  });

  it('EVM-026 AC6 the same threshold again in a window of its own is a new crossing', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    for (let round = 0; round < 2; round += 1) {
      const panel = current.panel();
      const token = await startLogin(panel, account);
      for (let attempt = 0; attempt < 3; attempt += 1) await sendLoginTotp(panel, token, wrongTotp(account.secret));
      current.clock.advance(16 * 60_000);
    }
    expect(await alertCodes(current)).toEqual(['second_step_failure_spike', 'second_step_failure_spike']);
  });
});

describe('a token that names no first step (EVM-026 AC3)', () => {
  it('EVM-026 AC3 an unknown loginToken stays 401 unauthenticated while the account is locked: the lock is not told to a caller who holds no first step', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    await wrongPasswords(current, account.email, 10);
    const unknown = await current.panel().post(SECOND_STEP.loginTotp, { loginToken: 'B'.repeat(43), code: '123456' });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toMatchObject({ code: 'unauthenticated' });
  });
});
