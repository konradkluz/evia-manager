// url-issuer: spike stand-in for the API (ADR-0009 upload protocol). Listens on loopback only. Not a production endpoint.
// - the server (not the client) assigns the object key media/{year}/{month}/{assetId}/original and the uploadId mapping;
// - createSession is idempotent per assetId (same device) and answers 409 id_conflict for another device;
// - part URLs are SigV4-presigned with a short TTL, Content-Length signed (URL bound to key, uploadId, part and size);
// - complete is idempotent (NoSuchUpload -> HEAD object, size must match the declaration);
// - logs contain no tokens, no signed URLs (query is never logged) and no keys.
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GiB, planParts, type CreateSessionRequest } from '@evm011/core';

export interface IssuerConfig {
  /** Endpoint the issuer itself talks to (host loopback). */
  s3Endpoint: string;
  /** Endpoint written into the signed URLs = the one the device sees (10.0.2.2:PORT for the emulator, 127.0.0.1 with adb reverse). */
  signEndpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  token: string;
  userId?: string;
  /** Part URL lifetime; never above 3600 s (ADR-0009). */
  ttlSeconds: number;
  statePath: string;
  host?: string;
  port?: number;
  /** Part size used when the client does not request one (8-64 MiB, default 16 MiB). */
  defaultPartSize?: number;
  /** Provider part limit (Scaleway: 1000). */
  maxParts?: number;
  log?: (line: string) => void;
}

