/**
 * The queries of the media part of the automatic purge of a site survey (EVM-139 AC2, AC4; SR-PRIV-11, SR-FILE-11, SR-DATA-08). The erasure itself uses the functions of
 * the purge of EVM-051 (`erasure-store.ts`: sessions closed, files marked `erased_at`, objects removed after the commit); what is new here is the reach by ORDER: every
 * medium and - since EVM-147 (ADR-0025 pt 4) - every document of the order, deleted ones too. Every value is a bound parameter; nothing selects a name, a title, a
 * description, a note or a checksum.
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
export async function purgeAssetsOfOrder(db: MediaDb, workOrderId: string, assetIds: readonly string[], now: Date): Promise<void> {
  if (assetIds.length === 0) return;
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
    .where('id', 'in', assetIds)
    .execute();
}

/** Every document of the order - soft deleted and already erased ones too (EVM-147; ADR-0025 pt 4) - the identifiers the register of deletions holds. */
export async function documentIdsOfOrder(db: MediaDb, workOrderId: string): Promise<string[]> {
  const rows = await db.selectFrom('media.documents').select('id').where('work_order_id', '=', workOrderId).orderBy('id').execute();
  return rows.map((row) => row.id);
}

/**
 * The documents of the order, row-locked `FOR UPDATE` (ADR-0025 pt 4): a change, a deletion and an erasure of a file of a document take the lock of its row, so they wait for
 * the purge. A document INSERTED meanwhile is not stopped by a lock - the caller compares the set with the register.
 */
export async function lockDocumentsOfOrder(db: MediaDb, workOrderId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('media.documents')
    .select('id')
    .where('work_order_id', '=', workOrderId)
    .orderBy('id')
    .forUpdate()
    .execute();
  return rows.map((row) => row.id);
}

/** Every file of EVERY version of the named documents of the order, row-locked: a scan or a complete on any of them waits for the purge. */
export async function lockDocumentFilesOf(db: MediaDb, workOrderId: string, documentIds: readonly string[]): Promise<FileToErase[]> {
  if (documentIds.length === 0) return [];
  const rows = await db
    .selectFrom('media.stored_files as f')
    .innerJoin('media.document_versions as v', 'v.id', 'f.document_version_id')
    .innerJoin('media.documents as d', 'd.id', 'v.document_id')
    .where('d.work_order_id', '=', workOrderId)
    .where('d.id', 'in', [...documentIds])
    .select(['f.id', 'f.object_key', 'f.state'])
    .orderBy('f.id')
    .forUpdate('f')
    .execute();
  return rows.map((row) => ({ id: row.id, objectKey: row.object_key, state: row.state }));
}

/** How many versions of the named documents of the order have a `change_note` (ADR-0025 pt 4: always `NULL`) - a count, never the note. */
export async function changeNoteViolationsOf(db: MediaDb, workOrderId: string, documentIds: readonly string[]): Promise<number> {
  if (documentIds.length === 0) return 0;
  const row = await db
    .selectFrom('media.document_versions as v')
    .innerJoin('media.documents as d', 'd.id', 'v.document_id')
    .where('d.work_order_id', '=', workOrderId)
    .where('d.id', 'in', [...documentIds])
    .where('v.change_note', 'is not', null)
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/**
 * The documents of the order after the erasure of their files (EVM-147 AC5; ADR-0025 pt 4): the marker of the erasure (kept when it is there: write-once), the neutral title
 * (the marker of EVM-051; set on every row the purge touches - defence in depth), the description gone, the soft delete (kept when it is there), `version + 1`.
 * `deleted_by` is a foreign key to a USER, so it names the creator of the document (like the media). A document that has all of it already is not touched: a second
 * application changes nothing (the replay of the register is idempotent).
 */
export async function purgeDocumentsOfOrder(
  db: MediaDb,
  workOrderId: string,
  documentIds: readonly string[],
  title: string,
  now: Date,
): Promise<void> {
  if (documentIds.length === 0) return;
  await db
    .updateTable('media.documents')
    .set({
      file_purged_at: sql<Date>`coalesce(file_purged_at, ${now})`,
      title,
      description: null,
      deleted_at: sql<Date>`coalesce(deleted_at, ${now})`,
      deleted_by: sql<string>`coalesce(deleted_by, created_by)`,
      updated_at: now,
      version: sql<number>`version + 1`,
    })
    .where('work_order_id', '=', workOrderId)
    .where('id', 'in', [...documentIds])
    .where((eb) => eb.or([eb('file_purged_at', 'is', null), eb('deleted_at', 'is', null), eb('description', 'is not', null)]))
    .execute();
}

/** The mode `report` (EVM-147): how many documents the candidates have and how many versions break the invariant of `change_note` - counts only. */
export async function documentReportOf(
  db: MediaDb,
  workOrderIds: readonly string[],
): Promise<{ documents: number; changeNoteViolations: number }> {
  if (workOrderIds.length === 0) return { documents: 0, changeNoteViolations: 0 };
  const documents = await db
    .selectFrom('media.documents')
    .where('work_order_id', 'in', [...workOrderIds])
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirst();
  const violations = await db
    .selectFrom('media.document_versions as v')
    .innerJoin('media.documents as d', 'd.id', 'v.document_id')
    .where('d.work_order_id', 'in', [...workOrderIds])
    .where('v.change_note', 'is not', null)
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirst();
  return { documents: Number(documents?.n ?? 0), changeNoteViolations: Number(violations?.n ?? 0) };
}
