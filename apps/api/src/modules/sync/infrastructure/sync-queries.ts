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

/** The horizon of the log: every transaction below it has finished, so every row below it is visible and none will appear later. */
export async function currentHorizon(tx: Kysely<Database>): Promise<string> {
  const { rows } = await sql<{ horizon: string }>`select pg_snapshot_xmin(pg_current_snapshot())::text as horizon`.execute(tx);
  return rows[0]?.horizon ?? '0';
}

/** The rows after `(txid, seq)` below the horizon, in the order of the log; `limit` rows at most. */
export async function readLogAfter(tx: Kysely<Database>, txid: string, seq: string, limit: number): Promise<readonly ChangeLogRow[]> {
  // `superseded`: a LATER row of the same entity is already below the horizon, so this one has nothing to say - the later one gives the current state, once.
  const { rows } = await sql<{ seq: string; txid: string; entity_type: SyncEntityType; entity_id: string; superseded: boolean }>`
    select l.seq::text as seq, l.txid::text as txid, l.entity_type, l.entity_id,
      exists (
        select 1 from sync.change_log later where later.entity_id = l.entity_id and (later.txid, later.seq) > (l.txid, l.seq)
          and later.txid < pg_snapshot_xmin(pg_current_snapshot())
      ) as superseded
    from sync.change_log l
    where (l.txid, l.seq) > (${txid}::xid8, ${seq}::bigint) and l.txid < pg_snapshot_xmin(pg_current_snapshot())
    order by l.txid, l.seq limit ${limit}`.execute(tx);
  return rows.map((row) => ({ seq: row.seq, txid: row.txid, type: row.entity_type, id: row.entity_id, superseded: row.superseded }));
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
    .values({ device_id: deviceId, last_full_sync_at: null, resync_requested_reason: null, updated_at: now })
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

/** True when the download of this device and user exists (a cursor of the snapshot names it). */
export async function fullDownloadExists(tx: Kysely<Database>, id: string, deviceId: string, userId: string): Promise<boolean> {
  const row = await syncTables(tx)
    .selectFrom('sync.full_downloads')
    .select('id')
    .where('id', '=', id)
    .where('device_id', '=', deviceId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row !== undefined;
}

export async function addDownloadedCounts(
  tx: Kysely<Database>,
  id: string,
  counts: { readonly workOrders: number; readonly customers: number; readonly sites: number },
): Promise<void> {
  await sql`
    update sync.full_downloads set work_order_count = work_order_count + ${counts.workOrders},
      customer_count = customer_count + ${counts.customers}, site_count = site_count + ${counts.sites}
    where id = ${id}`.execute(tx);
}

/** The snapshot is complete: the device is current as of `now`, and a flag that asked for this resync is spent. */
export async function completeFullSync(tx: Kysely<Database>, deviceId: string, now: Date): Promise<void> {
  await syncTables(tx)
    .updateTable('sync.device_sync_state')
    .set({ last_full_sync_at: now, resync_requested_reason: null as ResyncReason | null, updated_at: now })
    .where('device_id', '=', deviceId)
    .execute();
}
