/**
 * Queries of the `identity` module (Kysely builder only, parameters always bound — SR-INPUT-03). Time is always a
 * parameter taken from the application clock; there is no `now()` in SQL. Functions take a handle (pool or
 * transaction) narrowed to the identity tables, so a use case decides what runs in one transaction.
 */
import { sql } from 'kysely';
import type { IdentityDb, OneTimeLinksTable, RevokeReason, SessionsTable, UsersTable } from './tables.ts';

export interface LinkRecord {
  readonly linkId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UsersTable['role'];
  readonly userStatus: UsersTable['status'];
  readonly userDeleted: boolean;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly supersededAt: Date | null;
}

/** A link opens an activation only while it is unused, not superseded, not expired and its account still waits for it. */
export const isLinkUsable = (link: LinkRecord, now: Date): boolean =>
  link.usedAt === null && link.supersededAt === null && link.expiresAt > now && link.userStatus === 'invited';

/**
 * A reset link opens a password reset only while it is unused, not superseded, not expired and its account is still ACTIVE and not deleted
 * (an invited account has no password to forget, a deactivated one must not come back this way — EVM-025 AC2).
 */
export const isResetLinkUsable = (link: LinkRecord, now: Date): boolean =>
  link.usedAt === null && link.supersededAt === null && link.expiresAt > now && link.userStatus === 'active' && !link.userDeleted;

/** One query by the unique hash — the same work for every outcome (unknown, used, expired, superseded). Activation links only. */
export function findLinkByTokenHash(db: IdentityDb, tokenHash: Buffer, lock: boolean = false): Promise<LinkRecord | undefined> {
  return findLinkOfPurpose(db, 'account_activation', tokenHash, lock);
}

/**
 * The link of a hash AND a purpose: the purpose is part of the condition, so a link of one kind never opens the route of the other
 * (EVM-025 K4; CWE-639). One query, the same work for every outcome.
 */
export async function findLinkOfPurpose(
  db: IdentityDb,
  purpose: OneTimeLinksTable['purpose'],
  tokenHash: Buffer,
  lock: boolean = false,
): Promise<LinkRecord | undefined> {
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
      'u.deleted_at as userDeletedAt',
      'l.expires_at as expiresAt',
      'l.used_at as usedAt',
      'l.superseded_at as supersededAt',
    ])
    .where('l.token_hash', '=', tokenHash)
    .where('l.purpose', '=', purpose);
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (row === undefined) return undefined;
  const { userDeletedAt, ...link } = row;
  return { ...link, userDeleted: userDeletedAt !== null };
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly userId: string;
  readonly channel: SessionsTable['channel'];
  readonly state: SessionsTable['state'];
  readonly revokedAt: Date | null;
  readonly revokeReason: RevokeReason | null;
  readonly lastSeenAt: Date;
  readonly passkeyAuthenticatedAt: Date | null;
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
      's.passkey_authenticated_at as passkeyAuthenticatedAt',
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
    passkeyAuthenticatedAt: row.passkeyAuthenticatedAt,
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
  /** Set only by an authentication with a passkey (sign-in with a key, step-up); null for every other origin of a session (SR-SESS-08). */
  readonly passkeyAuthenticatedAt: Date | null;
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
      passkey_authenticated_at: session.passkeyAuthenticatedAt,
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

