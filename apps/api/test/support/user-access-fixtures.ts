/**
 * Helpers of the tests of the administration of accounts (EVM-027): the five operations as the panel sends them (with `If-Match`), accounts with a
 * known number of sessions, and reads of the tables the story touches. Synthetic data only.
 */
import { sql } from 'kysely';
import type { Response } from 'supertest';
import type { IdentityApp } from './identity-app.ts';
import { createPasskey, createSession, createUser, type Role, type SessionFixture, type UserFixture } from './identity-fixtures.ts';
import { PATHS } from './flows.ts';
import { USERS, type Browser } from './invitation-fixtures.ts';
import { PanelClient } from './panel-client.ts';
import { PANEL_ORIGIN } from './app.ts';

export const etag = (version: number): string => `"${version}"`;

export async function versionOf(app: IdentityApp, userId: string): Promise<number> {
  const { rows } = await sql<{ version: number }>`select version from identity.users where id = ${userId}`.execute(app.database.admin);
  return rows[0]?.version ?? 0;
}

export async function userRow(app: IdentityApp, userId: string) {
  const { rows } = await sql<{
    role: Role;
    status: string;
    version: number;
    activated_at: Date | null;
    deactivated_at: Date | null;
    updated_by: string | null;
  }>`select role, status, version, activated_at, deactivated_at, updated_by from identity.users where id = ${userId}`.execute(
    app.database.admin,
  );
  return rows[0];
}

/** The role change as the panel sends it; `version` defaults to the current one in the database. */
export async function changeRole(app: IdentityApp, admin: Browser, userId: string, role: string, version?: number): Promise<Response> {
  return admin.panel.put(`${USERS}/${userId}/role`, { role }, { 'If-Match': etag(version ?? (await versionOf(app, userId))) });
}

export async function deactivate(app: IdentityApp, admin: Browser, userId: string, version?: number): Promise<Response> {
  return admin.panel.post(`${USERS}/${userId}/deactivation`, undefined, { 'If-Match': etag(version ?? (await versionOf(app, userId))) });
}

export async function reactivate(app: IdentityApp, admin: Browser, userId: string, version?: number): Promise<Response> {
  return admin.panel.post(`${USERS}/${userId}/reactivation`, undefined, { 'If-Match': etag(version ?? (await versionOf(app, userId))) });
}

export function endSessions(admin: Browser, userId: string): Promise<Response> {
  return Promise.resolve(admin.panel.delete(`${USERS}/${userId}/sessions`));
}

export async function resetSecondStep(
  app: IdentityApp,
  admin: Browser,
  userId: string,
  options: { version?: number; verification?: string } = {},
): Promise<Response> {
  return admin.panel.post(
    `${USERS}/${userId}/second-step-reset`,
    { identityVerification: options.verification ?? 'in_person' },
    { 'If-Match': etag(options.version ?? (await versionOf(app, userId))) },
  );
}

export interface Held {
  readonly user: UserFixture;
  readonly sessions: Array<{ readonly panel: PanelClient; readonly session: SessionFixture }>;
}

/** An account with `count` sessions (each in its own browser); `key`: the account has a passkey (a row — it never verifies anything). */
export async function accountWithSessions(
  app: IdentityApp,
  options: { role?: Role; status?: 'invited' | 'active' | 'deactivated'; count?: number; key?: boolean; email?: string } = {},
): Promise<Held> {
  const user = await createUser(app.database.admin, app.clock, {
    role: options.role ?? 'editor',
    status: options.status ?? 'active',
    ...(options.email === undefined ? {} : { email: options.email }),
  });
  if (options.key === true) await createPasskey(app.database.admin, app.clock, user);
  const sessions: Held['sessions'] = [];
  for (let index = 0; index < (options.count ?? 2); index += 1) {
    const session = await createSession(app.database.admin, app.clock, user);
    const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
    panel.cookie = session.cookie;
    panel.csrfToken = session.csrfToken;
    sessions.push({ panel, session });
  }
  return { user, sessions };
}

/** The first (here: only) session of an account made by {@link accountWithSessions}. */
export function firstSession(held: Held): Held['sessions'][number] {
  const [first] = held.sessions;
  if (first === undefined) throw new Error('the account has no session');
  return first;
}

/** What the session says to the next request: the status and the code of the problem. */
export async function sessionAnswer(panel: PanelClient): Promise<{ status: number; code: string | undefined }> {
  const response = await panel.get(PATHS.session);
  return { status: response.status, code: (response.body as { code?: string }).code };
}

export async function revokedSessions(app: IdentityApp, userId: string): Promise<Array<{ revoke_reason: string | null; state: string }>> {
  const { rows } = await sql<{ revoke_reason: string | null; state: string }>`
    select revoke_reason, state from identity.sessions where user_id = ${userId} and revoked_at is not null order by created_at, id`.execute(
    app.database.admin,
  );
  return rows;
}

export async function auditOf(
  app: IdentityApp,
  action: string,
): Promise<
  Array<{
    actor_user_id: string | null;
    object_id: string | null;
    outcome: string;
    reason_code: string | null;
    from_code: string | null;
    to_code: string | null;
  }>
> {
  const { rows } = await sql<{
    actor_user_id: string | null;
    object_id: string | null;
    outcome: string;
    reason_code: string | null;
    from_code: string | null;
    to_code: string | null;
  }>`select actor_user_id, object_id, outcome, reason_code, from_code, to_code from audit.events where action = ${action} order by occurred_at, id`.execute(
    app.database.admin,
  );
  return rows;
}

export async function alertRows(app: IdentityApp): Promise<Array<{ recipient_user_id: string; variant: string | null }>> {
  const { rows } = await sql<{ recipient_user_id: string; variant: string | null }>`
    select recipient_user_id, variant from platform.email_outbox where kind = 'administrator_alert' order by created_at, id`.execute(
    app.database.admin,
  );
  return rows;
}
