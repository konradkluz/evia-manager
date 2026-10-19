import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserAccessService } from '../../src/modules/identity/application/user-access.service.ts';
import { PATHS } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createPasskey, createUser } from '../support/identity-fixtures.ts';
import { USERS, browserOf, emailHarness, outboxRows } from '../support/invitation-fixtures.ts';
import { enrolledAccount, firstStep, loginOptions, signIn } from '../support/login-flows.ts';
import { principal } from '../support/principals.ts';
import { insertTotpFactor } from '../support/totp-flows.ts';
import {
  accountWithSessions,
  alertRows,
  auditOf,
  changeRole,
  deactivate,
  endSessions,
  etag,
  firstSession,
  reactivate,
  resetSecondStep,
  revokedSessions,
  sessionAnswer,
  userRow,
  versionOf,
} from '../support/user-access-fixtures.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const REVOKED = { status: 401, code: 'session_revoked' };
const db = () => current.database.admin;

/** Deactivates every Administrator except the given ones — the scenarios that count "who is left" start from a known set. */
async function onlyAdministrators(...keep: string[]): Promise<void> {
  await sql`update identity.users set status = 'deactivated' where role = 'administrator' and id <> all(${keep}::uuid[])`.execute(db());
}

describe('a change of a role (EVM-027 AC1; SR-AUTHZ-09, SR-SESS-02)', () => {
  it('EVM-027 AC1 an Administrator after a step-up changes Anna from Editor to Tylko odczyt: 200 with the new version and ETag, her sessions end (401 session_revoked), the actor stays signed in', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 2 });

    const response = await changeRole(current, admin, anna.user.id, 'read_only');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: anna.user.id, role: 'read_only', status: 'active', version: 2 });
    expect(response.headers['etag']).toBe('"2"');
    for (const { panel } of anna.sessions) expect(await sessionAnswer(panel)).toEqual(REVOKED);
    expect((await sessionAnswer(admin.panel)).status).toBe(200);
    expect((await revokedSessions(current, anna.user.id)).map((row) => row.revoke_reason)).toEqual(['role_changed', 'role_changed']);
    expect(await userRow(current, anna.user.id)).toMatchObject({ role: 'read_only', version: 2, updated_by: admin.user.id });
  });

  it('EVM-027 AC1 the audit event holds the codes of the roles before and after, the actor and the object — and the ended sessions are audited with the reason', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 2 });
    await changeRole(current, admin, anna.user.id, 'read_only');

    expect(await auditOf(current, 'user.role_changed')).toEqual([
      {
        actor_user_id: admin.user.id,
        object_id: anna.user.id,
        outcome: 'success',
        reason_code: null,
        from_code: 'editor',
        to_code: 'read_only',
      },
    ]);
    const ended = await auditOf(current, 'session.revoked');
    expect(ended).toHaveLength(2);
    expect(ended.every((event) => event.reason_code === 'role_changed' && event.actor_user_id === admin.user.id)).toBe(true);
  });

  it('EVM-027 AC1 after signing in again the new role works: every mutation is 403 forbidden', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    expect((await anna.panel.post('/api/v1/customers', {})).status).toBe(400); // let through to the validation: an Editor may write

    expect((await changeRole(current, admin, anna.user.id, 'read_only')).status).toBe(200);
    expect((await anna.panel.get(PATHS.session)).status).toBe(401);

    const again = current.panel();
    expect((await signIn(again, anna)).status).toBe(200);
    const mutation = await again.post('/api/v1/customers', {});
    expect(mutation.status).toBe(403);
    expect(mutation.body).toMatchObject({ code: 'forbidden' });
  });

  it('EVM-027 AC1 SR-AUTHZ-09 there is no cache of permissions longer than a request: the role read from the database applies to the very next request of the same session', async () => {
    const editor = await accountWithSessions(current, { role: 'editor', count: 1 });
    const { panel } = firstSession(editor);
    expect((await panel.post('/api/v1/customers', {})).status).toBe(400);
    await sql`update identity.users set role = 'read_only' where id = ${editor.user.id}`.execute(db());
    expect((await panel.post('/api/v1/customers', {})).status).toBe(403);
  });

  it('EVM-027 D8 the same role is not a transition: 409 invalid_state_transition and nothing changes — no version, no session, no event', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 1 });
    const before = await current.snapshot();

    const response = await changeRole(current, admin, anna.user.id, 'editor');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'invalid_state_transition' });
    expect(await current.snapshot()).toBe(before);
  });

  it('EVM-027 AC1 a role outside the list and a field outside the contract are 400 validation_failed — nothing changes', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 1 });
    const before = await current.snapshot();
    const version = etag(await versionOf(current, anna.user.id));
    for (const [body, pointer, code] of [
      [{ role: 'owner' }, '/role', 'invalid_value'],
      [{}, '/role', 'invalid_value'],
      [{ role: 'read_only', status: 'active' }, '/status', 'unknown_field'],
    ] as const) {
      const response = await admin.panel.put(`${USERS}/${anna.user.id}/role`, body, { 'If-Match': version });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed', errors: expect.arrayContaining([{ pointer, code }]) as unknown });
    }
    expect(await current.snapshot()).toBe(before);
  });
});

