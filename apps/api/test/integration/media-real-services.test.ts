/**
 * The REAL services of the media pipeline (EVM-044 AC3, AC6; ADR-0014): ClamAV with the EICAR test file and an S3 server (SeaweedFS, the
 * emulator of ADR-0011) through the adapters of the platform — Testcontainers, so they run where Docker is available (the CI job
 * `backend-integration`, a developer host). In the `backend-tests` container the database comes from the compose service
 * (`EVIA_TEST_DATABASE_URL`) and there is no Docker socket (ADR-0015): the file is then skipped, and the units cover the same code with the
 * doubles. Synthetic data only; the EICAR string is the harmless standard test file of the antivirus industry.
 */
import { CreateBucketCommand, PutBucketVersioningCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClamdScanner } from '../../src/platform/malware-scan/clamd-scanner.ts';
import { EICAR } from '../../src/platform/malware-scan/fake-malware-scanner.ts';
import { MalwareScanError } from '../../src/platform/malware-scan/malware-scanner.ts';
import { createS3Client, S3ObjectStorage } from '../../src/platform/object-storage/s3-object-storage.ts';

const DOCKER = (process.env['EVIA_TEST_DATABASE_URL'] ?? '') === '';
const MiB = 1024 * 1024;

async function* bytes(...parts: Buffer[]): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  for (const part of parts) yield part;
}

describe.skipIf(!DOCKER)('EVM-044 AC3 — the real ClamAV (the image of the infrastructure, the limits the staging asks for)', () => {
  let clamav: StartedTestContainer;
  let scanner: ClamdScanner;

  beforeAll(async () => {
    // the same image as infra/runtime/compose.infra.yaml; the limits of RR-NOC-T1-2: the stream and the file up to 64M, a larger one is an ERROR
    clamav = await new GenericContainer(
      'clamav/clamav-debian:1.5.4@sha256:cce3e1a43ae2bb40e11335c52c0e1e98273b12fa3d587e617f63a6907cc4b70b',
    )
      .withEnvironment({
        CLAMAV_NO_FRESHCLAMD: 'true',
        CLAMAV_NO_MILTERD: 'true',
        CLAMD_CONF_StreamMaxLength: '64M',
        CLAMD_CONF_MaxFileSize: '64M',
        CLAMD_CONF_MaxScanSize: '64M',
        CLAMD_CONF_AlertExceedsMax: 'yes',
      })
      .withExposedPorts(3310)
      .withWaitStrategy(Wait.forLogMessage(/socket found, clamd started/i))
      .withStartupTimeout(280_000)
      .start();
    scanner = new ClamdScanner({ kind: 'tcp', host: clamav.getHost(), port: clamav.getMappedPort(3310) });
  }, 300_000);

  afterAll(async () => {
    await clamav.stop();
  });

  it('EVM-044 AC3 the EICAR test file is infected; ordinary bytes are clean', async () => {
    await expect(scanner.scan(bytes(Buffer.from(EICAR)))).resolves.toEqual({ status: 'infected' });
    await expect(scanner.scan(bytes(Buffer.from('synthetic bytes, nothing to see')))).resolves.toEqual({ status: 'clean' });
  });

  it('EVM-044 AC3 a clean file of 50 MB (the largest photo) passes, and EICAR split over several chunks is still found (ClamAV matches the whole file, as the standard test file is)', async () => {
    await expect(scanner.scan(bytes(...Array.from({ length: 50 }, () => Buffer.alloc(MiB, 3))))).resolves.toEqual({ status: 'clean' });
    const eicar = Buffer.from(EICAR);
    await expect(scanner.scan(bytes(eicar.subarray(0, 10), eicar.subarray(10, 40), eicar.subarray(40)))).resolves.toEqual({
      status: 'infected',
    });
  }, 120_000);

  it('EVM-044 AC3 a stream above the limit of the scanner is an error and never clean', async () => {
    await expect(scanner.scan(bytes(...Array.from({ length: 70 }, () => Buffer.alloc(MiB, 2))))).rejects.toBeInstanceOf(MalwareScanError);
  }, 120_000);
});

