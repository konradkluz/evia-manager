/**
 * The queries of the ZIP export (EVM-052; SR-FILE-07, SR-FILE-09, SR-DATA-07, SR-AUTHZ-06; CWE-639, CWE-362). Every read of an export by a person carries the
 * order of the path AND the requester AND the life (`expires_at > now`) in ONE statement, so a foreign, expired or missing export is the same absence. The
 * single use of the link is a conditional UPDATE: of two concurrent calls exactly one gets a row.
 */
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { ExportCandidate } from '../domain/export-plan.ts';
import type { MediaDb, MediaExportsTable } from './tables.ts';

export type ExportRow = MediaExportsTable;
/** A row a person may see: never `expired` (the queries leave it out). */
export type LiveExportRow = Omit<ExportRow, 'state'> & { readonly state: Exclude<ExportRow['state'], 'expired'> };
export type FailureCode = NonNullable<MediaExportsTable['failure_code']>;

/** One export of one user at a time decides its limits: a transaction lock on the user (released at the end of the transaction). */
export async function lockUserExports(tx: Kysely<Database>, userId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`media_export|${userId}`}, 0))`.execute(tx);
}

/** The times of the exports of the user since `since` - EVERY state counts, a failed export too (P10). */
export async function exportTimesOf(db: MediaDb, userId: string, since: Date): Promise<Date[]> {
  const rows = await db
    .selectFrom('media.media_exports')
    .select('created_at')
    .where('requested_by', '=', userId)
    .where('created_at', '>', since)
    .execute();
  return rows.map((row) => row.created_at);
}

export function insertExport(
  db: MediaDb,
  row: Pick<ExportRow, 'id' | 'work_order_id' | 'requested_by' | 'object_key' | 'created_at' | 'expires_at'>,
): Promise<unknown> {
  return db
    .insertInto('media.media_exports')
    .values({
      ...row,
      state: 'queued',
      size_bytes: null,
      file_count: null,
      failure_code: null,
      started_at: null,
      ready_at: null,
      downloaded_at: null,
      object_removed_at: null,
    })
    .execute();
}

/** The originals of the photos of the order with everything the selection needs; the selection itself is `planEntries` (pure). */
export async function exportCandidates(db: MediaDb, workOrderId: string): Promise<ExportCandidate[]> {
  const rows = await db
    .selectFrom('media.media_assets as a')
    .innerJoin('media.stored_files as f', 'f.media_asset_id', 'a.id')
    .where('a.work_order_id', '=', workOrderId)
    .where('a.media_type', '=', 'photo')
    .where('f.purpose', '=', 'media_original')
    .select([
      'a.id as media_asset_id',
      'a.media_type',
      'a.deleted_at',
      'a.file_purged_at',
      'f.state',
      'f.erased_at',
      'f.s3_version_id',
      'f.s3_etag',
      'f.size_bytes',
      'f.content_type',
      'f.original_filename',
      'f.object_key',
    ])
    .orderBy(sql`coalesce(a.captured_at, a.created_at)`, 'asc')
    .orderBy('a.id', 'asc')
    .execute();
  return rows.map((row) => ({
    mediaAssetId: row.media_asset_id,
    mediaType: row.media_type,
    state: row.state,
    erased: row.erased_at !== null,
    deleted: row.deleted_at !== null,
    purged: row.file_purged_at !== null,
    versionId: row.s3_version_id,
    etag: row.s3_etag,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    contentType: row.content_type,
    originalFilename: row.original_filename,
    objectKey: row.object_key,
  }));
}

const EXPORT_COLUMNS = [
  'id',
  'work_order_id',
  'requested_by',
  'state',
  'object_key',
  'size_bytes',
  'file_count',
  'failure_code',
  'created_at',
  'started_at',
  'ready_at',
  'expires_at',
  'downloaded_at',
  'object_removed_at',
] as const;

/** The export of THIS requester in THIS order that is still alive - or `undefined` (a foreign, an expired, a missing one: the same absence). */
export async function findOwnExport(
  db: MediaDb,
  input: { exportId: string; workOrderId: string; userId: string; now: Date },
): Promise<LiveExportRow | undefined> {
  const row = await db
    .selectFrom('media.media_exports')
    .select(EXPORT_COLUMNS)
    .where('id', '=', input.exportId)
    .where('work_order_id', '=', input.workOrderId)
    .where('requested_by', '=', input.userId)
    .where('state', '<>', 'expired')
    .where('expires_at', '>', input.now)
    .executeTakeFirst();
  return row as LiveExportRow | undefined;
}

export async function listOwnExports(db: MediaDb, input: { workOrderId: string; userId: string; now: Date }): Promise<LiveExportRow[]> {
  const rows = await db
    .selectFrom('media.media_exports')
    .select(EXPORT_COLUMNS)
    .where('work_order_id', '=', input.workOrderId)
    .where('requested_by', '=', input.userId)
    .where('state', '<>', 'expired')
    .where('expires_at', '>', input.now)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(10)
    .execute();
  return rows as LiveExportRow[];
}

/**
 * The single use of the link: ONE statement that wins only while the export is `ready`, unused, alive and the requester's own in this order.
 * @returns the key of the object, or `undefined` (no row = the same absence for every reason)
 */
export async function consumeExport(
  db: MediaDb,
  input: { exportId: string; workOrderId: string; userId: string; now: Date },
): Promise<string | undefined> {
  const row = await db
    .updateTable('media.media_exports')
    .set({ downloaded_at: input.now })
    .where('id', '=', input.exportId)
    .where('work_order_id', '=', input.workOrderId)
    .where('requested_by', '=', input.userId)
    .where('state', '=', 'ready')
    .where('downloaded_at', 'is', null)
    .where('expires_at', '>', input.now)
    .returning('object_key')
    .executeTakeFirst();
  return row?.object_key;
}

/** How long a `running` export may stay without an end before another pass takes it again (a worker that died). */
export const STALE_RUNNING_MS = 3 * 60 * 60 * 1000;

/** Takes the oldest export that waits (or whose builder died), alive only; `FOR UPDATE SKIP LOCKED` - two workers never take the same row. */
export async function claimNextExport(db: MediaDb, now: Date): Promise<ExportRow | undefined> {
  const stale = new Date(now.getTime() - STALE_RUNNING_MS);
  const next = db
    .selectFrom('media.media_exports')
    .select('id')
    .where('expires_at', '>', now)
    .where((eb) => eb.or([eb('state', '=', 'queued'), eb.and([eb('state', '=', 'running'), eb('started_at', '<', stale)])]))
    .orderBy('created_at', 'asc')
    .limit(1)
    .forUpdate()
    .skipLocked();
  return db
    .updateTable('media.media_exports')
    .set({ state: 'running', started_at: now })
    .where('id', 'in', next)
    .returning(EXPORT_COLUMNS)
    .executeTakeFirst();
}

/** `running` -> `queued` again: the builder was stopped (a deploy), the same export is built afresh by the next pass. */
export async function requeueExport(db: MediaDb, exportId: string): Promise<void> {
  await db
    .updateTable('media.media_exports')
    .set({ state: 'queued', started_at: null })
    .where('id', '=', exportId)
    .where('state', '=', 'running')
    .execute();
}

/** @returns whether the export was still `running` (an erasure may have ended it meanwhile) */
export async function markReady(
  db: MediaDb,
  input: { exportId: string; sizeBytes: number; fileCount: number; now: Date },
): Promise<boolean> {
  const row = await db
    .updateTable('media.media_exports')
    .set({ state: 'ready', size_bytes: String(input.sizeBytes), file_count: input.fileCount, ready_at: input.now })
    .where('id', '=', input.exportId)
    .where('state', '=', 'running')
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** @returns whether the export was still `running` */
export async function markFailed(db: MediaDb, input: { exportId: string; code: FailureCode }): Promise<boolean> {
  const row = await db
    .updateTable('media.media_exports')
    .set({ state: 'failed', failure_code: input.code })
    .where('id', '=', input.exportId)
    .where('state', '=', 'running')
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * The end of life of every export of the order that is not over (the erasure of a file of the order: SR-PRIV-04, SR-DATA-07). The object is removed by the sweep; until
 * then nobody can read or download it (a read wants a state other than `expired`).
 * @returns the identifiers of the exports ended
 */
export async function expireExportsOfOrder(db: MediaDb, workOrderId: string): Promise<string[]> {
  const rows = await db
    .updateTable('media.media_exports')
    .set({ state: 'expired' })
    .where('work_order_id', '=', workOrderId)
    .where('state', 'in', ['queued', 'running', 'ready'])
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

export interface DueExport {
  readonly id: string;
  readonly objectKey: string;
}

/**
 * The exports whose objects have to go: past their life (`expires_at <= now`, not running) or ended early (`expired`) - and the object is not yet confirmed
 * removed. The rows are locked so two sweeps never work on the same one.
 */
export async function lockDueExports(db: MediaDb, now: Date, limit: number): Promise<DueExport[]> {
  const rows = await db
    .selectFrom('media.media_exports')
    .select(['id', 'object_key'])
    .where('object_removed_at', 'is', null)
    .where((eb) => eb.or([eb('state', '=', 'expired'), eb.and([eb('expires_at', '<=', now), eb('state', '<>', 'running')])]))
    .orderBy('expires_at', 'asc')
    .limit(limit)
    .forUpdate()
    .skipLocked()
    .execute();
  return rows.map((row) => ({ id: row.id, objectKey: row.object_key }));
}

/** The object is confirmed gone: `expired` is final only now. */
export async function markObjectRemoved(db: MediaDb, exportId: string, now: Date): Promise<void> {
  await db.updateTable('media.media_exports').set({ state: 'expired', object_removed_at: now }).where('id', '=', exportId).execute();
}