describe('an Administrator needs a passkey (EVM-027 D3, decision of Konrad 2026-10-19; SR-AUTH-06, P1)', () => {
  it('EVM-027 D3 an Editor without a passkey does not become an Administrator: 409 administrator_passkey_required, role and version unchanged, no session ended, no window, no alert, no audit event', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 1, key: false });
    const before = await current.snapshot();

    const response = await changeRole(current, admin, anna.user.id, 'administrator');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'administrator_passkey_required' });
    expect(await current.snapshot()).toBe(before);
    expect(await userRow(current, anna.user.id)).toMatchObject({ role: 'editor', version: 1 });
    expect((await sessionAnswer(anna.sessions[0]?.panel ?? current.panel())).status).toBe(200);
    expect(await alertRows(current)).toEqual([]);
    expect(await auditOf(current, 'user.role_changed')).toEqual([]);
    const { rows } = await sql`select 1 from identity.one_time_links where user_id = ${anna.user.id}`.execute(db());
    expect(rows).toEqual([]);
  });

  it('EVM-027 D3 a code of the app and recovery codes are not a passkey: an Editor with only a TOTP factor is refused too', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 1 });
    await insertTotpFactor(current, anna.user.id);
    const response = await changeRole(current, admin, anna.user.id, 'administrator');
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'administrator_passkey_required' });
  });

  it('EVM-027 D3 an Editor with a passkey becomes an Administrator: 200, sessions end, every active Administrator is alerted', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 1, key: true });
    const response = await changeRole(current, admin, anna.user.id, 'administrator');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ role: 'administrator', secondStepMethods: ['passkey'] });
    expect(await sessionAnswer(anna.sessions[0]?.panel ?? current.panel())).toEqual(REVOKED);
  });

  it('EVM-027 D3 a deactivated account is not prepared for the role in secret: 409 invalid_state_transition', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', status: 'deactivated', count: 0, key: true });
    const response = await changeRole(current, admin, anna.user.id, 'administrator');
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'invalid_state_transition' });
  });
});