/** The attempt of a token hash (single use is decided by the atomic `consumeLoginAttempt`, not by this read). */
export async function findLoginAttempt(db: IdentityDb, tokenHash: Buffer): Promise<LoginAttemptRecord | undefined> {
  return db
    .selectFrom('identity.login_attempts')
    .select(['id', 'user_id as userId', 'expires_at as expiresAt', 'used_at as usedAt'])
    .where('token_hash', '=', tokenHash)
    .executeTakeFirst();
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
  link: { userId: string; tokenHash: Buffer; issuedAt: Date; expiresAt: Date; issuedBy: OneTimeLinksTable['issued_by'] },
): Promise<string> {
  const row = await db
    .insertInto('identity.one_time_links')
    .values({
      user_id: link.userId,
      purpose: 'account_activation',
      token_hash: link.tokenHash,
      issued_by: link.issuedBy,
      issued_at: link.issuedAt,
      expires_at: link.expiresAt,
      used_at: null,
      superseded_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Supersedes the unused, not yet superseded activation links of ONE account; @returns their ids. An invitation or a resend must never end the
 * link of another person (SR-AUTH-12, ASVS V6.4.1, CWE-613, CWE-639): the filter on `user_id` is the whole point of this function.
 */
export async function supersedeOpenLinksOfUser(db: IdentityDb, userId: string, now: Date): Promise<string[]> {
  const rows = await db
    .updateTable('identity.one_time_links')
    .set({ superseded_at: now })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .where('purpose', '=', 'account_activation')
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

/** Supersedes every unused, not yet superseded activation link of EVERY account (the command that activates the first Administrator only); @returns their ids. */
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

/**
 * The challenge of a step-up, tied to the session of the request (purpose `passkey_step_up` — never mixed with an
 * enrolment or a sign-in challenge). One open challenge per session and purpose: asking for new options retires the
 * earlier one.
 */
export async function storeStepUpChallenge(
  db: IdentityDb,
  challenge: { userId: string; sessionId: string; challengeHash: Buffer; now: Date; expiresAt: Date },
): Promise<void> {
  await db
    .updateTable('identity.webauthn_challenges')
    .set({ used_at: challenge.now })
    .where('session_id', '=', challenge.sessionId)
    .where('purpose', '=', 'passkey_step_up')
    .where('used_at', 'is', null)
    .execute();
  await db
    .insertInto('identity.webauthn_challenges')
    .values({
      user_id: challenge.userId,
      session_id: challenge.sessionId,
      login_attempt_id: null,
      purpose: 'passkey_step_up',
      challenge_hash: challenge.challengeHash,
      created_at: challenge.now,
      expires_at: challenge.expiresAt,
      used_at: null,
    })
    .execute();
}

/** Atomically spends every open step-up challenge of the session of the user; @returns their hashes (at most one is ever open). */
export async function consumeStepUpChallenges(db: IdentityDb, sessionId: string, userId: string, now: Date): Promise<Buffer[]> {
  const rows = await db
    .updateTable('identity.webauthn_challenges')
    .set({ used_at: now })
    .where('session_id', '=', sessionId)
    .where('user_id', '=', userId)
    .where('purpose', '=', 'passkey_step_up')
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .returning('challenge_hash')
    .execute();
  return rows.map((row) => row.challenge_hash);
}

export interface RotatedSession {
  readonly channel: SessionsTable['channel'];
  readonly state: SessionsTable['state'];
  readonly absoluteExpiresAt: Date;
}

/**
 * Ends the session of the user for good (reason `rotated`) in one conditional UPDATE: only a session that is still alive —
 * not revoked, not past an idle or absolute deadline — is taken, so of two parallel rotations exactly one wins and a session
 * that ran out never comes back (SR-SESS-02, SR-SESS-03; CWE-384).
 * @returns what the replacement session inherits, or undefined when the session was already over
 */
export async function rotateSession(db: IdentityDb, sessionId: string, userId: string, now: Date): Promise<RotatedSession | undefined> {
  const row = await db
    .updateTable('identity.sessions')
    .set({ revoked_at: now, revoke_reason: 'rotated' })
    .where('id', '=', sessionId)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .where('idle_expires_at', '>', now)
    .where('absolute_expires_at', '>', now)
    .returning(['channel', 'state', 'absolute_expires_at'])
    .executeTakeFirst();
  return row === undefined ? undefined : { channel: row.channel, state: row.state, absoluteExpiresAt: row.absolute_expires_at };
}

/** The keys of an account in the form the options of a ceremony need. */
export async function listPasskeysOfUser(db: IdentityDb, userId: string) {
  return db.selectFrom('identity.passkeys').select(['credential_id', 'transports']).where('user_id', '=', userId).execute();
}

export interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UsersTable['role'];
  readonly status: UsersTable['status'];
  readonly deletedAt: Date | null;
}

const USER_COLUMNS = ['id', 'email', 'display_name as displayName', 'role', 'status', 'deleted_at as deletedAt'] as const;

/** The account of a normalised address — also a deleted one (the address stays taken: `users.email` is unique for every row). */
export async function findUserByEmail(db: IdentityDb, email: string): Promise<UserRow | undefined> {
  return db.selectFrom('identity.users').select(USER_COLUMNS).where('email', '=', email).executeTakeFirst();
}

/** The account by id, `FOR UPDATE` when `lock` — the FIRST lock of every unit of work that also locks an outbox row (the order of locks). */
export async function findUserById(db: IdentityDb, id: string, lock: boolean = false): Promise<UserRow | undefined> {
  let query = db.selectFrom('identity.users').select(USER_COLUMNS).where('id', '=', id);
  if (lock) query = query.forUpdate();
  return query.executeTakeFirst();
}

/** The active, not deleted Administrators: the recipients of an alert (SR-LOG-07). */
export async function listActiveAdministratorIds(db: IdentityDb): Promise<string[]> {
  const rows = await db
    .selectFrom('identity.users')
    .select('id')
    .where('role', '=', 'administrator')
    .where('status', '=', 'active')
    .where('deleted_at', 'is', null)
    .orderBy('id')
    .execute();
  return rows.map((row) => row.id);
}

export interface NewUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UsersTable['role'];
  readonly webauthnUserHandle: Buffer;
  readonly createdBy: string;
  readonly now: Date;
}

/** Inserts an account in the state `invited`. @returns false when the `id` is taken (an INSERT only: never an upsert, never a look at the content) */
export async function insertInvitedUser(db: IdentityDb, user: NewUser): Promise<boolean> {
  const row = await db
    .insertInto('identity.users')
    .values({
      id: user.id,
      email: user.email,
      display_name: user.displayName,
      role: user.role,
      status: 'invited',
      webauthn_user_handle: user.webauthnUserHandle,
      last_login_at: null,
      deactivated_at: null,
      created_at: user.now,
      created_by: user.createdBy,
      updated_at: user.now,
      updated_by: user.createdBy,
      deleted_at: null,
      deleted_by: null,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

export interface UserListRow extends UserRow {
  readonly lastLinkIssuedAt: Date | null;
  readonly lastLinkExpiresAt: Date | null;
  readonly lastLinkUsedAt: Date | null;
  readonly lastLinkSupersededAt: Date | null;
}

/** The display name of a user (the sort key of a cursor position) — also a deleted one, so a user deleted while someone pages keeps the position. */
export async function findDisplayName(db: IdentityDb, id: string): Promise<string | undefined> {
  const row = await db.selectFrom('identity.users').select('display_name').where('id', '=', id).executeTakeFirst();
  return row?.display_name;
}

export interface UserPageRequest {
  readonly limit: number;
  readonly after: { readonly displayName: string; readonly id: string } | undefined;
}

/**
 * ONE statement per page of the list of users (W-16): the accounts that are not deleted with their LATEST link (a lateral join, no query per
 * row), in the order of the list — the display name in the ICU `pl-PL` collation of the database, then the id — cut by a keyset (no OFFSET).
 * One row more than the limit is read to know whether a next page exists.
 */
export async function readUserPage(db: IdentityDb, request: UserPageRequest): Promise<UserListRow[]> {
  let query = db
    .selectFrom('identity.users as u')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('identity.one_time_links as l')
          .select(['l.issued_at', 'l.expires_at', 'l.used_at', 'l.superseded_at'])
          .whereRef('l.user_id', '=', 'u.id')
          .where('l.purpose', '=', 'account_activation')
          .orderBy('l.issued_at', 'desc')
          .orderBy('l.id', 'desc')
          .limit(1)
          .as('link'),
      (join) => join.onTrue(),
    )
    .select([
      'u.id',
      'u.email',
      'u.display_name as displayName',
      'u.role',
      'u.status',
      'u.deleted_at as deletedAt',
      'link.issued_at as lastLinkIssuedAt',
      'link.expires_at as lastLinkExpiresAt',
      'link.used_at as lastLinkUsedAt',
      'link.superseded_at as lastLinkSupersededAt',
    ])
    .where('u.deleted_at', 'is', null);
  const { after } = request;
  if (after !== undefined) {
    query = query.where((eb) => eb(eb.refTuple('u.display_name', 'u.id'), '>', eb.tuple(after.displayName, after.id)));
  }
  return query
    .orderBy('u.display_name')
    .orderBy('u.id')
    .limit(request.limit + 1)
    .execute();
}

/** The latest link of one account (the representation of the account after an invitation or a resend). */
export async function findLatestLink(db: IdentityDb, userId: string) {
  return db
    .selectFrom('identity.one_time_links')
    .select(['issued_at', 'expires_at', 'used_at', 'superseded_at'])
    .where('user_id', '=', userId)
    .where('purpose', '=', 'account_activation')
    .orderBy('issued_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
}

/** Stores the hash of a password reset link (issued by the worker when it sends the e-mail; `issued_by: password_reset`). @returns the id of the link */
export async function insertResetLink(
  db: IdentityDb,
  link: { userId: string; tokenHash: Buffer; issuedAt: Date; expiresAt: Date },
): Promise<string> {
  const row = await db
    .insertInto('identity.one_time_links')
    .values({
      user_id: link.userId,
      purpose: 'password_reset',
      token_hash: link.tokenHash,
      issued_by: 'password_reset',
      issued_at: link.issuedAt,
      expires_at: link.expiresAt,
      used_at: null,
      superseded_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Supersedes the unused, not yet superseded RESET links of ONE account (a newer link replaces the older ones). Both filters — the account and
 * the purpose — are the point: a reset never ends an activation link, and never the link of another person (EVM-025 K4; CWE-639).
 */
export async function supersedeOpenResetLinksOfUser(db: IdentityDb, userId: string, now: Date): Promise<string[]> {
  const rows = await db
    .updateTable('identity.one_time_links')
    .set({ superseded_at: now })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .where('purpose', '=', 'password_reset')
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

/** Spends a link (single use) conditionally; @returns false when it was already used. */
export async function markLinkUsed(db: IdentityDb, linkId: string, now: Date): Promise<boolean> {
  const row = await db
    .updateTable('identity.one_time_links')
    .set({ used_at: now })
    .where('id', '=', linkId)
    .where('used_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** Ends every open first step of the account (a `loginToken` made before a reset must not finish a sign-in after it). */
export async function revokeLoginAttemptsOfUser(db: IdentityDb, userId: string, now: Date): Promise<void> {
  await db
    .updateTable('identity.login_attempts')
    .set({ used_at: now })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .execute();
}
