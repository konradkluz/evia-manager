/**
 * Queries of the documents (EVM-047). Like the queries of the media, every read that leads to an object starts from the order of the path in ONE
 * statement (SR-AUTHZ-02, CWE-639): a document of another order is simply not found, and so is a medium (or a document) used through the other path.
 * Nothing here selects the checksum or the upload id; the object key only where the service must sign it.
 */
import { sql, type Selectable } from 'kysely';
import type { DocumentsTable, DocumentVersionsTable, MediaDb } from './tables.ts';
import { QUARANTINE_RETENTION_DAYS } from '../domain/quarantine.ts';
import type { StoredFileRow } from './media-store.ts';

export type DocumentRow = Selectable<DocumentsTable>;
export type DocumentVersionRow = Selectable<DocumentVersionsTable>;

/** A document with the current version and the file of that version. */
export interface DocumentWithFile {
  readonly document: DocumentRow;
  readonly version: DocumentVersionRow;
  readonly file: StoredFileRow;
  readonly quarantineExpiresAt: Date | null;
}

export interface NewDocument {
  readonly id: string;
  readonly kindCode: string;
  readonly title: string;
  readonly description: string | null;
  readonly workOrderId: string;
  readonly confidentialityOverride: 'building_security' | 'identity_data' | null;
  readonly createdBy: string;
}

