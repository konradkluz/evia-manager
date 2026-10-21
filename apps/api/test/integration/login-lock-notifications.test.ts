import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEmailSender } from '../../src/platform/email/in-memory-email-sender.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { METRICS } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createLink, createUser } from '../support/identity-fixtures.ts';
import { setPassword } from '../support/flows.ts';
import { emailHarness, outboxRows } from '../support/invitation-fixtures.ts';
import { enrolledAccount, firstStep } from '../support/login-flows.ts';
import { deliverReset, NEW_PASSWORD, processPending, requestReset, RESET } from '../support/password-reset-fixtures.ts';
import { accountRow, alertCodes, lockEvents, WRONG, wrongPasswords } from '../support/throttle-flows.ts';
import { codeNow, sendLoginTotp, startLogin, totpAccount } from '../support/totp-flows.ts';

const NINE = '2026-10-05T07:00:00.000Z';
const MINUTE = 60_000;

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp({ now: NINE });
});
afterEach(async () => {
  await current.close();
});

const mails = (userId: string) => outboxRows(current, { recipient: userId, kind: 'account_locked' });
const lockouts = () =>
  current.app
    .get<MetricsRegistry>(METRICS, { strict: false })
    .snapshot()
    .filter((sample) => sample.name === 'evia_account_lockouts_total')
    .map((sample) => [sample.labels, sample.value]);

/** Delivers the pending e-mail of a lock through the worker (a fake of the port) and @returns the message. */
async function deliverLockMail(userId: string) {
  const sender = new InMemoryEmailSender();
  const [row] = await mails(userId);
  await emailHarness(current, sender).job.run({ ids: [row?.id ?? ''] });
  return sender.sent.at(-1);
}

