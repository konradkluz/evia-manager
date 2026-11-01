import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MEDIA_LIMITS } from '../../src/platform/config/media-config.ts';
import { createMalwareScanner } from '../../src/platform/malware-scan/create-malware-scanner.ts';
import { createObjectStorage } from '../../src/platform/object-storage/create-object-storage.ts';
import { InMemoryObjectStorage } from '../../src/platform/object-storage/in-memory-object-storage.ts';
import { ObjectStorageError } from '../../src/platform/object-storage/object-storage.ts';
import { S3ObjectStorage } from '../../src/platform/object-storage/s3-object-storage.ts';

const SETTINGS = {
  endpoint: 'https://s3.fr-par.scw.cloud',
  region: 'fr-par',
  bucket: 'evia-staging-media',
  accessKeyId: 'SCWSYNTHETIC0000',
  secretAccessKey: 'synthetic-secret-value',
  forcePathStyle: false,
};

class AwsLikeError extends Error {
  readonly $metadata: { httpStatusCode: number };
  constructor(name: string, status: number) {
    super('Synthetic message that names bucket evia-staging-media and request id 123');
    this.name = name;
    this.$metadata = { httpStatusCode: status };
  }
}

const storageThat = (answer: () => unknown): S3ObjectStorage =>
  new S3ObjectStorage({ send: () => Promise.resolve().then(answer), config: {} } as unknown as S3Client, SETTINGS.bucket);
const failing = (name: string, status: number): S3ObjectStorage =>
  storageThat(() => {
    throw new AwsLikeError(name, status);
  });

describe('EVM-044 AC6 the double and the adapter cover the awkward answers of a storage', () => {
  it('EVM-044 AC6 the double refuses a part of an unknown upload, an incomplete assembly and every call when unavailable', async () => {
    const storage = new InMemoryObjectStorage();
    expect(() => {
      storage.putPart('missing', 1, Buffer.alloc(1));
    }).toThrow(ObjectStorageError);
    await expect(storage.listParts('k', 'missing')).rejects.toMatchObject({ code: 'no_such_upload' });
    await expect(storage.completeMultipartUpload('k', 'missing', [])).rejects.toMatchObject({ code: 'no_such_upload' });
    const { uploadId } = await storage.createMultipartUpload('k', 'image/jpeg');
    await expect(storage.completeMultipartUpload('k', uploadId, [{ partNumber: 1, size: 1, etag: '"x"' }])).rejects.toMatchObject({
      code: 'unavailable',
    });
    storage.unavailable = true;
    const part = { key: 'k', uploadId, partNumber: 1, contentLength: 1, expiresInSeconds: 60 };
    await expect(storage.createMultipartUpload('k', 'x')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storage.presignUploadPart(part)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storage.listParts('k', uploadId)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storage.completeMultipartUpload('k', uploadId, [])).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storage.abortMultipartUpload('k', uploadId)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storage.head('k')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storage.getObjectStream('k', {})).rejects.toMatchObject({ code: 'unavailable' });
    storage.unavailable = false;
    await expect(storage.abortMultipartUpload('k', 'never-existed')).resolves.toBeUndefined();
  });

  it('EVM-044 AC6 the double serves a pinned version and keeps a multi-chunk body whole', async () => {
    const storage = new InMemoryObjectStorage();
    const put = storage.putObject('k', Buffer.alloc(150_000, 2));
    const stream = await storage.getObjectStream('k', {
      ...(put.versionId === undefined ? {} : { versionId: put.versionId }),
      ifMatch: put.etag,
    });
    let total = 0;
    for await (const chunk of stream) total += (chunk as Buffer).length;
    expect(total).toBe(150_000);
    await expect(storage.getObjectStream('k', { versionId: 'other' })).rejects.toMatchObject({ code: 'no_such_object' });
    expect(storage.versionsOf('absent')).toBe(0);
  });

  it('EVM-044 AC6 every failing call of the S3 adapter becomes a fixed code; an abort of a vanished upload is not an error, any other failure is', async () => {
    await expect(failing('InternalError', 500).createMultipartUpload('k', 'x')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(failing('InternalError', 500).listParts('k', 'u')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(failing('NoSuchUpload', 404).completeMultipartUpload('k', 'u', [])).rejects.toMatchObject({ code: 'no_such_upload' });
    await expect(failing('NoSuchUpload', 404).abortMultipartUpload('k', 'u')).resolves.toBeUndefined();
    await expect(failing('InternalError', 500).abortMultipartUpload('k', 'u')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(failing('NoSuchKey', 404).getObjectStream('k', {})).rejects.toMatchObject({ code: 'no_such_object' });
    await expect(failing('PreconditionFailed', 412).getObjectStream('k', { ifMatch: '"e"' })).rejects.toMatchObject({
      code: 'precondition_failed',
    });
    await expect(storageThat(() => ({})).getObjectStream('k', {})).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storageThat(() => ({})).deleteObject('k')).resolves.toBeUndefined();
    await expect(failing('NoSuchKey', 404).deleteObject('k')).resolves.toBeUndefined();
    await expect(failing('InternalError', 500).deleteObject('k')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storageThat(() => ({ Parts: [] })).listParts('k', 'u')).resolves.toEqual([]);
  });

  it('EVM-051 AC5 the adapter lists a page of the current objects with their time and the token of the next page, and a failure is a fixed code', async () => {
    const modified = new Date('2026-10-03T10:00:00.000Z');
    const page = await storageThat(() => ({
      Contents: [{ Key: 'media/a', LastModified: modified }, { Key: 'media/b' }, {}],
      IsTruncated: true,
      NextContinuationToken: 'next-token',
    })).listObjects('media/', 3, 'token');
    expect(page).toEqual({
      objects: [
        { key: 'media/a', modifiedAt: modified },
        { key: 'media/b', modifiedAt: new Date(0) },
      ],
      nextToken: 'next-token',
    });
    await expect(storageThat(() => ({})).listObjects('media/', 3)).resolves.toEqual({ objects: [], nextToken: undefined });
    await expect(failing('InternalError', 500).listObjects('media/', 3)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('EVM-044 AC3 the factories return nothing without the media configuration and the real adapters with it', () => {
    expect(createObjectStorage(undefined)).toBeNull();
    expect(createMalwareScanner(undefined)).toBeNull();
    const media = {
      s3: SETTINGS,
      clamd: { kind: 'tcp', host: 'clamd', port: 3310 },
      processor: undefined,
      bucketOrigin: undefined,
      limits: DEFAULT_MEDIA_LIMITS,
    } as const;
    expect(createObjectStorage(media)).toBeInstanceOf(S3ObjectStorage);
    expect(createMalwareScanner(media)).not.toBeNull();
    expect(createMalwareScanner({ ...media, clamd: undefined })).toBeNull();
  });
});
