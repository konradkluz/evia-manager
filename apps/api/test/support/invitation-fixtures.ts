/**
 * Helpers of the tests of the invitation (EVM-024): an Administrator with a fresh key, the body of an invitation, the job of the
 * outbox over the database of the app under test with a fake of the port, and reads of the tables the story touches. Synthetic data only.
 */
import { sql, type Kysely } from 'kysely';
import {
  InvitationEmailComposer,
  LoginSecurityEmailComposer,
  MfaEmailComposer,
  PasswordEmailComposer,
} from '../../src/modules/identity/index.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { InMemoryEmailSender } from '../../src/platform/email/in-memory-email-sender.ts';
import { SendEmailJob } from '../../src/platform/email/send-email.job.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { DATABASE } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from './app.ts';
import type { IdentityApp } from './identity-app.ts';
import { createSession, createUser, type Role, type UserFixture } from './identity-fixtures.ts';
import { PanelClient } from './panel-client.ts';
import { uuidv7 } from './uuid.ts';

export const USERS = '/api/v1/users';
export const MINUTE = 60_000;

export interface Browser {
  readonly panel: PanelClient;
  readonly user: UserFixture;
  readonly sessionId: string;
}

/** A browser of a user: `fresh` — the key was used just now (the window of a step-up is open), `stale` — 16 minutes ago, `none` — never. */
export async function browserOf(
  app: IdentityApp,
  options: {
    role?: Role;
    key?: 'fresh' | 'stale' | 'none';
    channel?: 'web' | 'mobile';
    state?: 'active' | 'mfa_enrollment';
    displayName?: string;
    email?: string;
  } = {},
): Promise<Browser> {
  const user = await createUser(app.database.admin, app.clock, {
    role: options.role ?? 'administrator',
    ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
    ...(options.email === undefined ? {} : { email: options.email }),
  });
  const key = options.key ?? 'fresh';
  const session = await createSession(app.database.admin, app.clock, user, {
    ...(options.channel === undefined ? {} : { channel: options.channel }),
    ...(options.state === undefined ? {} : { state: options.state }),
    ...(key === 'none' ? {} : { passkeyAuthenticatedAt: new Date(app.clock.now().getTime() - (key === 'fresh' ? 0 : 16 * MINUTE)) }),
  });
  const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { panel, user, sessionId: session.id };
}

export interface InviteBody {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export const inviteBody = (overrides: Partial<InviteBody> = {}): InviteBody => ({
  id: uuidv7(),
  email: 'anna.testowa@example.com',
  displayName: 'Anna Testowa',
  role: 'editor',
  ...overrides,
});

/** An invitation as the panel sends it: the body and a fresh `Idempotency-Key`. */
export const invite = (browser: Browser, body: InviteBody | Record<string, unknown> = inviteBody(), key: string = uuidv7()) =>
  browser.panel.post(USERS, body, { 'Idempotency-Key': key });

export interface Harness {
  readonly job: SendEmailJob;
  readonly sender: InMemoryEmailSender;
}

/** The job of the outbox over the database of the app, with the composer of the identity module and a fake of the port. */
export function emailHarness(app: IdentityApp, sender: InMemoryEmailSender = new InMemoryEmailSender()): Harness {
  const db = app.app.get<Kysely<Database>>(DATABASE, { strict: false });
  const job = new SendEmailJob({
    db,
    clock: app.clock,
    logger: createLogger({ level: 'fatal' }),
    sender,
    composers: [
      app.app.get(InvitationEmailComposer, { strict: false }),
      app.app.get(PasswordEmailComposer, { strict: false }),
      app.app.get(MfaEmailComposer, { strict: false }),
      app.app.get(LoginSecurityEmailComposer, { strict: false }),
    ],
  });
  return { job, sender };
}

export interface OutboxRow {
  id: string;
  kind: string;
  variant: string | null;
  recipient_user_id: string;
  state: string;
  attempts: number;
  enqueued_at: Date | null;
  sent_at: Date | null;
}

export async function outboxRows(app: IdentityApp, where: { recipient?: string; kind?: string } = {}): Promise<OutboxRow[]> {
  const { rows } = await sql<OutboxRow>`
    select id, kind, variant, recipient_user_id, state, attempts, enqueued_at, sent_at from platform.email_outbox
    where (${where.recipient ?? null}::uuid is null or recipient_user_id = ${where.recipient ?? null}::uuid)
      and (${where.kind ?? null}::text is null or kind = ${where.kind ?? null}::text)
    order by created_at, id`.execute(app.database.admin);
  return rows;
}

export interface LinkRow {
  id: string;
  user_id: string;
  token_hash: Buffer;
  issued_by: string;
  issued_at: Date;
  expires_at: Date;
  used_at: Date | null;
  superseded_at: Date | null;
}

export async function linksOf(app: IdentityApp, userId: string): Promise<LinkRow[]> {
  const { rows } = await sql<LinkRow>`
    select id, user_id, token_hash, issued_by, issued_at, expires_at, used_at, superseded_at from identity.one_time_links
    where user_id = ${userId} order by issued_at, id`.execute(app.database.admin);
  return rows;
}

export async function auditActions(app: IdentityApp): Promise<
  Array<{
    action: string;
    actor_type: string;
    actor_user_id: string | null;
    object_id: string | null;
    outcome: string;
    reason_code: string | null;
  }>
> {
  const { rows } = await sql<{
    action: string;
    actor_type: string;
    actor_user_id: string | null;
    object_id: string | null;
    outcome: string;
    reason_code: string | null;
  }>`
    select action, actor_type, actor_user_id, object_id, outcome, reason_code from audit.events order by occurred_at, id`.execute(
    app.database.admin,
  );
  return rows;
}

/** Everything the database holds that the story touches, as text — to prove that something never reached any table. */
export async function everythingAsText(app: IdentityApp): Promise<string> {
  const db = app.database.admin;
  const queries = [
    ['identity.users', sql<{ row: string }>`select to_jsonb(t)::text as row from identity.users t`],
    ['identity.one_time_links', sql<{ row: string }>`select to_jsonb(t)::text as row from identity.one_time_links t`],
    ['identity.sessions', sql<{ row: string }>`select to_jsonb(t)::text as row from identity.sessions t`],
    ['platform.email_outbox', sql<{ row: string }>`select to_jsonb(t)::text as row from platform.email_outbox t`],
    ['platform.idempotency_records', sql<{ row: string }>`select to_jsonb(t)::text as row from platform.idempotency_records t`],
    ['platform.security_alert_outbox', sql<{ row: string }>`select to_jsonb(t)::text as row from platform.security_alert_outbox t`],
    ['audit.events', sql<{ row: string }>`select to_jsonb(t)::text as row from audit.events t`],
  ] as const;
  const parts: string[] = [];
  for (const [table, query] of queries) parts.push(...(await query.execute(db)).rows.map((row) => `${table} ${row.row}`));
  return parts.join(String.fromCharCode(10));
}

/** The link in the text of a message: the part after the origin of the panel. */
export function linkIn(text: string): { link: string; path: string; token: string } {
  const match = new RegExp(`^(${PANEL_ORIGIN.replaceAll('.', '\\.')}(/[a-z/-]*)#([A-Za-z0-9_-]{43}))$`, 'm').exec(text);
  if (match === null) throw new Error('no link with a token in the text');
  return { link: match[1] ?? '', path: match[2] ?? '', token: match[3] ?? '' };
}
