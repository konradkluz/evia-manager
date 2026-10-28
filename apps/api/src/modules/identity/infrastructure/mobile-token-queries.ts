/**
 * Queries of the tokens of a mobile session (EVM-094; SR-SESS-09). Every token is looked up by the SHA-256 of its value through a unique index. The
 * validity of a token is never read from the token's own row: the session, the account and the device are read with it, in the same query or the same
 * transaction, so every way of ending a session (logout, reset of the password, deactivation, wipe) ends the tokens at once.
 */
import type { UsersTable, IdentityDb, DeviceState, SessionsTable, RevokeReason } from './tables.ts';

export interface AccessContext {
  readonly tokenExpiresAt: Date;
  readonly sessionId: string;
  readonly userId: string;
  readonly channel: SessionsTable['channel'];
  readonly revokedAt: Date | null;
  readonly lastSeenAt: Date;
  readonly totpAuthenticatedAt: Date | null;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly role: UsersTable['role'];
  readonly userStatus: UsersTable['status'];
  readonly userDeleted: boolean;
  readonly deviceId: string | null;
  readonly deviceState: DeviceState | null;
  readonly deviceRemoved: boolean;
  readonly secretProven: boolean;
  readonly deviceLastContactAt: Date | null;
}

/** The token of a hash with its session, account and device — one query per request. */
export async function findAccessContext(db: IdentityDb, tokenHash: Buffer): Promise<AccessContext | undefined> {
  const row = await db
    .selectFrom('identity.access_tokens as a')
    .innerJoin('identity.sessions as s', 's.id', 'a.session_id')
    .innerJoin('identity.users as u', 'u.id', 's.user_id')
    .leftJoin('identity.devices as d', 'd.id', 's.device_id')
    .select([
      'a.expires_at as tokenExpiresAt',
      's.id as sessionId',
      's.user_id as userId',
      's.channel',
      's.revoked_at as revokedAt',
      's.last_seen_at as lastSeenAt',
      's.totp_authenticated_at as totpAuthenticatedAt',
      's.idle_expires_at as idleExpiresAt',
      's.absolute_expires_at as absoluteExpiresAt',
      'u.role',
      'u.status as userStatus',
      'u.deleted_at as userDeletedAt',
      'd.id as deviceId',
      'd.state as deviceState',
      'd.removed_at as deviceRemovedAt',
      'd.secret_proven as secretProven',
      'd.last_contact_at as deviceLastContactAt',
    ])
    .where('a.token_hash', '=', tokenHash)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  const { userDeletedAt, deviceRemovedAt, secretProven, ...rest } = row;
  return { ...rest, userDeleted: userDeletedAt !== null, deviceRemoved: deviceRemovedAt !== null, secretProven: secretProven ?? false };
}

export async function insertAccessToken(
  db: IdentityDb,
  token: { tokenHash: Buffer; sessionId: string; now: Date; expiresAt: Date },
): Promise<void> {
  await db
    .insertInto('identity.access_tokens')
    .values({ token_hash: token.tokenHash, session_id: token.sessionId, created_at: token.now, expires_at: token.expiresAt })
    .execute();
}

/** The earlier access tokens of the session stop at once (a new pair replaces them); the rows stay until the retention. */
export async function expireAccessTokens(db: IdentityDb, sessionId: string, now: Date): Promise<void> {
  await db
    .updateTable('identity.access_tokens')
    .set({ expires_at: now })
    .where('session_id', '=', sessionId)
    .where('expires_at', '>', now)
    .execute();
}

export async function deleteAccessTokensExpiredBefore(db: IdentityDb, cutoff: Date): Promise<number> {
  const rows = await db.deleteFrom('identity.access_tokens').where('expires_at', '<', cutoff).returning('token_hash').execute();
  return rows.length;
}

export interface RefreshRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly parentId: string | null;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly supersededAt: Date | null;
}