describe('deactivation and reactivation (EVM-027 AC2; SR-SESS-06)', () => {
  it('EVM-027 AC2 a deactivated account with two sessions: both are 401 session_revoked, the status is deactivated, signing in is the answer of a wrong password, and the events are audited', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    const second = current.panel();
    expect((await signIn(second, anna)).status).toBe(200);

    const response = await deactivate(current, admin, anna.user.id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: anna.user.id,
      status: 'deactivated',
      version: expect.any(Number) as unknown,
      invitation: null,
    });
    expect(await sessionAnswer(anna.panel)).toEqual(REVOKED);
    expect(await sessionAnswer(second)).toEqual(REVOKED);
    current.clock.advance(61_000);
    const login = await firstStep(current.panel(), anna.email, anna.password);
    expect(login.status).toBe(401);
    expect(login.body).toMatchObject({ code: 'invalid_credentials' });
    expect(await auditOf(current, 'user.deactivated')).toEqual([
      { actor_user_id: admin.user.id, object_id: anna.user.id, outcome: 'success', reason_code: null, from_code: null, to_code: null },
    ]);
    const ended = (await auditOf(current, 'session.revoked')).filter((event) => event.reason_code === 'account_deactivated');
    expect(ended).toHaveLength(2);
    expect((await userRow(current, anna.user.id))?.deactivated_at).not.toBeNull();
  });

  it('EVM-027 AC2 a reactivated account is active with the second steps it had: it signs in with the same key, and the event is audited', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    await deactivate(current, admin, anna.user.id);

    const response = await reactivate(current, admin, anna.user.id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'active', secondStepMethods: ['passkey'] });
    expect((await userRow(current, anna.user.id))?.deactivated_at).toBeNull();
    current.clock.advance(61_000);
    expect((await signIn(current.panel(), anna)).status).toBe(200);
    expect(await auditOf(current, 'user.reactivated')).toHaveLength(1);
  });

  it('EVM-027 AC2 a first sign-in started before the deactivation does not finish after it: the loginToken is dead even when the account comes back', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    const panel = current.panel();
    const first = await firstStep(panel, anna.email, anna.password);
    const { loginToken } = first.body as { loginToken: string };

    await deactivate(current, admin, anna.user.id);
    await reactivate(current, admin, anna.user.id);

    const options = await loginOptions(panel, loginToken);
    expect(options.response.status).toBe(401);
    expect(options.response.body).toMatchObject({ code: 'unauthenticated' });
  });

  it('EVM-027 AC2 an account that was never activated returns to invited, and its earlier invitation stays dead (the link is superseded, a new one only by "Wyślij ponownie")', async () => {
    const admin = await browserOf(current);
    const pending = await current.pendingAdministrator({ email: 'oczekujaca@example.com' });
    const before = await userRow(current, pending.user.id);

    const off = await deactivate(current, admin, pending.user.id);
    expect(off.status).toBe(200);
    const link = await sql<{
      superseded_at: Date | null;
    }>`select superseded_at from identity.one_time_links where user_id = ${pending.user.id}`.execute(db());
    expect(link.rows[0]?.superseded_at).not.toBeNull();

    const on = await reactivate(current, admin, pending.user.id);
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ status: 'invited', activatedAt: null, invitation: { state: 'expired' } });
    expect((await userRow(current, pending.user.id))?.activated_at).toBeNull();
    expect(before?.status).toBe('invited');
    const check = await current.panel().post(PATHS.check, { token: pending.link.token });
    expect(check.status).toBe(400);
    expect(check.body).toMatchObject({ code: 'activation_link_invalid' });
  });

  it('EVM-027 AC2 a deactivation ends the setup of an authenticator that was not confirmed, the open links of every purpose and the messages that wait — an active factor stays', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 1 });
    await insertTotpFactor(current, anna.user.id, { state: 'pending' });
    const other = await accountWithSessions(current, { role: 'editor', count: 0 });
    await insertTotpFactor(current, other.user.id, { state: 'active' });
    await sql`insert into identity.one_time_links (user_id, purpose, token_hash, issued_by, issued_at, expires_at)
      values (${anna.user.id}, 'password_reset', ${Buffer.alloc(32, 7)}, 'password_reset', ${current.clock.now()}, ${new Date(current.clock.now().getTime() + 1_800_000)})`.execute(
      db(),
    );
    await sql`insert into platform.email_outbox (kind, variant, recipient_user_id, state, attempts, created_at)
      values ('password_reset', null, ${anna.user.id}, 'pending', 0, ${current.clock.now()})`.execute(db());

    expect((await deactivate(current, admin, anna.user.id)).status).toBe(200);
    expect((await deactivate(current, admin, other.user.id)).status).toBe(200);

    const factors = await sql<{ user_id: string; state: string }>`select user_id, state from identity.totp_factors`.execute(db());
    expect(factors.rows).toEqual([{ user_id: other.user.id, state: 'active' }]);
    const links = await sql<{
      superseded_at: Date | null;
    }>`select superseded_at from identity.one_time_links where user_id = ${anna.user.id}`.execute(db());
    expect(links.rows.every((row) => row.superseded_at !== null)).toBe(true);
    expect((await outboxRows(current, { recipient: anna.user.id, kind: 'password_reset' })).map((row) => row.state)).toEqual([
      'superseded',
    ]);
  });

  it('EVM-027 AC2 only a deactivated account is reactivated and only an active or invited one is deactivated (409 invalid_state_transition otherwise, nothing changes)', async () => {
    const admin = await browserOf(current);
    const active = await accountWithSessions(current, { count: 0 });
    const off = await accountWithSessions(current, { status: 'deactivated', count: 0 });
    const before = await current.snapshot();
    for (const response of [await reactivate(current, admin, active.user.id), await deactivate(current, admin, off.user.id)]) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'invalid_state_transition' });
    }
    expect(await current.snapshot()).toBe(before);
  });
});

