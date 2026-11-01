/**
 * Queries of the deletion of a medium or a document and of the erasure of its files (EVM-051; SR-AUTHZ-02, SR-PRIV-03, SR-DATA-08, CWE-459). The soft delete
 * and the erasure of a file are separate: the first hides the record (restorable), the second removes every object of the subject for good and keeps the
 * record with a marker. Nothing here selects a name, a description or a checksum.
 */
import { sql } from 'kysely';
import type { FileState } from '../domain/scan-outcome.ts';
import type { MediaAssetRow } from './media-store.ts';
import type { MediaDb } from './tables.ts';

/** The medium of THIS order, row-locked - also a soft deleted one (the restore and the erasure reach it); another order's medium and a missing one are the same absence. */
export async function lockAssetForErasure(db: MediaDb, workOrderId: string, mediaAssetId: string): Promise<MediaAssetRow | undefined> {
  return db
    .selectFrom('media.media_assets')
    .where('id', '=', mediaAssetId)
    .where('work_order_id', '=', workOrderId)
    .selectAll()
    .forUpdate()
    .executeTakeFirst();
}

/** The soft delete (`deleted`) or the restore of a medium; compare-and-set on the current state. @returns whether the row changed */
export async function setAssetDeleted(db: MediaDb, mediaAssetId: string, userId: string, deleted: boolean, now: Date): Promise<boolean> {
  const row = await db
    .updateTable('media.media_assets')
    .set({
      deleted_at: deleted ? now : null,
      deleted_by: deleted ? userId : null,
      updated_at: now,
      updated_by: userId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', mediaAssetId)
    .where('deleted_at', deleted ? 'is' : 'is not', null)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** The soft delete (`deleted`) or the restore of a document. @returns whether the row changed */
export async function setDocumentDeleted(db: MediaDb, documentId: string, userId: string, deleted: boolean, now: Date): Promise<boolean> {
  const row = await db
    .updateTable('media.documents')
    .set({
      deleted_at: deleted ? now : null,
      deleted_by: deleted ? userId : null,
      updated_at: now,
      updated_by: userId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', documentId)
    .where('deleted_at', deleted ? 'is' : 'is not', null)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

export interface FileToErase {
  readonly id: string;
  readonly objectKey: string;
  readonly state: FileState;
}

/** Every file of a medium, row-locked: a worker, a complete or a rescan on any of them waits for the erasure. */
export async function lockFilesOfAsset(db: MediaDb, mediaAssetId: string): Promise<FileToErase[]> {
  const rows = await db
    .selectFrom('media.stored_files')
    .where('media_asset_id', '=', mediaAssetId)
    .select(['id', 'object_key', 'state'])
    .forUpdate()
    .execute();
  return rows.map((row) => ({ id: row.id, objectKey: row.object_key, state: row.state }));
}

/** Every file of EVERY version of a document, row-locked. */
export async function lockFilesOfDocument(db: MediaDb, documentId: string): Promise<FileToErase[]> {
  const rows = await db
    .selectFrom('media.stored_files as f')
    .innerJoin('media.document_versions as v', 'v.id', 'f.document_version_id')
    .where('v.document_id', '=', documentId)
    .select(['f.id', 'f.object_key', 'f.state'])
    .forUpdate('f')
    .execute();
  return rows.map((row) => ({ id: row.id, objectKey: row.object_key, state: row.state }));
}

/** The keys of the derivatives (thumbnail, preview, 720p) of the files. */
export async function derivativeKeysOf(db: MediaDb, fileIds: readonly string[]): Promise<string[]> {
  if (fileIds.length === 0) return [];
  const rows = await db
    .selectFrom('media.file_derivatives')
    .where('stored_file_id', 'in', [...fileIds])
    .select('object_key')
    .execute();
  return rows.map((row) => row.object_key);
}

export interface OpenUpload {
  readonly objectKey: string;
  readonly uploadId: string;
}

/** Closes the active sessions of the files (a closed session cannot be continued). */
export async function closeSessionsOf(db: MediaDb, fileIds: readonly string[], now: Date): Promise<void> {
  if (fileIds.length === 0) return;
  await db
    .updateTable('media.upload_sessions')
    .set({ state: 'aborted', updated_at: now })
    .where('stored_file_id', 'in', [...fileIds])
    .where('state', '=', 'active')
    .execute();
}

/** Marks the files as erased (and forgets the original name: personal data). */
export async function markFilesErased(db: MediaDb, fileIds: readonly string[], now: Date): Promise<void> {
  if (fileIds.length === 0) return;
  await db
    .updateTable('media.stored_files')
    .set({ erased_at: now, original_filename: null })
    .where('id', 'in', [...fileIds])
    .where('erased_at', 'is', null)
    .execute();
}

/** Marks that the objects of the files are gone from the storage. */
export async function markObjectsErased(db: MediaDb, fileIds: readonly string[], now: Date): Promise<void> {
  if (fileIds.length === 0) return;
  await db
    .updateTable('media.stored_files')
    .set({ objects_erased_at: now })
    .where('id', 'in', [...fileIds])
    .where('erased_at', 'is not', null)
    .where('objects_erased_at', 'is', null)
    .execute();
}

/** The marker on a medium: the file is erased, the description goes; `version + 1`. */
export async function markAssetPurged(db: MediaDb, mediaAssetId: string, userId: string, now: Date): Promise<void> {
  await db
    .updateTable('media.media_assets')
    .set({ file_purged_at: now, description: null, updated_at: now, updated_by: userId, version: sql<number>`version + 1` })
    .where('id', '=', mediaAssetId)
    .where('file_purged_at', 'is', null)
    .execute();
}

/** The marker on a document: the title becomes the marker text, the description goes; `version + 1`. */
export async function markDocumentPurged(db: MediaDb, documentId: string, title: string, userId: string, now: Date): Promise<void> {
  await db
    .updateTable('media.documents')
    .set({
      file_purged_at: now,
      title,
      description: null,
      updated_at: now,
      updated_by: userId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', documentId)
    .where('file_purged_at', 'is', null)
    .execute();
}

export interface PendingErasure {
  readonly id: string;
  readonly objectKey: string;
}

/** Erased files whose objects are not confirmed gone since before `before` (the request may have failed after the commit); `SKIP LOCKED`: two workers never share one. */
export async function lockPendingErasures(db: MediaDb, before: Date, limit: number): Promise<PendingErasure[]> {
  const rows = await db
    .selectFrom('media.stored_files')
    .where('erased_at', 'is not', null)
    .where('objects_erased_at', 'is', null)
    .where('erased_at', '<', before)
    .orderBy('erased_at', 'asc')
    .limit(limit)
    .select(['id', 'object_key'])
    .forUpdate()
    .skipLocked()
    .execute();
  return rows.map((row) => ({ id: row.id, objectKey: row.object_key }));
}

/** Every multipart upload ever opened for the files - the job aborts them again (idempotent) before it removes the objects. */
export async function uploadIdsOf(db: MediaDb, fileIds: readonly string[]): Promise<OpenUpload[]> {
  if (fileIds.length === 0) return [];
  const rows = await db
    .selectFrom('media.upload_sessions as s')
    .innerJoin('media.stored_files as f', 'f.id', 's.stored_file_id')
    .where('s.stored_file_id', 'in', [...fileIds])
    .where('s.state', 'in', ['aborted', 'active'])
    .select(['f.object_key', 's.s3_upload_id'])
    .execute();
  return rows.map((row) => ({ objectKey: row.object_key, uploadId: row.s3_upload_id }));
}
