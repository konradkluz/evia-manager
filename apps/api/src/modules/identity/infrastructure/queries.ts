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
  readonly revokeReason: RevokeReason | null;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
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
      's.revoke_reason as revokeReason',
      's.last_seen_at as lastSeenAt',
      's.idle_expires_at as idleExpiresAt',
      's.absolute_expires_at as absoluteExpiresAt',
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
    revokeReason: row.revokeReason,
    lastSeenAt: row.lastSeenAt,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
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

/** Revokes the open session of a session token (the cookie of a request) — rotation at sign-in; @returns the ids revoked. */
export async function revokeSessionByTokenHash(db: IdentityDb, tokenHash: Buffer, reason: RevokeReason, now: Date): Promise<string[]> {
  const rows = await db
    .updateTable('identity.sessions')
    .set({ revoked_at: now, revoke_reason: reason })
    .where('token_hash', '=', tokenHash)
    .where('revoked_at', 'is', null)
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Moves the idle deadline of a session that is still alive. The deadlines are part of the condition, so a session that
 * has run out never comes back (it is not decided from a value read earlier — SR-SESS-03, CWE-613).
 * @returns the deadlines after the change, or undefined when the session is over (revoked or expired)
 */
export async function slideSession(
  db: IdentityDb,
  sessionId: string,
  now: Date,
  idleExpiresAt: Date,
): Promise<{ idleExpiresAt: Date; absoluteExpiresAt: Date } | undefined> {
  const row = await db
    .updateTable('identity.sessions')
    .set({ last_seen_at: now, idle_expires_at: idleExpiresAt })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .where('idle_expires_at', '>', now)
    .where('absolute_expires_at', '>', now)
    .returning(['idle_expires_at', 'absolute_expires_at'])
    .executeTakeFirst();
  return row === undefined ? undefined : { idleExpiresAt: row.idle_expires_at, absoluteExpiresAt: row.absolute_expires_at };
}

export interface LoginUser {
  readonly userId: string;
  readonly role: UsersTable['role'];
  readonly status: UsersTable['status'];
  readonly passwordHash: string | null;
}

/** The account of a normalised e-mail with its password hash — one query, the same work for every outcome. */
export async function findLoginUser(db: IdentityDb, email: string): Promise<LoginUser | undefined> {
  const row = await db
    .selectFrom('identity.users as u')
    .leftJoin('identity.password_credentials as c', 'c.user_id', 'u.id')
    .select(['u.id as userId', 'u.role', 'u.status', 'c.password_hash as passwordHash'])
    .where('u.email', '=', email)
    .where('u.deleted_at', 'is', null)
    .executeTakeFirst();
  return row;
}

export async function hasPasskey(db: IdentityDb, userId: string): Promise<boolean> {
  const row = await db.selectFrom('identity.passkeys').select('id').where('user_id', '=', userId).limit(1).executeTakeFirst();
  return row !== undefined;
}

export interface LoginAttemptRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly failedAttempts: number;
}