describe('the end of all sessions of a user (EVM-027 AC3; SR-SESS-07)', () => {
  it('EVM-027 AC3 every session of the user — an active one and one of the setup of a second step — is 401 session_revoked; the user may sign in again; the event is audited', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    const second = current.panel();
    expect((await signIn(second, anna)).status).toBe(200);

    const response = await endSessions(admin, anna.user.id);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(await sessionAnswer(anna.panel)).toEqual(REVOKED);
    expect(await sessionAnswer(second)).toEqual(REVOKED);
    current.clock.advance(61_000);
    expect((await signIn(current.panel(), anna)).status).toBe(200);
    expect(await auditOf(current, 'user.sessions_ended')).toEqual([
      { actor_user_id: admin.user.id, object_id: anna.user.id, outcome: 'success', reason_code: null, from_code: null, to_code: null },
    ]);
    expect((await auditOf(current, 'session.revoked')).filter((event) => event.reason_code === 'sessions_ended')).toHaveLength(2);
    expect(await userRow(current, anna.user.id)).toMatchObject({ version: 2, status: 'active' }); // the activation raised it once; this does not
  });

  it('EVM-027 AC3 it is idempotent (a second call is 204 too), it never changes the account, and a sign-in started before it does not finish after it', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    const panel = current.panel();
    const { loginToken } = (await firstStep(panel, anna.email, anna.password)).body as { loginToken: string };
    const version = await versionOf(current, anna.user.id);

    expect((await endSessions(admin, anna.user.id)).status).toBe(204);
    expect((await endSessions(admin, anna.user.id)).status).toBe(204);

    expect(await versionOf(current, anna.user.id)).toBe(version);
    expect((await loginOptions(panel, loginToken)).response.status).toBe(401);
  });

  it('EVM-027 AC3 D5 your own sessions are not ended here (409 own_account_not_allowed, the session stays); the sessions of another person do not touch the actor', async () => {
    const admin = await browserOf(current);
    const response = await endSessions(admin, admin.user.id);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'own_account_not_allowed' });
    expect((await sessionAnswer(admin.panel)).status).toBe(200);
  });
});

