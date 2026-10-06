import type { Request, Response } from 'express';
import request from 'supertest';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthController } from '../../src/modules/identity/http/auth.controller.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { activateAdministrator, passkeyOptions, PATHS, registerPasskey, setPassword, PASSWORD } from '../support/flows.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { PanelClient } from '../support/panel-client.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const server = () => current.app.getHttpServer();

describe('logout (EVM-016 AC6; SR-SESS-05, ASVS V7.4.1, V3.3.1)', () => {
  it('EVM-016 AC6 logout revokes the session in the database, clears site data and the cookie, and the old cookie is 401 session_revoked', async () => {
    const { panel, user } = await activateAdministrator(current);
    const oldCookie = panel.cookie;
    const response = await panel.post(PATHS.logout);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(response.headers['clear-site-data']).toBe('"cache", "storage"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toEqual(['__Host-evia_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0']);

    const sessions = await db()
      .selectFrom('identity.sessions')
      .select(['state', 'revoked_at', 'revoke_reason'])
      .where('user_id', '=', user.id)
      .where('revoke_reason', '=', 'logout')
      .execute();
    expect(sessions).toEqual([{ state: 'active', revoked_at: current.clock.now(), revoke_reason: 'logout' }]);

    const replay = await request(server())
      .get(PATHS.session)
      .set('Cookie', oldCookie ?? '');
    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({ code: 'session_revoked' });
    const again = await panel.post(PATHS.logout);
    expect(again.status).toBe(401);
  });

  it('EVM-016 AC6 logout needs the CSRF token, Origin and Sec-Fetch-Site: without them it is 403 csrf_failed and the session stays', async () => {
    const { panel } = await activateAdministrator(current);
    const cookie = panel.cookie ?? '';
    const token = panel.csrfToken ?? '';
    const foreign = await createSession(current.database.admin, current.clock, await createUser(current.database.admin, current.clock));
    const attempts: Array<[string, Record<string, string>]> = [
      ['no CSRF token', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin' }],
      ['a wrong CSRF token', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Token': `${token.slice(1)}x` }],
      ['the CSRF token of another session', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Token': foreign.csrfToken }],
      ['no Origin', { 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Token': token }],
      ['a foreign Origin', { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Token': token }],
      ['a cross-site fetch', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'cross-site', 'X-CSRF-Token': token }],
      ['no Sec-Fetch-Site', { Origin: PANEL_ORIGIN, 'X-CSRF-Token': token }],
    ];
    for (const [label, headers] of attempts) {
      const response = await request(server()).post(PATHS.logout).set('Cookie', cookie).set(headers);
      expect(response.status, label).toBe(403);
      expect(response.body, label).toMatchObject({ code: 'csrf_failed' });
      expect(response.headers['clear-site-data'], label).toBeUndefined();
    }
    expect((await panel.get(PATHS.session)).status).toBe(200);
  });

  it('EVM-016 AC6 logout is available in the enrolment state too (W-03 has a "Wyloguj"), and the audit trail records it', async () => {
    const { link } = await current.pendingAdministrator();
    const panel = current.panel();
    await setPassword(panel, link.token);
    expect((await panel.post(PATHS.logout)).status).toBe(204);
    const stale = await panel.get(PATHS.session);
    expect(stale.body).toMatchObject({ code: 'session_revoked' });
    // the link is still valid: the Administrator can start again
    expect((await current.panel().post(PATHS.check, { token: link.token })).status).toBe(200);
  });

  it('EVM-016 AC6 a session of a deactivated account is revoked (401 session_revoked)', async () => {
    const { panel, user } = await activateAdministrator(current);
    await db().updateTable('identity.users').set({ status: 'deactivated' }).where('id', '=', user.id).execute();
    const response = await panel.get(PATHS.session);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'session_revoked' });
  });
});

describe('the session cookie as the only credential (EVM-016 AC6; SR-SESS-01, SR-AUTH-14)', () => {
  it('EVM-016 AC6 two session cookies in one request are not trusted, even if one of them is valid (cookie tossing)', async () => {
    const { panel } = await activateAdministrator(current);
    const planted = `__Host-evia_session=${'z'.repeat(43)}`;
    for (const cookie of [`${panel.cookie};${planted}`, `${planted}; ${panel.cookie}`]) {
      const response = await request(server()).get(PATHS.session).set('Cookie', cookie);
      expect(response.status, cookie).toBe(401);
      expect(response.body).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('EVM-016 AC6 an unknown, malformed or foreign cookie is 401 unauthenticated; an Authorization header opens nothing in M1', async () => {
    const { panel } = await activateAdministrator(current);
    const token = (panel.cookie ?? '').split('=')[1] ?? '';
    for (const headers of [
      { Cookie: `__Host-evia_session=${'z'.repeat(43)}` },
      { Cookie: '__Host-evia_session=short' },
      { Cookie: `evia_session=${token}` },
      { Authorization: `Bearer ${token}` },
      { Authorization: `Bearer ${token}`, Cookie: 'x=y' },
    ]) {
      const response = await request(server()).get(PATHS.session).set(headers);
      expect(response.status, JSON.stringify(headers)).toBe(401);
      expect(response.body).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('EVM-016 AC6 a database error while looking the session up denies the request and is logged without the cookie (fail closed)', async () => {
    const { panel } = await activateAdministrator(current);
    await sql`revoke select on identity.sessions from evia_app`.execute(current.database.admin);
    const response = await panel.get(PATHS.session);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
    expect(current.logs.entries.some((entry) => entry['msg'] === 'session lookup failed; the request continues without a principal')).toBe(
      true,
    );
    expect(current.logs.text).not.toContain(panel.cookie?.split('=')[1] ?? 'x');
  });

  it('EVM-016 AC8 a session whose role may not use the mobile channel is refused there: read-only on mobile is 403 on every operation', async () => {
    const reader = await createUser(current.database.admin, current.clock, { role: 'read_only' });
    const mobile = new PanelClient(server(), PANEL_ORIGIN);
    const session = await createSession(current.database.admin, current.clock, reader, { channel: 'mobile' });
    mobile.cookie = session.cookie;
    mobile.csrfToken = session.csrfToken;
    for (const response of [await mobile.get(PATHS.session), await mobile.post(PATHS.logout)]) {
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'forbidden' });
    }
  });
});

describe('handlers do not trust the guard blindly (EVM-016 AC6; defence in depth)', () => {
  it('EVM-016 AC6 an authenticated handler called without a principal fails closed (401) instead of acting on nobody', async () => {
    const controller = current.app.get(AuthController);
    const failure = async (call: () => unknown): Promise<unknown> => {
      try {
        await call();
      } catch (error) {
        return error;
      }
      return undefined;
    };
    for (const call of [
      () => controller.getCurrentSession({} as Request),
      () => controller.logout({} as Request, {} as Response),
      () => controller.getPasskeyRegistrationOptions({} as Request),
    ]) {
      expect(await failure(call)).toMatchObject({ code: 'unauthenticated' });
    }
  });
});

describe('the audit trail of the activation (EVM-016 AC7; SR-LOG-03, SR-LOG-04)', () => {
  it('EVM-016 AC7 every event has who, what, when (UTC), where (a /24 prefix), outcome and trace id — and nothing personal, secret or free text', async () => {
    const { panel, user } = await activateAdministrator(current, 'administrator@evia.invalid');
    current.clock.advance(60_000);
    await panel.post(PATHS.logout);

    const { rows } = await sql<{
      occurred_at: Date;
      actor_type: string;
      actor_user_id: string | null;
      session_id: string | null;
      ip_prefix: string | null;
      origin: string;
      action: string;
      outcome: string;
      reason_code: string | null;
      object_type: string;
      object_id: string | null;
      trace_id: string;
    }>`select * from audit.events order by occurred_at, id`.execute(current.database.admin);

    expect(rows.map((row) => `${row.action}:${row.outcome}:${row.reason_code ?? '-'}`)).toEqual([
      'account.password_set:success:-',
      'session.created:success:-',
      'passkey.registered:success:-',
      'account.activated:success:-',
      'session.revoked:success:rotated',
      'session.created:success:-',
      'session.revoked:success:logout',
    ]);
    for (const row of rows) {
      expect(row.occurred_at).toBeInstanceOf(Date);
      expect(row.occurred_at.getTime()).toBeGreaterThanOrEqual(new Date(ISSUED_AT).getTime());
      expect(row.ip_prefix).toBe('127.0.0.0/24');
      expect(row.origin).toBe('web');
      expect(row.trace_id).toMatch(/^[0-9a-f]{32}$/);
      expect(['user', 'anonymous']).toContain(row.actor_type);
      expect(row.actor_user_id).toBe(row.actor_type === 'user' ? user.id : null);
    }
    expect(rows.at(-1)?.occurred_at).toEqual(new Date(new Date(ISSUED_AT).getTime() + 60_000));
    // one trace id per request that wrote events: password, registration, logout
    expect(new Set(rows.map((row) => row.trace_id)).size).toBe(3);

    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/@|evia\.invalid|Zq9|lamp|Orbit/i);
    expect(JSON.stringify(current.logs.entries)).not.toContain(PASSWORD);
  });

  it('EVM-016 AC7 a failed registration is audited with outcome failed and a code, never with the content of the response', async () => {
    const { link } = await current.pendingAdministrator();
    const panel = current.panel();
    await setPassword(panel, link.token);
    const { options } = await passkeyOptions(panel);
    await registerPasskey(panel, options, undefined, { origin: 'https://panel.evia.invalid' });
    const { rows } = await sql<{ action: string; outcome: string; reason_code: string }>`
      select action, outcome, reason_code from audit.events where outcome = 'failed'`.execute(current.database.admin);
    expect(rows).toEqual([{ action: 'passkey.registered', outcome: 'failed', reason_code: 'verification_failed' }]);
    const text =
      (await sql<{ all: string }>`select string_agg(to_jsonb(e)::text, ' ') as "all" from audit.events e`.execute(current.database.admin))
        .rows[0]?.all ?? '';
    expect(text).not.toMatch(/panel\.evia\.invalid|clientData|attestation|challenge/);
  });

  it('EVM-016 AC7 a failing audit write rolls the whole change back (the audit trail and the change commit together)', async () => {
    const { link } = await current.pendingAdministrator();
    // an audit table that rejects every new row, as a full disk or a revoked privilege would
    await sql`alter table audit.events add constraint audit_always_fails check (false) not valid`.execute(current.database.admin);
    const response = await setPassword(current.panel(), link.token);
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: 'internal_error' });
    const counts = await sql<{ credentials: string; sessions: string }>`
      select (select count(*) from identity.password_credentials)::text as credentials, (select count(*) from identity.sessions)::text as sessions`.execute(
      current.database.admin,
    );
    expect(counts.rows[0]).toEqual({ credentials: '0', sessions: '0' });
  });
});
