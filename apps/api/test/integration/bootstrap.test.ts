import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeBootstrap, EXIT_OK, EXIT_REFUSED, type TerminalIo } from '../../src/cli/run.ts';
import { RoutePolicyCheck } from '../../src/modules/authorization/index.ts';
import { AdministratorBootstrap } from '../../src/modules/identity/index.ts';
import { hashToken } from '../../src/modules/identity/domain/tokens.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { CLOCK, DATABASE, EVENT_BUS, SECURITY_ALERT_EMITTER } from '../../src/platform/tokens.ts';
import type { SecurityAlertEmitter } from '../../src/platform/alerts/security-alerts.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { activateAdministrator, passkeyOptions, PATHS, registerPasskey, setPassword } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createLink, createSession, createUser } from '../support/identity-fixtures.ts';
import { VirtualAuthenticator } from '../support/virtual-authenticator.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await current.close();
});

const db = () => identityTables(current.database.admin);
const bootstrap = () => current.app.get(AdministratorBootstrap);
const cli = { origin: 'cli', traceId: 'd'.repeat(32) } as const;
const ADMIN = 'administrator@evia.invalid';

/** The terminal of the operator: scripted answers, everything written is kept. */
function terminal(...answers: string[]) {
  const written: string[] = [];
  const io: TerminalIo = {
    question: () => Promise.resolve(answers.shift() ?? ''),
    write: (text) => {
      written.push(text);
    },
  };
  return { io, output: () => written.join('') };
}

const tokenOf = (output: string): string => /#([A-Za-z0-9_-]{43})/.exec(output)?.[1] ?? '';