describe('e-mail and audit of a lock (EVM-026 AC4; SR-AUTH-15, SR-INPUT-07, SR-LOG-03)', () => {
  it('EVM-026 AC4 the lock of the password is ONE e-mail with the link to the form "Zresetuj hasło" — no token, no data of a client — and one audit event without personal data', async () => {
    const account = await enrolledAccount(current);
    current.clock.set(NINE);
    await wrongPasswords(current, account.email, 10);
    for (let attempt = 0; attempt < 3; attempt += 1) await firstStep(current.panel(), account.email, account.password); // during the lock: nothing new
    const rows = await mails(account.user.id);
    expect(rows.map((row) => [row.variant, row.state])).toEqual([['password', 'pending']]);
    const message = await deliverLockMail(account.user.id);
    expect(message?.to).toBe(account.email);
    expect(message?.subject).toBe('EVia Manager: logowanie zablokowane na 15 minut');
    expect(message?.text).toContain(`${PANEL_ORIGIN}/login/reset`);
    expect(message?.text).toContain('zmiana hasła zdejmie tę blokadę');
    expect(message?.text).not.toMatch(/#|token|\d+\.\d+\.\d+\.\d+|Mozilla|@evia\.invalid/i);
    expect(message?.text).toMatch(/od \d{2}\.\d{2}\.2026, 09:\d{2} do \d{2}\.\d{2}\.2026, 09:\d{2}/);

    expect(await lockEvents(current)).toEqual([
      { action: 'account.locked', reason_code: 'password', object_id: account.user.id, actor_type: 'anonymous', outcome: 'denied' },
    ]);
    // what the lock writes down: the audit trail, the outbox of e-mails (by identifier), the alerts and the counters — not the address, not a password
    const db = current.database.admin;
    const stored = JSON.stringify([
      (await sql`select to_jsonb(t) as row from audit.events t`.execute(db)).rows,
      (await sql`select to_jsonb(t) as row from platform.email_outbox t`.execute(db)).rows,
      (await sql`select to_jsonb(t) as row from platform.security_alert_outbox t`.execute(db)).rows,
      (await sql`select to_jsonb(t) as row from identity.login_throttle t`.execute(db)).rows,
    ]);
    expect(stored).not.toContain(account.email);
    expect(stored).not.toContain(WRONG);
    expect(current.logs.text).not.toContain(account.email);
    const audit = (
      await sql<{ ip_prefix: string | null }>`select ip_prefix from audit.events where action = 'account.locked'`.execute(
        current.database.admin,
      )
    ).rows;
    expect(audit[0]?.ip_prefix ?? '').not.toMatch(/(^|[^\d])127\.0\.0\.1(?!\d)/); // the prefix of the address (P9), never the whole address
  });

  it('EVM-026 AC4 the lock of the second step has a variant of its own ("ktoś zna Twoje hasło") and says that a new password does not lift it', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    await wrongPasswords(current, account.email, 6);
    const panel = current.panel();
    const token = await startLogin(panel, account);
    const wrong = codeNow(current, account.secret) === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 4; attempt += 1) await sendLoginTotp(panel, token, wrong);
    const message = await deliverLockMail(account.user.id);
    expect(message?.text).toContain('ktoś zna Twoje hasło');
    expect(message?.text).toContain('Zmiana hasła nie zdejmie tej blokady');
    expect(message?.text).toContain(`${PANEL_ORIGIN}/login/reset`);
    expect(message?.text).not.toContain('#');
  });

  it('EVM-026 AC4 at most three e-mails a day to one account: the fourth lock of the day is audited and alerted but not mailed', async () => {
    const account = await enrolledAccount(current);
    for (let round = 0; round < 4; round += 1) {
      current.clock.set(new Date(new Date(NINE).getTime() + round * 20 * MINUTE));
      await wrongPasswords(current, account.email, 10, { everyMs: 1000 });
    }
    expect(await mails(account.user.id)).toHaveLength(3);
    expect(await lockEvents(current)).toHaveLength(4);
    // a day later it is mailed again
    current.clock.set(new Date(new Date(NINE).getTime() + 25 * 3_600_000));
    await wrongPasswords(current, account.email, 10, { everyMs: 1000 });
    expect(await mails(account.user.id)).toHaveLength(4);
  });

  it('EVM-026 AC4 an address without an account, and an account that is not active, leave a metric and an alert — no audit event about a person, no e-mail', async () => {
    const invited = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
    const link = await createLink(current.database.admin, current.clock, invited.id);
    expect((await setPassword(current.panel(), link.token)).status).toBe(200);
    current.clock.set(NINE);
    await wrongPasswords(current, 'nobody@evia.invalid', 10, { everyMs: 1000 });
    current.clock.advance(61_000); // a fresh window of the limit of the address
    await wrongPasswords(current, invited.email, 10, { everyMs: 1000 });
    expect(await lockEvents(current)).toEqual([]);
    expect(await outboxRows(current, { kind: 'account_locked' })).toEqual([]);
    expect(lockouts()).toEqual([[{ cause: 'password' }, 2]]);
    expect((await alertCodes(current)).filter((code) => code === 'account_locked')).toHaveLength(2);
    expect((await accountRow(current, 'nobody@evia.invalid'))?.lock_cause).toBe('password');
  });
});

describe('alerts and the metric (EVM-026 AC6; SR-LOG-06, SR-LOG-07)', () => {
  it('EVM-026 AC6 more than 30 failed passwords of all accounts in 5 minutes raise ONE warning alert; the 31st crosses it, the 32nd does not repeat it; a new window is a new crossing', async () => {
    const failures = async (count: number, label: string) => {
      for (let index = 0; index < count; index += 1) {
        expect((await firstStep(current.panel(), `${label}-${index}@evia.invalid`, WRONG)).status).toBe(401);
      }
    };
    current.clock.set(NINE);
    await failures(20, 'a'); // different addresses: no lock, only the flood
    current.clock.advance(61_000);
    await failures(10, 'b');
    expect(await alertCodes(current)).toEqual([]); // thirty are not more than thirty
    await failures(1, 'c');
    expect(await alertCodes(current)).toEqual(['login_failure_spike']);
    await failures(1, 'd');
    expect(await alertCodes(current)).toEqual(['login_failure_spike']);
    current.clock.advance(6 * MINUTE);
    await failures(20, 'e');
    current.clock.advance(61_000);
    await failures(12, 'f');
    expect(await alertCodes(current)).toEqual(['login_failure_spike', 'login_failure_spike']);
  });

  it('EVM-026 AC6 a lock raises ONE alert and counts evia_account_lockouts_total with the cause only; neither holds a person', async () => {
    const account = await enrolledAccount(current);
    current.clock.set(NINE);
    await wrongPasswords(current, account.email, 12, { everyMs: 1000 });
    expect(await alertCodes(current)).toEqual(['account_locked']);
    expect(lockouts()).toEqual([[{ cause: 'password' }, 1]]);
    const rows = (await sql`select * from platform.security_alert_outbox`.execute(current.database.admin)).rows;
    expect(JSON.stringify(rows)).not.toContain(account.user.id);
    expect(JSON.stringify(rows)).not.toContain(account.email);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['alert_code', 'emitted_at', 'id', 'occurred_at', 'trace_id']);
  });
});

