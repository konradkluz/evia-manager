import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountKey } from '../../src/modules/identity/domain/throttle-keys.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { APP_CONFIG } from '../../src/platform/tokens.ts';
import {
  ACCOUNT,
  NEW_PASSWORD,
  auditOf,
  outboxOf,
  reauthWithCode,
  reauthWithKey,
  signedInWithCode,
  signedInWithKey,
} from '../support/account-flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { firstStep, LOGIN, signIn } from '../support/login-flows.ts';
import { emailHarness } from '../support/invitation-fixtures.ts';
import { codeNow, everythingWritten, nextStep } from '../support/totp-flows.ts';
import { accountRow, deviceIdsOf, WRONG } from '../support/throttle-flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const throttleKey = (email: string): Buffer =>
  accountKey(current.app.get<AppConfig>(APP_CONFIG, { strict: false }).loginThrottleKey, email);

/** Two sessions of the account: the signed-in browser and a second one (a second sign-in with the key). */
async function twoSessions() {
  const admin = await signedInWithKey(current);
  const second = current.panel();
  nextStep(current);
  expect((await signIn(second, admin)).status).toBe(200);
  nextStep(current);
  return { admin, second };
}

describe('the change of the password (EVM-028 AC2; SR-AUTH-03, SR-AUTH-10, SR-AUTH-01, SR-AUTH-02)', () => {
  it('EVM-028 AC2 a user with two sessions changes the password: the current one, the rules of the new one, the second step; an e-mail, an audit event, the other sessions go on until the owner ends them', async () => {
    const { admin, second } = await twoSessions();
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'password_change')).status).toBe(204);
    const response = await admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ otherActiveSessions: 1 });
    expect(response.headers['cache-control']).toBe('no-store');

    expect(await outboxOf(current, admin.user.id, 'password_changed')).toEqual([{ kind: 'password_changed', variant: 'from_account' }]);
    expect((await auditOf(current, 'password.changed')).at(-1)).toMatchObject({
      outcome: 'success',
      actor_user_id: admin.user.id,
      object_id: admin.user.id,
    });
    expect((await second.get(ACCOUNT.account)).status).toBe(200); // the other session was not ended by the change
    expect((await admin.panel.get(ACCOUNT.account)).status).toBe(200);

    // the old password no longer signs in; the new one does
    const fresh = current.panel();
    expect((await firstStep(fresh, admin.email, admin.password)).status).toBe(401);
    nextStep(current);
    expect((await firstStep(fresh, admin.email, NEW_PASSWORD)).status).toBe(200);

    // and the panel offers "Zakończ pozostałe sesje": it ends the other session
    const ended = await admin.panel.delete(ACCOUNT.sessions);
    expect(ended.status).toBe(200);
    expect(ended.body).toEqual({ ended: 1 });
    expect((await second.get(ACCOUNT.account)).body).toMatchObject({ code: 'session_revoked' });
  });

  it('EVM-028 AC2 e-mail 4 of a change in the account says where to end the other sessions, and names no IP, no browser and no doer', async () => {
    const { admin } = await twoSessions();
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'password_change')).status).toBe(204);
    expect((await admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword: NEW_PASSWORD })).status).toBe(200);
    const harness = emailHarness(current);
    const { rows } = await sql<{ id: string }>`
      select id from platform.email_outbox where recipient_user_id = ${admin.user.id} and kind = 'password_changed'`.execute(
      current.database.admin,
    );
    await harness.job.run({ ids: rows.map((row) => row.id) });
    expect(harness.sender.sent).toHaveLength(1);
    const sent = harness.sender.sent[0];
    expect(sent?.to).toBe(admin.email);
    expect(sent?.subject).toBe('EVia Manager: hasło zostało zmienione');
    expect(sent?.text).toContain('Konto → Moje sesje');
    expect(sent?.text).toContain('/account#moje-sesje');
    expect(sent?.text).not.toContain('Zakończyliśmy wszystkie sesje konta.');
    expect(sent?.text).not.toMatch(/\d+\.\d+\.\d+\.\d+|Mozilla|synthetic/);
  });

  it('EVM-028 AC2 a wrong current password is 401 invalid_credentials: it is counted against the lock and audited, the password is not changed and the mark is untouched', async () => {
    const admin = await signedInWithKey(current);
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'password_change')).status).toBe(204);
    const response = await admin.panel.post(ACCOUNT.password, { currentPassword: WRONG, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'invalid_credentials' });
    expect((await auditOf(current, 'password.changed')).at(-1)).toMatchObject({ outcome: 'failed', reason_code: 'bad_password' });
    expect((await auditOf(current, 'login.failed')).at(-1)).toMatchObject({ reason_code: 'bad_password' });
    const device = (await deviceIdsOf(current, admin.user.id))[0] ?? '';
    const { rows } = await sql<{ failures: number }>`select failures from identity.login_throttle where scope = 'browser'`.execute(
      current.database.admin,
    );
    expect(device).not.toBe('');
    expect(rows[0]?.failures).toBe(1);
    // the same mark still works with the right current password
    const ok = await admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('EVM-028 AC2 K2 ten wrong current passwords lock the scope and end the session (429 + Retry-After); a lock that holds verifies nothing', async () => {
    const admin = await signedInWithKey(current);
    for (let attempt = 1; attempt < 10; attempt += 1) {
      expect((await admin.panel.post(ACCOUNT.password, { currentPassword: WRONG, newPassword: NEW_PASSWORD })).status).toBe(401);
      current.clock.advance(3000);
    }
    const tenth = await admin.panel.post(ACCOUNT.password, { currentPassword: WRONG, newPassword: NEW_PASSWORD });
    expect(tenth.status).toBe(429);
    expect(Number(tenth.headers['retry-after'])).toBeGreaterThan(0);
    expect((await admin.panel.get(ACCOUNT.account)).body).toMatchObject({ code: 'session_revoked' });
  });

  it('EVM-028 AC2 the rules of SR-AUTH-01 and SR-AUTH-02 apply to the new password and are shown BEFORE the second step: too short, a popular password, a breached one, the e-mail address, the same as the current one', async () => {
    const admin = await signedInWithKey(current);
    const ask = (newPassword: string) => admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword });
    const short = await ask('Krotkie-1');
    expect(short.status).toBe(400);
    expect(short.body).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/newPassword', code: 'too_short' }] });
    const popular = await ask('1234567890123456');
    expect(popular.status).toBe(400);
    const contextual = await ask(`${admin.email}-x1`);
    expect(contextual.status).toBe(400);
    expect(contextual.body).toMatchObject({ errors: [{ pointer: '/newPassword' }] });
    const same = await ask(admin.password);
    expect(same.status).toBe(400);
    expect(same.body).toMatchObject({ errors: [{ pointer: '/newPassword', code: 'same_as_current' }] });
    current.breaches.result = 'breached';
    const breached = await ask(NEW_PASSWORD);
    expect(breached.status).toBe(400);
    expect(breached.body).toMatchObject({ errors: [{ pointer: '/newPassword', code: 'too_weak' }] });
    // no refusal above asked for a mark, and none spent one
    expect(await outboxOf(current, admin.user.id, 'password_changed')).toEqual([]);
  });

  it('EVM-028 AC2 without the mark of the second step the change is 403 reauthentication_required — after the new password passed — and nothing changes', async () => {
    const admin = await signedInWithKey(current);
    const before = await db()
      .selectFrom('identity.password_credentials')
      .select('password_hash')
      .where('user_id', '=', admin.user.id)
      .executeTakeFirstOrThrow();
    const response = await admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'reauthentication_required' });
    const after = await db()
      .selectFrom('identity.password_credentials')
      .select('password_hash')
      .where('user_id', '=', admin.user.id)
      .executeTakeFirstOrThrow();
    expect(after.password_hash).toBe(before.password_hash);
    expect(await outboxOf(current, admin.user.id, 'password_changed')).toEqual([]);
  });

  it('EVM-028 AC2 an Editor confirms with the code of the app (the second step alone); the password is never in the trail, the outbox or the logs', async () => {
    const editor = await signedInWithCode(current);
    nextStep(current);
    expect((await reauthWithCode(editor.session, 'password_change', codeNow(current, editor.secret))).status).toBe(204);
    const response = await editor.session.post(ACCOUNT.password, { currentPassword: editor.password, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ otherActiveSessions: 1 }); // the session of the setup is still open
    const written = await everythingWritten(current);
    for (const secret of [editor.password, NEW_PASSWORD]) {
      expect(written).not.toContain(secret);
      expect(current.logs.text).not.toContain(secret);
    }
  });

  it('EVM-028 AC2 a change of the password removes the pending links of a reset and the pending first steps of the sign-in', async () => {
    const admin = await signedInWithKey(current);
    const other = current.panel();
    const step1 = await firstStep(other, admin.email, admin.password);
    expect(step1.status).toBe(200);
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'password_change')).status).toBe(204);
    expect((await admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword: NEW_PASSWORD })).status).toBe(200);
    const open = await db().selectFrom('identity.login_attempts').select('used_at').where('user_id', '=', admin.user.id).execute();
    expect(open.every((attempt) => attempt.used_at !== null)).toBe(true);
    const token = (step1.body as { loginToken: string }).loginToken;
    const options = await other.post(LOGIN.options, { loginToken: token });
    expect(options.status).toBe(401);
  });
});

