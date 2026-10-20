/**
 * Queries of the administration of accounts (EVM-027): the facts the rules read under the locks, the managed changes of an account, and the links,
 * ceremonies and credentials that end with them. Kysely builder only, parameters always bound; time is a parameter from the application clock.
 */
import { sql } from 'kysely';
import type { IdentityDb, UsersTable } from './tables.ts';

export type SecondStepKind = 'passkey' | 'totp';

/** The active, not deleted Administrators now — counted under the advisory lock, in the transaction that decides (AC5, AC6). */
export async function countActiveAdministrators(db: IdentityDb): Promise<number> {
  const row = await db
    .selectFrom('identity.users')
    .select(sql<string>`count(*)`.as('total'))
    .where('role', '=', 'administrator')
    .where('status', '=', 'active')
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}

/**
 * The kinds of the ACTIVE second steps of the accounts — two statements for a page (`User.secondStepMethods`): a passkey is a row, a TOTP factor counts
 * only when active (a pending one is no method). Never an identifier of a credential, a count of recovery codes or a secret.
 */
export async function listSecondStepKinds(db: IdentityDb, userIds: readonly string[]): Promise<Map<string, SecondStepKind[]>> {
  const kinds = new Map<string, SecondStepKind[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return kinds;
  const ids = [...userIds];
  const passkeys = await db.selectFrom('identity.passkeys').select('user_id').distinct().where('user_id', 'in', ids).execute();
  for (const row of passkeys) kinds.get(row.user_id)?.push('passkey');
  const totp = await db
    .selectFrom('identity.totp_factors')
    .select('user_id')
    .where('user_id', 'in', ids)
    .where('state', '=', 'active')
    .execute();
  for (const row of totp) kinds.get(row.user_id)?.push('totp');
  return kinds;
}

/** A managed change of the role: `version + 1` (the value of `If-Match`), who and when. @returns the new version */
export async function setUserRole(db: IdentityDb, userId: string, role: UsersTable['role'], actorId: string, now: Date): Promise<number> {
  const row = await db
    .updateTable('identity.users')
    .set({ role, updated_at: now, updated_by: actorId, version: sql<number>`version + 1` })
    .where('id', '=', userId)
    .returning('version')
    .executeTakeFirstOrThrow();
  return row.version;
}

/** A managed change of the status (`deactivated` stamps `deactivated_at`, the other statuses clear it). @returns the new version */
export async function setUserStatus(
  db: IdentityDb,
  userId: string,
  status: UsersTable['status'],
  actorId: string,
  now: Date,
): Promise<number> {
  const row = await db
    .updateTable('identity.users')
    .set({
      status,
      deactivated_at: status === 'deactivated' ? now : null,
      updated_at: now,
      updated_by: actorId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', userId)
    .returning('version')
    .executeTakeFirstOrThrow();
  return row.version;
}

/** A reset of the second step is a managed change of the account: `version + 1`, who and when. @returns the new version */
export async function touchUser(db: IdentityDb, userId: string, actorId: string, now: Date): Promise<number> {
  const row = await db
    .updateTable('identity.users')
    .set({ updated_at: now, updated_by: actorId, version: sql<number>`version + 1` })
    .where('id', '=', userId)
    .returning('version')
    .executeTakeFirstOrThrow();
  return row.version;
}

/** Supersedes EVERY open link of one account, whatever its purpose (an invitation, a password reset, the window of a second step); @returns their ids. */
export async function supersedeAllOpenLinksOfUser(db: IdentityDb, userId: string, now: Date): Promise<string[]> {
  const rows = await db
    .updateTable('identity.one_time_links')
    .set({ superseded_at: now })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Opens the window to set up a second step (D1): a row of the purpose `mfa_setup` with a random hash that nobody is given — it exists to be bound to by
 * the session `mfa_enrollment` that the password starts, and to end that session when the window ends. @returns the id of the link
 */
export async function insertSetupWindow(
  db: IdentityDb,
  window: { userId: string; tokenHash: Buffer; issuedAt: Date; expiresAt: Date },
): Promise<string> {
  const row = await db
    .insertInto('identity.one_time_links')
    .values({
      user_id: window.userId,
      purpose: 'mfa_setup',
      token_hash: window.tokenHash,
      issued_by: 'mfa_reset',
      issued_at: window.issuedAt,
      expires_at: window.expiresAt,
      used_at: null,
      superseded_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The open window of the account (unused, not superseded, not expired), or undefined. */
export async function findOpenSetupWindow(db: IdentityDb, userId: string, now: Date): Promise<string | undefined> {
  const row = await db
    .selectFrom('identity.one_time_links')
    .select('id')
    .where('user_id', '=', userId)
    .where('purpose', '=', 'mfa_setup')
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .where('expires_at', '>', now)
    .orderBy('issued_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.id;
}

/** Ends every open WebAuthn ceremony of the account (a challenge made before a change must not finish after it). */
export async function revokeChallengesOfUser(db: IdentityDb, userId: string, now: Date): Promise<void> {
  await db
    .updateTable('identity.webauthn_challenges')
    .set({ used_at: now })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .execute();
}

/** Deletes the passkeys of the account for good: the reset leaves no key that could be used (the audit keeps the fact, not the key). */
export async function deletePasskeysOfUser(db: IdentityDb, userId: string): Promise<void> {
  await db.deleteFrom('identity.passkeys').where('user_id', '=', userId).execute();
}

/** Deletes the TOTP factor of the account, active or pending — the sealed secret goes with the row (the authenticator of the account is shredded). */
export async function deleteTotpFactor(db: IdentityDb, userId: string): Promise<void> {
  await db.deleteFrom('identity.totp_factors').where('user_id', '=', userId).execute();
}

/** Deletes only a PENDING factor (a deactivation ends a setup that was not confirmed; an active factor stays for the reactivation). */
export async function deletePendingTotp(db: IdentityDb, userId: string): Promise<void> {
  await db.deleteFrom('identity.totp_factors').where('user_id', '=', userId).where('state', '=', 'pending').execute();
}