interface SessionRecord {
  assetId: string;
  uploadId: string;
  key: string;
  userId: string;
  deviceId: string;
  size: number;
  sha256: string;
  contentType: string;
  partSize: number;
  partCount: number;
  completed: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED_TYPES = new Set(['image/jpeg', 'video/mp4']);

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const digest = (s: string) => createHash('sha256').update(s).digest();

export interface Issuer {
  server: Server;
  listen(): Promise<number>;
  close(): Promise<void>;
  revoke(token: string): void;
  /** Test hook: a new login on the same device issues a new token (the old one stays revoked). */
  rotateToken(token: string): void;
  /** Mapping assetId -> record, for tests and the duplicate counter. */
  sessions(): SessionRecord[];
  s3: S3Client;
}

export function createIssuer(cfg: IssuerConfig): Issuer {
  if (cfg.ttlSeconds < 1 || cfg.ttlSeconds > 3600) throw new Error('ttlSeconds must be within 1..3600');
  const log = cfg.log ?? ((l: string) => console.log(l));
  const userId = cfg.userId ?? 'tester';
  const maxParts = cfg.maxParts ?? 1000;
  const creds = { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey };
  const s3 = new S3Client({ endpoint: cfg.s3Endpoint, region: 'us-east-1', forcePathStyle: true, credentials: creds });
  // WHEN_REQUIRED: with the default (WHEN_SUPPORTED) the presigner adds a CRC32 of the EMPTY body to the URL and the server rejects every part.
  const signer = new S3Client({
    endpoint: cfg.signEndpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: creds,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const revoked = new Set<string>();
  let current = cfg.token;

  const map = new Map<string, SessionRecord>();
  if (existsSync(cfg.statePath)) {
    for (const r of JSON.parse(readFileSync(cfg.statePath, 'utf8')) as SessionRecord[]) map.set(r.assetId, r);
  }
  const persist = () => {
    mkdirSync(dirname(cfg.statePath), { recursive: true });
    const tmp = `${cfg.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify([...map.values()]));
    renameSync(tmp, cfg.statePath);
  };

  const authenticate = (req: IncomingMessage): string => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (revoked.has(token) && token !== '') throw new HttpError(401, 'session_revoked');
    // Constant-time comparison of fixed-length digests; deny by default.
    if (!token || !timingSafeEqual(digest(token), digest(current))) throw new HttpError(401, 'unauthorized');
    const device = req.headers['x-device-id'];
    if (typeof device !== 'string' || device.length < 1 || device.length > 64) throw new HttpError(400, 'device_required');
    return device;
  };

  const sessionFor = (assetId: string, device: string): SessionRecord => {
    const rec = map.get(assetId);
    if (!rec) throw new HttpError(404, 'unknown_asset');
    // A session is continued only by its creator (user + device).
    if (rec.userId !== userId || rec.deviceId !== device) throw new HttpError(403, 'forbidden');
    return rec;
  };

  const readJson = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const c of req) {
      total += (c as Buffer).length;
      if (total > 256 * 1024) throw new HttpError(413, 'too_large');
      chunks.push(c as Buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw new HttpError(400, 'bad_json');
    }
  };

  const objectExists = async (key: string): Promise<number | undefined> => {
    try {
      const h = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return h.ContentLength;
    } catch (e) {
      if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return undefined;
      throw e;
    }
  };
  const isNoSuchUpload = (e: unknown) =>
    (e as { name?: string }).name === 'NoSuchUpload' || (e as { Code?: string }).Code === 'NoSuchUpload';

  async function createSession(device: string, body: Record<string, unknown>) {
    const req = body as Partial<CreateSessionRequest> & { partSize?: number };
    if (typeof req.assetId !== 'string' || !UUID.test(req.assetId)) throw new HttpError(400, 'invalid_asset_id');
    if (typeof req.size !== 'number' || !Number.isInteger(req.size) || req.size < 1 || req.size > 4 * GiB)
      throw new HttpError(400, 'invalid_size');
    if (typeof req.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(req.sha256)) throw new HttpError(400, 'invalid_sha256');
    if (typeof req.contentType !== 'string' || !ALLOWED_TYPES.has(req.contentType)) throw new HttpError(400, 'invalid_type');
    let plan;
    try {
      plan = planParts(req.size, { maxParts }, req.partSize ?? cfg.defaultPartSize);
    } catch {
      throw new HttpError(400, 'invalid_part_size');
    }
    const existing = map.get(req.assetId);
    if (existing) {
      if (existing.deviceId !== device || existing.userId !== userId) {
        // Another installation claims the same asset id: the old multipart is aborted, the client must start over with a new id.
        if (!existing.completed) {
          await s3
            .send(new AbortMultipartUploadCommand({ Bucket: cfg.bucket, Key: existing.key, UploadId: existing.uploadId }))
            .catch(() => undefined);
        }
        map.delete(req.assetId);
        persist();
        throw new HttpError(409, 'id_conflict');
      }
      return { uploadId: existing.uploadId, key: existing.key, partSize: existing.partSize, partCount: existing.partCount };
    }
    const now = new Date();
    const key = `media/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${req.assetId}/original`;
    const created = await s3.send(new CreateMultipartUploadCommand({ Bucket: cfg.bucket, Key: key, ContentType: req.contentType }));
    const rec: SessionRecord = {
      assetId: req.assetId,
      uploadId: created.UploadId!,
      key,
      userId,
      deviceId: device,
      size: req.size,
      sha256: req.sha256,
      contentType: req.contentType,
      partSize: plan.partSize,
      partCount: plan.parts.length,
      completed: false,
    };
    map.set(rec.assetId, rec);
    persist();
    return { uploadId: rec.uploadId, key: rec.key, partSize: rec.partSize, partCount: rec.partCount };
  }

  async function listParts(rec: SessionRecord) {
    if (rec.completed) return { completed: true, parts: [] };
    const parts: { number: number; etag: string; size: number }[] = [];
    let marker: string | undefined;
    try {
      for (;;) {
        const r = await s3.send(
          new ListPartsCommand({ Bucket: cfg.bucket, Key: rec.key, UploadId: rec.uploadId, PartNumberMarker: marker }),
        );
        for (const p of r.Parts ?? []) parts.push({ number: p.PartNumber!, etag: p.ETag!, size: p.Size! });
        if (!r.IsTruncated) break;
        marker = String(r.NextPartNumberMarker);
      }
    } catch (e) {
      if (isNoSuchUpload(e)) {
        // Upload is gone: either assembled (object exists) or aborted.
        const len = await objectExists(rec.key);
        if (len === rec.size) {
          rec.completed = true;
          persist();
          return { completed: true, parts: [] };
        }
        throw new HttpError(410, 'upload_gone');
      }
      throw e;
    }
    return { completed: false, parts };
  }

  async function partUrl(rec: SessionRecord, n: number) {
    const plan = planParts(rec.size, { maxParts }, rec.partSize);
    const part = plan.parts[n - 1];
    if (!Number.isInteger(n) || !part) throw new HttpError(400, 'invalid_part_number');
    const url = await getSignedUrl(
      signer,
      new UploadPartCommand({
        Bucket: cfg.bucket,
        Key: rec.key,
        UploadId: rec.uploadId,
        PartNumber: n,
        ContentLength: part.length,
      }),
      { expiresIn: cfg.ttlSeconds, signableHeaders: new Set(['content-length']) },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + cfg.ttlSeconds * 1000).toISOString(),
      contentLength: part.length,
    };
  }

  async function complete(rec: SessionRecord, body: Record<string, unknown>) {
    const list = body.parts;
    if (!Array.isArray(list) || list.length !== rec.partCount) throw new HttpError(400, 'invalid_parts');
    const parts = list.map((p, i) => {
      const q = p as { number?: unknown; etag?: unknown };
      if (q.number !== i + 1 || typeof q.etag !== 'string' || q.etag.length > 128) throw new HttpError(400, 'invalid_parts');
      return { PartNumber: q.number, ETag: q.etag };
    });
    if (!rec.completed) {
      try {
        await s3.send(
          new CompleteMultipartUploadCommand({
            Bucket: cfg.bucket,
            Key: rec.key,
            UploadId: rec.uploadId,
            MultipartUpload: { Parts: parts },
          }),
        );
      } catch (e) {
        if (!isNoSuchUpload(e)) throw e;
        const len = await objectExists(rec.key);
        if (len !== rec.size) throw new HttpError(404, 'upload_gone');
        rec.completed = true;
        persist();
        return { status: 'already_complete', size: len };
      }
    } else {
      const len = await objectExists(rec.key);
      if (len === rec.size) return { status: 'already_complete', size: len };
    }
    // Total size must match the declaration, otherwise the object is removed and the upload rejected.
    const len = await objectExists(rec.key);
    if (len !== rec.size) {
      await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: rec.key })).catch(() => undefined);
      map.delete(rec.assetId);
      persist();
      throw new HttpError(422, 'size_mismatch');
    }
    rec.completed = true;
    persist();
    return { status: 'completed', size: len };
  }

  async function abort(rec: SessionRecord) {
    if (!rec.completed) {
      await s3.send(new AbortMultipartUploadCommand({ Bucket: cfg.bucket, Key: rec.key, UploadId: rec.uploadId })).catch(() => undefined);
    }
    map.delete(rec.assetId);
    persist();
    return { status: 'aborted' };
  }

  async function route(req: IncomingMessage): Promise<unknown> {
    const device = authenticate(req);
    const path = (req.url ?? '').split('?')[0]!;
    const m = /^\/v1\/uploads(?:\/([0-9a-f-]{36}))?(?:\/(parts|complete|abort))?(?:\/(\d+))?(?:\/(url))?$/.exec(path);
    if (!m) throw new HttpError(404, 'not_found');
    const [, assetId, action, num, tail] = m;
    if (!assetId) {
      if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      return createSession(device, (await readJson(req)) as Record<string, unknown>);
    }
    const rec = sessionFor(assetId, device);
    if (action === 'parts' && !num && req.method === 'GET') return listParts(rec);
    if (action === 'parts' && num && tail === 'url' && req.method === 'GET') return partUrl(rec, Number(num));
    if (action === 'complete' && req.method === 'POST') return complete(rec, (await readJson(req)) as Record<string, unknown>);
    if (action === 'abort' && req.method === 'POST') return abort(rec);
    throw new HttpError(404, 'not_found');
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now();
    const finish = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(payload));
      // Path only (no query), no headers, no body: nothing sensitive reaches the log.
      const shown = (req.url ?? '').split('?')[0]!.replace(/[0-9a-f-]{36}/, '<asset>');
      log(`${req.method} ${shown} ${status} ${Date.now() - started}ms`);
    };
    route(req).then(
      (payload) => finish(200, payload),
      (e: unknown) => {
        if (e instanceof HttpError) finish(e.status, { error: e.code });
        else finish(502, { error: 'upstream_error' });
      },
    );
  });

  return {
    server,
    s3,
    revoke: (t: string) => void revoked.add(t),
    rotateToken: (t: string) => void (current = t),
    sessions: () => [...map.values()],
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(cfg.port ?? 0, cfg.host ?? '127.0.0.1', () => {
          const a = server.address();
          resolve(typeof a === 'object' && a ? a.port : 0);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