describe('the last active Administrator (EVM-027 AC5; decision 10)', () => {
  it('EVM-027 AC5 the only active Administrator cannot be deactivated or lose the role: 409 last_active_administrator, nothing changes', async () => {
    const admin = await browserOf(current);
    await onlyAdministrators(admin.user.id);
    const before = await current.snapshot();

    const off = await deactivate(current, admin, admin.user.id);
    const role = await changeRole(current, admin, admin.user.id, 'editor');

    for (const response of [off, role]) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'last_active_administrator' });
    }
    expect(await current.snapshot()).toBe(before);
  });

  it('EVM-027 AC5 an Administrator who is invited or deactivated is not counted: the one active Administrator is still the last', async () => {
    const admin = await browserOf(current);
    const invited = await createUser(db(), current.clock, { role: 'administrator', status: 'invited' });
    const off = await createUser(db(), current.clock, { role: 'administrator', status: 'deactivated' });
    await onlyAdministrators(admin.user.id, invited.id, off.id);
    const response = await deactivate(current, admin, admin.user.id);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'last_active_administrator' });
  });

  it('EVM-027 AC5 with other Administrators about, an Administrator still cannot deactivate themselves or take the role from themselves: 409 own_account_not_allowed', async () => {
    const admin = await browserOf(current);
    await browserOf(current); // a second active Administrator
    for (const response of [await deactivate(current, admin, admin.user.id), await changeRole(current, admin, admin.user.id, 'editor')]) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'own_account_not_allowed' });
    }
    expect((await sessionAnswer(admin.panel)).status).toBe(200);
  });

  it('EVM-027 AC5 another Administrator may be demoted or deactivated while one active Administrator remains; reactivation is never blocked', async () => {
    const admin = await browserOf(current);
    const other = await accountWithSessions(current, { role: 'administrator', count: 1, key: true });
    const third = await accountWithSessions(current, { role: 'administrator', count: 0, key: true });
    await onlyAdministrators(admin.user.id, other.user.id, third.user.id);

    expect((await deactivate(current, admin, other.user.id)).status).toBe(200);
    expect((await changeRole(current, admin, third.user.id, 'editor')).status).toBe(200);
    expect((await reactivate(current, admin, other.user.id)).status).toBe(200);
  });
});

describe('two Administrators at the same time (EVM-027 AC6; CWE-362, ASVS V2.3.3)', () => {
  const pair = async () => {
    const a = await browserOf(current);
    const b = await browserOf(current);
    await onlyAdministrators(a.user.id, b.user.id);
    return { a, b };
  };
  const activeAdministrators = async (): Promise<number> =>
    Number(
      (
        await sql<{ n: string }>`select count(*)::text as n from identity.users where role = 'administrator' and status = 'active'`.execute(
          db(),
        )
      ).rows[0]?.n,
    );

  it('EVM-027 AC6 each deactivates the other in parallel, five times over: exactly one succeeds, the other is refused (the actor was deactivated meanwhile: 401 session_revoked) and one active Administrator stays', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { a, b } = await pair();
      const [x, y] = await Promise.all([deactivate(current, a, b.user.id), deactivate(current, b, a.user.id)]);
      expect([x.status, y.status].sort(), `round ${round}`).toEqual([200, 401]);
      expect([x, y].find((response) => response.status === 401)?.body).toMatchObject({ code: 'session_revoked' });
      expect(await activeAdministrators(), `round ${round}`).toBe(1);
    }
  });

  it('EVM-027 AC6 each takes the role from the other in parallel: at least one Administrator stays; the loser did not act as an Administrator any more (403 forbidden)', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { a, b } = await pair();
      const [x, y] = await Promise.all([changeRole(current, a, b.user.id, 'editor'), changeRole(current, b, a.user.id, 'editor')]);
      expect([x.status, y.status].sort(), `round ${round}`).toEqual([200, 403]);
      expect(await activeAdministrators(), `round ${round}`).toBe(1);
    }
  });

  it('EVM-027 AC6 one deactivates the other while the other takes the role from the first: one Administrator stays, whoever is first', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { a, b } = await pair();
      const [x, y] = await Promise.all([deactivate(current, a, b.user.id), changeRole(current, b, a.user.id, 'editor')]);
      expect(
        [x.status, y.status].filter((status) => status === 200),
        `round ${round}`,
      ).toHaveLength(1);
      expect(await activeAdministrators(), `round ${round}`).toBe(1);
    }
  });

  it('EVM-027 AC6 the actor is read again UNDER the lock: one deactivated (or no longer an Administrator) while the request waited is refused with 401 session_revoked (403 forbidden) and the target stays as it was', async () => {
    const { b } = await pair();
    const editor = await accountWithSessions(current, { role: 'editor', count: 1 });
    const service = current.app.get(UserAccessService);
    const request = (actor: string) => ({ ...principal({ userId: actor }), role: 'administrator' as const });
    const context = { origin: 'web' as const, traceId: 'a'.repeat(32) };
    const version = etag(await versionOf(current, editor.user.id));

    await sql`update identity.users set status = 'deactivated' where id = ${b.user.id}`.execute(db()); // the principal of the request is an old fact
    await expect(
      service.changeRole(request(b.user.id), { userId: editor.user.id }, version, { role: 'read_only' }, context),
    ).rejects.toMatchObject({
      code: 'session_revoked',
    });
    await sql`update identity.users set status = 'active', role = 'editor' where id = ${b.user.id}`.execute(db());
    await expect(
      service.changeRole(request(b.user.id), { userId: editor.user.id }, version, { role: 'read_only' }, context),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await userRow(current, editor.user.id)).toMatchObject({ role: 'editor', version: 1 });
  });
});