describe('who lifts a lock (EVM-026 AC7; SR-AUTHZ-05)', () => {
  it('EVM-026 AC7 asking for a reset works during a lock and unlocks nothing; the END of the reset lifts a lock whose cause is the password', async () => {
    const account = await enrolledAccount(current);
    current.clock.set(NINE);
    await wrongPasswords(current, account.email, 10, { everyMs: 1000 });
    const asked = await requestReset(current.panel(), account.email);
    expect(asked.status).toBe(202);
    expect((await firstStep(current.panel(), account.email, account.password)).status).toBe(429); // the request alone lifts nothing
    const delivered = await deliverReset(current, account, emailHarness(current));
    const done = await current.panel().post(RESET.complete, { token: delivered.token, password: NEW_PASSWORD });
    expect(done.status).toBe(200);
    expect(await accountRow(current, account.email)).toBeUndefined();
    current.clock.advance(61_000);
    expect((await firstStep(current.panel(), account.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('EVM-026 AC7 a lock whose cause is the second step is NOT lifted by a reset of the password: only time lifts it', async () => {
    const account = await totpAccount(current, { withCodes: true });
    current.clock.set(NINE);
    await wrongPasswords(current, account.email, 6, { everyMs: 1000 });
    const panel = current.panel();
    const token = await startLogin(panel, account);
    const wrong = codeNow(current, account.secret) === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 4; attempt += 1) await sendLoginTotp(panel, token, wrong);
    expect(await accountRow(current, account.email)).toMatchObject({ lock_cause: 'second_step' });

    expect((await requestReset(current.panel(), account.email)).status).toBe(202);
    const delivered = await processPending(current, account.user.id, emailHarness(current));
    const done = await current.panel().post(RESET.complete, { token: delivered.token, password: NEW_PASSWORD });
    expect(done.status).toBe(200);
    // the loginToken of the reset is a first step of the same scope: its second step is refused too
    const { loginToken } = done.body as { loginToken: string };
    expect((await sendLoginTotp(current.panel(), loginToken, codeNow(current, account.secret))).status).toBe(429);
    expect((await firstStep(current.panel(), account.email, NEW_PASSWORD)).status).toBe(429);
    current.clock.advance(16 * MINUTE);
    expect((await firstStep(current.panel(), account.email, NEW_PASSWORD)).status).toBe(200);
  });

  it.each(['administrator', 'editor', 'read_only'] as const)('EVM-026 AC7 the protection is the same for the role %s', async (role) => {
    const account = await enrolledAccount(current, { role });
    current.clock.set(NINE);
    const tries = await wrongPasswords(current, account.email, 11, { everyMs: 1000 });
    expect(tries.map((response) => response.status)).toEqual([...Array<number>(10).fill(401), 429]);
    expect(tries[10]?.body).toMatchObject({ code: 'rate_limited' });
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 10, lock_cause: 'password' });
  });

  it('EVM-026 AC7 there is no way to unlock an account by an Administrator: no operation of the contract is about it', () => {
    expect(Object.keys(AUTHZ_MANIFEST).filter((operation) => /unlock|unblock|lockout|throttle/i.test(operation))).toEqual([]);
    expect(Object.values(AUTHZ_MANIFEST).filter((operation) => /unlock|unblock/i.test(operation.path))).toEqual([]);
  });
});