describe('the change of the password keeps the rules of the protection against guessing (EVM-028 K9; EVM-026 AC5, AC7)', () => {
  it('EVM-026 AC5 the register of the browsers of the account is forgotten with their counters (as after a reset): the next sign-in is from a browser the account does not know', async () => {
    const admin = await signedInWithKey(current);
    expect(await deviceIdsOf(current, admin.user.id)).toHaveLength(1);
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'password_change')).status).toBe(204);
    expect((await admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword: NEW_PASSWORD })).status).toBe(200);
    expect(await deviceIdsOf(current, admin.user.id)).toEqual([]);
    const { rows } = await sql`select 1 from identity.login_throttle where scope = 'browser'`.execute(current.database.admin);
    expect(rows).toEqual([]);
  });

  /** The lock of the sign-in from the browsers the account does not know; the owner's own browser has its own counter and is not locked. */
  const lockAccount = (email: string, cause: 'password' | 'second_step') =>
    sql`insert into identity.login_throttle (scope_key, scope, window_started_at, failures, second_step_failures, locked_until, lock_cause, expires_at)
        values (${throttleKey(email)}, 'account', ${current.clock.now()}, 10, ${cause === 'second_step' ? 1 : 0}, ${new Date(current.clock.now().getTime() + 600_000)}, ${cause}, ${new Date(current.clock.now().getTime() + 3_600_000)})
        on conflict (scope_key) do update set failures = 10, second_step_failures = excluded.second_step_failures, locked_until = excluded.locked_until, lock_cause = excluded.lock_cause, expires_at = excluded.expires_at`.execute(
      current.database.admin,
    );

  it('EVM-026 AC7 the lock whose cause is the password is lifted by the new password', async () => {
    const admin = await signedInWithKey(current);
    await lockAccount(admin.email, 'password');
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'password_change')).status).toBe(204);
    expect((await admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword: NEW_PASSWORD })).status).toBe(200);
    expect(await accountRow(current, admin.email)).toBeUndefined();
  });

  it('EVM-026 AC7 the lock whose cause is the second step stays: a new password does not lift it', async () => {
    const admin = await signedInWithKey(current);
    await lockAccount(admin.email, 'second_step');
    expect((await reauthWithKey(admin.panel, admin.authenticator, 'password_change')).status).toBe(204);
    expect((await admin.panel.post(ACCOUNT.password, { currentPassword: admin.password, newPassword: NEW_PASSWORD })).status).toBe(200);
    expect((await accountRow(current, admin.email))?.lock_cause).toBe('second_step');
    expect(await deviceIdsOf(current, admin.user.id)).toEqual([]);
  });
});