describe('alerts for the Administrators (EVM-027 AC7; SR-LOG-07)', () => {
  const recipients = async (): Promise<string[]> => (await alertRows(current)).map((row) => row.recipient_user_id).sort();

  async function others() {
    const active = await accountWithSessions(current, { role: 'administrator', count: 0, key: true });
    const off = await accountWithSessions(current, { role: 'administrator', status: 'deactivated', count: 0 });
    const pending = await accountWithSessions(current, { role: 'administrator', status: 'invited', count: 0 });
    const editor = await accountWithSessions(current, { role: 'editor', count: 0 });
    return { active, off, pending, editor };
  }

  it('EVM-027 AC7 whoever becomes an Administrator: every ACTIVE Administrator gets the alert (the new one and the actor too), nobody else', async () => {
    const admin = await browserOf(current);
    const { active, off, pending, editor } = await others();
    const anna = await accountWithSessions(current, { role: 'editor', count: 0, key: true });
    expect((await changeRole(current, admin, anna.user.id, 'administrator')).status).toBe(200);

    const rows = await alertRows(current);
    expect(rows.every((row) => row.variant === 'administrator_granted')).toBe(true);
    expect(await recipients()).toEqual([admin.user.id, active.user.id, anna.user.id].sort());
    for (const excluded of [off, pending, editor]) expect(await recipients()).not.toContain(excluded.user.id);
  });

  it('EVM-027 AC7 whoever stops being an Administrator: the alert goes to the Administrators who are left (not to the one who lost the role)', async () => {
    const admin = await browserOf(current);
    const { active } = await others();
    const anna = await accountWithSessions(current, { role: 'administrator', count: 0, key: true });
    expect((await changeRole(current, admin, anna.user.id, 'read_only')).status).toBe(200);
    expect((await alertRows(current)).every((row) => row.variant === 'administrator_revoked')).toBe(true);
    expect(await recipients()).toEqual([admin.user.id, active.user.id].sort());
  });

  it('EVM-027 AC7 a deactivated, a reactivated and a reset Administrator are alerts of their own kind', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'administrator', count: 0, key: true });
    await sql`update identity.users set activated_at = ${current.clock.now()} where id = ${anna.user.id}`.execute(db());

    expect((await resetSecondStep(current, admin, anna.user.id)).status).toBe(200);
    expect((await deactivate(current, admin, anna.user.id)).status).toBe(200);
    expect((await reactivate(current, admin, anna.user.id)).status).toBe(200);

    const rows = await alertRows(current);
    expect([...new Set(rows.map((row) => row.variant))]).toEqual([
      'administrator_second_step_reset',
      'administrator_deactivated',
      'administrator_reactivated',
    ]);
    // the reset alerts the reset Administrator as well (still active then); the deactivation does not (already inactive); the reactivation does (active again)
    expect(
      rows
        .filter((row) => row.variant === 'administrator_second_step_reset')
        .map((row) => row.recipient_user_id)
        .sort(),
    ).toEqual([admin.user.id, anna.user.id].sort());
    expect(rows.filter((row) => row.variant === 'administrator_deactivated').map((row) => row.recipient_user_id)).toEqual([admin.user.id]);
    expect(
      rows
        .filter((row) => row.variant === 'administrator_reactivated')
        .map((row) => row.recipient_user_id)
        .sort(),
    ).toEqual([admin.user.id, anna.user.id].sort());
  });

  it('EVM-027 AC7 no alert for the other roles (Edytor <-> Tylko odczyt, deactivating and reactivating an Editor, resetting their second step) and none for a refusal', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 0 });
    await sql`update identity.users set activated_at = ${current.clock.now()} where id = ${anna.user.id}`.execute(db());

    expect((await changeRole(current, admin, anna.user.id, 'read_only')).status).toBe(200);
    expect((await changeRole(current, admin, anna.user.id, 'editor')).status).toBe(200);
    expect((await deactivate(current, admin, anna.user.id)).status).toBe(200);
    expect((await reactivate(current, admin, anna.user.id)).status).toBe(200);
    expect((await resetSecondStep(current, admin, anna.user.id)).status).toBe(200);
    expect((await changeRole(current, admin, anna.user.id, 'administrator')).status).toBe(409); // no passkey
    expect((await deactivate(current, admin, admin.user.id)).status).toBe(409);

    expect(await alertRows(current)).toEqual([]);
  });

  it('EVM-027 AC7 the alert is a fixed text without the person, the address or the IP: the worker sends it to each recipient', async () => {
    const admin = await browserOf(current, { email: 'szefowa@example.com' });
    const anna = await accountWithSessions(current, { role: 'editor', count: 0, key: true, email: 'anna.awansowana@example.com' });
    await changeRole(current, admin, anna.user.id, 'administrator');
    const { job, sender } = emailHarness(current);
    for (const row of await outboxRows(current, { kind: 'administrator_alert' })) await job.run({ ids: [row.id] });

    expect(sender.sent.map((message) => message.to).sort()).toEqual(['anna.awansowana@example.com', 'szefowa@example.com']);
    for (const message of sender.sent) {
      expect(message.subject).toBe('EVia Manager: alert bezpieczeństwa — nowy administrator');
      expect(message.text).toContain('nadano rolę Administrator jednemu z kont.');
      expect(message.text).not.toMatch(/anna|awansowana|szefowa|Użytkownik|\d+\.\d+\.\d+\.\d+/i);
    }
  });
});

