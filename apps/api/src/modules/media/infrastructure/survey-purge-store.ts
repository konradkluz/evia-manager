/**
 * The queries of the media part of the automatic purge of a site survey (EVM-139 AC2, AC4; SR-PRIV-11, SR-FILE-11, SR-DATA-08). The erasure itself uses the functions of
 * the purge of EVM-051 (`erasure-store.ts`: sessions closed, files marked `erased_at`, objects removed after the commit); what is new here is the reach by ORDER: every
 * medium of the order, deleted ones too. Every value is a bound parameter; nothing selects a name, a description or a checksum.
 */
import { sql } from 'kysely';
import type { FileToErase } from './erasure-store.ts';
import type { MediaDb } from './tables.ts';

/** Every medium of the order (soft deleted ones too) - the identifiers the register of deletions holds. */
export async function assetIdsOfOrder(db: MediaDb, workOrderId: string): Promise<string[]> {
  const rows = await db.selectFrom('media.media_assets').select('id').where('work_order_id', '=', workOrderId).orderBy('id').execute();
  return rows.map((row) => row.id);
}

/** Does a document (soft deleted or not) point at the location? Then the location is not the survey's alone. */
export async function siteHeldByDocument(db: MediaDb, siteId: string): Promise<boolean> {
  const row = await db.selectFrom('media.documents').select('id').where('site_id', '=', siteId).limit(1).executeTakeFirst();
  return row !== undefined;
}

/** Every file of every medium of the order, row-locked: a worker, a complete or a rescan on any of them waits for the purge. */
export async function lockFilesOfOrder(db: MediaDb, workOrderId: string): Promise<FileToErase[]> {
  const rows = await db
    .selectFrom('media.stored_files as f')
    .innerJoin('media.media_assets as a', 'a.id', 'f.media_asset_id')
    .where('a.work_order_id', '=', workOrderId)
    .select(['f.id', 'f.object_key', 'f.state'])
    .orderBy('f.id')
    .forUpdate('f')
    .execute();
  return rows.map((row) => ({ id: row.id, objectKey: row.object_key, state: row.state }));
}

/**
 * The media of the order after the erasure of their files: the marker of the purge (kept when it is there: write-once), the description gone, the soft delete (kept when it
 * is there - the trigger of the change log of 0065 writes the `delete` marker for the phones), `version + 1`. `deleted_by` of the media is a foreign key to a USER (0062) and
 * the system is none, so the column names the uploader of the medium (`created_by`, a pseudonymous identifier that is already in the row); `updated_by` is left as it is. The
 * audit trail and the register of deletions say that the SYSTEM erased the media - these two columns are internal and never part of an answer.
 */
export async function purgeAssetsOfOrder(db: MediaDb, workOrderId: string, now: Date): Promise<void> {
  await db
    .updateTable('media.media_assets')
    .set({
      file_purged_at: sql<Date>`coalesce(file_purged_at, ${now})`,
      description: null,
      deleted_at: sql<Date>`coalesce(deleted_at, ${now})`,
      deleted_by: sql<string>`coalesce(deleted_by, created_by)`,
      updated_at: now,
      version: sql<number>`version + 1`,
    })
    .where('work_order_id', '=', workOrderId)
    .execute();
}
