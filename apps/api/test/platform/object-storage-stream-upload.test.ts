import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from '../../src/platform/object-storage/in-memory-object-storage.ts';
import { S3ObjectStorage, UPLOAD_PART_BYTES } from '../../src/platform/object-storage/s3-object-storage.ts';

interface Sent {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** A client that records the commands; a part is acknowledged with an ETag of its number. `failPart` makes that part fail like an unreachable storage. */
function fakeClient(options: { failPart?: number; failComplete?: 'PreconditionFailed' } = {}): { client: S3Client; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      if (name === 'CreateMultipartUploadCommand') return Promise.resolve({ UploadId: 'upload-1' });
      if (name === 'UploadPartCommand') {
        if (command.input['PartNumber'] === options.failPart)
          return Promise.reject(Object.assign(new Error('SlowDown'), { name: 'SlowDown' }));
        return Promise.resolve({ ETag: `"etag-${String(command.input['PartNumber'])}"` });
      }
      if (name === 'CompleteMultipartUploadCommand' && options.failComplete !== undefined)
        return Promise.reject(Object.assign(new Error('x'), { name: options.failComplete, $metadata: { httpStatusCode: 412 } }));
      return Promise.resolve({});
    },
  } as unknown as S3Client;
  return { client, sent };
}

const INPUT = {
  key: 'exports/2026/11/0198a7a0-1234-7000-8000-000000000001.zip',
  contentType: 'application/zip',
  cacheControl: 'private, no-store',
};
const stream = (...chunks: Buffer[]): Readable => Readable.from(chunks, { objectMode: false });

