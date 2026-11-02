/**
 * Queries of the management of mobile devices (EVM-095; W-15, W-17): the lists, the lock of a row, the order of the wipe, the end of the sessions of a device
 * and the retention of the register. Kysely builder only, parameters always bound; time is a parameter from the application clock. Ownership of a row that an
 * identifier of a client points to is in the WHERE; the answers carry no secret, key, address or serial number (the columns are listed, never `*`).
 */
import { sql, type RawBuilder } from 'kysely';
import type { DeviceState, IdentityDb, RevokeReason } from './tables.ts';

export interface ManagedDeviceRow {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly model: string;
  readonly osVersion: string;
  readonly securityPatch: Date;
  readonly appVersion: string;
  readonly state: DeviceState;
  readonly hasValidSession: boolean;
  readonly lastContactAt: Date;
  readonly createdAt: Date;
  readonly pendingItemsReported: number;
}

export interface OwnDeviceRow {
  readonly id: string;
  readonly model: string;
  readonly osVersion: string;
  readonly appVersion: string;
  readonly state: DeviceState;
  readonly hasValidSession: boolean;
  readonly lastContactAt: Date;
  readonly createdAt: Date;
}

/** Is there a valid mobile session of the device now (not ended, inside both deadlines)? */
const validSession = (now: Date): RawBuilder<boolean> =>
  sql<boolean>`exists (
    select 1 from identity.sessions s
    where s.device_id = d.id and s.revoked_at is null and s.idle_expires_at > ${now} and s.absolute_expires_at > ${now}
  )`;

/** The state as the panel names it: `signed_out` is an active device with no valid session. */
const viewStateSql = (now: Date): RawBuilder<string> =>
  sql<string>`case when d.state <> 'active' then d.state when ${validSession(now)} then 'active' else 'signed_out' end`;

export interface ManagedPageQuery {
  readonly userId: string | undefined;
  readonly state: 'active' | 'signed_out' | 'wipe_required' | 'wiped' | undefined;
  readonly limit: number;
  readonly after: { readonly lastContactAt: Date; readonly id: string } | undefined;
  readonly now: Date;
}

/** One page of the devices of all users, newest contact first; one row more than `limit` tells there is a next page. */
export async function readManagedDevices(db: IdentityDb, query: ManagedPageQuery): Promise<ManagedDeviceRow[]> {
  const { now } = query;
  const result = await sql<{
    id: string;
    user_id: string;
    display_name: string;
    model: string;
    os_version: string;
    security_patch: Date;
    app_version: string;
    state: DeviceState;
    has_valid_session: boolean;
    last_contact_at: Date;
    created_at: Date;
    pending_items_reported: number;
  }>`
    select d.id, d.user_id, u.display_name, d.model, d.os_version, d.security_patch, d.app_version, d.state, ${validSession(now)} as has_valid_session,
      d.last_contact_at, d.created_at, d.pending_items_reported
    from identity.devices d
    join identity.users u on u.id = d.user_id
    where d.removed_at is null
      and (${query.userId ?? null}::uuid is null or d.user_id = ${query.userId ?? null}::uuid)
      and (${query.state ?? null}::text is null or ${viewStateSql(now)} = ${query.state ?? null}::text)
      and (${query.after?.lastContactAt ?? null}::timestamptz is null
        or (d.last_contact_at, d.id) < (${query.after?.lastContactAt ?? null}::timestamptz, ${query.after?.id ?? null}::uuid))
    order by d.last_contact_at desc, d.id desc
    limit ${query.limit + 1}`.execute(db);
  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    model: row.model,
    osVersion: row.os_version,
    securityPatch: row.security_patch,
    appVersion: row.app_version,
    state: row.state,
    hasValidSession: row.has_valid_session,
    lastContactAt: row.last_contact_at,
    createdAt: row.created_at,
    pendingItemsReported: row.pending_items_reported,
  }));
}

/** The `maxItems` of `AccountDeviceList` and the `maximum` of the counts in `UserDevicesSummary`. */
const OWN_DEVICES_LIMIT = 10;
const SUMMARY_COUNT_CAP = 100;
const SUMMARY_PENDING_CAP = 1_000_000;

/** The devices of ONE account that are still in the register (the ownership is the WHERE): those with a valid session first, then the latest contact; at most the {@link OWN_DEVICES_LIMIT} of the contract. */
export async function readOwnDevices(db: IdentityDb, userId: string, now: Date): Promise<OwnDeviceRow[]> {
  const result = await sql<{
    id: string;
    model: string;
    os_version: string;
    app_version: string;
    state: DeviceState;
    has_valid_session: boolean;
    last_contact_at: Date;
    created_at: Date;
  }>`
    select d.id, d.model, d.os_version, d.app_version, d.state, ${validSession(now)} as has_valid_session, d.last_contact_at, d.created_at
    from identity.devices d
    where d.user_id = ${userId} and d.removed_at is null
    order by ${validSession(now)} desc, d.last_contact_at desc, d.id desc
    limit ${OWN_DEVICES_LIMIT}`.execute(db);
  return result.rows.map((row) => ({
    id: row.id,
    model: row.model,
    osVersion: row.os_version,
    appVersion: row.app_version,
    state: row.state,
    hasValidSession: row.has_valid_session,
    lastContactAt: row.last_contact_at,
    createdAt: row.created_at,
  }));
}

