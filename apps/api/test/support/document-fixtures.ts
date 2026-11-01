/**
 * Synthetic documents written straight into the database (EVM-047) - a TEST helper: it lives outside `src`, so it is not in the production image and no
 * route reaches it; it refuses to run when `NODE_ENV=production` (SR-INFRA-08). Everything is synthetic (no real document, no real person).
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { FileState, ReasonCode } from '../../src/modules/media/domain/scan-outcome.ts';
import { mediaTables } from '../../src/modules/media/infrastructure/tables.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { uuidv7 } from './uuid.ts';
import { assertSyntheticDataAllowed } from './work-order-fixtures.ts';

const AT = new Date('2026-10-31T08:00:00.000Z');

export interface DocumentSpec {
  /** EXACTLY one of `workOrderId`, `siteId`, `customerId` (the anchor, EVM-050). */
  readonly workOrderId?: string;
  readonly siteId?: string;
  readonly customerId?: string;
  readonly createdBy: string;
  readonly kindCode?: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly override?: 'building_security' | 'identity_data' | null;
  readonly state?: FileState;
  readonly reason?: ReasonCode;
  readonly fileName?: string;
  readonly contentType?: string;
  /** The type the scan recorded (`stored_files.content_type`); the default is the declared one. */
  readonly detectedType?: string | null;
  readonly size?: number;
  readonly sha256?: string;
  readonly session?: { readonly userId: string; readonly uploadId?: string };
  readonly createdAt?: Date;
  readonly versionId?: string;
  readonly etag?: string;
}

export interface InsertedDocument {
  readonly documentId: string;
  readonly versionId: string;
  readonly storedFileId: string;
  readonly objectKey: string;
  readonly sessionId: string | null;
}

export async function insertDocumentRow(db: Kysely<Database>, spec: DocumentSpec): Promise<InsertedDocument> {
  assertSyntheticDataAllowed();
  const tables = mediaTables(db);
  const documentId = uuidv7();
  const versionId = uuidv7();
  const storedFileId = (await sql<{ id: string }>`select uuidv7() as id`.execute(db)).rows[0]?.id ?? uuidv7();
  const at = spec.createdAt ?? AT;
  const objectKey = `documents/2026/10/${storedFileId}/original`;
  await tables
    .insertInto('media.documents')
    .values({
      id: documentId,
      kind_code: spec.kindCode ?? 'connection_conditions',
      title: spec.title ?? 'Warunki przylaczenia - tytul testowy',
      description: spec.description ?? null,
      work_order_id: spec.workOrderId ?? null,
      customer_id: spec.customerId ?? null,
      site_id: spec.siteId ?? null,
      procedure_stage_id: null,
      confidentiality_override: spec.override ?? null,
      created_at: at,
      created_by: spec.createdBy,
      updated_at: at,
      updated_by: spec.createdBy,
      deleted_at: null,
      deleted_by: null,
    })
    .execute();
  await tables
    .insertInto('media.document_versions')
    .values({ id: versionId, document_id: documentId, version_number: 1, change_note: null, created_at: at, created_by: spec.createdBy })
    .execute();
  const state = spec.state ?? 'pending_upload';
  await tables
    .insertInto('media.stored_files')
    .values({
      id: storedFileId,
      purpose: 'document',
      media_asset_id: null,
      document_version_id: versionId,
      object_key: objectKey,
      state,
      state_reason_code: spec.reason ?? (state === 'quarantined' ? 'malware_detected' : state === 'failed' ? 'checksum_mismatch' : null),
      state_changed_at: at,
      scan_claimed_at: null,
      declared_size_bytes: String(spec.size ?? 1000),
      size_bytes: null,
      declared_content_type: spec.contentType ?? 'application/pdf',
      content_type:
        spec.detectedType === undefined
          ? state === 'clean' || state === 'ready'
            ? (spec.contentType ?? 'application/pdf')
            : null
          : spec.detectedType,
      declared_sha256: spec.sha256 ?? 'a'.repeat(64),
      sha256: null,
      original_filename: spec.fileName ?? 'warunki-przylaczenia.pdf',
      s3_version_id: spec.versionId ?? null,
      s3_etag: spec.etag ?? null,
      quarantined_at: state === 'quarantined' ? at : null,
      purged_at: null,
      created_at: at,
      created_by: spec.createdBy,
    })
    .execute();
  let sessionId: string | null = null;
  if (spec.session !== undefined) {
    sessionId = uuidv7();
    await tables
      .insertInto('media.upload_sessions')
      .values({
        id: sessionId,
        stored_file_id: storedFileId,
        user_id: spec.session.userId,
        device_id: null,
        s3_upload_id: spec.session.uploadId ?? 'upload-fixture',
        part_size_bytes: String(16 * 1024 * 1024),
        part_count: Math.max(1, Math.ceil((spec.size ?? 1000) / (16 * 1024 * 1024))),
        state: 'active',
        expires_at: new Date('2026-11-07T08:00:00.000Z'),
        created_at: at,
        updated_at: at,
      })
      .execute();
  }
  return { documentId, versionId, storedFileId, objectKey, sessionId };
}
