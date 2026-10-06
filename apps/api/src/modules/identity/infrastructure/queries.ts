/**
 * Queries of the `identity` module (Kysely builder only, parameters always bound — SR-INPUT-03). Time is always a
 * parameter taken from the application clock; there is no `now()` in SQL. Functions take a handle (pool or
 * transaction) narrowed to the identity tables, so a use case decides what runs in one transaction.
 */
import { sql } from 'kysely';
import type { IdentityDb, RevokeReason, SessionsTable, UsersTable } from './tables.ts';

export interface LinkRecord {
  readonly linkId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UsersTable['role'];
  readonly userStatus: UsersTable['status'];
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly supersededAt: Date | null;
}

/** A link opens an activation only while it is unused, not superseded, not expired and its account still waits for it. */
export const isLinkUsable = (link: LinkRecord, now: Date): boolean =>
  link.usedAt === null && link.supersededAt === null && link.expiresAt > now && link.userStatus === 'invited';

/** One query by the unique hash — the same work for every outcome (unknown, used, expired, superseded). */
export async function findLinkByTokenHash(db: IdentityDb, tokenHash: Buffer, lock: boolean = false): Promise<LinkRecord | undefined> {
  let query = db
    .selectFrom('identity.one_time_links as l')
    .innerJoin('identity.users as u', 'u.id', 'l.user_id')
    .select([
      'l.id as linkId',
      'u.id as userId',
      'u.email',
      'u.display_name as displayName',
      'u.role',
      'u.status as userStatus',
      'l.expires_at as expiresAt',
      'l.used_at as usedAt',
      'l.superseded_at as supersededAt',
    ])
    .where('l.token_hash', '=', tokenHash)
    .where('l.purpose', '=', 'account_activation');
  if (lock) query = query.forUpdate();
  return query.executeTakeFirst();
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly userId: string;
  readonly channel: SessionsTable['channel'];
  readonly state: SessionsTable['state'];
  readonly revokedAt: Date | null;
  readonly role: UsersTable['role'];
  readonly userStatus: UsersTable['status'];
  readonly link: { readonly usedAt: Date | null; readonly supersededAt: Date | null; readonly expiresAt: Date } | null;
}

/** The session of a token hash with its account and, for an enrolment session, its link — one query per request. */
export async function findSessionByTokenHash(db: IdentityDb, tokenHash: Buffer): Promise<SessionRecord | undefined> {
  const row = await db
    .selectFrom('identity.sessions as s')
    .innerJoin('identity.users as u', 'u.id', 's.user_id')
    .leftJoin('identity.one_time_links as l', 'l.id', 's.one_time_link_id')
    .select([
      's.id as sessionId',
      's.user_id as userId',
      's.channel',
      's.state',
      's.revoked_at as revokedAt',
      'u.role',
      'u.status as userStatus',
      'l.id as linkId',
      'l.used_at as linkUsedAt',
      'l.superseded_at as linkSupersededAt',
      'l.expires_at as linkExpiresAt',
    ])
    .where('s.token_hash', '=', tokenHash)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    channel: row.channel,
    state: row.state,
    revokedAt: row.revokedAt,
    role: row.role,
    userStatus: row.userStatus,
    link:
      row.linkId === null || row.linkExpiresAt === null
        ? null
        : { usedAt: row.linkUsedAt, supersededAt: row.linkSupersededAt, expiresAt: row.linkExpiresAt },
  };
}

export interface NewSession {
  readonly userId: string;
  readonly channel: SessionsTable['channel'];
  readonly state: SessionsTable['state'];
  readonly tokenHash: Buffer;
  readonly linkId: string | null;
  readonly now: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

/** Sizes of the stored client data (P9): the address is stored in full for 30 days, the agent is cut to 512 characters. */
const USER_AGENT_LIMIT = 512;

export async function insertSession(db: IdentityDb, session: NewSession): Promise<string> {
  const row = await db
    .insertInto('identity.sessions')
    .values({
      user_id: session.userId,
      channel: session.channel,
      state: session.state,
      token_hash: session.tokenHash,
      one_time_link_id: session.linkId,
      created_at: session.now,
      last_seen_at: session.now,
      last_authenticated_at: session.now,
      idle_expires_at: session.idleExpiresAt,
      absolute_expires_at: session.absoluteExpiresAt,
      revoked_at: null,
      revoke_reason: null,
      ip_address: session.ip ?? null,
      user_agent: session.userAgent?.slice(0, USER_AGENT_LIMIT) ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Revokes the open sessions matching the filter; @returns the ids revoked (one audit event each). */
export async function revokeSessions(
  db: IdentityDb,
  filter: { readonly sessionId?: string; readonly userId?: string; readonly linkIds?: readonly string[] },
  reason: RevokeReason,
  now: Date,
): Promise<string[]> {
  let query = db.updateTable('identity.sessions').set({ revoked_at: now, revoke_reason: reason }).where('revoked_at', 'is', null);
  if (filter.sessionId !== undefined) query = query.where('id', '=', filter.sessionId);
  if (filter.userId !== undefined) query = query.where('user_id', '=', filter.userId);
  if (filter.linkIds !== undefined) {
    if (filter.linkIds.length === 0) return [];
    query = query.where('one_time_link_id', 'in', [...filter.linkIds]);
  }
  const rows = await query.returning('id').execute();
  return rows.map((row) => row.id);
}

export async function insertLink(
  db: IdentityDb,
  link: { userId: string; tokenHash: Buffer; issuedAt: Date; expiresAt: Date },
): Promise<string> {
  const row = await db
    .insertInto('identity.one_time_links')
    .values({
      user_id: link.userId,
      purpose: 'account_activation',
      token_hash: link.tokenHash,
      issued_by: 'cli',
      issued_at: link.issuedAt,
      expires_at: link.expiresAt,
      used_at: null,
      superseded_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Supersedes every unused, not yet superseded activation link; @returns their ids. */
export async function supersedeOpenLinks(db: IdentityDb, now: Date): Promise<string[]> {
  const rows = await db
    .updateTable('identity.one_time_links')
    .set({ superseded_at: now })
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .where('purpose', '=', 'account_activation')
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

/** Takes a transaction-scoped advisory lock (released at commit or rollback). */
export async function lockAdministrators(db: IdentityDb, key: number): Promise<void> {
  await sql`select pg_advisory_xact_lock(${key})`.execute(db);
}
