// In-memory fake of the issuer + S3 with fault injection, for fast engine tests (real S3 runs in host/test).
import { ApiError, TransportError, type CreateSessionRequest, type PartTransport, type UploadApi } from '../src/types.ts';
import type { ListPartsResult, Session } from '../src/types.ts';

export class FakeServer implements UploadApi, PartTransport {
  sessions = new Map<string, Session & { deviceId: string; size: number }>();
  parts = new Map<string, Map<number, { etag: string; size: number }>>();
  completed = new Set<string>();
  putLog: { assetId: string; n: number }[] = [];
  revoked = false;
  failNextPuts: (number | 'net')[] = [];
  private urlSeq = 0;

  private guard() {
    if (this.revoked) throw new ApiError(401, 'session_revoked');
  }

  async createSession(req: CreateSessionRequest): Promise<Session> {
    this.guard();
    const existing = this.sessions.get(req.assetId);
    if (existing) {
      if (existing.deviceId !== req.deviceId) throw new ApiError(409, 'id_conflict');
      return existing;
    }
    const partSize = 8 * 1024 * 1024;
    const s = {
      uploadId: `up-${req.assetId}`,
      key: `media/2026/10/${req.assetId}/original`,
      partSize,
      partCount: Math.ceil(req.size / partSize),
      deviceId: req.deviceId,
      size: req.size,
    };
    this.sessions.set(req.assetId, s);
    this.parts.set(req.assetId, new Map());
    return s;
  }

  async listParts(assetId: string): Promise<ListPartsResult> {
    this.guard();
    if (this.completed.has(assetId)) return { completed: true, parts: [] };
    const m = this.parts.get(assetId) ?? new Map();
    return { completed: false, parts: [...m].map(([number, v]) => ({ number, ...v })) };
  }

  async partUrl(assetId: string, n: number) {
    this.guard();
    return { url: `fake://${assetId}/${n}?v=${++this.urlSeq}`, expiresAt: 'x' };
  }

  async put(url: string, _file: string, _offset: number, length: number) {
    const fail = this.failNextPuts.shift();
    if (fail === 'net') throw new TransportError(undefined);
    if (fail !== undefined) throw new TransportError(fail);
    const [, assetId, n] = /^fake:\/\/([^/]+)\/(\d+)/.exec(url)!;
    const part = Number(n);
    this.putLog.push({ assetId: assetId!, n: part });
    const etag = `"etag-${part}"`;
    this.parts.get(assetId!)!.set(part, { etag, size: length });
    return { etag };
  }

  async complete(assetId: string, parts: { number: number; etag: string }[]) {
    this.guard();
    if (this.completed.has(assetId)) return { status: 'already_complete' as const, size: this.sessions.get(assetId)!.size };
    const have = this.parts.get(assetId)!;
    for (const p of parts) if (have.get(p.number)?.etag !== p.etag) throw new ApiError(400, 'invalid_part');
    this.completed.add(assetId);
    return { status: 'completed' as const, size: this.sessions.get(assetId)!.size };
  }
}
