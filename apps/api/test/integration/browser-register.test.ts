import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_COOKIE_NAME } from '../../src/modules/identity/domain/constants.ts';
import { hashToken } from '../../src/modules/identity/domain/tokens.ts';
import { PATHS } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSetupWindow } from '../support/identity-fixtures.ts';
import { browserOf, emailHarness, outboxRows } from '../support/invitation-fixtures.ts';
import { enrolledAccount, firstStep, signIn } from '../support/login-flows.ts';
import { deliverReset, NEW_PASSWORD, RESET } from '../support/password-reset-fixtures.ts';
import { InMemoryEmailSender } from '../../src/platform/email/in-memory-email-sender.ts';
import { deactivate, resetSecondStep } from '../support/user-access-fixtures.ts';
import { PurgeLoginSecurityJob } from '../../src/modules/identity/index.ts';
import { browserRow, deviceIdsOf, throttleRows, wrongPasswords } from '../support/throttle-flows.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { PanelClient } from '../support/panel-client.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const DAY = 24 * 3_600_000;
const db = () => current.database.admin;
const devices = async (userId: string) =>
  (
    await sql<{ id: string; user_id: string; token_sha256: Buffer; created_at: Date; last_seen_at: Date }>`
      select * from identity.browser_devices where user_id = ${userId} order by created_at, id`.execute(db())
  ).rows;
const mails = (userId: string, kind: string) => outboxRows(current, { recipient: userId, kind });
const setCookieOf = (response: { headers: Record<string, unknown> }, name: string): string | undefined =>
  ((response.headers['set-cookie'] as string[] | undefined) ?? []).find((value) => value.startsWith(`${name}=`));
const cookiePair = (panel: PanelClient): string => panel.deviceCookie ?? '';

describe('the cookie of a known browser (EVM-026 AC5; SR-AUTH-15, ASVS V3.3, CWE-614, CWE-1004)', () => {
  it('EVM-026 AC5 a full sign-in sets __Host-evia_device with the attributes of the contract; the database holds only the SHA-256, the account and two dates', async () => {
    const account = await enrolledAccount(current);
    const panel = current.panel();
    const response = await signIn(panel, account);
    expect(response.status).toBe(200);
    const header = setCookieOf(response, DEVICE_COOKIE_NAME);
    expect(header).toMatch(
      new RegExp(`^${DEVICE_COOKIE_NAME}=[A-Za-z0-9_-]{43}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000$`),
    );
    expect(header).not.toMatch(/Domain/i);
    const token = /=([A-Za-z0-9_-]{43});/.exec(header ?? '')?.[1] ?? '';
    const rows = await devices(account.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_sha256.equals(hashToken(token))).toBe(true);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['created_at', 'id', 'last_seen_at', 'token_sha256', 'user_id']);
    // the token itself is nowhere in the database, the audit trail or the log
    const everything = JSON.stringify([
      (await sql`select to_jsonb(t) as r from identity.browser_devices t`.execute(db())).rows,
      (await sql`select to_jsonb(t) as r from audit.events t`.execute(db())).rows,
    ]);
    expect(everything).not.toContain(token);
    expect(current.logs.text).not.toContain(token);
  });

  it('EVM-026 AC5 every full sign-in rotates the cookie: a new token, the same browser (identifier, first date), a new date of use; the old token is dead', async () => {
    const account = await enrolledAccount(current);
    const panel = current.panel();
    await signIn(panel, account);
    const [before] = await devices(account.user.id);
    const oldCookie = cookiePair(panel);
    current.clock.advance(61_000);
    const again = await signIn(panel, account);
    expect(again.status).toBe(200);
    const [after] = await devices(account.user.id);
    expect(await devices(account.user.id)).toHaveLength(1);
    expect(cookiePair(panel)).not.toBe(oldCookie);
    expect(after).toMatchObject({ id: before?.id, created_at: before?.created_at });
    expect(after?.last_seen_at.getTime()).toBeGreaterThan(before?.last_seen_at.getTime() ?? 0);
    expect(after?.token_sha256.equals(before?.token_sha256 ?? Buffer.alloc(0))).toBe(false);
    // the old cookie is an unknown browser now: it gets e-mail 7 again
    current.clock.advance(61_000);
    const stale = current.panel();
    stale.deviceCookie = oldCookie;
    await signIn(stale, account);
    expect(await mails(account.user.id, 'new_browser')).toHaveLength(2);
  });

  it('EVM-026 AC5 the cookie authenticates nobody and skips no step: on its own it is no session, and the first step with it still asks for the second', async () => {
    const account = await enrolledAccount(current);
    const known = current.panel();
    await signIn(known, account);
    const alone = current.panel();
    alone.deviceCookie = cookiePair(known);
    expect((await alone.get(PATHS.session)).status).toBe(401);
    current.clock.advance(61_000);
    const first = await firstStep(alone, account.email, account.password);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ state: 'second_step' });
    expect(setCookieOf(first, DEVICE_COOKIE_NAME)).toBeUndefined();
    expect(setCookieOf(first, '__Host-evia_session')).toBeUndefined();
  });

  it('EVM-026 AC5 the session of the enrolment (mfa_enrollment) is no full sign-in: no cookie of the browser, no register entry, no e-mail', async () => {
    const account = await enrolledAccount(current);
    await sql`delete from identity.passkeys where user_id = ${account.user.id}`.execute(db());
    await createSetupWindow(db(), current.clock, account.user.id);
    const response = await firstStep(current.panel(), account.email, account.password);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ state: 'mfa_enrollment' });
    expect(setCookieOf(response, DEVICE_COOKIE_NAME)).toBeUndefined();
    expect(await devices(account.user.id)).toEqual([]);
    expect(await mails(account.user.id, 'new_browser')).toEqual([]);
  });

  it('EVM-026 AC5 at most 20 browsers are kept per account: the oldest go first, with their counters', async () => {
    const account = await enrolledAccount(current);
    const first = current.panel();
    await signIn(first, account);
    const [oldest] = await devices(account.user.id);
    await wrongPasswords(current, account.email, 1, { panel: () => withCookie(first) });
    expect(await browserRow(current, oldest?.id ?? '')).toBeDefined();
    for (let index = 0; index < 20; index += 1) {
      current.clock.advance(61_000);
      expect((await signIn(current.panel(), account)).status).toBe(200);
    }
    const rows = await devices(account.user.id);
    expect(rows).toHaveLength(20);
    expect(rows.map((row) => row.id)).not.toContain(oldest?.id);
    expect(await browserRow(current, oldest?.id ?? '')).toBeUndefined();
  });
});

