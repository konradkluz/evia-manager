/**
 * The SQL of the pull (EVM-096): the change log, the state of the device and the register of the full downloads. Every value is a bound parameter; the one
 * statement that reads the horizon of the database (`pg_snapshot_xmin`) is a fixed text. Nothing here reads the content of a synchronised row.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { DeviceSyncState, FullDownloadReason, ResyncReason } from '../domain/cursor.ts';
import type { ChangeLogRow } from '../domain/changes-page.ts';
import type { SyncEntityType } from '../domain/projection.ts';
import { syncTables } from './tables.ts';

const DAY_MS = 24 * 3_600_000;
const PULL_NOTE_INTERVAL_MS = 3_600_000;

/** The horizon of the log: every transaction below it has finished, so every row below it is visible and none will appear later. */
export async function currentHorizon(tx: Kysely<Database>): Promise<string> {
  const { rows } = await sql<{ horizon: string }>`select pg_snapshot_xmin(pg_current_snapshot())::text as horizon`.execute(tx);
  return rows[0]?.horizon ?? '0';
}

/** The rows after `(txid, seq)` below the horizon, in the order of the log; `limit` rows at most. */
export async function readLogAfter(tx: Kysely<Database>, txid: string, seq: string, limit: number): Promise<readonly ChangeLogRow[]> {
  // `superseded`: a LATER row of the same entity is already below the horizon, so this one has nothing to say - the later one gives the current state, once.
  const { rows } = await sql<{
    seq: string;
    txid: string;
    entity_type: SyncEntityType;
    entity_id: string;
    entity_version: number;
    superseded: boolean;
  }>`
    select l.seq::text as seq, l.txid::text as txid, l.entity_type, l.entity_id, l.entity_version,
      exists (
        select 1 from sync.change_log later where later.entity_id = l.entity_id and (later.txid, later.seq) > (l.txid, l.seq)
          and later.txid < pg_snapshot_xmin(pg_current_snapshot())
      ) as superseded
    from sync.change_log l
    where (l.txid, l.seq) > (${txid}::xid8, ${seq}::bigint) and l.txid < pg_snapshot_xmin(pg_current_snapshot())
    order by l.txid, l.seq limit ${limit}`.execute(tx);
  return rows.map((row) => ({
    seq: row.seq,
    txid: row.txid,
    type: row.entity_type,
    id: row.entity_id,
    version: row.entity_version,
    superseded: row.superseded,
  }));
}

/** The age in seconds of the oldest committed row above the horizon (0 when there is none): a long transaction holds the pull back (ADR-0021 D5). */
export async function horizonLagSeconds(tx: Kysely<Database>): Promise<number> {
  // The clock of the database on purpose: the lag compares two instants the database stamped, an operational measure and not business time.
  const { rows } = await sql<{ lag: string | null }>`
    select extract(epoch from clock_timestamp() - min(recorded_at))::text as lag from sync.change_log
    where txid >= pg_snapshot_xmin(pg_current_snapshot())`.execute(tx);
  const lag = rows[0]?.lag ?? null;
  return lag === null ? 0 : Math.max(0, Number(lag));
}

export async function readDeviceState(tx: Kysely<Database>, deviceId: string): Promise<DeviceSyncState | undefined> {
  const row = await syncTables(tx)
    .selectFrom('sync.device_sync_state')
    .select(['last_full_sync_at', 'resync_requested_reason'])
    .where('device_id', '=', deviceId)
    .executeTakeFirst();
  return row === undefined ? undefined : { lastFullSyncAt: row.last_full_sync_at, resyncRequestedReason: row.resync_requested_reason };
}

