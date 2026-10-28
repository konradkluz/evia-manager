/**
 * Queries of the register of mobile devices and of the first step of the phone (EVM-094). Ownership is in the WHERE of every query that takes an identifier
 * from a client: a `deviceId` of another account is a missing one. The secrets are hashes (SHA-256) and are compared in the domain, never in SQL.
 */
import { sql } from 'kysely';
import type { SecretState } from '../domain/device-rules.ts';
import type { DeviceState, DevicesTable, IdentityDb, MobileChallengesTable } from './tables.ts';

export interface DeviceRecord {
  readonly id: string;
  readonly userId: string;
  readonly state: DeviceState;
  readonly secrets: SecretState;
  readonly removed: boolean;
}

const DEVICE_COLUMNS = [
  'id',
  'user_id as userId',
  'state',
  'secret_hash as secretHash',
  'secret_proven as secretProven',
  'previous_secret_hash as previousSecretHash',
  'previous_valid_until as previousValidUntil',
  'removed_at as removedAt',
] as const;

type DeviceRow = {
  id: string;
  userId: string;
  state: DeviceState;
  secretHash: Buffer;
  secretProven: boolean;
  previousSecretHash: Buffer | null;
  previousValidUntil: Date | null;
  removedAt: Date | null;
};

function toRecord(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    userId: row.userId,
    state: row.state,
    secrets: {
      current: row.secretHash,
      proven: row.secretProven,
      previous: row.previousSecretHash,
      previousValidUntil: row.previousValidUntil,
    },
    removed: row.removedAt !== null,
  };
}

/** A device by its identifier — whoever owns it; the caller compares the owner (a device of another account is treated as unknown). */
export async function findDeviceById(db: IdentityDb, deviceId: string, lock: boolean = false): Promise<DeviceRecord | undefined> {
  let query = db.selectFrom('identity.devices').select(DEVICE_COLUMNS).where('id', '=', deviceId);
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  return row === undefined ? undefined : toRecord(row);
}

export interface DeviceDescription {
  readonly model: string;
  readonly osVersion: string;
  readonly securityPatch: string;
  readonly platform: DevicesTable['platform'];
  readonly appVersion: string;
  readonly publicKey: string | undefined;
}

