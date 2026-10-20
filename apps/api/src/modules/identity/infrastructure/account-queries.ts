/**
 * Queries of the account of the user (EVM-028): the one-time mark of the full re-authentication, the keys and the sessions of the OWNER, the retention of
 * sessions. Every state change is a conditional UPDATE … RETURNING, so of two parallel requests exactly one wins (CWE-362); every query that names an object
 * carries the owner in its WHERE — an object of somebody else is simply not found (SR-AUTHZ-05, CWE-639). All parameterised (Kysely).
 */
import { sql } from 'kysely';
import { REAUTH_TTL_MS } from '../domain/constants.ts';
import type { ReauthPurpose, IdentityDb, RevokeReason } from './tables.ts';

/** The mark is valid in the window (now − 5 minutes, now]: a mark from the future (a clock moved back) is no mark (fail closed). */
const markWindow = (now: Date): { readonly from: Date; readonly to: Date } => ({ from: new Date(now.getTime() - REAUTH_TTL_MS), to: now });

/** Sets the mark on a session that is alive. @returns false when the session is over (nothing is set) */
export async function grantReauthMark(
  db: IdentityDb,
  sessionId: string,
  userId: string,
  purpose: ReauthPurpose,
  now: Date,
): Promise<boolean> {
  const row = await db
    .updateTable('identity.sessions')
    .set({ reauthenticated_at: now, reauth_purpose: purpose })
    .where('id', '=', sessionId)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .where('idle_expires_at', '>', now)
    .where('absolute_expires_at', '>', now)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** Is there a valid mark of this purpose on the session? A look only — it does not spend the mark (the options of a ceremony). */
export async function hasReauthMark(db: IdentityDb, sessionId: string, purpose: ReauthPurpose, now: Date): Promise<boolean> {
  const { from, to } = markWindow(now);
  const row = await db
    .selectFrom('identity.sessions')
    .select('id')
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .where('reauth_purpose', '=', purpose)
    .where('reauthenticated_at', '>', from)
    .where('reauthenticated_at', '<=', to)
    .executeTakeFirst();
  return row !== undefined;
}

/** Spends the mark: only a valid mark of THIS purpose on THIS session, once. @returns false when there is none (never set, other purpose, spent, too old) */
export async function consumeReauthMark(db: IdentityDb, sessionId: string, purpose: ReauthPurpose, now: Date): Promise<boolean> {
  const { from, to } = markWindow(now);
  const row = await db
    .updateTable('identity.sessions')
    .set({ reauthenticated_at: null, reauth_purpose: null })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .where('reauth_purpose', '=', purpose)
    .where('reauthenticated_at', '>', from)
    .where('reauthenticated_at', '<=', to)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

export interface PasskeySummary {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: Date;
  readonly deviceType: 'single_device' | 'multi_device';
  readonly backedUp: boolean;
}

/** The keys of the account, in the order they were added. */
export async function listPasskeySummaries(db: IdentityDb, userId: string): Promise<PasskeySummary[]> {
  return db
    .selectFrom('identity.passkeys')
    .select(['id', 'name', 'created_at as createdAt', 'device_type as deviceType', 'backed_up as backedUp'])
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

/** A key of THIS account (`FOR UPDATE` when `lock`); somebody else's key and a missing one are the same `undefined`. */
export async function findOwnPasskey(
  db: IdentityDb,
  userId: string,
  passkeyId: string,
  lock: boolean = false,
): Promise<{ id: string } | undefined> {
  let query = db.selectFrom('identity.passkeys').select('id').where('id', '=', passkeyId).where('user_id', '=', userId);
  if (lock) query = query.forUpdate();
  return query.executeTakeFirst();
}

export async function countPasskeys(db: IdentityDb, userId: string): Promise<number> {
  const row = await db
    .selectFrom('identity.passkeys')
    .select(sql<string>`count(*)`.as('count'))
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/** Deletes a key of THIS account. @returns false when there was none */
export async function deleteOwnPasskey(db: IdentityDb, userId: string, passkeyId: string): Promise<boolean> {
  const row = await db
    .deleteFrom('identity.passkeys')
    .where('id', '=', passkeyId)
    .where('user_id', '=', userId)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** The time the current generation of recovery codes was made, or undefined when the account has none (spent codes do not make it undefined). */
export async function currentRecoveryGenerationAt(db: IdentityDb, userId: string): Promise<Date | undefined> {
  const row = await db
    .selectFrom('identity.recovery_codes')
    .select(sql<Date>`min(created_at)`.as('generatedAt'))
    .where('user_id', '=', userId)
    .where('superseded_at', 'is', null)
    .executeTakeFirst();
  return row?.generatedAt ?? undefined;
}

export interface TotpSummary {
  readonly addedAt: Date;
}

/** The active code of the app (a pending one is not a method); the date is the confirmation. */
export async function findActiveTotpSummary(db: IdentityDb, userId: string): Promise<TotpSummary | undefined> {
  const row = await db
    .selectFrom('identity.totp_factors')
    .select('confirmed_at')
    .where('user_id', '=', userId)
    .where('state', '=', 'active')
    .executeTakeFirst();
  return row?.confirmed_at == null ? undefined : { addedAt: row.confirmed_at };
}

/** Changes the name shown to others. `version` stays: it rises with the managed changes of an Administrator only (EVM-027). */
export async function updateDisplayName(db: IdentityDb, userId: string, displayName: string, now: Date): Promise<void> {
  await db
    .updateTable('identity.users')
    .set({ display_name: displayName, updated_at: now, updated_by: userId })
    .where('id', '=', userId)
    .execute();
}

export async function findPasswordHash(db: IdentityDb, userId: string): Promise<string | undefined> {
  const row = await db.selectFrom('identity.password_credentials').select('password_hash').where('user_id', '=', userId).executeTakeFirst();
  return row?.password_hash;
}

export async function savePasswordHash(db: IdentityDb, userId: string, passwordHash: string, now: Date): Promise<void> {
  await db
    .insertInto('identity.password_credentials')
    .values({ user_id: userId, password_hash: passwordHash, updated_at: now })
    .onConflict((conflict) => conflict.column('user_id').doUpdateSet({ password_hash: passwordHash, updated_at: now }))
    .execute();
}

export interface OpenSessionRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** The sessions of the web channel that are alive and `active` (not revoked, not past a deadline), the oldest first (by the start, then the identifier). */
export async function listOpenWebSessions(db: IdentityDb, userId: string, now: Date): Promise<OpenSessionRow[]> {
  return db
    .selectFrom('identity.sessions')
    .select(['id', 'created_at as createdAt', 'last_seen_at as lastSeenAt', 'ip_address as ipAddress', 'user_agent as userAgent'])
    .where('user_id', '=', userId)
    .where('channel', '=', 'web')
    .where('state', '=', 'active')
    .where('revoked_at', 'is', null)
    .where('idle_expires_at', '>', now)
    .where('absolute_expires_at', '>', now)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

/** One lock per account for everything that starts an `active` session: of two parallel sign-ins the second waits and sees the first (the limit of five). */
export async function lockSessionStarts(db: IdentityDb, userId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`session-start:${userId}`}, 0))`.execute(db);
}

/** Ends ONE session of THIS account that is alive. @returns false when there is none (somebody else's, missing, already over) */
export async function revokeOwnSession(
  db: IdentityDb,
  userId: string,
  sessionId: string,
  reason: RevokeReason,
  now: Date,
): Promise<boolean> {
  const row = await db
    .updateTable('identity.sessions')
    .set({ revoked_at: now, revoke_reason: reason, reauthenticated_at: null, reauth_purpose: null })
    .where('id', '=', sessionId)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .where('idle_expires_at', '>', now)
    .where('absolute_expires_at', '>', now)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** Ends every other session of the account that is open; @returns the ids (one audit event each). */
export async function revokeOtherSessions(
  db: IdentityDb,
  userId: string,
  exceptSessionId: string,
  reason: RevokeReason,
  now: Date,
): Promise<string[]> {
  const rows = await db
    .updateTable('identity.sessions')
    .set({ revoked_at: now, revoke_reason: reason, reauthenticated_at: null, reauth_purpose: null })
    .where('user_id', '=', userId)
    .where('id', '<>', exceptSessionId)
    .where('revoked_at', 'is', null)
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

/** How many other sessions of the account are alive — what "Zakończ pozostałe sesje" would end. */
export async function countOtherAliveSessions(db: IdentityDb, userId: string, exceptSessionId: string, now: Date): Promise<number> {
  const row = await db
    .selectFrom('identity.sessions')
    .select(sql<string>`count(*)`.as('count'))
    .where('user_id', '=', userId)
    .where('id', '<>', exceptSessionId)
    .where('revoked_at', 'is', null)
    .where('idle_expires_at', '>', now)
    .where('absolute_expires_at', '>', now)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export interface SessionForEmail {
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly userAgent: string | null;
}

/** The session that the sixth sign-in ended at the moment `endedAt` (the oldest of them when several) — for e-mail 8. */
export async function findSessionEndedByLimit(db: IdentityDb, userId: string, endedAt: Date): Promise<SessionForEmail | undefined> {
  return db
    .selectFrom('identity.sessions')
    .select(['created_at as createdAt', 'last_seen_at as lastSeenAt', 'user_agent as userAgent'])
    .where('user_id', '=', userId)
    .where('revoked_at', '=', endedAt)
    .where('revoke_reason', '=', 'session_limit')
    .orderBy('created_at')
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
}

/** The sign-in that went over the limit: the session that began at `startedAt` (the newest of them when several began at that instant). */
export async function findSessionStartedAt(db: IdentityDb, userId: string, startedAt: Date): Promise<SessionForEmail | undefined> {
  return db
    .selectFrom('identity.sessions')
    .select(['created_at as createdAt', 'last_seen_at as lastSeenAt', 'user_agent as userAgent'])
    .where('user_id', '=', userId)
    .where('channel', '=', 'web')
    .where('created_at', '=', startedAt)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
}

/**
 * The retention (P4; SR-DATA-07): the sessions that ended more than the retention ago. A session ends at the earliest of its revocation and its two
 * deadlines. The challenges of those sessions go first (a foreign key). The audit trail is never touched.
 * @returns the number of sessions deleted
 */
export async function deleteSessionsEndedBefore(db: IdentityDb, cutoff: Date): Promise<number> {
  const ended = sql<Date>`least(coalesce(revoked_at, 'infinity'::timestamptz), idle_expires_at, absolute_expires_at)`;
  const expired = db.selectFrom('identity.sessions').select('id').where(ended, '<', cutoff);
  await db.deleteFrom('identity.webauthn_challenges').where('session_id', 'in', expired).execute();
  const rows = await db.deleteFrom('identity.sessions').where(ended, '<', cutoff).returning('id').execute();
  return rows.length;
}
