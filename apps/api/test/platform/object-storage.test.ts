import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from '../../src/platform/object-storage/in-memory-object-storage.ts';
import { ObjectStorageError, type ObjectStorage } from '../../src/platform/object-storage/object-storage.ts';
import { createS3Client, S3ObjectStorage, translateS3Error } from '../../src/platform/object-storage/s3-object-storage.ts';

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

const stubStorage = (send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => unknown): S3ObjectStorage =>
  new S3ObjectStorage({ send: (command: never) => Promise.resolve().then(() => send(command)) } as unknown as S3Client, SETTINGS.bucket);

describe('EVM-044 AC6 the signed URL of a part (SR-FILE-02, media-pipeline section 5)', () => {
  it('EVM-044 AC6 is virtual-hosted, lives 3600 s, and signs the length, the upload and the part number', async () => {
    const storage = new S3ObjectStorage(createS3Client(SETTINGS), SETTINGS.bucket, () => new Date('2026-10-27T10:00:00Z'));
    const part = await storage.presignUploadPart({
      key: 'media/2026/10/01928f3e-0000-7000-8000-000000000001/original',
      uploadId: 'UPLOAD-ID-1',
      partNumber: 3,
      contentLength: 16_777_216,
      expiresInSeconds: 3600,
    });
    const url = new URL(part.url);
    expect(url.hostname).toBe('evia-staging-media.s3.fr-par.scw.cloud');
    expect(url.pathname).toBe('/media/2026/10/01928f3e-0000-7000-8000-000000000001/original');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('uploadId')).toBe('UPLOAD-ID-1');
    expect(url.searchParams.get('partNumber')).toBe('3');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false);
    expect(part.expiresAt.toISOString()).toBe('2026-10-27T11:00:00.000Z');
  });

  it('EVM-044 AC6 a lifetime above 3600 s (or below 1) is refused in code', async () => {
    const storage = new S3ObjectStorage(createS3Client(SETTINGS), SETTINGS.bucket);
    const base = { key: 'k', uploadId: 'u', partNumber: 1, contentLength: 1 };
    await expect(storage.presignUploadPart({ ...base, expiresInSeconds: 3601 })).rejects.toThrow(RangeError);
    await expect(storage.presignUploadPart({ ...base, expiresInSeconds: 0 })).rejects.toThrow(RangeError);
    const memory = new InMemoryObjectStorage();
    expect(() => memory.presignUploadPart({ ...base, expiresInSeconds: 3601 })).toThrow(RangeError);
  });
});