export interface LockedDevice {
  readonly id: string;
  readonly userId: string;
  readonly model: string;
  readonly state: DeviceState;
}

/**
 * A device `FOR UPDATE`. With `ownerId` the ownership is in the WHERE (a device of somebody else, a missing one and one removed from the register are the same
 * `undefined`); without it, any device of the register. The lock serialises with the confirmation of the wipe (CWE-362).
 */
export async function lockDevice(db: IdentityDb, deviceId: string, ownerId?: string): Promise<LockedDevice | undefined> {
  let query = db
    .selectFrom('identity.devices')
    .select(['id', 'user_id as userId', 'model', 'state'])
    .where('id', '=', deviceId)
    .where('removed_at', 'is', null);
  if (ownerId !== undefined) query = query.where('user_id', '=', ownerId);
  return query.forUpdate().executeTakeFirst();
}

/** The sessions of a device that are still open end now; @returns their identifiers. */
export async function endSessionsOfDevice(db: IdentityDb, deviceId: string, reason: RevokeReason, now: Date): Promise<string[]> {
  const rows = await db
    .updateTable('identity.sessions')
    .set({ revoked_at: now, revoke_reason: reason, reauthenticated_at: null, reauth_purpose: null })
    .where('device_id', '=', deviceId)
    .where('revoked_at', 'is', null)
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

/** Stamps the moment of the invalidation (the retention counts from it, M1 of the security review). */
export async function stampInvalidated(db: IdentityDb, deviceId: string, now: Date): Promise<void> {
  await db.updateTable('identity.devices').set({ invalidated_at: now }).where('id', '=', deviceId).execute();
}

/** `active` to `wipe_required`; any other state is left alone (the state is final, only the confirmation of the phone leaves it). @returns true when it changed */
export async function orderWipe(db: IdentityDb, deviceId: string, now: Date): Promise<boolean> {
  const row = await db
    .updateTable('identity.devices')
    .set({ state: 'wipe_required', invalidated_at: now })
    .where('id', '=', deviceId)
    .where('state', '=', 'active')
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** Every device of the account in the register, locked in the order of the identifier (no deadlock between two events of one account). */
export async function lockDevicesOfUser(db: IdentityDb, userId: string): Promise<LockedDevice[]> {
  return db
    .selectFrom('identity.devices')
    .select(['id', 'user_id as userId', 'model', 'state'])
    .where('user_id', '=', userId)
    .where('removed_at', 'is', null)
    .orderBy('id')
    .forUpdate()
    .execute();
}

export interface DevicesSummaryRow {
  readonly devices: number;
  readonly activeDevices: number;
  readonly pendingItemsReported: number;
}

/** The numbers for the dialogs of the Administrator: devices in the register, those that are `active`, and the sum of the reported unsent items - each capped at the maximum of the contract. */
export async function summariseDevicesOfUser(db: IdentityDb, userId: string): Promise<DevicesSummaryRow> {
  const result = await sql<{ devices: string; active: string; pending: string }>`
    select count(*) as devices, count(*) filter (where state = 'active') as active, coalesce(sum(pending_items_reported), 0) as pending
    from identity.devices where user_id = ${userId} and removed_at is null`.execute(db);
  const row = result.rows[0];
  return {
    devices: Math.min(Number(row?.devices ?? 0), SUMMARY_COUNT_CAP),
    activeDevices: Math.min(Number(row?.active ?? 0), SUMMARY_COUNT_CAP),
    pendingItemsReported: Math.min(Number(row?.pending ?? 0), SUMMARY_PENDING_CAP),
  };
}

/**
 * Retention of the register (P2, SR-DATA-07): the devices whose later of the last contact and the invalidation is older than the cutoff go, with what refers
 * to them - in ONE transaction, in batches. The sessions of a device (their tokens follow by the cascade) and the references of the unfinished sign-in steps
 * are removed first; the tables of the synchronisation cascade by their own foreign keys. Business data and the audit trail have no foreign key to a device
 * and are never touched. @returns the number of devices deleted
 */
export async function purgeStaleDevices(db: IdentityDb, cutoff: Date, batch: number): Promise<number> {
  let total = 0;
  for (;;) {
    const stale = db
      .selectFrom('identity.devices')
      .select('id')
      .where(sql<Date>`greatest(last_contact_at, coalesce(invalidated_at, last_contact_at))`, '<', cutoff)
      .orderBy('id')
      .limit(batch);
    const ids = (await stale.execute()).map((row) => row.id);
    if (ids.length === 0) return total;
    await db
      .deleteFrom('identity.webauthn_challenges')
      .where('session_id', 'in', db.selectFrom('identity.sessions').select('id').where('device_id', 'in', ids))
      .execute();
    await db.deleteFrom('identity.sessions').where('device_id', 'in', ids).execute();
    await db
      .updateTable('identity.mobile_challenges')
      .set({ matched_device_id: null, matched_by: null })
      .where('matched_device_id', 'in', ids)
      .execute();
    const deleted = await db.deleteFrom('identity.devices').where('id', 'in', ids).returning('id').execute();
    total += deleted.length;
    if (ids.length < batch) return total;
  }
}