/** @returns whether the document was inserted (`false`: the identifier is taken - by anyone; nothing of the existing row is read) */
export async function insertDocument(db: MediaDb, document: NewDocument, now: Date): Promise<boolean> {
  const result = await db
    .insertInto('media.documents')
    .values({
      id: document.id,
      kind_code: document.kindCode,
      title: document.title,
      description: document.description,
      work_order_id: document.workOrderId,
      customer_id: null,
      site_id: null,
      procedure_stage_id: null,
      confidentiality_override: document.confidentialityOverride,
      created_at: now,
      created_by: document.createdBy,
      updated_at: now,
      updated_by: document.createdBy,
      deleted_at: null,
      deleted_by: null,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning('id')
    .executeTakeFirst();
  return result !== undefined;
}

export async function insertDocumentVersion(
  db: MediaDb,
  version: { readonly id: string; readonly documentId: string; readonly versionNumber: number; readonly createdBy: string },
  now: Date,
): Promise<void> {
  await db
    .insertInto('media.document_versions')
    .values({
      id: version.id,
      document_id: version.documentId,
      version_number: version.versionNumber,
      change_note: null,
      created_at: now,
      created_by: version.createdBy,
    })
    .execute();
}

export async function insertDocumentFile(
  db: MediaDb,
  file: {
    readonly id: string;
    readonly documentVersionId: string;
    readonly objectKey: string;
    readonly declaredSize: number;
    readonly declaredContentType: string;
    readonly declaredSha256: string;
    readonly originalFilename: string;
    readonly createdBy: string;
  },
  now: Date,
): Promise<void> {
  await db
    .insertInto('media.stored_files')
    .values({
      id: file.id,
      purpose: 'document',
      media_asset_id: null,
      document_version_id: file.documentVersionId,
      object_key: file.objectKey,
      state: 'pending_upload',
      state_reason_code: null,
      state_changed_at: now,
      scan_claimed_at: null,
      declared_size_bytes: String(file.declaredSize),
      size_bytes: null,
      declared_content_type: file.declaredContentType,
      content_type: null,
      declared_sha256: file.declaredSha256,
      sha256: null,
      original_filename: file.originalFilename,
      s3_version_id: null,
      s3_etag: null,
      quarantined_at: null,
      purged_at: null,
      created_at: now,
      created_by: file.createdBy,
    })
    .execute();
}

const quarantineExpiry = sql<Date | null>`media.quarantine_expires_at(f.quarantined_at, ${QUARANTINE_RETENTION_DAYS}::integer)`.as(
  'quarantine_expires_at',
);

/** The columns of the document, prefixed so one row carries the document, its version and its file. */
const DOCUMENT_COLUMNS = [
  'd.id as d_id',
  'd.kind_code as d_kind_code',
  'd.title as d_title',
  'd.description as d_description',
  'd.work_order_id as d_work_order_id',
  'd.customer_id as d_customer_id',
  'd.site_id as d_site_id',
  'd.procedure_stage_id as d_procedure_stage_id',
  'd.confidentiality_override as d_confidentiality_override',
  'd.created_at as d_created_at',
  'd.created_by as d_created_by',
  'd.updated_at as d_updated_at',
  'd.updated_by as d_updated_by',
  'd.version as d_version',
  'd.deleted_at as d_deleted_at',
  'd.deleted_by as d_deleted_by',
  'v.id as v_id',
  'v.version_number as v_version_number',
  'v.change_note as v_change_note',
  'v.created_at as v_created_at',
  'v.created_by as v_created_by',
] as const;

type JoinedDocumentRow = StoredFileRow & {
  [
    K in 'id' | 'kind_code' | 'title' | 'description' | 'work_order_id' | 'customer_id' | 'site_id' | 'procedure_stage_id' as `d_${K}`
  ]: DocumentRow[K];
} & {
  d_confidentiality_override: DocumentRow['confidentiality_override'];
  d_created_at: Date;
  d_created_by: string;
  d_updated_at: Date;
  d_updated_by: string;
  d_version: number;
  d_deleted_at: Date | null;
  d_deleted_by: string | null;
  v_id: string;
  v_version_number: number;
  v_change_note: string | null;
  v_created_at: Date;
  v_created_by: string;
  quarantine_expires_at: Date | null;
};

function splitDocumentRow(row: JoinedDocumentRow): DocumentWithFile {
  const {
    d_id,
    d_kind_code,
    d_title,
    d_description,
    d_work_order_id,
    d_customer_id,
    d_site_id,
    d_procedure_stage_id,
    d_confidentiality_override,
    d_created_at,
    d_created_by,
    d_updated_at,
    d_updated_by,
    d_version,
    d_deleted_at,
    d_deleted_by,
    v_id,
    v_version_number,
    v_change_note,
    v_created_at,
    v_created_by,
    quarantine_expires_at,
    ...file
  } = row;
  return {
    file,
    quarantineExpiresAt: quarantine_expires_at,
    document: {
      id: d_id,
      kind_code: d_kind_code,
      title: d_title,
      description: d_description,
      work_order_id: d_work_order_id,
      customer_id: d_customer_id,
      site_id: d_site_id,
      procedure_stage_id: d_procedure_stage_id,
      confidentiality_override: d_confidentiality_override,
      created_at: d_created_at,
      created_by: d_created_by,
      updated_at: d_updated_at,
      updated_by: d_updated_by,
      version: d_version,
      deleted_at: d_deleted_at,
      deleted_by: d_deleted_by,
    },
    version: {
      id: v_id,
      document_id: d_id,
      version_number: v_version_number,
      change_note: v_change_note,
      created_at: v_created_at,
      created_by: v_created_by,
    },
  };
}

function baseQuery(db: MediaDb, workOrderId: string) {
  return db
    .selectFrom('media.documents as d')
    .innerJoin('media.document_versions as v', 'v.document_id', 'd.id')
    .innerJoin('media.stored_files as f', 'f.document_version_id', 'v.id')
    .where('d.work_order_id', '=', workOrderId)
    .where('d.deleted_at', 'is', null);
}

/** The document of THIS order (not deleted) with its newest version and that version's file, row-locked when `lock`. */
export async function findDocumentWithFile(
  db: MediaDb,
  workOrderId: string,
  documentId: string,
  lock = false,
): Promise<DocumentWithFile | undefined> {
  const base = baseQuery(db, workOrderId)
    .where('d.id', '=', documentId)
    .selectAll('f')
    .select([...DOCUMENT_COLUMNS, quarantineExpiry])
    .orderBy('v.version_number', 'desc')
    .limit(1);
  const row = await (lock ? base.forNoKeyUpdate('f') : base).executeTakeFirst();
  return row === undefined ? undefined : splitDocumentRow(row);
}

export interface DocumentPagePosition {
  readonly createdAt: Date;
  readonly id: string;
}

/** One page of the documents of an order, ONE statement (no N+1); `limit + 1` rows come back so the caller knows whether there is a next page. */
export async function listDocuments(
  db: MediaDb,
  workOrderId: string,
  options: { readonly position?: DocumentPagePosition; readonly limit: number },
): Promise<DocumentWithFile[]> {
  let query = baseQuery(db, workOrderId);
  if (options.position !== undefined) {
    query = query.where(sql<boolean>`(d.created_at, d.id) < (${options.position.createdAt}, ${options.position.id})`);
  }
  const rows = await query
    .selectAll('f')
    .select([...DOCUMENT_COLUMNS, quarantineExpiry])
    .orderBy('d.created_at', 'desc')
    .orderBy('d.id', 'desc')
    .limit(options.limit + 1)
    .execute();
  return rows.map((row) => splitDocumentRow(row as JoinedDocumentRow));
}

export async function countDocuments(db: MediaDb, workOrderId: string): Promise<number> {
  const row = await db
    .selectFrom('media.documents')
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .select(sql<string>`count(*)`.as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/** Raises the override under the lock of the caller; the version moves by one. @returns the new version, or `undefined` when the version differs */
export async function raiseOverride(
  db: MediaDb,
  documentId: string,
  expectedVersion: number,
  override: 'building_security' | 'identity_data',
  userId: string,
  now: Date,
): Promise<number | undefined> {
  const row = await db
    .updateTable('media.documents')
    .set({ confidentiality_override: override, updated_at: now, updated_by: userId, version: sql<number>`version + 1` })
    .where('id', '=', documentId)
    .where('version', '=', expectedVersion)
    .returning('version')
    .executeTakeFirst();
  return row?.version;
}

/** The order a document belongs to (for the link of an alert and the audit); `undefined` for a file that has no document. */
export async function workOrderOfDocumentVersion(
  db: MediaDb,
  documentVersionId: string,
): Promise<{ documentId: string; workOrderId: string | null } | undefined> {
  const row = await db
    .selectFrom('media.document_versions as v')
    .innerJoin('media.documents as d', 'd.id', 'v.document_id')
    .where('v.id', '=', documentVersionId)
    .select(['d.id as document_id', 'd.work_order_id'])
    .executeTakeFirst();
  return row === undefined ? undefined : { documentId: row.document_id, workOrderId: row.work_order_id };
}

/** The order a document belongs to; `undefined` for a missing document, `null` for one anchored to a customer or a site. */
export async function workOrderOfDocument(db: MediaDb, documentId: string): Promise<string | null | undefined> {
  const row = await db.selectFrom('media.documents').where('id', '=', documentId).select('work_order_id').executeTakeFirst();
  return row?.work_order_id;
}