describe('EVM-044 AC6 the S3 adapter maps results and errors to the port', () => {
  it('EVM-044 AC6 errors are translated to fixed codes and never carry the message of the SDK', () => {
    expect(translateS3Error(new AwsLikeError('NoSuchUpload', 404)).code).toBe('no_such_upload');
    expect(translateS3Error(new AwsLikeError('NoSuchKey', 404)).code).toBe('no_such_object');
    expect(translateS3Error(new AwsLikeError('Whatever', 404)).code).toBe('no_such_object');
    expect(translateS3Error(new AwsLikeError('PreconditionFailed', 412)).code).toBe('precondition_failed');
    expect(translateS3Error(new AwsLikeError('InternalError', 500)).code).toBe('unavailable');
    expect(translateS3Error('boom').code).toBe('unavailable');
    expect(translateS3Error(new AwsLikeError('InternalError', 500)).message).toBe('unavailable');
    const own = new ObjectStorageError('no_such_object');
    expect(translateS3Error(own)).toBe(own);
  });

  it('EVM-044 AC6 creates, lists (paged), completes and aborts through the commands of the SDK', async () => {
    const calls: string[] = [];
    const storage = stubStorage((command) => {
      const name = command.constructor.name;
      calls.push(name);
      switch (name) {
        case 'CreateMultipartUploadCommand':
          expect(command.input['ContentType']).toBe('image/jpeg');
          return { UploadId: 'U1' };
        case 'ListPartsCommand':
          return command.input['PartNumberMarker'] === undefined
            ? { Parts: [{ PartNumber: 2, Size: 5, ETag: '"b"' }], IsTruncated: true, NextPartNumberMarker: '2' }
            : { Parts: [{ PartNumber: 1, Size: 6, ETag: '"a"' }, { PartNumber: 3 }], IsTruncated: false };
        case 'CompleteMultipartUploadCommand':
          return { ETag: '"final"', VersionId: 'v1' };
        case 'AbortMultipartUploadCommand':
          throw new AwsLikeError('NoSuchUpload', 404);
        default:
          throw new Error(name);
      }
    });
    await expect(storage.createMultipartUpload('k', 'image/jpeg')).resolves.toEqual({ uploadId: 'U1' });
    await expect(storage.listParts('k', 'U1')).resolves.toEqual([
      { partNumber: 1, size: 6, etag: '"a"' },
      { partNumber: 2, size: 5, etag: '"b"' },
    ]);
    await expect(storage.completeMultipartUpload('k', 'U1', [{ partNumber: 1, size: 6, etag: '"a"' }])).resolves.toEqual({
      etag: '"final"',
      versionId: 'v1',
    });
    await expect(storage.abortMultipartUpload('k', 'U1')).resolves.toBeUndefined();
    expect(calls).toEqual([
      'CreateMultipartUploadCommand',
      'ListPartsCommand',
      'ListPartsCommand',
      'CompleteMultipartUploadCommand',
      'AbortMultipartUploadCommand',
    ]);
  });

  it('EVM-044 AC6 head is undefined for a missing object, reads are pinned to a version and an ETag, an incomplete answer is unavailable', async () => {
    let head: unknown = { ContentLength: 10, ETag: '"e"', VersionId: 'v2' };
    const storage = stubStorage((command) => {
      const name = command.constructor.name;
      if (name === 'HeadObjectCommand') {
        if (head instanceof Error) throw head;
        return head;
      }
      if (name === 'GetObjectCommand') {
        expect(command.input).toMatchObject({ VersionId: 'v2', IfMatch: '"e"' });
        return { Body: 'stream' };
      }
      if (name === 'CreateMultipartUploadCommand') return {};
      if (name === 'CompleteMultipartUploadCommand') return {};
      throw new Error(name);
    });
    await expect(storage.head('k')).resolves.toEqual({ size: 10, etag: '"e"', versionId: 'v2' });
    await expect(storage.getObjectStream('k', { versionId: 'v2', ifMatch: '"e"' })).resolves.toBe('stream');
    head = new AwsLikeError('NotFound', 404);
    await expect(storage.head('k')).resolves.toBeUndefined();
    head = new AwsLikeError('InternalError', 500);
    await expect(storage.head('k')).rejects.toMatchObject({ code: 'unavailable' });
    head = {};
    await expect(storage.head('k')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storage.createMultipartUpload('k', 'x')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storage.completeMultipartUpload('k', 'u', [])).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('EVM-044 AC6 the in-memory storage keeps the semantics the services rely on', () => {
  async function upload(storage: ObjectStorage, key: string, body: Buffer): Promise<string> {
    const { uploadId } = await storage.createMultipartUpload(key, 'image/jpeg');
    (storage as InMemoryObjectStorage).putPart(uploadId, 1, body);
    await storage.completeMultipartUpload(key, uploadId, await storage.listParts(key, uploadId));
    return uploadId;
  }

  it('EVM-044 AC6 a completed upload is gone (NoSuchUpload), an overwrite keeps the older version, reads can be pinned', async () => {
    const storage = new InMemoryObjectStorage();
    const first = await upload(storage, 'k', Buffer.from('one'));
    await expect(storage.listParts('k', first)).rejects.toMatchObject({ code: 'no_such_upload' });
    const head1 = await storage.head('k');
    await upload(storage, 'k', Buffer.from('second'));
    expect(storage.versionsOf('k')).toBe(2);
    const head2 = await storage.head('k');
    expect(head2?.size).toBe(6);
    const old = await storage.getObjectStream('k', { versionId: head1?.versionId });
    const text: Buffer[] = [];
    for await (const chunk of old) text.push(chunk as Buffer);
    expect(Buffer.concat(text).toString()).toBe('one');
    await expect(storage.getObjectStream('k', { ifMatch: '"other"' })).rejects.toMatchObject({ code: 'precondition_failed' });
    await expect(storage.getObjectStream('missing', {})).rejects.toMatchObject({ code: 'no_such_object' });
    await expect(storage.head('missing')).resolves.toBeUndefined();
  });

  it('EVM-044 AC6 an unavailable storage fails every call with the fixed code', async () => {
    const storage = new InMemoryObjectStorage();
    storage.unavailable = true;
    await expect(storage.createMultipartUpload('k', 'x')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(storage.head('k')).rejects.toMatchObject({ code: 'unavailable' });
  });
});
