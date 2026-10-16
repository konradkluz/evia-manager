import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashToken, newToken } from '../../src/modules/identity/domain/tokens.ts';
import { EmailTransientError } from '../../src/platform/email/email-errors.ts';
import { InMemoryEmailSender } from '../../src/platform/email/in-memory-email-sender.ts';
import { EVENT_BUS } from '../../src/platform/tokens.ts';
import type { EventBus } from '../../src/platform/events/event-bus.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { PATHS } from '../support/flows.ts';
import { createLink, createUser } from '../support/identity-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { auditActions, emailHarness, everythingAsText, linksOf, outboxRows } from '../support/invitation-fixtures.ts';
import { enrolledAccount, firstStep, loginOptions, secondStep, signIn, type EnrolledAccount } from '../support/login-flows.ts';
import { deliverReset, NEW_PASSWORD, requestReset, RESET } from '../support/password-reset-fixtures.ts';
import { VirtualAuthenticator } from '../support/virtual-authenticator.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const MINUTE = 60_000;
const EMAIL = 'ewa.aktywna@example.com';
const complete = (token: string, password: string = NEW_PASSWORD) => current.panel().post(RESET.complete, { token, password });
const check = (token: string) => current.panel().post(RESET.check, { token });
const sessionsOf = async (userId: string) =>
  (
    await sql<{ id: string; revoked_at: Date | null; revoke_reason: string | null }>`
      select id, revoked_at, revoke_reason from identity.sessions where user_id = ${userId} order by created_at, id`.execute(
      current.database.admin,
    )
  ).rows;
const countOf = async (table: 'sessions' | 'login_attempts'): Promise<number> => {
  const { rows } =
    table === 'sessions'
      ? await sql<{ n: string }>`select count(*)::text as n from identity.sessions`.execute(current.database.admin)
      : await sql<{ n: string }>`select count(*)::text as n from identity.login_attempts`.execute(current.database.admin);
  return Number(rows[0]?.n);
};

/** An active account with a password and a key, and a link as the worker sends it. */
async function accountWithLink(email: string = EMAIL): Promise<{ account: EnrolledAccount; token: string }> {
  const account = await enrolledAccount(current, { role: 'editor', email });
  const { token } = await deliverReset(current, account);
  return { account, token };
}

