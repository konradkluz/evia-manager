/**
 * Synthetic media written straight into the database (EVM-044) — a TEST helper: it lives outside `src`, so it is not in the production
 * image and no route reaches it; it refuses to run when `NODE_ENV=production` (SR-INFRA-08). Everything is synthetic (no real photo).
 */
import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import { mediaTables } from '../../src/modules/media/infrastructure/tables.ts';
import type { FileState, ReasonCode } from '../../src/modules/media/domain/scan-outcome.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { uuidv7 } from './uuid.ts';
import { assertSyntheticDataAllowed } from './work-order-fixtures.ts';

const AT = new Date('2026-10-27T08:00:00.000Z');

export const sha256Of = (body: Buffer | string): string => createHash('sha256').update(body).digest('hex');

export interface MediaSpec {
  readonly workOrderId: string;
  readonly createdBy: string;
  readonly state?: FileState;
  readonly reason?: ReasonCode;
  readonly fileName?: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly sha256?: string;
  readonly session?: {
    readonly userId: string;
    readonly uploadId?: string;
    readonly expiresAt?: Date;
    readonly state?: 'active' | 'completed' | 'aborted' | 'expired';
  };
  readonly createdAt?: Date;
  readonly versionId?: string;
  readonly etag?: string;
}

export interface InsertedMedia {
  readonly mediaAssetId: string;
  readonly storedFileId: string;
  readonly objectKey: string;
  readonly sessionId: string | null;
}

export async function insertMedia(db: Kysely<Database>, spec: MediaSpec): Promise<InsertedMedia> {
  assertSyntheticDataAllowed();
  const tables = mediaTables(db);
  const mediaAssetId = uuidv7();
  const storedFileId = uuidv7();
  const at = spec.createdAt ?? AT;
  const objectKey = `media/2026/10/${storedFileId}/original`;
  await tables
    .insertInto('media.media_assets')
    .values({
      id: mediaAssetId,
      work_order_id: spec.workOrderId,
      procedure_stage_id: null,
      media_type: 'photo',
      category: 'in_progress',
      description: null,
      origin: 'web',
      captured_at: null,
      created_at: at,
      created_by: spec.createdBy,
      updated_at: at,
    })
    .execute();
  await tables
    .insertInto('media.stored_files')
    .values({
      id: storedFileId,
      purpose: 'media_original',
      media_asset_id: mediaAssetId,
      object_key: objectKey,
      state: spec.state ?? 'pending_upload',
      state_reason_code: spec.reason ?? null,
      state_changed_at: at,
      scan_claimed_at: null,
      declared_size_bytes: String(spec.size ?? 1000),
      size_bytes: null,
      declared_content_type: spec.contentType ?? 'image/jpeg',
      content_type: null,
      declared_sha256: spec.sha256 ?? 'a'.repeat(64),
      sha256: null,
      original_filename: spec.fileName ?? 'IMG_0001.JPG',
      s3_version_id: spec.versionId ?? null,
      s3_etag: spec.etag ?? null,
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
        state: spec.session.state ?? 'active',
        expires_at: spec.session.expiresAt ?? new Date('2026-11-03T08:00:00.000Z'),
        created_at: at,
        updated_at: at,
      })
      .execute();
  }
  return { mediaAssetId, storedFileId, objectKey, sessionId };
}
