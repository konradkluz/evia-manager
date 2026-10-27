/**
 * What the services of `media` share (EVM-044): the fail-closed access to the storage, the key of idempotency, the creator of a session
 * and the representation of a medium. The representation NEVER carries the object key, the S3 upload id, the checksum or the reason of a
 * quarantine (media-pipeline.md, domain-model.md: the reason is for the Administrator, EVM-049).
 */
import type { MediaAsset, UploadSession } from '@evia/contracts';
import { zCreateMediaAssetsHeaders } from '@evia/contracts/zod';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ObjectStorageError, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import type { AssetWithFile, Creator, ListedAsset, UploadSessionRow } from '../infrastructure/media-store.ts';

const RETRY_AFTER_SECONDS = 60;

/** @throws ProblemException `media_storage_unavailable` — the feature is not configured (P5: fail closed, the service stays healthy) */
export function requireStorage(storage: ObjectStorage | null): ObjectStorage {
  if (storage === null) throw new ProblemException('media_storage_unavailable', { retryAfterSeconds: RETRY_AFTER_SECONDS });
  return storage;
}

/**
 * Runs a call of the storage; every failure but the ones the caller handles by code becomes `503 media_storage_unavailable` — the error of the SDK
 * never travels further (it may name the bucket, the request or the path; SR-ERR-01).
 * @param handled the codes the caller maps itself (they are rethrown as {@link ObjectStorageError})
 */
export async function viaStorage<T>(call: () => Promise<T>, handled: readonly ObjectStorageError['code'][] = []): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ObjectStorageError && handled.includes(error.code)) throw error;
    throw new ProblemException('media_storage_unavailable', { retryAfterSeconds: RETRY_AFTER_SECONDS });
  }
}

const idempotencyKeySchema = zCreateMediaAssetsHeaders.shape['Idempotency-Key'];

/** @throws ProblemException `validation_failed` — the header is required and is a UUIDv7 (`/headers/Idempotency-Key`) */
export function idempotencyKeyOf(rawKey: string | undefined): string {
  const pointer = '/headers/Idempotency-Key';
  if (rawKey === undefined) throw new ProblemException('validation_failed', { errors: [{ pointer, code: 'required' }] });
  const parsed = idempotencyKeySchema.safeParse(rawKey);
  if (!parsed.success) throw new ProblemException('validation_failed', { errors: [{ pointer, code: 'invalid_format' }] });
  return parsed.data;
}

/** The creator of a session: the user and the device — the web has no device (`null`). */
export const creatorOf = (principal: Principal): Creator => ({ userId: principal.userId, deviceId: null });

interface Representation {
  /** The list with `uploadState=unfinished`: the only place the file name and the session are returned. */
  readonly unfinished: boolean;
  readonly session?: ListedAsset['session'];
}

export function toMediaAsset({ asset, file }: AssetWithFile, options: Representation = { unfinished: false }): MediaAsset {
  const checksumMismatch = file.state === 'failed' && file.state_reason_code === 'checksum_mismatch';
  const session = options.unfinished ? (options.session ?? null) : null;
  return {
    id: asset.id,
    workOrderId: asset.work_order_id,
    mediaType: asset.media_type,
    category: asset.category as MediaAsset['category'],
    description: asset.description,
    origin: asset.origin,
    capturedAt: asset.captured_at === null ? null : asset.captured_at.toISOString(),
    createdAt: asset.created_at.toISOString(),
    fileState: file.state,
    stateReasonCode: checksumMismatch ? 'checksum_mismatch' : null,
    needsAttention: file.state === 'quarantined',
    declaredSize: Number(file.declared_size_bytes),
    originalFilename: options.unfinished ? file.original_filename : null,
    uploadSession:
      session === null
        ? null
        : { id: session.id, expiresAt: session.expiresAt.toISOString(), partSize: session.partSize, partCount: session.partCount },
  };
}

export function toUploadSession(session: UploadSessionRow, mediaAssetId: string): UploadSession {
  return {
    id: session.id,
    mediaAssetId,
    state: session.state,
    partSize: Number(session.part_size_bytes),
    partCount: session.part_count,
    expiresAt: session.expires_at.toISOString(),
  };
}
