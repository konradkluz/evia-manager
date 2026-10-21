// Integration tests of the protocol against a REAL S3-compatible server (SeaweedFS, infra/compose.seaweedfs.yaml) via the url-issuer.
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  DeleteObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MiB,
  MemoryStore,
  FileStore,
  newJob,
  runUpload,
  uuidv7,
  markVerified,
  type Checkpoint,
  type EngineDeps,
  type UploadApi,
  type UploadJob,
} from '@evm011/core';
import { HttpPartTransport, HttpUploadApi } from '../src/client.ts';
import { createIssuer, type Issuer } from '../src/issuer.ts';
import { countDuplicates, ensureBucket, loadLocal, s3Client, type LocalConfig } from '../src/local.ts';
import { makeSyntheticFile } from '../src/synthetic.ts';
import { objectSha256 } from '../src/verify.ts';

const SIZE = 28 * MiB + 12345; // 4 parts of 8 MiB (last one partial)
const PART = 8 * MiB;
const DEVICE = 'device-a';
let local: LocalConfig;
let s3: S3Client;
let issuer: Issuer;
let base: string;
let dir: string;
let file: string;
let fileSha: string;
let bucket = '';

class Killed extends Error {}
const killAt = (point: Checkpoint, nth = 1) => {
  let seen = 0;
  return (name: Checkpoint) => {
    if (name === point && ++seen === nth) throw new Killed();
  };
};

async function startIssuer(ttlSeconds = 60, statePath = join(dir, 'issuer-state.json')) {
  const i = createIssuer({
    s3Endpoint: 'http://127.0.0.1:8333',
    signEndpoint: 'http://127.0.0.1:8333',
    bucket,
    accessKey: local.accessKey,
    secretKey: local.secretKey,
    token: local.token,
    ttlSeconds,
    statePath,
    defaultPartSize: PART,
    log: () => undefined,
  });
  const port = await i.listen();
  return { i, base: `http://127.0.0.1:${port}` };
}

const mkJob = (assetId = uuidv7(), deviceId = DEVICE): UploadJob =>
  newJob({ assetId, deviceId, filePath: file, size: SIZE, sha256: fileSha, contentType: 'video/mp4' });

function rawStatus(method: string, url: string, body?: Buffer, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(body);
  });
}

