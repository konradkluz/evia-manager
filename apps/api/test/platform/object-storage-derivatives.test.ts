import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from '../../src/platform/object-storage/in-memory-object-storage.ts';
import { DERIVATIVE_URL_SECONDS } from '../../src/platform/object-storage/object-storage.ts';
import { createS3Client, S3ObjectStorage } from '../../src/platform/object-storage/s3-object-storage.ts';

const SETTINGS = {
  endpoint: 'https://s3.fr-par.scw.cloud',
  region: 'fr-par',
  bucket: 'evia-staging-media',
  accessKeyId: 'SCWSYNTHETIC0000',
  secretAccessKey: 'synthetic-secret-value',
  forcePathStyle: false,
};
const KEY = 'media/2026/10/01928f3e-0000-7000-8000-000000000001/thumbnail.webp';
const GET = { key: KEY, expiresInSeconds: DERIVATIVE_URL_SECONDS, contentType: 'image/webp', cacheControl: 'private, max-age=300' };

describe('EVM-068 AC6 the signed GET of a derivative (SR-FILE-07, SR-WEB-04)', () => {
  it('EVM-068 AC6 comes from the host of the bucket, lives 300 s and signs the type, the disposition and the cache control', async () => {
    const storage = new S3ObjectStorage(createS3Client(SETTINGS), SETTINGS.bucket, () => new Date('2026-10-29T10:00:00Z'));
    const signed = await storage.presignGet(GET);
    const url = new URL(signed.url);
    expect(url.hostname).toBe('evia-staging-media.s3.fr-par.scw.cloud');
    expect(url.pathname).toBe(`/${KEY}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-type')).toBe('image/webp');
    expect(url.searchParams.get('response-content-disposition')).toBe('inline');
    expect(url.searchParams.get('response-cache-control')).toBe('private, max-age=300');
    expect(signed.expiresAt.toISOString()).toBe('2026-10-29T10:05:00.000Z');
  });

  it('EVM-068 AC6 a lifetime above 300 s (or below 1) is refused in code, by the adapter and by the double', async () => {
    const storage = new S3ObjectStorage(createS3Client(SETTINGS), SETTINGS.bucket);
    await expect(storage.presignGet({ ...GET, expiresInSeconds: 301 })).rejects.toThrow(RangeError);
    await expect(storage.presignGet({ ...GET, expiresInSeconds: 0 })).rejects.toThrow(RangeError);
    expect(() => new InMemoryObjectStorage().presignGet({ ...GET, expiresInSeconds: 301 })).toThrow(RangeError);
  });

  it('EVM-068 AC6 the double records the URLs handed out and fails like an unreachable storage when unavailable', async () => {
    const storage = new InMemoryObjectStorage();
    const signed = await storage.presignGet(GET);
    expect(new URL(signed.url).searchParams.get('response-content-disposition')).toBe('inline');
    expect(storage.signedGets).toEqual([GET]);
    storage.unavailable = true;
    await expect(storage.presignGet(GET)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('EVM-068 AC6 a failure of the signing is a fixed code, never the message of the SDK', () => {
  it('EVM-068 AC6 a client that cannot sign gives the code `unavailable`', async () => {
    const storage = new S3ObjectStorage({ send: () => Promise.reject(new Error('x')), config: {} } as unknown as S3Client, SETTINGS.bucket);
    await expect(storage.presignGet(GET)).rejects.toMatchObject({ name: 'ObjectStorageError', code: 'unavailable' });
  });
});

describe('EVM-068 AC1 the add-only write of a derivative (TM-76)', () => {
  it('EVM-068 AC1 the adapter sends If-None-Match, the type and the cache control, and maps 412 to precondition_failed', async () => {
    const sent: Array<Record<string, unknown>> = [];
    let answer: () => unknown = () => ({});
    const client = {
      send: (command: { input: Record<string, unknown> }) => {
        sent.push(command.input);
        return Promise.resolve().then(answer);
      },
      config: {},
    } as unknown as S3Client;
    const storage = new S3ObjectStorage(client, SETTINGS.bucket);
    await storage.putObjectIfAbsent({ key: KEY, body: Buffer.from('x'), contentType: 'image/webp', cacheControl: 'private, max-age=300' });
    expect(sent[0]).toMatchObject({
      Bucket: SETTINGS.bucket,
      Key: KEY,
      IfNoneMatch: '*',
      ContentType: 'image/webp',
      CacheControl: 'private, max-age=300',
      ContentLength: 1,
    });
    answer = () => {
      throw Object.assign(new Error('synthetic'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
    };
    await expect(
      storage.putObjectIfAbsent({ key: KEY, body: Buffer.from('x'), contentType: 'image/webp', cacheControl: 'c' }),
    ).rejects.toMatchObject({
      code: 'precondition_failed',
    });
  });

  it('EVM-068 AC1 the double writes once: a second write of the key is precondition_failed and keeps the first bytes', async () => {
    const storage = new InMemoryObjectStorage();
    const put = (body: string) =>
      storage.putObjectIfAbsent({ key: KEY, body: Buffer.from(body), contentType: 'image/webp', cacheControl: 'c' });
    await put('first');
    await expect(put('second')).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(storage.read(KEY)?.body.toString()).toBe('first');
    expect(storage.read(KEY)?.contentType).toBe('image/webp');
    expect(storage.read('missing')).toBeUndefined();
    storage.unavailable = true;
    await expect(put('third')).rejects.toMatchObject({ code: 'unavailable' });
  });
});
