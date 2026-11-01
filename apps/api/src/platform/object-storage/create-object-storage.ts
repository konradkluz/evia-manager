/**
 * Builds the object storage from the validated configuration (EVM-044): `null` when the media variables are absent — the feature is then
 * off and every media operation answers `503 media_storage_unavailable` while the service stays healthy (P5, fail closed).
 */
import type { MediaConfig } from '../config/media-config.ts';
import type { ObjectStorage } from './object-storage.ts';
import { createS3Client, S3ObjectStorage } from './s3-object-storage.ts';

export function createObjectStorage(media: MediaConfig | undefined): ObjectStorage | null {
  return media === undefined ? null : new S3ObjectStorage(createS3Client(media.s3), media.s3.bucket);
}

/** The storage of the exports: the same server and credentials, the bucket of the exports; `null` when the bucket is not configured (fail closed). */
export function createExportStorage(media: MediaConfig | undefined): ObjectStorage | null {
  if (media?.exportBucket === undefined) return null;
  return new S3ObjectStorage(createS3Client(media.s3), media.exportBucket);
}