beforeAll(async () => {
  local = loadLocal();
  bucket = local.bucket;
  s3 = s3Client(local);
  await ensureBucket(s3, bucket);
  // Leftovers of earlier runs (killed uploads) would be counted as orphans: start from a clean list.
  for (const u of (await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket }))).Uploads ?? []) {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: u.Key!, UploadId: u.UploadId! }));
  }
  dir = join(tmpdir(), `evm011-it-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  file = join(dir, 'synthetic.bin');
  fileSha = await makeSyntheticFile(file, SIZE, 'integration');
  ({ i: issuer, base } = await startIssuer());
});

afterAll(async () => {
  await issuer?.close();
  // Remove all test objects and the bucket content (the SeaweedFS volume is removed with `down -v` anyway).
  const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  for (const o of list.Contents ?? []) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.Key! }));
  }
  rmSync(dir, { recursive: true, force: true });
});

const engine = (api: UploadApi, transport = new HttpPartTransport(), extra: Partial<EngineDeps> = {}) => ({
  deps: { api, transport, store: new MemoryStore(), sleep: async () => undefined, ...extra } satisfies EngineDeps,
  transport,
});
const client = (deviceId = DEVICE, token = local.token) => new HttpUploadApi(base, token, deviceId);

describe('EVM-011 AC1 upload against S3-compatible storage', () => {
  it('EVM-011 AC1 EVM-011 AC3 uploads a multi-part file; object size and SHA-256 match; no duplicates or orphans', async () => {
    const job = mkJob();
    const { deps, transport } = engine(client());
    expect(await runUpload(job, deps)).toBe('uploaded');
    const rec = issuer.sessions().find((s) => s.assetId === job.assetId)!;
    expect(rec.key).toMatch(new RegExp(`^media/\\d{4}/\\d{2}/${job.assetId}/original$`));
    const stored = await objectSha256(s3, bucket, rec.key);
    expect(stored).toEqual({ sha256: fileSha, size: SIZE });
    const saved = (await deps.store.load(job.assetId))!;
    expect(saved.metrics).toMatchObject({ partPuts: 4, retries: 0, wastedBytes: 0 });
    expect(transport.puts).toBe(4);
    const verified = await markVerified(deps.store, saved, stored.sha256);
    expect(verified.state).toBe('verified');
    const dup = await countDuplicates(s3, bucket);
    expect(dup.duplicateAssetIds).toEqual([]);
    expect(dup.objectsWithoutAsset).toEqual([]);
    expect(dup.orphanedMultipart).toEqual([]);
  });

  it('EVM-011 AC2 survives a network cut in the middle of a part: retry with backoff, no orphan, correct bytes', async () => {
    const job = mkJob();
    const { deps, transport } = engine(client());
    transport.faults = [{}, { cutAfterBytes: 3 * MiB }];
    expect(await runUpload(job, deps)).toBe('uploaded');
    const saved = (await deps.store.load(job.assetId))!;
    expect(saved.metrics.retries).toBe(1);
    const rec = issuer.sessions().find((s) => s.assetId === job.assetId)!;
    expect((await objectSha256(s3, bucket, rec.key)).sha256).toBe(fileSha);
  });

  it('EVM-011 AC2 kill after a part PUT but before its ETag is saved: restart adopts the part from ListParts (no re-PUT)', async () => {
    const job = mkJob();
    const store = new MemoryStore();
    const t1 = new HttpPartTransport();
    await expect(runUpload(job, { ...engine(client(), t1).deps, store, checkpoint: killAt('afterPartPut', 2) })).rejects.toBeInstanceOf(
      Killed,
    );
    expect(t1.puts).toBe(2);
    const t2 = new HttpPartTransport();
    const persisted = (await store.load(job.assetId))!;
    expect(await runUpload(persisted, { ...engine(client(), t2).deps, store })).toBe('uploaded');
    expect(t2.puts).toBe(2); // parts 3 and 4 only; 1 (saved) and 2 (PUT but unsaved) come from ListParts
    const rec = issuer.sessions().find((s) => s.assetId === job.assetId)!;
    expect((await objectSha256(s3, bucket, rec.key)).sha256).toBe(fileSha);
  });

  it('EVM-011 AC2 kill exactly between server-side complete and the local state write: re-run is idempotent, one object', async () => {
    const job = mkJob();
    const store = new MemoryStore();
    await expect(runUpload(job, { ...engine(client()).deps, store, checkpoint: killAt('afterCompleteBeforeSave') })).rejects.toBeInstanceOf(
      Killed,
    );
    expect(await store.load(job.assetId)).toMatchObject({ state: 'uploading' });
    const t2 = new HttpPartTransport();
    expect(await runUpload((await store.load(job.assetId))!, { ...engine(client(), t2).deps, store })).toBe('uploaded');
    expect(t2.puts).toBe(0);
    expect((await store.load(job.assetId))!.state).toBe('uploaded');
    const dup = await countDuplicates(s3, bucket);
    expect(dup.duplicateAssetIds).toEqual([]);
  });

  it('EVM-011 AC2 complete is idempotent even when the issuer lost its "completed" flag (NoSuchUpload -> HEAD object)', async () => {
    const job = mkJob();
    const statePath = join(dir, `rewind-${job.assetId}.json`);
    const a = await startIssuer(60, statePath);
    const api1 = new HttpUploadApi(a.base, local.token, DEVICE);
    const store = new MemoryStore();
    await expect(
      runUpload(job, { api: api1, transport: new HttpPartTransport(), store, checkpoint: killAt('beforeComplete') }),
    ).rejects.toBeInstanceOf(Killed);
    const { readFileSync, writeFileSync } = await import('node:fs');
    const before = readFileSync(statePath, 'utf8'); // completed: false
    const persisted = (await store.load(job.assetId))!;
    expect(await runUpload(persisted, { api: api1, transport: new HttpPartTransport(), store })).toBe('uploaded');
    await a.i.close();
    writeFileSync(statePath, before); // rewind: issuer believes the upload is still open
    const b = await startIssuer(60, statePath);
    const api2 = new HttpUploadApi(b.base, local.token, DEVICE);
    const parts = Object.entries((await store.load(job.assetId))!.etags).map(([n, etag]) => ({ number: Number(n), etag }));
    // FINDING: SeaweedFS answers a repeated CompleteMultipartUpload with success (no NoSuchUpload), so the issuer returns a
    // normal result here; AWS-like stores answer NoSuchUpload, which is simulated below.
    const repeated = await api2.complete(job.assetId, parts);
    expect(['completed', 'already_complete']).toContain(repeated.status);
    const rec = b.i.sessions().find((s) => s.assetId === job.assetId)!;
    expect((await objectSha256(s3, bucket, rec.key)).sha256).toBe(fileSha);
    await b.i.close();
    writeFileSync(statePath, before);
    const c = await startIssuer(60, statePath);
    const realSend = c.i.s3.send.bind(c.i.s3) as (cmd: unknown) => Promise<unknown>;
    (c.i.s3 as { send: unknown }).send = async (cmd: unknown) => {
      if (cmd instanceof CompleteMultipartUploadCommand) throw Object.assign(new Error('gone'), { name: 'NoSuchUpload' });
      return realSend(cmd);
    };
    const api3 = new HttpUploadApi(c.base, local.token, DEVICE);
    expect((await api3.complete(job.assetId, parts)).status).toBe('already_complete');
    await c.i.close();
  });

  it('EVM-011 AC2 dedup: running the same assetId again creates no second object and no second multipart', async () => {
    const job = mkJob();
    const a = engine(client());
    await runUpload(job, a.deps);
    const again = engine(client());
    const done = (await a.deps.store.load(job.assetId))!;
    done.state = 'pending'; // local state lost / reset: the server still answers idempotently
    expect(await runUpload(done, again.deps)).toBe('uploaded');
    expect(again.transport.puts).toBe(0);
    const dup = await countDuplicates(s3, bucket);
    expect(dup.duplicateAssetIds).toEqual([]);
  });
});

describe('EVM-011 AC1 signed URLs: TTL, size binding, private bucket (ADR-0009)', () => {
  it('EVM-011 AC1 EVM-011 AC2 a 403 after the TTL leads to renewal and repeating only that part', async () => {
    const short = await startIssuer(1);
    const api = new HttpUploadApi(short.base, local.token, DEVICE);
    let first = true;
    const slowApi: UploadApi = {
      createSession: (r) => api.createSession(r),
      listParts: (a) => api.listParts(a),
      complete: (a, p) => api.complete(a, p),
      partUrl: async (a, n) => {
        const r = await api.partUrl(a, n);
        if (first) {
          first = false;
          await new Promise((res) => setTimeout(res, 2500)); // the URL expires before it is used
        }
        return r;
      },
    };
    const job = mkJob();
    const { deps } = engine(slowApi);
    expect(await runUpload(job, deps)).toBe('uploaded');
    expect((await deps.store.load(job.assetId))!.metrics.renewals).toBe(1);
    await short.i.close();
  });

  it('EVM-011 AC1 refuses TTL above 60 minutes', () => {
    expect(() =>
      createIssuer({
        s3Endpoint: 'x',
        signEndpoint: 'x',
        bucket: 'b',
        accessKey: 'a',
        secretKey: 's',
        token: 't',
        ttlSeconds: 3601,
        statePath: join(dir, 'never.json'),
      }),
    ).toThrow(/ttlSeconds/);
  });

  it('EVM-011 AC1 signs Content-Length: the URL carries content-length among the signed headers', async () => {
    const job = mkJob();
    const api = client();
    await api.createSession(job);
    const { url } = await api.partUrl(job.assetId, 1);
    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed.split(';')).toContain('content-length');
    expect(signed.split(';')).toContain('host');
    await api.abort(job.assetId);
  });

  it('EVM-011 AC1 FINDING: SeaweedFS rejects (403) a PUT whose body length differs from the signed Content-Length, in both directions', async () => {
    const job = mkJob();
    const api = client();
    await api.createSession(job);
    const { url } = await api.partUrl(job.assetId, 1);
    const t = new HttpPartTransport();
    t.timeoutMs = 4000;
    const outcomes: Record<string, string> = {};
    for (const delta of [-1, 1]) {
      t.faults = [{ lengthDelta: delta }];
      try {
        await t.put(url, file, 0, PART);
        outcomes[`delta${delta}`] = 'accepted';
      } catch (e) {
        outcomes[`delta${delta}`] = `rejected:${(e as { status?: number }).status ?? 'network'}`;
      }
    }
    expect(outcomes).toEqual({ 'delta-1': 'rejected:403', delta1: 'rejected:403' });
    // The spike records the outcome; what matters is that a part is never silently stored with a wrong size:
    const list = await api.listParts(job.assetId);
    for (const p of list.parts) expect(p.size).toBe(PART);
    await api.abort(job.assetId);
  });

  it('EVM-011 AC1 the bucket is private: anonymous GET, PUT and ListObjects return 403', async () => {
    const endpoint = 'http://127.0.0.1:8333';
    expect(await rawStatus('GET', `${endpoint}/${bucket}/anything`)).toBe(403);
    expect(await rawStatus('PUT', `${endpoint}/${bucket}/anon.txt`, Buffer.from('x'))).toBe(403);
    expect(await rawStatus('GET', `${endpoint}/${bucket}?list-type=2`)).toBe(403);
    expect(await rawStatus('GET', `${endpoint}/${bucket}/`)).toBe(403);
  });

  it('EVM-011 AC1 a presigned URL for part N cannot be reused for another part (signature covers the part number)', async () => {
    const job = mkJob();
    const api = client();
    await api.createSession(job);
    const { url } = await api.partUrl(job.assetId, 1);
    const other = url.replace('partNumber=1', 'partNumber=2');
    expect(other).not.toBe(url);
    expect(await rawStatus('PUT', other, Buffer.alloc(PART))).toBe(403);
    await api.abort(job.assetId);
  });
});

describe('EVM-011 AC2 issuer access control (SR-MOB-04, SR-SYNC-03, SR-SYNC-08, SR-FILE-02)', () => {
  it('EVM-011 AC1 denies by default: no token and a wrong token give 401', async () => {
    const job = mkJob();
    await expect(client(DEVICE, 'wrong').createSession(job)).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(await rawStatus('POST', `${base}/v1/uploads`, Buffer.from('{}'))).toBe(401);
  });

  it('EVM-011 AC1 validates input: part number range, content type, size, sha256 and asset id format', async () => {
    const job = mkJob();
    const api = client();
    await api.createSession(job);
    await expect(api.partUrl(job.assetId, 0)).rejects.toMatchObject({ status: 400 });
    await expect(api.partUrl(job.assetId, 99)).rejects.toMatchObject({ status: 400 });
    await expect(api.createSession({ ...mkJob(), contentType: 'text/html' })).rejects.toMatchObject({ code: 'invalid_type' });
    await expect(api.createSession({ ...mkJob(), size: 0 })).rejects.toMatchObject({ code: 'invalid_size' });
    await expect(api.createSession({ ...mkJob(), sha256: 'zz' })).rejects.toMatchObject({ code: 'invalid_sha256' });
    await expect(api.createSession({ ...mkJob('../../etc/passwd') })).rejects.toMatchObject({ code: 'invalid_asset_id' });
    await api.abort(job.assetId);
  });

  it('EVM-011 AC2 401 session_revoked: queue and files stay; a new session on the same device resumes from the last part, a new device gets id_conflict and restarts', async () => {
    const job = mkJob();
    const store = new MemoryStore();
    const loginA = randomBytes(24).toString('base64url');
    issuer.rotateToken(loginA);
    await expect(
      runUpload(job, { ...engine(client(DEVICE, loginA)).deps, store, checkpoint: killAt('afterPartSaved', 2) }),
    ).rejects.toBeInstanceOf(Killed);
    issuer.revoke(loginA);
    const revokedRun = await runUpload((await store.load(job.assetId))!, { ...engine(client(DEVICE, loginA)).deps, store });
    expect(revokedRun).toBe('paused_revoked');
    const paused = (await store.load(job.assetId))!;
    expect(paused.state).toBe('paused_revoked');
    expect(Object.keys(paused.etags)).toHaveLength(2); // pending state kept
    // Same device, new login (new token): resumes from ListParts.
    const fresh = randomBytes(24).toString('base64url');
    issuer.rotateToken(fresh);
    const t = new HttpPartTransport();
    expect(await runUpload(paused, { ...engine(client(DEVICE, fresh), t).deps, store })).toBe('uploaded');
    expect(t.puts).toBe(2);
    // restore the main token for the other tests
    issuer.rotateToken(local.token);
    // Control: another device with the same asset id -> id_conflict.
    expect(await runUpload({ ...mkJob(job.assetId, 'device-b') }, engine(client('device-b')).deps)).toBe('id_conflict');
  });

  it('EVM-011 AC2 id_conflict: the old multipart is aborted, the client restarts with a new assetId and a new key', async () => {
    const job = mkJob();
    const store = new MemoryStore();
    await expect(runUpload(job, { ...engine(client()).deps, store, checkpoint: killAt('afterPartSaved', 1) })).rejects.toBeInstanceOf(
      Killed,
    );
    const oldRec = issuer.sessions().find((s) => s.assetId === job.assetId)!;
    const other = mkJob(job.assetId, 'device-b');
    expect(await runUpload(other, engine(client('device-b')).deps)).toBe('id_conflict');
    const open = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket }));
    expect((open.Uploads ?? []).some((u) => u.UploadId === oldRec.uploadId)).toBe(false);
    const restart = mkJob(uuidv7(), 'device-b');
    expect(await runUpload(restart, engine(client('device-b')).deps)).toBe('uploaded');
    const newRec = issuer.sessions().find((s) => s.assetId === restart.assetId)!;
    expect(newRec.key).not.toBe(oldRec.key);
  });

  it('EVM-011 AC2 a part URL for somebody else’s session is refused with 403', async () => {
    const job = mkJob();
    await client().createSession(job);
    await expect(client('device-b').partUrl(job.assetId, 1)).rejects.toMatchObject({ status: 403 });
    await expect(client('device-b').listParts(job.assetId)).rejects.toMatchObject({ status: 403 });
    await expect(client().partUrl(job.assetId, 1)).resolves.toBeDefined();
    await client().abort(job.assetId);
  });

  it('EVM-011 AC1 the log never contains the token, signed URL parts or object keys', async () => {
    const lines: string[] = [];
    const logged = createIssuer({
      s3Endpoint: 'http://127.0.0.1:8333',
      signEndpoint: 'http://127.0.0.1:8333',
      bucket,
      accessKey: local.accessKey,
      secretKey: local.secretKey,
      token: local.token,
      ttlSeconds: 60,
      statePath: join(dir, 'log-state.json'),
      defaultPartSize: PART,
      log: (l) => lines.push(l),
    });
    const port = await logged.listen();
    const api = new HttpUploadApi(`http://127.0.0.1:${port}`, local.token, DEVICE);
    const job = mkJob();
    await api.createSession(job);
    await api.partUrl(job.assetId, 1);
    await api.abort(job.assetId);
    await logged.close();
    const text = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const forbidden of [local.token, 'X-Amz', 'Signature', local.accessKey, local.secretKey, 'media/', job.assetId]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('EVM-011 AC1 restart simulation with a persisted outbox', () => {
  it('EVM-011 AC2 a FileStore outbox survives a "process restart" mid-upload', async () => {
    const path = join(dir, 'outbox.json');
    const job = mkJob();
    await expect(
      runUpload(job, { ...engine(client()).deps, store: new FileStore(path), checkpoint: killAt('afterPartSaved', 3) }),
    ).rejects.toBeInstanceOf(Killed);
    const reopened = new FileStore(path);
    const persisted = (await reopened.load(job.assetId))!;
    expect(Object.keys(persisted.etags)).toHaveLength(3);
    const t = new HttpPartTransport();
    expect(await runUpload(persisted, { ...engine(client(), t).deps, store: reopened })).toBe('uploaded');
    expect(t.puts).toBe(1);
  });
});