const withCookie = (source: PanelClient): PanelClient => {
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.deviceCookie = cookiePair(source);
  return panel;
};

describe('e-mail 7 and the alert 9 (EVM-026 AC5; SR-AUTH-15, SR-LOG-07)', () => {
  it('EVM-026 AC5 a sign-in without a cookie of the account is e-mail 7 to its owner, every time; with the cookie there is none', async () => {
    const account = await enrolledAccount(current, { role: 'editor' });
    const panel = current.panel();
    await signIn(panel, account);
    expect(await mails(account.user.id, 'new_browser')).toHaveLength(1);
    current.clock.advance(61_000);
    await signIn(panel, account); // the cookie of the browser came with the request
    expect(await mails(account.user.id, 'new_browser')).toHaveLength(1);
    current.clock.advance(61_000);
    await signIn(current.panel(), account); // another browser, no limit
    await signIn(current.panel(), account);
    expect(await mails(account.user.id, 'new_browser')).toHaveLength(3);
    // an Editor's sign-in is no alert for the Administrators
    expect(
      (await outboxRows(current, { kind: 'administrator_alert' })).filter((row) => row.variant === 'administrator_new_browser'),
    ).toEqual([]);
  });

  it('EVM-026 AC5 the new browser of an Administrator is an alert 9 for EVERY active Administrator — and for no one else', async () => {
    const account = await enrolledAccount(current, { role: 'administrator' });
    const other = await browserOf(current, { role: 'administrator' });
    const inactive = await browserOf(current, { role: 'administrator' });
    await sql`update identity.users set status = 'deactivated' where id = ${inactive.user.id}`.execute(db());
    const editor = await browserOf(current, { role: 'editor' });
    await signIn(current.panel(), account);
    const alerts = (await outboxRows(current, { kind: 'administrator_alert' })).filter(
      (row) => row.variant === 'administrator_new_browser',
    );
    expect(alerts.map((row) => row.recipient_user_id).sort()).toEqual([account.user.id, other.user.id].sort());
    expect(alerts.map((row) => row.recipient_user_id)).not.toContain(editor.user.id);
    // known browser: no further alert
    const panel = current.panel();
    current.clock.advance(61_000);
    await signIn(panel, account);
    const before = (await outboxRows(current, { kind: 'administrator_alert' })).length;
    current.clock.advance(61_000);
    await signIn(panel, account);
    expect((await outboxRows(current, { kind: 'administrator_alert' })).length).toBe(before);
  });

  it('EVM-026 AC5 the texts hold the time and the way back and nothing else: no address, no IP, no device, no token', async () => {
    const account = await enrolledAccount(current, { role: 'administrator' });
    await signIn(current.panel(), account);
    const sender = new InMemoryEmailSender();
    const harness = emailHarness(current, sender);
    const pending = (await outboxRows(current)).filter(
      (row) => row.state === 'pending' && ['new_browser', 'administrator_alert'].includes(row.kind),
    );
    await harness.job.run({ ids: pending.map((row) => row.id) });
    const texts = sender.sent.map((message) => message.text);
    expect(texts.length).toBeGreaterThanOrEqual(2);
    for (const text of texts) {
      expect(text).not.toMatch(/@evia\.invalid|\d+\.\d+\.\d+\.\d+|Mozilla|#[A-Za-z0-9_-]{20}|token/i);
    }
    const owner = sender.sent.find((message) => message.subject.startsWith('EVia Manager: logowanie z nowej przeglądarki'));
    expect(owner?.text).toContain(`${PANEL_ORIGIN}/login/reset`);
    expect(owner?.text).not.toContain('#');
    const alert = sender.sent.find((message) => message.subject.includes('alert bezpieczeństwa'));
    expect(alert?.text).toContain('z przeglądarki, której to konto wcześniej nie używało');
  });
});

describe('the register is cleared (EVM-026 AC5, M6; RODO art. 5(1)(e))', () => {
  async function accountWithCounter() {
    const account = await enrolledAccount(current, { role: 'editor' });
    const panel = current.panel();
    await signIn(panel, account);
    await wrongPasswords(current, account.email, 2, { panel: () => withCookie(panel) });
    const ids = await deviceIdsOf(current, account.user.id);
    expect(ids).toHaveLength(1);
    expect(await browserRow(current, ids[0] ?? '')).toMatchObject({ failures: 2 });
    return account;
  }

  it('EVM-026 AC5 the deactivation of the account forgets its browsers and their counters', async () => {
    const account = await accountWithCounter();
    const admin = await browserOf(current, { role: 'administrator' });
    expect((await deactivate(current, admin, account.user.id)).status).toBe(200);
    expect(await devices(account.user.id)).toEqual([]);
    expect((await throttleRows(current)).filter((row) => row.scope === 'browser')).toEqual([]);
  });

  it('EVM-026 AC5 the reset of the second step by an Administrator forgets its browsers and their counters', async () => {
    const account = await accountWithCounter();
    const admin = await browserOf(current, { role: 'administrator' });
    expect((await resetSecondStep(current, admin, account.user.id)).status).toBe(200);
    expect(await devices(account.user.id)).toEqual([]);
    expect((await throttleRows(current)).filter((row) => row.scope === 'browser')).toEqual([]);
  });

  it('EVM-026 AC5 the reset of the password forgets its browsers and their counters', async () => {
    const account = await accountWithCounter();
    const delivered = await deliverReset(current, account);
    const done = await current.panel().post(RESET.complete, { token: delivered.token, password: NEW_PASSWORD });
    expect(done.status).toBe(200);
    expect(await devices(account.user.id)).toEqual([]);
    expect((await throttleRows(current)).filter((row) => row.scope === 'browser')).toEqual([]);
  });

  it('EVM-026 M6 the job of retention deletes a browser 30 days after its last use (with its counter) and a counter 30 minutes after its window — rows nobody touches again', async () => {
    const account = await accountWithCounter();
    const idle = await enrolledAccount(current, { role: 'editor' });
    await wrongPasswords(current, idle.email, 1);
    const job = current.app.get(PurgeLoginSecurityJob, { strict: false });
    expect(await job.run()).toEqual({ throttles: 0, browsers: 0, loginAttempts: 0 });
    current.clock.advance(50 * 60_000); // 15 minutes of the window and 30 of retention are over
    const firstSteps = Number((await sql<{ n: string }>`select count(*)::text as n from identity.login_attempts`.execute(db())).rows[0]?.n);
    expect(firstSteps).toBeGreaterThan(0);
    // the idle address, the address of the account, the counter of its browser and the one shared counter of the alert about a flood of failed passwords
    expect(await job.run()).toEqual({ throttles: 4, browsers: 0, loginAttempts: firstSteps });
    expect(await throttleRows(current)).toEqual([]);
    current.clock.advance(28 * DAY);
    expect((await job.run()).browsers).toBe(0); // used 28 days and almost an hour ago
    current.clock.advance(2 * DAY);
    expect(await job.run()).toMatchObject({ browsers: 1 });
    expect(await devices(account.user.id)).toEqual([]);
  });

  it('EVM-026 M6 the job of retention deletes a first step 30 minutes after it expired — the HMAC of the address (throttle_key) does not outlive the counters', async () => {
    const account = await enrolledAccount(current);
    expect((await firstStep(current.panel(), account.email, account.password)).status).toBe(200);
    const attempts = async () =>
      Number((await sql<{ n: string }>`select count(*)::text as n from identity.login_attempts`.execute(db())).rows[0]?.n);
    const job = current.app.get(PurgeLoginSecurityJob, { strict: false });
    current.clock.advance(20 * 60_000); // expired 15 minutes ago (five minutes of life)
    expect(await job.run()).toMatchObject({ loginAttempts: 0 });
    expect(await attempts()).toBe(1);
    current.clock.advance(16 * 60_000); // expired 31 minutes ago
    expect(await job.run()).toMatchObject({ loginAttempts: 1 });
    expect(await attempts()).toBe(0);
  });
});