export async function insertDevice(
  db: IdentityDb,
  device: { readonly userId: string; readonly secrets: SecretState; readonly description: DeviceDescription; readonly now: Date },
): Promise<string> {
  const { description, secrets, now } = device;
  const row = await db
    .insertInto('identity.devices')
    .values({
      user_id: device.userId,
      secret_hash: secrets.current,
      secret_proven: secrets.proven,
      previous_secret_hash: secrets.previous,
      previous_valid_until: secrets.previousValidUntil,
      model: description.model,
      os_version: description.osVersion,
      security_patch: description.securityPatch,
      platform: description.platform,
      app_version: description.appVersion,
      public_key: description.publicKey ?? null,
      last_contact_at: now,
      created_at: now,
      removed_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** A known phone signed in again: the new secrets and the fresh description of the device. */
export async function updateDeviceAtLogin(
  db: IdentityDb,
  deviceId: string,
  update: { readonly secrets: SecretState; readonly description: DeviceDescription; readonly now: Date },
): Promise<void> {
  const { secrets, description, now } = update;
  await db
    .updateTable('identity.devices')
    .set({
      secret_hash: secrets.current,
      secret_proven: secrets.proven,
      previous_secret_hash: secrets.previous,
      previous_valid_until: secrets.previousValidUntil,
      model: description.model,
      os_version: description.osVersion,
      security_patch: description.securityPatch,
      platform: description.platform,
      app_version: description.appVersion,
      ...(description.publicKey === undefined ? {} : { public_key: description.publicKey }),
      last_contact_at: now,
    })
    .where('id', '=', deviceId)
    .execute();
}

/**
 * How many OTHER devices of the account have a valid mobile session (SR-SESS-04): a device ordered to wipe, a wiped or a removed one and a device with no
 * valid session take no place.
 */
export async function countOtherActiveDevices(
  db: IdentityDb,
  userId: string,
  exceptDeviceId: string | undefined,
  now: Date,
): Promise<number> {
  const result = await sql<{ total: string }>`
    select count(*) as total from identity.devices d
    where d.user_id = ${userId} and d.removed_at is null and d.state = 'active'
      and (${exceptDeviceId ?? null}::uuid is null or d.id <> ${exceptDeviceId ?? null}::uuid)
      and exists (
        select 1 from identity.sessions s
        where s.device_id = d.id and s.revoked_at is null and s.idle_expires_at > ${now} and s.absolute_expires_at > ${now}
      )`.execute(db);
  return Number(result.rows[0]?.total ?? 0);
}

/**
 * The phone proved the newest secret (it used the tokens issued with it): the previous one stops working. A conditional UPDATE — a device that has proved
 * it already is not written to on every request.
 */
export async function proveDeviceSecret(db: IdentityDb, deviceId: string): Promise<void> {
  await db
    .updateTable('identity.devices')
    .set({ secret_proven: true, previous_secret_hash: null, previous_valid_until: null })
    .where('id', '=', deviceId)
    .where('secret_proven', '=', false)
    .execute();
}

export async function touchDevice(db: IdentityDb, deviceId: string, now: Date, appVersion?: string): Promise<void> {
  await db
    .updateTable('identity.devices')
    .set({ last_contact_at: now, ...(appVersion === undefined ? {} : { app_version: appVersion }) })
    .where('id', '=', deviceId)
    .execute();
}

/**
 * The phone confirmed the wipe: `wipe_required` → `wiped`, and both secrets stop working (replaced by the hash of random bytes nobody holds). Idempotent in
 * the sense of the contract: for a device in any other state nothing changes. @returns true when the state changed
 */
export async function confirmWipe(db: IdentityDb, deviceId: string, burned: Buffer): Promise<boolean> {
  const row = await db
    .updateTable('identity.devices')
    .set({ state: 'wiped', secret_hash: burned, secret_proven: true, previous_secret_hash: null, previous_valid_until: null })
    .where('id', '=', deviceId)
    .where('state', '=', 'wipe_required')
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

export interface MobileChallengeRecord {
  readonly attemptId: string;
  readonly description: DeviceDescription;
  readonly matchedDeviceId: string | null;
  readonly matchedBy: 'current' | 'previous' | null;
  readonly secretMismatch: boolean;
  readonly totpFactorId: string;
}

export async function insertMobileChallenge(
  db: IdentityDb,
  challenge: {
    readonly attemptId: string;
    readonly description: DeviceDescription;
    readonly matchedDeviceId: string | undefined;
    readonly matchedBy: 'current' | 'previous' | undefined;
    readonly secretMismatch: boolean;
    readonly userId: string;
    readonly totpFactorId: string;
  },
): Promise<void> {
  const { description } = challenge;
  // The stamp of the password is read in SQL (microseconds are kept): the second step compares it in SQL too.
  await sql`
    insert into identity.mobile_challenges (
      attempt_id, model, os_version, security_patch, platform, app_version, public_key, matched_device_id, matched_by, secret_mismatch,
      password_stamp, totp_factor_id
    )
    select ${challenge.attemptId}, ${description.model}, ${description.osVersion}, ${description.securityPatch}::date, ${description.platform},
      ${description.appVersion}, ${description.publicKey ?? null}, ${challenge.matchedDeviceId ?? null}::uuid, ${challenge.matchedBy ?? null},
      ${challenge.secretMismatch}, p.updated_at, ${challenge.totpFactorId}::uuid
    from identity.password_credentials p where p.user_id = ${challenge.userId}`.execute(db);
}

/**
 * The challenge of an attempt, but only while the credentials are the ones it was issued for (the password was not changed and the same code factor is
 * still active; CWE-367). Compared in SQL, so the microseconds of the stamp count.
 */
export async function findMobileChallenge(db: IdentityDb, attemptId: string, userId: string): Promise<MobileChallengeRecord | undefined> {
  const result = await sql<{
    model: string;
    os_version: string;
    security_patch: string;
    platform: MobileChallengesTable['platform'];
    app_version: string;
    public_key: string | null;
    matched_device_id: string | null;
    matched_by: 'current' | 'previous' | null;
    secret_mismatch: boolean;
    totp_factor_id: string;
  }>`
    select c.model, c.os_version, to_char(c.security_patch, 'YYYY-MM-DD') as security_patch, c.platform, c.app_version, c.public_key,
      c.matched_device_id, c.matched_by, c.secret_mismatch, c.totp_factor_id
    from identity.mobile_challenges c
    join identity.password_credentials p on p.user_id = ${userId} and p.updated_at = c.password_stamp
    join identity.totp_factors t on t.id = c.totp_factor_id and t.user_id = ${userId} and t.state = 'active'
    where c.attempt_id = ${attemptId}`.execute(db);
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    attemptId,
    description: {
      model: row.model,
      osVersion: row.os_version,
      securityPatch: row.security_patch,
      platform: row.platform,
      appVersion: row.app_version,
      publicKey: row.public_key ?? undefined,
    },
    matchedDeviceId: row.matched_device_id,
    matchedBy: row.matched_by,
    secretMismatch: row.secret_mismatch,
    totpFactorId: row.totp_factor_id,
  };
}

/** The sessions of a device that are still open end (a new sign-in of the same phone replaces them). @returns their ids */
export async function revokeSessionsOfDevice(db: IdentityDb, deviceId: string, reason: 'rotated', now: Date): Promise<string[]> {
  const rows = await db
    .updateTable('identity.sessions')
    .set({ revoked_at: now, revoke_reason: reason, reauthenticated_at: null, reauth_purpose: null })
    .where('device_id', '=', deviceId)
    .where('revoked_at', 'is', null)
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Retention (P2): the sessions of a device with no contact for 30 days end; the audit says why. @returns the ids with their owners.
 */
export async function revokeSessionsOfInactiveDevices(
  db: IdentityDb,
  inactiveBefore: Date,
  now: Date,
): Promise<{ readonly id: string; readonly userId: string }[]> {
  const rows = await db
    .updateTable('identity.sessions')
    .set({ revoked_at: now, revoke_reason: 'device_inactive', reauthenticated_at: null, reauth_purpose: null })
    .where('revoked_at', 'is', null)
    .where('device_id', 'in', db.selectFrom('identity.devices').select('id').where('last_contact_at', '<', inactiveBefore))
    .returning(['id', 'user_id'])
    .execute();
  return rows.map((row) => ({ id: row.id, userId: row.user_id }));
}

/** The device of an account registered at the given moment — what the e-mail about a new device describes. */
export async function findDeviceCreatedAt(
  db: IdentityDb,
  userId: string,
  createdAt: Date,
): Promise<{ readonly model: string; readonly osVersion: string } | undefined> {
  return db
    .selectFrom('identity.devices')
    .select(['model', 'os_version as osVersion'])
    .where('user_id', '=', userId)
    .where('created_at', '=', createdAt)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
}