describe('the token of the link (EVM-025 AC2; SR-AUTH-11, SR-API-04, SR-LOG-02, SR-CRYPTO-03)', () => {
  it('EVM-025 AC2 a link sent 2026-10-05 10:00 Warsaw works until 10:30 and is one and the same refusal from 10:30 on, at 10:31 and after use', async () => {
    const account = await enrolledAccount(current, { role: 'editor', email: EMAIL });
    current.clock.set('2026-10-05T08:00:00.000Z'); // 10:00 Warsaw (CEST)
    const { token } = await deliverReset(current, account);

    current.clock.set('2026-10-05T08:29:59.000Z');
    expect((await check(token)).status).toBe(200);
    for (const at of ['2026-10-05T08:30:00.000Z', '2026-10-05T08:31:00.000Z']) {
      current.clock.set(at);
      const late = await check(token);
      expect(late.status).toBe(400);
      expect(late.body).toMatchObject({ code: 'password_reset_link_invalid' });
      expect((await complete(token)).body).toMatchObject({ code: 'password_reset_link_invalid' });
    }
  });

  it('EVM-025 AC2 a link works once: after the new password is set the same link is the refusal in the check and in the completion', async () => {
    const { token } = await accountWithLink();
    expect((await complete(token)).status).toBe(200);
    for (const answer of [await check(token), await complete(token)]) {
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({ code: 'password_reset_link_invalid' });
    }
  });

  it('EVM-025 AC2 a newer link ends the older one: only the newest of two works', async () => {
    const account = await enrolledAccount(current, { role: 'editor', email: EMAIL });
    const first = await deliverReset(current, account);
    current.clock.advance(MINUTE + 1000);
    const second = await deliverReset(current, account, first.harness);
    expect(second.token).not.toBe(first.token);
    expect((await check(first.token)).body).toMatchObject({ code: 'password_reset_link_invalid' });
    expect((await complete(first.token)).body).toMatchObject({ code: 'password_reset_link_invalid' });
    expect((await check(second.token)).status).toBe(200);
    const links = (await linksOf(current, account.user.id)).filter((link) => link.issued_by === 'password_reset');
    expect(links.map((link) => link.superseded_at !== null)).toEqual([true, false]);
  });

  it('EVM-025 AC2 the check does not spend the link: two checks (a scanner of the mail client), then the completion works', async () => {
    const { account, token } = await accountWithLink();
    const before = JSON.stringify(await linksOf(current, account.user.id));
    for (let time = 0; time < 2; time += 1) {
      const answer = await check(token);
      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ email: EMAIL });
    }
    expect(JSON.stringify(await linksOf(current, account.user.id))).toBe(before);
    expect((await complete(token)).status).toBe(200);
  });

  it('EVM-025 AC2 the token has 256 bits and only its SHA-256 is stored; it is in no table, no job, no log and no event', async () => {
    const { account, token } = await accountWithLink();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const [link] = (await linksOf(current, account.user.id)).filter((candidate) => candidate.issued_by === 'password_reset');
    expect(link?.token_hash.equals(hashToken(token))).toBe(true);
    expect((await check(token)).status).toBe(200);
    expect((await complete(token)).status).toBe(200);

    const { rows: jobs } = await sql<{ row: string }>`select to_jsonb(j)::text as row from pgboss.job j`.execute(current.database.admin);
    expect(await everythingAsText(current)).not.toContain(token);
    expect(jobs.map((job) => job.row).join('')).not.toContain(token);
    expect(JSON.stringify(current.logs.entries)).not.toContain(token);
    expect(current.logs.text).not.toContain(NEW_PASSWORD);
  });

  it('EVM-025 AC2 the token never opens a route through the address: a GET with it, or any method but POST, is no way in', async () => {
    const { token } = await accountWithLink();
    for (const path of Object.values(RESET)) {
      for (const method of ['get', 'put', 'patch', 'delete'] as const) {
        const response = await request(current.app.getHttpServer())[method](`${path}?token=${token}`).set('Origin', PANEL_ORIGIN);
        expect(response.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
      }
    }
    expect(JSON.stringify(current.logs.entries)).not.toContain(token);
    expect((await check(token)).status).toBe(200);
  });

  it('EVM-025 AC2 used, changed, superseded, expired, unknown, another purpose, an account that is not active: one answer and no change in the database', async () => {
    const { token: live } = await accountWithLink();
    const used = await deliverReset(current, await enrolledAccount(current, { role: 'editor', email: 'uzyty@example.com' }));
    expect((await complete(used.token)).status).toBe(200);
    const changed = `${live.slice(0, 42)}${live.endsWith('A') ? 'B' : 'A'}`;
    const lapsed = await enrolledAccount(current, { role: 'editor', email: 'wygasly@example.com' });
    const expired = await deliverReset(current, lapsed);
    const off = await accountWithLink('wylaczony@example.com');
    await sql`update identity.users set status = 'deactivated' where id = ${off.account.user.id}`.execute(current.database.admin);
    const gone = await accountWithLink('usuniety@example.com');
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${gone.account.user.id}`.execute(
      current.database.admin,
    );
    const pending = await current.pendingAdministrator({ email: 'zaproszony@example.com' });
    current.clock.advance(31 * MINUTE);
    const before = await current.snapshot();

    const answers: string[] = [];
    for (const [label, token] of [
      ['used', used.token],
      ['changed', changed],
      ['expired', expired.token],
      ['unknown', newToken()],
      ['an activation link', pending.link.token],
      ['live link but expired', live],
      ['account deactivated', off.token],
      ['account deleted', gone.token],
    ] as const) {
      const answer = await check(token);
      expect(answer.status, label).toBe(400);
      answers.push(JSON.stringify({ ...(answer.body as object), traceId: '' }));
    }
    expect(new Set(answers).size).toBe(1);
    expect(JSON.parse(answers[0] ?? '{}')).toMatchObject({ code: 'password_reset_link_invalid', status: 400 });
    expect(answers[0]).not.toMatch(/@|account|invited|active/i);
    expect(await current.snapshot()).toBe(before);
  });

  it('EVM-025 AC2 a link of one purpose never opens the route of the other: the activation link on the reset routes, the reset link on the activation route', async () => {
    const { token } = await accountWithLink();
    const pending = await current.pendingAdministrator({ email: 'zaproszony@example.com' });
    expect((await check(pending.link.token)).body).toMatchObject({ code: 'password_reset_link_invalid' });
    expect((await complete(pending.link.token)).body).toMatchObject({ code: 'password_reset_link_invalid' });
    const onActivation = await current.panel().post(PATHS.check, { token });
    expect(onActivation.status).toBe(400);
    expect(onActivation.body).toMatchObject({ code: 'activation_link_invalid' });
    // and the activation link is untouched by the reset
    expect((await current.panel().post(PATHS.check, { token: pending.link.token })).status).toBe(200);
  });

  it('EVM-025 AC2 the link of one account never works for another: the password of the other account stays', async () => {
    const x = await accountWithLink('xavier@example.com');
    const y = await enrolledAccount(current, { role: 'editor', email: 'yvonne@example.com' });
    expect((await complete(x.token)).status).toBe(200);
    expect((await firstStep(current.panel(), y.email, y.password)).status).toBe(200);
    expect((await firstStep(current.panel(), y.email, NEW_PASSWORD)).status).toBe(401);
    expect((await sessionsOf(y.user.id)).every((session) => session.revoked_at === null || session.revoke_reason === 'rotated')).toBe(true);
  });
});

describe('the new password (EVM-025 AC3; SR-AUTH-01, SR-AUTH-02)', () => {
  it('EVM-025 AC3 the rules of the activation apply: too short, a popular password and one made of the account data are refused with a code and no value', async () => {
    const { token } = await accountWithLink();
    for (const [password, code] of [
      ['short one 12', 'too_short'],
      ['password password', 'too_weak'],
      ['ewa.aktywna lantern copper', 'too_weak'],
    ] as const) {
      const answer = await complete(token, password);
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/password', code }] });
      expect(JSON.stringify(answer.body)).not.toContain(password);
    }
    expect((await check(token)).status).toBe(200); // a refused password does not spend the link
  });

  it('EVM-025 AC3 a password from a breach is refused (Pwned Passwords, k-anonymity); when the service is out the local rules stand and the reset goes on', async () => {
    const { token } = await accountWithLink();
    current.breaches.result = 'breached';
    const refused = await complete(token);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ errors: [{ pointer: '/password', code: 'too_weak' }] });
    current.breaches.result = 'unavailable';
    expect((await complete(token)).status).toBe(200);
    const warnings = current.logs.entries.filter((entry) => String(entry['msg']).includes('pwned passwords unavailable'));
    expect(warnings.length).toBeGreaterThan(0);
    expect(current.logs.text).not.toContain(NEW_PASSWORD);
  });

  it('EVM-025 AC3 an invalid link costs nothing: no call to Pwned Passwords and no password work happens before the link is known to be good', async () => {
    await accountWithLink();
    current.breaches.checked.length = 0;
    const answer = await complete(newToken());
    expect(answer.status).toBe(400);
    expect(current.breaches.checked).toEqual([]);
  });

  it('EVM-025 AC3 the contract has no helper questions or hints: an extra field is refused, and a password over the length limit is a 400 before any work', async () => {
    const { token } = await accountWithLink();
    current.breaches.checked.length = 0;
    for (const extra of [{ hint: 'my dog' }, { question: 'a?' }, { role: 'administrator' }, { userId: '0' }]) {
      expect((await current.panel().post(RESET.complete, { token, password: NEW_PASSWORD, ...extra })).status).toBe(400);
    }
    expect((await complete(token, 'x'.repeat(257))).status).toBe(400);
    expect(current.breaches.checked).toEqual([]);
  });

  it('EVM-025 AC3 the password is kept in its NFC form: typed with a decomposed letter it verifies when typed composed', async () => {
    const { account, token } = await accountWithLink();
    const decomposed = 'café lantern copper river seven';
    expect((await complete(token, decomposed)).status).toBe(200);
    expect((await firstStep(current.panel(), account.email, 'café lantern copper river seven')).status).toBe(200);
  });
});

describe('the reset does not skip the second step (EVM-025 AC4; SR-AUTH-11, SR-AUTH-14; K1, K2)', () => {
  it('EVM-025 AC4 the completion creates no session and sets no cookie; it answers with the first step of a sign-in — the session exists only after the key', async () => {
    const { account, token } = await accountWithLink();
    const sessionsBefore = (await sessionsOf(account.user.id)).length;
    const attemptsBefore = await countOf('login_attempts');
    const answer = await complete(token);
    expect(answer.status).toBe(200);
    expect(answer.headers['set-cookie']).toBeUndefined();
    expect(answer.body).toMatchObject({ state: 'second_step', methods: ['passkey'] });
    const loginToken = (answer.body as { loginToken: string }).loginToken;
    expect(loginToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await sessionsOf(account.user.id)).length).toBe(sessionsBefore);
    expect(await countOf('login_attempts')).toBe(attemptsBefore + 1);

    const browser = current.panel();
    expect((await browser.get(PATHS.session)).status).toBe(401);
    const { response, options } = await loginOptions(browser, loginToken);
    expect(response.status).toBe(200);
    const finished = await secondStep(browser, loginToken, account.authenticator, options);
    expect(finished.status).toBe(200);
    expect(finished.headers['set-cookie']).toBeDefined();
    expect((await sessionsOf(account.user.id)).length).toBe(sessionsBefore + 1);
  });

  it('EVM-025 AC4 K2 a loginToken made before the reset is dead after it, the one the reset hands out works only for the key', async () => {
    const { account, token } = await accountWithLink();
    const old = await firstStep(current.panel(), account.email, account.password);
    const oldToken = (old.body as { loginToken: string }).loginToken;
    const answer = await complete(token);
    const newLogin = (answer.body as { loginToken: string }).loginToken;

    const stale = await loginOptions(current.panel(), oldToken);
    expect(stale.response.status).toBe(401);
    const fresh = await loginOptions(current.panel(), newLogin);
    expect(fresh.response.status).toBe(200);
    // the new token alone gives nothing: a wrong key is refused and no session starts
    const stranger = new VirtualAuthenticator();
    const refused = await secondStep(current.panel(), newLogin, stranger, fresh.options);
    expect(refused.status).toBe(401);
    expect(refused.headers['set-cookie']).toBeUndefined();
  });

  it('EVM-025 AC4 K1 an account without a passkey gets no mail, no session and no loginToken; a link it somehow holds is the same refusal and nothing changes', async () => {
    const user = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'active',
      email: 'bez.klucza@example.com',
    });
    expect((await requestReset(current.panel(), user.email)).status).toBe(202);
    expect(await outboxRows(current, { recipient: user.id, kind: 'password_reset' })).toEqual([]);

    const link = await createLink(current.database.admin, current.clock, user.id);
    await sql`update identity.one_time_links set purpose = 'password_reset', issued_by = 'password_reset' where id = ${link.id}`.execute(
      current.database.admin,
    );
    const before = await current.snapshot();
    const sessions = await countOf('sessions');
    const attempts = await countOf('login_attempts');
    const answer = await complete(link.token);
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ code: 'password_reset_link_invalid' });
    expect(answer.headers['set-cookie']).toBeUndefined();
    expect(await countOf('sessions')).toBe(sessions);
    expect(await countOf('login_attempts')).toBe(attempts);
    expect(await current.snapshot()).toBe(before);
  });

  it('EVM-025 AC4 K1 an account that lost its key after the request gets no link: the worker finds the message obsolete and sends nothing', async () => {
    const account = await enrolledAccount(current, { role: 'editor', email: EMAIL });
    expect((await requestReset(current.panel(), EMAIL)).status).toBe(202);
    await sql`delete from identity.passkeys where user_id = ${account.user.id}`.execute(current.database.admin);
    const harness = emailHarness(current);
    const rows = await outboxRows(current, { recipient: account.user.id, kind: 'password_reset' });
    await harness.job.run({ ids: rows.map((row) => row.id) });
    expect(harness.sender.sent).toEqual([]);
    expect((await outboxRows(current, { recipient: account.user.id, kind: 'password_reset' })).map((row) => row.state)).toEqual([
      'superseded',
    ]);
    expect((await linksOf(current, account.user.id)).filter((link) => link.issued_by === 'password_reset')).toEqual([]);
  });

  it('EVM-025 AC4 L2 a message that waited longer than the validity of a link (the worker was down) is obsolete: no link is sent long after the request', async () => {
    const account = await enrolledAccount(current, { role: 'editor', email: EMAIL });
    await requestReset(current.panel(), EMAIL);
    current.clock.advance(31 * MINUTE);
    const harness = emailHarness(current);
    const rows = await outboxRows(current, { recipient: account.user.id, kind: 'password_reset' });
    await harness.job.run({ ids: rows.map((row) => row.id) });
    expect(harness.sender.sent).toEqual([]);
  });
});

describe('the effects of the reset (EVM-025 AC5; SR-AUTH-15, SR-SESS, SR-LOG-03; K10, K11)', () => {
  it('EVM-025 AC5 two active sessions of the user both end; the next request of each is 401 session_revoked; the old password no longer works and the new one does', async () => {
    const { account, token } = await accountWithLink();
    const other = current.panel();
    expect((await signIn(other, account)).status).toBe(200);
    expect((await account.panel.get(PATHS.session)).status).toBe(200);
    expect((await other.get(PATHS.session)).status).toBe(200);

    expect((await complete(token)).status).toBe(200);
    for (const browser of [account.panel, other]) {
      const next = await browser.get(PATHS.session);
      expect(next.status).toBe(401);
      expect(next.body).toMatchObject({ code: 'session_revoked' });
    }
    const sessions = await sessionsOf(account.user.id);
    expect(sessions.filter((session) => session.revoke_reason === 'password_reset')).toHaveLength(2);
    expect((await firstStep(current.panel(), account.email, account.password)).status).toBe(401);
    expect((await firstStep(current.panel(), account.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('EVM-025 AC5 the notice "Hasło zostało zmienione" is in the outbox from the same transaction and the worker sends it: no token, no data of a customer, a link to the reset form', async () => {
    const { account, token } = await accountWithLink();
    expect((await complete(token)).status).toBe(200);
    const rows = await outboxRows(current, { recipient: account.user.id, kind: 'password_changed' });
    expect(rows.map((row) => row.state)).toEqual(['pending']);
    const harness = emailHarness(current);
    await harness.job.run({ ids: rows.map((row) => row.id) });
    const sent = harness.sender.sent.at(-1);
    expect(String(sent?.to)).toBe(EMAIL);
    expect(sent?.subject).toBe('EVia Manager: hasło zostało zmienione');
    expect(sent?.text).toContain('Zakończyliśmy wszystkie sesje konta.');
    expect(sent?.text).toContain('https://panel.evia.test/login/reset');
    expect(sent?.text).not.toContain(token);
    expect(sent?.text).not.toContain('#');
  });

  it('EVM-025 AC5 a failure anywhere in the unit of work rolls everything back: the password, the link, the sessions and the notice stay as they were', async () => {
    const { account, token } = await accountWithLink();
    const bus = current.app.get<EventBus>(EVENT_BUS, { strict: false });
    bus.subscribe('password.reset', () => Promise.reject(new Error('boom')));
    const before = await current.snapshot();
    const outboxBefore = (await outboxRows(current, { recipient: account.user.id })).length;
    const answer = await complete(token);
    expect(answer.status).toBe(500);
    expect(await current.snapshot()).toBe(before);
    expect((await outboxRows(current, { recipient: account.user.id })).length).toBe(outboxBefore);
    expect((await account.panel.get(PATHS.session)).status).toBe(200);
    expect((await firstStep(current.panel(), account.email, account.password)).status).toBe(200);
  });

  it('EVM-025 AC5 the audit trail says who reset what and ended which sessions — without the address, the name or the token', async () => {
    const { account, token } = await accountWithLink();
    expect((await complete(token)).status).toBe(200);
    const events = await auditActions(current);
    const reset = events.filter((event) => event.action === 'password.reset');
    expect(reset).toEqual([
      {
        action: 'password.reset',
        actor_type: 'user',
        actor_user_id: account.user.id,
        object_id: account.user.id,
        outcome: 'success',
        reason_code: null,
      },
    ]);
    const revoked = events.filter((event) => event.action === 'session.revoked' && event.reason_code === 'password_reset');
    expect(revoked).toHaveLength(
      (await sessionsOf(account.user.id)).filter((session) => session.revoke_reason === 'password_reset').length,
    );
    expect(events.some((event) => event.action === 'password_reset_link.issued' && event.actor_type === 'system')).toBe(true);
    const { rows } = await sql<{ row: string }>`select to_jsonb(t)::text as row from audit.events t`.execute(current.database.admin);
    const stored = rows.map((row) => row.row).join('');
    expect(stored).not.toContain(token);
    expect(stored).not.toMatch(/ewa\.aktywna|Użytkownik/);
  });

  it('EVM-025 AC5 the other open links of the account end with the reset, and the reset of the Administrator, the Editor and the read-only user is the same', async () => {
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const account = await enrolledAccount(current, { role, email: `${role.replace('_', '-')}@example.com` });
      const first = await deliverReset(current, account);
      current.clock.advance(MINUTE + 1000);
      const second = await deliverReset(current, account, first.harness);
      expect((await complete(second.token)).status, role).toBe(200);
      expect((await check(first.token)).status).toBe(400);
      expect((await firstStep(current.panel(), account.email, NEW_PASSWORD)).status).toBe(200);
    }
  });
});

describe('the transport and the retries (EVM-025 AC2; K5; EVM-024 fail-closed)', () => {
  it('EVM-025 AC2 K5 a failed attempt of the mail service leaves no raw token anywhere; the retry makes a newer link and ends the one of the failed attempt', async () => {
    const account = await enrolledAccount(current, { role: 'editor', email: EMAIL });
    const sender = new InMemoryEmailSender();
    const harness = emailHarness(current, sender);
    expect((await requestReset(current.panel(), EMAIL)).status).toBe(202);
    const rows = await outboxRows(current, { recipient: account.user.id, kind: 'password_reset' });

    sender.failNext(new EmailTransientError('timeout'));
    await expect(harness.job.run({ ids: rows.map((row) => row.id) })).rejects.toBeDefined();
    const { rows: jobs } = await sql<{ row: string }>`select to_jsonb(j)::text as row from pgboss.job j`.execute(current.database.admin);
    expect(jobs.map((job) => job.row).join('')).not.toContain('reset-password');
    expect(await everythingAsText(current)).not.toContain('reset-password');
    expect(JSON.stringify(current.logs.entries)).not.toContain('reset-password');

    await harness.job.run({ ids: rows.map((row) => row.id) });
    const text = sender.sent.at(-1)?.text ?? '';
    const token = /#([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? '';
    expect((await check(token)).status).toBe(200);
    const links = (await linksOf(current, account.user.id)).filter((link) => link.issued_by === 'password_reset');
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.superseded_at !== null)).toEqual([true, false]);
  });
});