export async function insertRefreshToken(
  db: IdentityDb,
  token: { tokenHash: Buffer; sessionId: string; parentId: string | null; now: Date; expiresAt: Date },
): Promise<string> {
  const row = await db
    .insertInto('identity.refresh_tokens')
    .values({
      session_id: token.sessionId,
      token_hash: token.tokenHash,
      parent_id: token.parentId,
      created_at: token.now,
      expires_at: token.expiresAt,
      used_at: null,
      superseded_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The refresh token of a hash, its row locked: two requests with the same token queue here and the second sees what the first did. */
export async function lockRefreshToken(db: IdentityDb, tokenHash: Buffer): Promise<RefreshRecord | undefined> {
  const row = await db
    .selectFrom('identity.refresh_tokens')
    .select([
      'id',
      'session_id as sessionId',
      'parent_id as parentId',
      'expires_at as expiresAt',
      'used_at as usedAt',
      'superseded_at as supersededAt',
    ])
    .where('token_hash', '=', tokenHash)
    .forUpdate()
    .executeTakeFirst();
  return row;
}

export interface RefreshSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly revokedAt: Date | null;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly role: UsersTable['role'];
  readonly userStatus: UsersTable['status'];
  readonly userDeleted: boolean;
  readonly deviceId: string | null;
  readonly deviceState: DeviceState | null;
  readonly deviceRemoved: boolean;
}

/** The session of a refresh token with its account and device, the session row locked. */
export async function lockRefreshSession(db: IdentityDb, sessionId: string): Promise<RefreshSession | undefined> {
  const row = await db
    .selectFrom('identity.sessions as s')
    .innerJoin('identity.users as u', 'u.id', 's.user_id')
    .leftJoin('identity.devices as d', 'd.id', 's.device_id')
    .select([
      's.id as sessionId',
      's.user_id as userId',
      's.revoked_at as revokedAt',
      's.idle_expires_at as idleExpiresAt',
      's.absolute_expires_at as absoluteExpiresAt',
      'u.role',
      'u.status as userStatus',
      'u.deleted_at as userDeletedAt',
      'd.id as deviceId',
      'd.state as deviceState',
      'd.removed_at as deviceRemovedAt',
    ])
    .where('s.id', '=', sessionId)
    .where('s.channel', '=', 'mobile')
    .forUpdate('s')
    .executeTakeFirst();
  if (row === undefined) return undefined;
  const { userDeletedAt, deviceRemovedAt, ...rest } = row;
  return { ...rest, userDeleted: userDeletedAt !== null, deviceRemoved: deviceRemovedAt !== null };
}

/** What became of the successors of a token: any used one, and the ones still waiting. */
export async function successorsOf(db: IdentityDb, tokenId: string): Promise<{ readonly used: number; readonly waiting: number }> {
  const rows = await db
    .selectFrom('identity.refresh_tokens')
    .select(['used_at as usedAt', 'superseded_at as supersededAt'])
    .where('parent_id', '=', tokenId)
    .execute();
  return {
    used: rows.filter((row) => row.usedAt !== null).length,
    waiting: rows.filter((row) => row.usedAt === null && row.supersededAt === null).length,
  };
}

export async function markRefreshUsed(db: IdentityDb, tokenId: string, now: Date): Promise<void> {
  await db.updateTable('identity.refresh_tokens').set({ used_at: now }).where('id', '=', tokenId).where('used_at', 'is', null).execute();
}

/** The first used successor invalidates its siblings (the other answers to one lost response). */
export async function supersedeSiblings(db: IdentityDb, parentId: string, exceptId: string, now: Date): Promise<void> {
  await db
    .updateTable('identity.refresh_tokens')
    .set({ superseded_at: now })
    .where('parent_id', '=', parentId)
    .where('id', '<>', exceptId)
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .execute();
}

/** The idle deadline of a mobile session moves on at a refresh, never past the absolute one. */
export async function slideMobileSession(db: IdentityDb, sessionId: string, now: Date, idleExpiresAt: Date): Promise<void> {
  await db
    .updateTable('identity.sessions')
    .set({ last_seen_at: now, idle_expires_at: idleExpiresAt })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .execute();
}

export async function touchMobileSession(db: IdentityDb, sessionId: string, now: Date): Promise<void> {
  await db
    .updateTable('identity.sessions')
    .set({ last_seen_at: now })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .execute();
}

/** Ends ONE session if it is still open. @returns false when it was already over — the caller does not audit twice */
export async function revokeMobileSession(db: IdentityDb, sessionId: string, reason: RevokeReason, now: Date): Promise<boolean> {
  const row = await db
    .updateTable('identity.sessions')
    .set({ revoked_at: now, revoke_reason: reason, reauthenticated_at: null, reauth_purpose: null })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}