describe('EVM-052 AC1 the streamed multipart upload of the archive (SR-INFRA-11, CWE-400)', () => {
  it('EVM-052 AC1 cuts the stream into parts of a fixed size, none larger, add-only on completion, in the order of the stream', async () => {
    const { client, sent } = fakeClient();
    const storage = new S3ObjectStorage(client, 'evia-exports');
    const chunk = Buffer.alloc(3 * 1024 * 1024, 1);
    const chunks = Array.from({ length: 7 }, () => chunk); // 21 MiB: parts of 9, 9 and 3 MiB (a part closes at the first chunk that reaches 8 MiB)
    await storage.uploadStreamIfAbsent({ ...INPUT, body: stream(...chunks), size: 21 * 1024 * 1024 });
    const parts = sent.filter((entry) => entry.name === 'UploadPartCommand');
    expect(parts.map((entry) => (entry.input['Body'] as Buffer).length)).toEqual([9 * 1024 * 1024, 9 * 1024 * 1024, 3 * 1024 * 1024]);
    for (const part of parts) expect((part.input['Body'] as Buffer).length).toBeLessThan(UPLOAD_PART_BYTES + chunk.length);
    const complete = sent.find((entry) => entry.name === 'CompleteMultipartUploadCommand');
    expect(complete?.input['IfNoneMatch']).toBe('*');
    expect((complete?.input['MultipartUpload'] as { Parts: unknown[] }).Parts).toHaveLength(3);
    expect(sent.some((entry) => entry.name === 'AbortMultipartUploadCommand')).toBe(false);
    const created = sent.find((entry) => entry.name === 'CreateMultipartUploadCommand');
    expect(created?.input).toMatchObject({ ContentType: 'application/zip', CacheControl: 'private, no-store' });
  });

  it('EVM-052 AC1 a small archive is one part; an empty stream of size zero is one empty part', async () => {
    const { client, sent } = fakeClient();
    await new S3ObjectStorage(client, 'b').uploadStreamIfAbsent({ ...INPUT, body: stream(Buffer.from('abc')), size: 3 });
    expect(sent.filter((entry) => entry.name === 'UploadPartCommand')).toHaveLength(1);
    const empty = fakeClient();
    await new S3ObjectStorage(empty.client, 'b').uploadStreamIfAbsent({ ...INPUT, body: stream(), size: 0 });
    expect(empty.sent.filter((entry) => entry.name === 'UploadPartCommand')).toHaveLength(1);
  });

  it('EVM-052 AC1 a part that the storage refuses aborts the multipart upload and the error is a fixed code', async () => {
    const { client, sent } = fakeClient({ failPart: 2 });
    const body = stream(Buffer.alloc(UPLOAD_PART_BYTES), Buffer.alloc(UPLOAD_PART_BYTES), Buffer.alloc(10));
    await expect(
      new S3ObjectStorage(client, 'b').uploadStreamIfAbsent({ ...INPUT, body, size: 2 * UPLOAD_PART_BYTES + 10 }),
    ).rejects.toMatchObject({ name: 'ObjectStorageError', code: 'unavailable' });
    expect(sent.at(-1)?.name).toBe('AbortMultipartUploadCommand');
    expect(sent.some((entry) => entry.name === 'CompleteMultipartUploadCommand')).toBe(false);
  });

  it('EVM-052 AC1 a stream that delivers fewer or more bytes than declared, or fails, aborts the upload and is never completed', async () => {
    for (const [body, size] of [
      [stream(Buffer.from('abc')), 4],
      [stream(Buffer.from('abcd')), 3],
    ] as const) {
      const { client, sent } = fakeClient();
      await expect(new S3ObjectStorage(client, 'b').uploadStreamIfAbsent({ ...INPUT, body, size })).rejects.toMatchObject({
        code: 'unavailable',
      });
      expect(sent.map((entry) => entry.name)).toContain('AbortMultipartUploadCommand');
      expect(sent.map((entry) => entry.name)).not.toContain('CompleteMultipartUploadCommand');
    }
    const { client, sent } = fakeClient();
    const failing = new Readable({
      read() {
        this.destroy(new Error('source failed'));
      },
    });
    await expect(new S3ObjectStorage(client, 'b').uploadStreamIfAbsent({ ...INPUT, body: failing, size: 5 })).rejects.toThrow(
      'source failed',
    );
    expect(sent.at(-1)?.name).toBe('AbortMultipartUploadCommand');
  });

  it('EVM-052 AC1 an existing object (precondition failed on completion) is reported as such, and the upload is aborted', async () => {
    const { client, sent } = fakeClient({ failComplete: 'PreconditionFailed' });
    await expect(
      new S3ObjectStorage(client, 'b').uploadStreamIfAbsent({ ...INPUT, body: stream(Buffer.from('abc')), size: 3 }),
    ).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(sent.at(-1)?.name).toBe('AbortMultipartUploadCommand');
  });

  it('EVM-052 AC1 a storage that cannot start the upload, or answers without an upload id, is `unavailable`', async () => {
    const down = { send: () => Promise.reject(new Error('down')) } as unknown as S3Client;
    await expect(
      new S3ObjectStorage(down, 'b').uploadStreamIfAbsent({ ...INPUT, body: stream(Buffer.from('a')), size: 1 }),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
    const noId = { send: () => Promise.resolve({}) } as unknown as S3Client;
    await expect(
      new S3ObjectStorage(noId, 'b').uploadStreamIfAbsent({ ...INPUT, body: stream(Buffer.from('a')), size: 1 }),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('EVM-052 AC1 a part answered without an ETag is `unavailable` and aborts', async () => {
    const sent: string[] = [];
    const client = {
      send: (command: { constructor: { name: string } }) => {
        sent.push(command.constructor.name);
        return Promise.resolve(command.constructor.name === 'CreateMultipartUploadCommand' ? { UploadId: 'u' } : {});
      },
    } as unknown as S3Client;
    await expect(
      new S3ObjectStorage(client, 'b').uploadStreamIfAbsent({ ...INPUT, body: stream(Buffer.from('a')), size: 1 }),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(sent.at(-1)).toBe('AbortMultipartUploadCommand');
  });
});

describe('EVM-052 AC1 the double of the storage streams the same way', () => {
  it('EVM-052 AC1 stores the bytes add-only and counts the upload; a wrong size or an existing key aborts it', async () => {
    const storage = new InMemoryObjectStorage();
    await storage.uploadStreamIfAbsent({ ...INPUT, body: stream(Buffer.from('ab'), Buffer.from('cd')), size: 4 });
    expect(storage.read(INPUT.key)?.body.toString()).toBe('abcd');
    expect(storage.read(INPUT.key)?.contentType).toBe('application/zip');
    await expect(storage.uploadStreamIfAbsent({ ...INPUT, body: stream(Buffer.from('x')), size: 1 })).rejects.toMatchObject({
      code: 'precondition_failed',
    });
    await expect(
      storage.uploadStreamIfAbsent({ ...INPUT, key: 'exports/other.zip', body: stream(Buffer.from('x')), size: 2 }),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(
      storage.uploadStreamIfAbsent({ ...INPUT, key: 'exports/other.zip', body: stream(Buffer.from('xyz')), size: 2 }),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(storage.streamedUploads).toEqual({ started: 4, aborted: 3, completed: 1 });
    storage.unavailable = true;
    await expect(storage.uploadStreamIfAbsent({ ...INPUT, body: stream(), size: 0 })).rejects.toMatchObject({ code: 'unavailable' });
  });
});