describe('the precondition of a command on the account (EVM-027 AC8; ADR-0004, SR-API-06)', () => {
  it('EVM-027 AC8 a missing If-Match is 428, a stale one 412 version_conflict (the account has changed meanwhile), a malformed one 400 — and nothing changes', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 1 });
    const before = await current.snapshot();

    const missing = await admin.panel.put(`${USERS}/${anna.user.id}/role`, { role: 'read_only' });
    expect(missing.status).toBe(428);
    expect(missing.body).toMatchObject({ code: 'precondition_required' });
    const stale = await changeRole(current, admin, anna.user.id, 'read_only', 7);
    expect(stale.status).toBe(412);
    expect(stale.body).toMatchObject({ code: 'version_conflict' });
    for (const header of ['W/"1"', '*', '"1", "2"', '1', '"0"']) {
      const bad = await admin.panel.post(`${USERS}/${anna.user.id}/deactivation`, undefined, { 'If-Match': header });
      expect(bad.status, header).toBe(400);
      expect(bad.body).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/headers/If-Match', code: 'invalid_format' }] });
    }
    expect(await current.snapshot()).toBe(before);
  });

  it('EVM-027 AC8 two Administrators decide on the same version: the first wins, the second gets 412 and the account is changed once', async () => {
    const admin = await browserOf(current);
    const other = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 0 });
    const version = await versionOf(current, anna.user.id);
    expect((await changeRole(current, admin, anna.user.id, 'read_only', version)).status).toBe(200);
    const second = await deactivate(current, other, anna.user.id, version);
    expect(second.status).toBe(412);
    expect(await userRow(current, anna.user.id)).toMatchObject({ role: 'read_only', status: 'active', version: version + 1 });
  });

  it('EVM-027 AC8 the 404 comes before the version: an account that does not exist or is deleted is 404 not_found even with a stale or missing If-Match — nothing tells it from a stale version', async () => {
    const admin = await browserOf(current);
    const gone = await accountWithSessions(current, { role: 'editor', count: 0 });
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${gone.user.id}`.execute(db());
    for (const id of [gone.user.id, '0198f2a0-7b1c-7c4e-8d3a-5f6b7c8d9e99']) {
      expect((await changeRole(current, admin, id, 'editor', 99)).status, id).toBe(404);
      expect((await admin.panel.post(`${USERS}/${id}/deactivation`)).status, id).toBe(404);
      expect((await admin.panel.post(`${USERS}/${id}/reactivation`)).status, id).toBe(404);
      expect((await endSessions(admin, id)).status, id).toBe(404);
      expect((await resetSecondStep(current, admin, id, { version: 99 })).status, id).toBe(404);
    }
  });

  it('EVM-027 AC8 the answer of every operation carries the new ETag, and the list shows the same version (the value of If-Match)', async () => {
    const admin = await browserOf(current);
    const anna = await accountWithSessions(current, { role: 'editor', count: 0 });
    await sql`update identity.users set activated_at = ${current.clock.now()} where id = ${anna.user.id}`.execute(db());
    const steps = [
      await changeRole(current, admin, anna.user.id, 'read_only'),
      await deactivate(current, admin, anna.user.id),
      await reactivate(current, admin, anna.user.id),
    ];
    expect(steps.map((response) => response.headers['etag'])).toEqual(['"2"', '"3"', '"4"']);
    const list = await admin.panel.get(USERS);
    const item = (list.body as { items: Array<{ id: string; version: number }> }).items.find((entry) => entry.id === anna.user.id);
    expect(item?.version).toBe(4);
  });

  it('EVM-027 AC8 the version rises only with a managed change: signing in does not raise it, a refusal does not, the end of sessions does not', async () => {
    const admin = await browserOf(current);
    const anna = await enrolledAccount(current, { role: 'editor' });
    const version = await versionOf(current, anna.user.id);
    current.clock.advance(61_000);
    expect((await signIn(current.panel(), anna)).status).toBe(200);
    expect((await endSessions(admin, anna.user.id)).status).toBe(204);
    expect((await reactivate(current, admin, anna.user.id)).status).toBe(409);
    expect(await versionOf(current, anna.user.id)).toBe(version);
  });
});

describe('no personal data in the audit trail (EVM-027; SR-LOG-03, SR-DATA-03)', () => {
  it('EVM-027 the events of the five operations hold identifiers and codes only — no address, no name, no free text', async () => {
    const admin = await browserOf(current, { email: 'szef.audytu@example.com', displayName: 'Szef Audytu' });
    const anna = await accountWithSessions(current, { role: 'editor', count: 1, key: true, email: 'anna.audytowana@example.com' });
    await sql`update identity.users set display_name = 'Anna Audytowana', activated_at = ${current.clock.now()} where id = ${anna.user.id}`.execute(
      db(),
    );
    await changeRole(current, admin, anna.user.id, 'read_only');
    await deactivate(current, admin, anna.user.id);
    await reactivate(current, admin, anna.user.id);
    await endSessions(admin, anna.user.id);
    await resetSecondStep(current, admin, anna.user.id, { verification: 'video_call' });

    const { rows } = await sql<{ row: string }>`select to_jsonb(t)::text as row from audit.events t`.execute(db());
    const text = rows.map((row) => row.row).join('\n');
    expect(text).not.toMatch(/szef\.audytu|anna\.audytowana|Szef Audytu|Anna Audytowana|example\.com/i);
    expect((await auditOf(current, 'user.second_step_reset'))[0]?.reason_code).toBe('identity_verified_video_call');
  });
});

describe('the passkeys the tests write (a sanity check of the fixtures)', () => {
  it('EVM-027 a fixture passkey is a row of the account and is seen as the kind passkey in the list', async () => {
    const admin = await browserOf(current);
    const anna = await createUser(db(), current.clock, { role: 'editor' });
    await createPasskey(db(), current.clock, anna);
    const list = await admin.panel.get(USERS);
    const item = (list.body as { items: Array<{ id: string; secondStepMethods: string[] }> }).items.find((entry) => entry.id === anna.id);
    expect(item?.secondStepMethods).toEqual(['passkey']);
  });
});