describe('first Administrator: the link from the server command (EVM-016 AC1; SR-AUTH-12, SR-LOG-02)', () => {
  it('EVM-016 AC1 without an active Administrator the command creates an invited Administrator and a 72-hour link stored only as a hash', async () => {
    const result = await bootstrap().run({ mode: 'activation', email: ADMIN }, cli);
    expect(result.kind).toBe('issued');
    if (result.kind !== 'issued') return;

    const user = await db().selectFrom('identity.users').selectAll().executeTakeFirstOrThrow();
    expect(user).toMatchObject({ email: ADMIN, display_name: 'administrator', role: 'administrator', status: 'invited', version: 1 });
    expect(user.webauthn_user_handle).toHaveLength(32);
    expect(user.webauthn_user_handle.toString('utf8')).not.toContain('administrator');

    const link = await db().selectFrom('identity.one_time_links').selectAll().executeTakeFirstOrThrow();
    expect(link).toMatchObject({ user_id: user.id, purpose: 'account_activation', issued_by: 'cli', used_at: null, superseded_at: null });
    expect(link.issued_at).toEqual(new Date('2026-10-01T08:00:00Z'));
    expect(link.expires_at).toEqual(new Date('2026-10-04T08:00:00Z'));
    expect(result.expiresAt).toEqual(link.expires_at);
    expect(link.token_hash.equals(hashToken(result.token))).toBe(true);

    // the token itself is in no column of any table: not as text, not as base64url, not as hex
    const everything = await current.snapshot();
    expect(everything).not.toContain(result.token);
    expect(everything).not.toContain(Buffer.from(result.token, 'base64url').toString('hex'));
    expect(everything).not.toContain(Buffer.from(result.token, 'base64url').toString('base64'));
  });

  it('EVM-016 AC1 the audit trail has the issue of the link, from the command, without the address and without an IP', async () => {
    await bootstrap().run({ mode: 'activation', email: ADMIN }, cli);
    const { rows } = await sql<Record<string, unknown>>`select * from audit.events`.execute(current.database.admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_type: 'system',
      actor_user_id: null,
      session_id: null,
      ip_prefix: null,
      origin: 'cli',
      action: 'activation_link.issued',
      outcome: 'success',
      reason_code: null,
      object_type: 'user',
      trace_id: cli.traceId,
      occurred_at: new Date('2026-10-01T08:00:00Z'),
    });
    expect(JSON.stringify(rows)).not.toMatch(/@|administrator@/);
  });

  it('EVM-016 AC1 at the terminal the address is typed, the link has the token in the fragment only, and the link opens W-13 (it works end to end)', async () => {
    const { io, output } = terminal(' Administrator@EVIA.invalid ');
    expect(await executeBootstrap([], io, { bootstrap: bootstrap(), panelOrigin: current.config.panelOrigin })).toBe(EXIT_OK);
    const token = tokenOf(output());
    expect(output()).toContain(`${PANEL_ORIGIN}/activate#${token}`);
    expect(output()).not.toMatch(/\?/);
    const response = await current.panel().post(PATHS.check, { token });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ email: ADMIN, role: 'administrator' });
  });

  it('EVM-016 AC1 the token reaches the terminal only: not the logger, not stdout/stderr of the process, not the audit trail', async () => {
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    const { io, output } = terminal(ADMIN);
    await executeBootstrap([], io, { bootstrap: bootstrap(), panelOrigin: current.config.panelOrigin });
    const token = tokenOf(output());
    expect(token).toHaveLength(43);
    expect(JSON.stringify(stdout.mock.calls)).not.toContain(token);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(token);
    expect(current.logs.text).not.toContain(token);
    expect(JSON.stringify((await sql`select * from audit.events`.execute(current.database.admin)).rows)).not.toContain(token);
  });

  it('EVM-016 AC1 the command has no e-mail port: its only dependencies are the database, the clock and the event bus', () => {
    const injected = (Reflect.getMetadata('self:paramtypes', AdministratorBootstrap) as Array<{ index: number; param: symbol }>)
      .map((entry) => String(entry.param))
      .sort();
    expect(injected).toEqual([String(CLOCK), String(DATABASE), String(EVENT_BUS)].sort());
  });

  it('EVM-016 AC1 there is no "setup" endpoint: neither in the contract nor on the router, and guessed paths are 401 (SR-AUTH-14)', async () => {
    expect(JSON.stringify(Object.values(AUTHZ_MANIFEST).map((operation) => operation.path))).not.toMatch(/setup|bootstrap|install|init/i);
    const routes = current.app.get(RoutePolicyCheck).routes();
    expect(routes.map((route) => route.path).join(' ')).not.toMatch(/setup|bootstrap|install/i);
    for (const path of ['/api/v1/setup', '/api/setup', '/api/v1/auth/bootstrap', '/api/v1/admin/bootstrap', '/setup']) {
      for (const method of ['get', 'post'] as const) {
        const response = await request(current.app.getHttpServer())[method](path);
        expect(response.status, `${method} ${path}`).toBe(401);
      }
    }
  });

  it('EVM-016 AC1 running it again for the same address issues a new link and ends the old one and the session started with it (A1d)', async () => {
    const first = await bootstrap().run({ mode: 'activation', email: ADMIN }, cli);
    if (first.kind !== 'issued') throw new Error('expected a link');
    const panel = current.panel();
    expect((await setPassword(panel, first.token)).status).toBe(200);
    const { options } = await passkeyOptions(panel);
    current.clock.advance(1000);
    const second = await bootstrap().run({ mode: 'activation', email: ADMIN }, { ...cli, traceId: 'e'.repeat(32) });
    if (second.kind !== 'issued') throw new Error('expected a link');
    expect(second.token).not.toBe(first.token);

    expect((await current.panel().post(PATHS.check, { token: first.token })).body).toMatchObject({ code: 'activation_link_invalid' });
    expect((await current.panel().post(PATHS.check, { token: second.token })).status).toBe(200);
    const stale = await panel.get(PATHS.session);
    expect(stale.body).toMatchObject({ code: 'session_revoked' });
    expect((await registerPasskey(panel, options)).status).toBe(401);
    expect(await db().selectFrom('identity.users').select('id').execute()).toHaveLength(1);
    const reasons = await db().selectFrom('identity.sessions').select('revoke_reason').execute();
    expect(reasons).toEqual([{ revoke_reason: 'link_superseded' }]);
    const { rows } = await sql<{
      action: string;
      reason_code: string | null;
    }>`select action, reason_code from audit.events order by occurred_at, id`.execute(current.database.admin);
    expect(rows.map((row) => `${row.action}:${row.reason_code ?? '-'}`)).toEqual([
      'activation_link.issued:-',
      'account.password_set:-',
      'session.created:-',
      'session.revoked:link_superseded',
      'activation_link.issued:-',
    ]);
  });

  it('EVM-016 AC1 another address while one is pending: the old account is deactivated and its link ends — only one way in remains (W8)', async () => {
    const first = await bootstrap().run({ mode: 'activation', email: ADMIN }, cli);
    const second = await bootstrap().run({ mode: 'activation', email: 'zapasowy@evia.invalid' }, cli);
    if (first.kind !== 'issued' || second.kind !== 'issued') throw new Error('expected links');
    const users = await db().selectFrom('identity.users').select(['email', 'status']).orderBy('email').execute();
    expect(users).toEqual([
      { email: ADMIN, status: 'deactivated' },
      { email: 'zapasowy@evia.invalid', status: 'invited' },
    ]);
    expect((await current.panel().post(PATHS.check, { token: first.token })).status).toBe(400);
    expect((await current.panel().post(PATHS.check, { token: second.token })).status).toBe(200);
    // a deactivated address cannot be revived by the command
    expect(await bootstrap().run({ mode: 'activation', email: ADMIN }, cli)).toEqual({ kind: 'refused', reason: 'account_unavailable' });
  });

  it('EVM-016 AC1 an address that belongs to another kind of account is refused without a link and without a change', async () => {
    await createUser(current.database.admin, current.clock, { role: 'editor', status: 'active', email: 'edytor@evia.invalid' });
    const before = await current.snapshot();
    expect(await bootstrap().run({ mode: 'activation', email: 'edytor@evia.invalid' }, cli)).toEqual({
      kind: 'refused',
      reason: 'account_unavailable',
    });
    expect(await current.snapshot()).toBe(before);
  });

  it('EVM-016 AC1 two runs at the same time never leave two valid links: exactly one link works afterwards', async () => {
    const [one, two] = await Promise.all([
      bootstrap().run({ mode: 'activation', email: ADMIN }, cli),
      bootstrap().run({ mode: 'activation', email: 'zapasowy@evia.invalid' }, { ...cli, traceId: 'f'.repeat(32) }),
    ]);
    if (one.kind !== 'issued' || two.kind !== 'issued') throw new Error('expected links');
    const statuses = [
      (await current.panel().post(PATHS.check, { token: one.token })).status,
      (await current.panel().post(PATHS.check, { token: two.token })).status,
    ];
    expect(statuses.sort()).toEqual([200, 400]);
    expect(await db().selectFrom('identity.users').select('id').where('status', '=', 'invited').execute()).toHaveLength(1);
    expect(await db().selectFrom('identity.one_time_links').select('id').where('superseded_at', 'is', null).execute()).toHaveLength(1);
  });
});