export async function insertLoginAttempt(
  db: IdentityDb,
  attempt: { userId: string; tokenHash: Buffer; now: Date; expiresAt: Date },
): Promise<string> {
  const row = await db
    .insertInto('identity.login_attempts')
    .values({
      user_id: attempt.userId,
      token_hash: attempt.tokenHash,
      created_at: attempt.now,
      expires_at: attempt.expiresAt,
      used_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Deletes the attempts that expired before `cutoff` (their challenges go with them: ON DELETE CASCADE). */
export async function deleteStaleLoginAttempts(db: IdentityDb, cutoff: Date): Promise<void> {
  await db.deleteFrom('identity.login_attempts').where('expires_at', '<', cutoff).execute();
}

/** The attempt of a token hash; `lock` serialises concurrent verifications of the same attempt (FOR UPDATE). */
export async function findLoginAttempt(db: IdentityDb, tokenHash: Buffer, lock: boolean = false): Promise<LoginAttemptRecord | undefined> {
  let query = db
    .selectFrom('identity.login_attempts')
    .select(['id', 'user_id as userId', 'expires_at as expiresAt', 'used_at as usedAt', 'failed_attempts as failedAttempts'])
    .where('token_hash', '=', tokenHash);
  if (lock) query = query.forUpdate();
  return query.executeTakeFirst();
}

export async function storeLoginChallenge(
  db: IdentityDb,
  challenge: { userId: string; attemptId: string; challengeHash: Buffer; now: Date; expiresAt: Date },
): Promise<void> {
  // One open challenge per attempt: asking for new options retires the earlier ones.
  await db
    .updateTable('identity.webauthn_challenges')
    .set({ used_at: challenge.now })
    .where('login_attempt_id', '=', challenge.attemptId)
    .where('used_at', 'is', null)
    .execute();
  await db
    .insertInto('identity.webauthn_challenges')
    .values({
      user_id: challenge.userId,
      session_id: null,
      login_attempt_id: challenge.attemptId,
      purpose: 'passkey_authentication',
      challenge_hash: challenge.challengeHash,
      created_at: challenge.now,
      expires_at: challenge.expiresAt,
      used_at: null,
    })
    .execute();
}

/** Atomically consumes every open challenge of the attempt; @returns their hashes (at most one is ever open). */
export async function consumeLoginChallenges(db: IdentityDb, attemptId: string, now: Date): Promise<Buffer[]> {
  const rows = await db
    .updateTable('identity.webauthn_challenges')
    .set({ used_at: now })
    .where('login_attempt_id', '=', attemptId)
    .where('purpose', '=', 'passkey_authentication')
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .returning('challenge_hash')
    .execute();
  return rows.map((row) => row.challenge_hash);
}

/** The key of this account (never of another one: the credential id alone is not an identity — SR-AUTH-09). */
export async function findPasskeyOfUser(db: IdentityDb, userId: string, credentialId: string) {
  return db
    .selectFrom('identity.passkeys')
    .select(['id', 'credential_id', 'public_key', 'counter', 'transports'])
    .where('user_id', '=', userId)
    .where('credential_id', '=', credentialId)
    .executeTakeFirst();
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

/** Counts a failed key; the attempt that reaches `limit` is ended at once (the next call finds it used). */
export async function recordFailedKey(db: IdentityDb, attemptId: string, now: Date, limit: number): Promise<void> {
  await db
    .updateTable('identity.login_attempts')
    .set({
      failed_attempts: sql<number>`failed_attempts + 1`,
      used_at: sql<Date | null>`case when failed_attempts + 1 >= ${limit} then ${now}::timestamptz else used_at end`,
    })
    .where('id', '=', attemptId)
    .execute();
}

/** Atomically spends the attempt (single use, within its lifetime); @returns false when it was already spent or has expired. */
export async function consumeLoginAttempt(db: IdentityDb, attemptId: string, now: Date): Promise<boolean> {
  const row = await db
    .updateTable('identity.login_attempts')
    .set({ used_at: now })
    .where('id', '=', attemptId)
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** The sign-in with a key: the counter the authenticator reported and the time of use. */
export async function recordKeyUse(db: IdentityDb, passkeyId: string, counter: number, now: Date): Promise<void> {
  await db.updateTable('identity.passkeys').set({ counter, last_used_at: now }).where('id', '=', passkeyId).execute();
}

/** The account signed in: `lastLoginAt` only (the row is not edited by a person, so `version` stays). */
export async function recordLogin(db: IdentityDb, userId: string, now: Date): Promise<void> {
  await db.updateTable('identity.users').set({ last_login_at: now }).where('id', '=', userId).execute();
}

/** Takes a transaction-scoped advisory lock (released at commit or rollback). */
export async function lockAdministrators(db: IdentityDb, key: number): Promise<void> {
  await sql`select pg_advisory_xact_lock(${key})`.execute(db);
}