describe.skipIf(!DOCKER)('EVM-044 AC6 — the real S3 server (SeaweedFS): signed parts, versions, complete', () => {
  const BUCKET = 'evia-test-media';
  const ACCESS = 'AKIASYNTHETIC00001';
  const SECRET = 'synthetic-secret-key-for-tests-only';
  let seaweed: StartedTestContainer;
  let storage: S3ObjectStorage;
  let endpoint = '';

  beforeAll(async () => {
    const identities = JSON.stringify({
      identities: [
        { name: 'test', credentials: [{ accessKey: ACCESS, secretKey: SECRET }], actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'] },
      ],
    });
    seaweed = await new GenericContainer('chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d')
      .withCommand([
        'server',
        '-dir=/data',
        '-ip.bind=0.0.0.0',
        '-master.volumeSizeLimitMB=64',
        '-volume.max=5',
        '-s3',
        '-s3.port=8333',
        '-s3.config=/etc/s3.json',
      ])
      .withCopyContentToContainer([{ content: identities, target: '/etc/s3.json' }])
      .withExposedPorts(8333)
      .withWaitStrategy(Wait.forListeningPorts())
      .withStartupTimeout(120_000)
      .start();
    endpoint = `http://${seaweed.getHost()}:${seaweed.getMappedPort(8333)}`;
    const settings = { endpoint, region: 'us-east-1', bucket: BUCKET, accessKeyId: ACCESS, secretAccessKey: SECRET, forcePathStyle: true };
    const client: S3Client = createS3Client(settings);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
        break;
      } catch (error) {
        if (attempt > 40) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    await client.send(new PutBucketVersioningCommand({ Bucket: BUCKET, VersioningConfiguration: { Status: 'Enabled' } }));
    storage = new S3ObjectStorage(client, BUCKET);
  }, 240_000);

  afterAll(async () => {
    await seaweed.stop();
  });

  const put = (url: string, body: Buffer, init: { length?: number } = {}) =>
    fetch(url, {
      method: 'PUT',
      body,
      credentials: 'omit',
      headers: { 'Content-Length': String(init.length ?? body.length) },
    });

  it('EVM-044 AC6 a part goes to the signed URL with the exact length; another length, another part number or another key is refused (403)', async () => {
    const key = 'media/2026/10/01928f3e-0000-7000-8000-000000000001/original';
    const { uploadId } = await storage.createMultipartUpload(key, 'image/jpeg');
    const body = Buffer.alloc(5 * MiB, 9);
    const signed = await storage.presignUploadPart({ key, uploadId, partNumber: 1, contentLength: body.length, expiresInSeconds: 3600 });
    const wrongLength = await fetch(signed.url, { method: 'PUT', body: Buffer.alloc(body.length + 5, 1), credentials: 'omit' });
    expect(wrongLength.status).toBe(403);
    const url = new URL(signed.url);
    url.searchParams.set('partNumber', '2');
    expect((await put(url.toString(), body)).status).toBe(403);
    const otherKey = new URL(signed.url);
    otherKey.pathname = otherKey.pathname.replace('original', 'copy');
    expect((await put(otherKey.toString(), body)).status).toBe(403);
    const ok = await put(signed.url, body);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('etag')).toBeTruthy();
    expect(await storage.listParts(key, uploadId)).toMatchObject([{ partNumber: 1, size: body.length }]);
  });

  it('EVM-044 AC6 complete assembles the object; the object has the declared length; a second complete is a success or NoSuchUpload (both handled); an overwrite keeps the older version', async () => {
    const key = 'media/2026/10/01928f3e-0000-7000-8000-000000000002/original';
    const first = await assemble(key, Buffer.alloc(5 * MiB + 17, 4));
    expect(await storage.head(key)).toMatchObject({ size: 5 * MiB + 17, versionId: first.versionId });
    const repeat = await storage
      .completeMultipartUpload(key, first.uploadId, await listOrEmpty(key, first.uploadId))
      .catch((error: unknown) => error);
    expect(repeat instanceof Error ? (repeat as { code?: string }).code : 'ok').toMatch(/ok|no_such_upload/);
    const second = await assemble(key, Buffer.alloc(5 * MiB + 3, 5));
    expect(second.versionId).not.toBe(first.versionId);
    // the older version is still there and a read pinned to it returns the older bytes
    const stream = await storage.getObjectStream(key, { versionId: first.versionId });
    let total = 0;
    for await (const chunk of stream) total += (chunk as Buffer).length;
    expect(total).toBe(5 * MiB + 17);
    expect(await storage.head('media/2026/10/no-such-object/original')).toBeUndefined();
    const anonymous = await fetch(`${endpoint}/${BUCKET}/${key}`);
    expect(anonymous.status).toBe(403);
  });

  async function listOrEmpty(key: string, uploadId: string) {
    return storage.listParts(key, uploadId).catch(() => []);
  }

  async function assemble(key: string, body: Buffer): Promise<{ uploadId: string; versionId: string | undefined }> {
    const { uploadId } = await storage.createMultipartUpload(key, 'image/jpeg');
    const signed = await storage.presignUploadPart({ key, uploadId, partNumber: 1, contentLength: body.length, expiresInSeconds: 3600 });
    expect((await put(signed.url, body)).status).toBe(200);
    const done = await storage.completeMultipartUpload(key, uploadId, await storage.listParts(key, uploadId));
    return { uploadId, versionId: done.versionId };
  }
});