/** Makes sure the row of the device exists and LOCKS it: the full downloads of one device are serialised (the limit cannot be passed by a race). */
export async function lockDeviceState(tx: Kysely<Database>, deviceId: string, now: Date): Promise<DeviceSyncState> {
  const db = syncTables(tx);
  await db
    .insertInto('sync.device_sync_state')
    .values({ device_id: deviceId, last_full_sync_at: null, resync_requested_reason: null, last_pulled_at: null, updated_at: now })
    .onConflict((conflict) => conflict.column('device_id').doNothing())
    .execute();
  const row = await db
    .selectFrom('sync.device_sync_state')
    .select(['last_full_sync_at', 'resync_requested_reason'])
    .where('device_id', '=', deviceId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return { lastFullSyncAt: row.last_full_sync_at, resyncRequestedReason: row.resync_requested_reason };
}

/** The full downloads of the device in the last 24 hours: how many, and when the oldest began (the answer to `Retry-After`). */
export async function recentFullDownloads(
  tx: Kysely<Database>,
  deviceId: string,
  now: Date,
): Promise<{ readonly count: number; readonly oldest: Date | null }> {
  const row = await syncTables(tx)
    .selectFrom('sync.full_downloads')
    .select((eb) => [eb.fn.countAll<string>().as('count'), eb.fn.min('started_at').as('oldest')])
    .where('device_id', '=', deviceId)
    .where('started_at', '>', new Date(now.getTime() - DAY_MS))
    .executeTakeFirstOrThrow();
  return { count: Number(row.count), oldest: row.oldest };
}

export async function startFullDownload(
  tx: Kysely<Database>,
  download: { readonly deviceId: string; readonly userId: string; readonly reason: FullDownloadReason; readonly now: Date },
): Promise<string> {
  const row = await syncTables(tx)
    .insertInto('sync.full_downloads')
    .values({ device_id: download.deviceId, user_id: download.userId, reason: download.reason, started_at: download.now })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * True when a cursor of the snapshot may be served: the download is of THIS device and user, still open (a cursor replayed after the end would hand out the
 * snapshot again outside the daily limit - AB-08), younger than a day (the window of the limit) and at the position the server last issued or the one before
 * it (a page whose answer was lost is asked again; going back further is a replay).
 */
export async function snapshotCursorAccepted(
  tx: Kysely<Database>,
  download: { readonly id: string; readonly deviceId: string; readonly userId: string; readonly after: string | null },
  now: Date,
): Promise<boolean> {
  // The server seals a cursor of the snapshot only after a page, so it always names a position; a cursor without one was not issued by us.
  const { after } = download;
  if (after === null) return false;
  const row = await syncTables(tx)
    .selectFrom('sync.full_downloads')
    .select('id')
    .where('id', '=', download.id)
    .where('device_id', '=', download.deviceId)
    .where('user_id', '=', download.userId)
    .where('completed_at', 'is', null)
    .where('started_at', '>', new Date(now.getTime() - DAY_MS))
    .where((eb) => eb.or([eb('last_after', '=', after), eb('prev_after', '=', after)]))
    .executeTakeFirst();
  return row !== undefined;
}

/** Moves the position of the download from `from` to `to`; false when `from` is not the last issued position (the page is a repeat and must not be counted twice). */
export async function advanceDownload(tx: Kysely<Database>, id: string, from: string | null, to: string): Promise<boolean> {
  const { rows } = await sql`
    update sync.full_downloads set prev_after = last_after, last_after = ${to}::uuid
    where id = ${id} and last_after is not distinct from ${from}::uuid returning 1 as moved`.execute(tx);
  return rows.length > 0;
}

export interface DownloadedCounts {
  readonly workOrders: number;
  readonly customers: number;
  readonly sites: number;
}

export async function addDownloadedCounts(tx: Kysely<Database>, id: string, counts: DownloadedCounts): Promise<void> {
  await sql`
    update sync.full_downloads set work_order_count = work_order_count + ${counts.workOrders},
      customer_count = customer_count + ${counts.customers}, site_count = site_count + ${counts.sites}
    where id = ${id}`.execute(tx);
}

/** The download is over: closes it (its cursors are no longer served) and returns the counts it served by type. */
export async function completeDownload(tx: Kysely<Database>, id: string, now: Date): Promise<DownloadedCounts> {
  const row = await syncTables(tx)
    .updateTable('sync.full_downloads')
    .set({ completed_at: now })
    .where('id', '=', id)
    .returning(['work_order_count', 'customer_count', 'site_count'])
    .executeTakeFirstOrThrow();
  return { workOrders: row.work_order_count, customers: row.customer_count, sites: row.site_count };
}

/** Notes that the device pulled (at most once an hour per device): the base measure of the alert "pulls for over 3 days and sends nothing" (EVM-098). */
export async function touchPulled(db: Kysely<Database>, deviceId: string, now: Date): Promise<void> {
  await syncTables(db)
    .updateTable('sync.device_sync_state')
    .set({ last_pulled_at: now })
    .where('device_id', '=', deviceId)
    .where((eb) => eb.or([eb('last_pulled_at', 'is', null), eb('last_pulled_at', '<', new Date(now.getTime() - PULL_NOTE_INTERVAL_MS))]))
    .execute();
}

/** The snapshot is complete: the device is current as of `now`, and a flag that asked for this resync is spent. */
export async function completeFullSync(tx: Kysely<Database>, deviceId: string, now: Date): Promise<void> {
  await syncTables(tx)
    .updateTable('sync.device_sync_state')
    .set({ last_full_sync_at: now, resync_requested_reason: null as ResyncReason | null, updated_at: now })
    .where('device_id', '=', deviceId)
    .execute();
}

const HOUR_MS = 3_600_000;

/** The start of the hour (UTC) the instant falls in: the window of the limit of the snapshots. */
export const snapshotWindowStart = (now: Date): Date => new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);

/**
 * Counts one request for a snapshot of the device in the window and returns how many it has made in it, this one included. ONE atomic statement
 * (`INSERT … ON CONFLICT`), so processes of the API that count at the same moment cannot both pass under the limit (SR-API-02, CWE-770); the counter stops
 * growing at a bound, so a flood cannot overflow it. The row is locked until the transaction ends.
 */
export async function countSnapshotRequest(tx: Kysely<Database>, deviceId: string, windowStart: Date): Promise<number> {
  const { rows } = await sql<{ request_count: number }>`
    insert into sync.snapshot_requests (device_id, window_start, request_count) values (${deviceId}::uuid, ${windowStart}, 1)
    on conflict (device_id, window_start) do update set request_count = least(sync.snapshot_requests.request_count + 1, 1000000)
    returning request_count`.execute(tx);
  return rows[0]?.request_count ?? 1;
}

/** True exactly once per device and window: the caller that gets `true` raises the alert (the row is locked by the count of the same transaction). */
export async function markSnapshotAlerted(tx: Kysely<Database>, deviceId: string, windowStart: Date): Promise<boolean> {
  const { rows } = await sql`
    update sync.snapshot_requests set alerted = true
    where device_id = ${deviceId}::uuid and window_start = ${windowStart} and alerted = false returning 1 as raised`.execute(tx);
  return rows.length > 0;
}

/** The counters of the device from windows that are over (a device keeps one row per hour it used, no more than two live ones). */
export async function purgeSnapshotWindows(tx: Kysely<Database>, deviceId: string, before: Date): Promise<void> {
  await sql`delete from sync.snapshot_requests where device_id = ${deviceId}::uuid and window_start < ${before}`.execute(tx);
}

/**
 * Serialises the commands of ONE device that create a customer or a site (EVM-099 AC7): the count of the last 24 hours and the insert that follows are not one
 * statement, so two batches of the device would both read 19 and pass. A transaction-scoped advisory lock with its own key space (`sync-quota:` + the device;
 * the idempotency port locks other keys) held until the end of the transaction of the mutation.
 */
export async function lockDeviceQuota(tx: Kysely<Database>, deviceId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(pg_catalog.hashtextextended(${`sync-quota:${deviceId}`}, 0))`.execute(tx);
}

/** True exactly once per device, kind and window: the caller that gets `true` writes the alert and the audit event of the exceeded limit (EVM-099 AC7). */
export async function markQuotaAlerted(
  tx: Kysely<Database>,
  deviceId: string,
  kind: 'customer' | 'site',
  windowStart: Date,
): Promise<boolean> {
  const { rows } = await sql`
    insert into sync.quota_alerts (device_id, kind, window_start) values (${deviceId}::uuid, ${kind}, ${windowStart})
    on conflict do nothing returning 1 as raised`.execute(tx);
  return rows.length > 0;
}

/** The marks of the device from windows that are over. */
export async function purgeQuotaAlerts(tx: Kysely<Database>, deviceId: string, before: Date): Promise<void> {
  await sql`delete from sync.quota_alerts where device_id = ${deviceId}::uuid and window_start < ${before}`.execute(tx);
}