describe('the command with an active Administrator (EVM-016 AC2; RR-16, SR-LOG-07)', () => {
  it('EVM-016 AC2 without the emergency mode it is refused and nothing in the database changes, in any table', async () => {
    await activateAdministrator(current, ADMIN);
    const before = await current.snapshot();
    for (const email of [ADMIN, 'inny@evia.invalid']) {
      expect(await bootstrap().run({ mode: 'activation', email }, cli)).toEqual({ kind: 'refused', reason: 'active_administrator_exists' });
    }
    const { io, output } = terminal(ADMIN);
    expect(await executeBootstrap([], io, { bootstrap: bootstrap(), panelOrigin: current.config.panelOrigin })).toBe(EXIT_REFUSED);
    expect(output()).toMatch(/aktywny Administrator/);
    expect(output()).not.toMatch(/#|https:/);
    expect(await current.snapshot()).toBe(before);
  });

  it('EVM-016 AC2 the emergency mode returns the account to "requires activation": credentials deleted, sessions ended with 401 session_revoked, new link, audit and alert', async () => {
    const { panel, user } = await activateAdministrator(current, ADMIN);
    const before = await db().selectFrom('identity.users').selectAll().where('id', '=', user.id).executeTakeFirstOrThrow();
    const oldCookie = panel.cookie;
    current.clock.advance(3_600_000);
    const trace = 'a1'.repeat(16);
    const result = await bootstrap().run({ mode: 'emergency', email: ADMIN, reason: 'lost_device' }, { origin: 'cli', traceId: trace });
    expect(result.kind).toBe('issued');
    if (result.kind !== 'issued') return;

    const account = await db().selectFrom('identity.users').selectAll().where('id', '=', user.id).executeTakeFirstOrThrow();
    expect(account).toMatchObject({ status: 'invited', role: 'administrator', email: ADMIN, version: before.version + 1 });
    expect(account.webauthn_user_handle.equals(before.webauthn_user_handle)).toBe(true);
    expect(await db().selectFrom('identity.password_credentials').selectAll().execute()).toEqual([]);
    expect(await db().selectFrom('identity.passkeys').selectAll().execute()).toEqual([]);
    expect(await db().selectFrom('identity.sessions').select('revoke_reason').execute()).toEqual(
      expect.arrayContaining([{ revoke_reason: 'emergency_reset' }]),
    );
    expect(await db().selectFrom('identity.sessions').select('id').where('revoked_at', 'is', null).execute()).toEqual([]);

    const stale = current.panel();
    stale.cookie = oldCookie;
    const view = await stale.get(PATHS.session);
    expect(view.status).toBe(401);
    expect(view.body).toMatchObject({ code: 'session_revoked' });

    const links = await db()
      .selectFrom('identity.one_time_links')
      .select(['used_at', 'superseded_at', 'expires_at'])
      .orderBy('issued_at')
      .execute();
    expect(links).toHaveLength(2);
    expect(links[1]).toMatchObject({ used_at: null, superseded_at: null, expires_at: new Date('2026-10-04T09:00:00Z') });

    const { rows } = await sql<{ action: string; reason_code: string | null; actor_type: string; origin: string; trace_id: string }>`
      select action, reason_code, actor_type, origin, trace_id from audit.events where occurred_at = ${current.clock.now()} order by id`.execute(
      current.database.admin,
    );
    expect(rows.map((row) => `${row.action}:${row.reason_code ?? '-'}`)).toEqual([
      'account.emergency_reset:lost_device',
      'session.revoked:emergency_reset',
      'activation_link.issued:-',
    ]);
    expect(rows.every((row) => row.actor_type === 'system' && row.origin === 'cli' && row.trace_id === trace)).toBe(true);

    const alerts = await sql<{
      alert_code: string;
      trace_id: string;
      emitted_at: Date | null;
    }>`select alert_code, trace_id, emitted_at from platform.security_alert_outbox`.execute(current.database.admin);
    expect(alerts.rows).toEqual([{ alert_code: 'emergency_reset', trace_id: trace, emitted_at: null }]);
    expect(JSON.stringify(alerts.rows)).not.toMatch(/@|administrator|[A-Za-z0-9_-]{43}/);
  });

  it('EVM-016 AC2 after the reset the Administrator activates the account again with the new link: password, then a new passkey', async () => {
    const { user } = await activateAdministrator(current, ADMIN);
    const result = await bootstrap().run({ mode: 'emergency', email: ADMIN, reason: 'lost_credentials' }, cli);
    if (result.kind !== 'issued') throw new Error('expected a link');
    current.clock.advance(61_000);
    const panel = current.panel();
    expect((await setPassword(panel, result.token, 'Another-Orbit-Lamp-7')).status).toBe(200);
    const { options } = await passkeyOptions(panel);
    expect((await registerPasskey(panel, options, new VirtualAuthenticator())).status).toBe(201);
    expect((await db().selectFrom('identity.users').select('status').where('id', '=', user.id).executeTakeFirstOrThrow()).status).toBe(
      'active',
    );
    expect(await db().selectFrom('identity.passkeys').select('id').execute()).toHaveLength(1);
  });

  it('EVM-016 AC2 the alert is emitted by the API process: one error entry with the stable fields, no address and no token, then marked as emitted', async () => {
    await activateAdministrator(current, ADMIN);
    const result = await bootstrap().run({ mode: 'emergency', email: ADMIN, reason: 'suspected_compromise' }, cli);
    if (result.kind !== 'issued') throw new Error('expected a link');
    const emitter = current.app.get<SecurityAlertEmitter>(SECURITY_ALERT_EMITTER);
    expect(await emitter.emitPending()).toBe(1);
    expect(await emitter.emitPending()).toBe(0);
    const alerts = current.logs.entries.filter((entry) => entry['alert'] === 'security');
    expect(alerts).toEqual([
      expect.objectContaining({
        level: 'error',
        msg: 'security alert',
        alert: 'security',
        alertCode: 'emergency_reset',
        alertTraceId: cli.traceId,
      }),
    ]);
    expect(JSON.stringify(alerts)).not.toMatch(/@|administrator/);
    expect(current.logs.text).not.toContain(result.token);
    const stored = await sql<{ emitted_at: Date | null }>`select emitted_at from platform.security_alert_outbox`.execute(
      current.database.admin,
    );
    expect(stored.rows).toEqual([{ emitted_at: current.clock.now() }]);
  });

  it('EVM-016 AC2 every refusal of the emergency mode is the same and changes nothing: unknown address, other roles, pending and deactivated accounts, no Administrator at all', async () => {
    const empty = await bootstrap().run({ mode: 'emergency', email: ADMIN, reason: 'other' }, cli);
    expect(empty).toEqual({ kind: 'refused', reason: 'account_unavailable' });
    await activateAdministrator(current, ADMIN);
    await createUser(current.database.admin, current.clock, { role: 'editor', status: 'active', email: 'edytor@evia.invalid' });
    await createUser(current.database.admin, current.clock, { role: 'administrator', status: 'invited', email: 'oczekujacy@evia.invalid' });
    await createUser(current.database.admin, current.clock, {
      role: 'administrator',
      status: 'deactivated',
      email: 'dezaktywowany@evia.invalid',
    });
    const before = await current.snapshot();
    for (const email of ['nieznany@evia.invalid', 'edytor@evia.invalid', 'oczekujacy@evia.invalid', 'dezaktywowany@evia.invalid']) {
      expect(await bootstrap().run({ mode: 'emergency', email, reason: 'lost_device' }, cli), email).toEqual({
        kind: 'refused',
        reason: 'account_unavailable',
      });
    }
    expect(await current.snapshot()).toBe(before);
  });

  it('EVM-016 AC2 the emergency mode also ends every unused link of any account and the sessions started with them (W8)', async () => {
    await activateAdministrator(current, ADMIN);
    const waiting = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'invited',
      email: 'zaproszony@evia.invalid',
    });
    const otherLink = await createLink(current.database.admin, current.clock, waiting.id);
    const enrolment = await createSession(current.database.admin, current.clock, waiting, {
      state: 'mfa_enrollment',
      linkId: otherLink.id,
    });
    const result = await bootstrap().run({ mode: 'emergency', email: ADMIN, reason: 'other' }, cli);
    expect(result.kind).toBe('issued');
    const stored = await db()
      .selectFrom('identity.one_time_links')
      .select('superseded_at')
      .where('id', '=', otherLink.id)
      .executeTakeFirstOrThrow();
    expect(stored.superseded_at).toEqual(current.clock.now());
    const session = await db()
      .selectFrom('identity.sessions')
      .select('revoke_reason')
      .where('id', '=', enrolment.id)
      .executeTakeFirstOrThrow();
    expect(session.revoke_reason).toBe('link_superseded');
  });

  it('EVM-016 AC2 two emergency runs at the same time leave exactly one valid link', async () => {
    await activateAdministrator(current, ADMIN);
    const [one, two] = await Promise.all([
      bootstrap().run({ mode: 'emergency', email: ADMIN, reason: 'lost_device' }, cli),
      bootstrap().run({ mode: 'emergency', email: ADMIN, reason: 'lost_device' }, { ...cli, traceId: 'b2'.repeat(16) }),
    ]);
    // the second run no longer finds an active Administrator (the first one reset the account)
    expect([one.kind, two.kind].sort()).toEqual(['issued', 'refused']);
    expect(
      await db()
        .selectFrom('identity.one_time_links')
        .select('id')
        .where('superseded_at', 'is', null)
        .where('used_at', 'is', null)
        .execute(),
    ).toHaveLength(1);
    expect(
      await sql`select 1 from platform.security_alert_outbox`.execute(current.database.admin).then((result) => result.rows),
    ).toHaveLength(1);
  });
});
