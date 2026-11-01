/**
 * Kysely types of the tables the `media` module owns (migration 0045; EVM-044; derivatives: 0053, EVM-068). The application role has SELECT, INSERT and UPDATE
 * (no DELETE). Times are written by the application with millisecond precision (no `now()` defaults), because the cursor of the list
 * carries a time as ISO 8601 with milliseconds.
 */
import type { Generated, Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { FileState, ReasonCode } from '../domain/scan-outcome.ts';

export interface MediaAssetsTable {
  id: string;
  work_order_id: string;
  procedure_stage_id: string | null;
  media_type: 'photo' | 'video';
  category: string;
  description: string | null;
  origin: 'web' | 'mobile';
  captured_at: Date | null;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  /** Optimistic lock of `If-Match` (migration 0060). */
  version: Generated<number>;
  /** The last editor of the metadata (migration 0060); `null` = never edited. Not part of the API. */
  updated_by: Generated<string | null>;
}

export interface StoredFilesTable {
  id: Generated<string>;
  purpose: 'media_original' | 'document';
  media_asset_id: string | null;
  /** The version of a document the file belongs to (migration 0059); exactly one of this and `media_asset_id` is set. */
  document_version_id: Generated<string | null>;
  object_key: string;
  state: FileState;
  state_reason_code: ReasonCode | null;
  state_changed_at: Date;
  /** When a worker last took the file for a scan (`null` until then): a scan that cannot be decided is retried only after the stale period. */
  scan_claimed_at: Date | null;
  declared_size_bytes: string;
  size_bytes: string | null;
  declared_content_type: string;
  content_type: string | null;
  declared_sha256: string;
  sha256: string | null;
  original_filename: string | null;
  storage_class: Generated<'standard' | 'archive'>;
  s3_version_id: string | null;
  s3_etag: string | null;
  created_at: Date;
  created_by: string;
  /** When the file FIRST entered quarantine (write-once; the clock of the retention, migration 0046). */
  quarantined_at: Date | null;
  /** When the object of a quarantined file was removed after the retention (write-once). */
  purged_at: Date | null;
  /** How many times the processing loop TOOK the file (raised at the take; migration 0053), at most 10. */
  process_attempts: Generated<number>;
  /** When the loop last took the file (`null` until then): a take that never finished is retried only after the stale period. */
  process_claimed_at: Generated<Date | null>;
  /** Whole seconds of a video, written once after the structural check (migration 0057); `null` for a photo and before the probe. */
  duration_seconds: Generated<number | null>;
  /** `true` after the antivirus, `false` for a video above the scan limit, `null` before the scan (migration 0057: no default - fail closed). */
  av_scanned: Generated<boolean | null>;
}

/**
 * A document of a work order (migration 0059; EVM-047). The kind and the anchor never change; the override of the class only rises (triggers). The
 * application role has SELECT, INSERT and UPDATE. `version` is the optimistic lock.
 */
export interface DocumentsTable {
  id: string;
  kind_code: string;
  title: string;
  description: string | null;
  work_order_id: string | null;
  customer_id: string | null;
  site_id: string | null;
  procedure_stage_id: string | null;
  confidentiality_override: 'building_security' | 'identity_data' | null;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  version: Generated<number>;
  deleted_at: Date | null;
  deleted_by: string | null;
}

/** The versions of a document: append-only (SELECT and INSERT only). */
export interface DocumentVersionsTable {
  id: string;
  document_id: string;
  version_number: number;
  change_note: string | null;
  created_at: Date;
  created_by: string;
}

/** The thumbnail and the preview of a photo (migration 0053). The application role has SELECT and INSERT only: a derivative is written once. */
export interface FileDerivativesTable {
  stored_file_id: string;
  variant: 'thumbnail' | 'preview';
  object_key: string;
  content_type: 'image/webp' | 'video/mp4';
  width: number;
  height: number;
  size_bytes: number;
  created_at: Date;
}

export interface UploadSessionsTable {
  id: string;
  stored_file_id: string;
  user_id: string;
  device_id: string | null;
  s3_upload_id: string;
  part_size_bytes: string;
  part_count: number;
  state: 'active' | 'completed' | 'aborted' | 'expired';
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export type MediaTables = {
  'media.media_assets': MediaAssetsTable;
  'media.stored_files': StoredFilesTable;
  'media.documents': DocumentsTable;
  'media.document_versions': DocumentVersionsTable;
  'media.file_derivatives': FileDerivativesTable;
  'media.upload_sessions': UploadSessionsTable;
};

export type MediaDb = Kysely<MediaTables>;

export const mediaTables = (db: Kysely<Database>): MediaDb => db.$extendTables<MediaTables>();
