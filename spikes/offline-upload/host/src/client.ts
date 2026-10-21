// Node-side client of the url-issuer + part transport (PUT of a file range with a signed Content-Length).
import { request } from 'node:http';
import { createReadStream } from 'node:fs';
import {
  ApiError,
  TransportError,
  type CompleteResult,
  type CreateSessionRequest,
  type ListPartsResult,
  type PartTransport,
  type Session,
  type UploadApi,
} from '@evm011/core';

export class HttpUploadApi implements UploadApi {
  private readonly base: string;
  private readonly token: string;
  private readonly deviceId: string;

  constructor(base: string, token: string, deviceId: string) {
    this.base = base;
    this.token = token;
    this.deviceId = deviceId;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'x-device-id': this.deviceId,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new TransportError(undefined);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, json.error ?? 'error');
    return json as T;
  }

  createSession(req: CreateSessionRequest): Promise<Session> {
    return this.call('POST', '/v1/uploads', req);
  }
  listParts(assetId: string): Promise<ListPartsResult> {
    return this.call('GET', `/v1/uploads/${assetId}/parts`);
  }
  partUrl(assetId: string, n: number): Promise<{ url: string; expiresAt: string }> {
    return this.call('GET', `/v1/uploads/${assetId}/parts/${n}/url`);
  }
  complete(assetId: string, parts: { number: number; etag: string }[]): Promise<CompleteResult> {
    return this.call('POST', `/v1/uploads/${assetId}/complete`, { parts });
  }
  abort(assetId: string): Promise<{ status: string }> {
    return this.call('POST', `/v1/uploads/${assetId}/abort`, {});
  }
}

export interface PutFault {
  /** Destroy the socket after this many body bytes were written (simulates a network cut mid-part). */
  cutAfterBytes?: number;
  /** Send a body length different from the signed Content-Length. */
  lengthDelta?: number;
}

export class HttpPartTransport implements PartTransport {
  /** Consumed one per PUT; used by tests to inject failures. */
  faults: PutFault[] = [];
  puts = 0;
  /** Socket inactivity limit; a stalled PUT is treated as a network error. */
  timeoutMs = 120_000;

  put(url: string, filePath: string, offset: number, length: number): Promise<{ etag: string }> {
    this.puts++;
    const fault = this.faults.shift();
    const declared = length + (fault?.lengthDelta ?? 0);
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = request(
        { method: 'PUT', hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'content-length': declared } },
        (res) => {
          res.resume();
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            const etag = res.headers.etag;
            if (status >= 200 && status < 300 && typeof etag === 'string') resolve({ etag });
            else reject(new TransportError(status));
          });
        },
      );
      req.setTimeout(this.timeoutMs, () => req.destroy());
      req.on('error', () => reject(new TransportError(undefined)));
      const stream = createReadStream(filePath, { start: offset, end: offset + Math.min(length, declared) - 1 });
      let sent = 0;
      stream.on('data', (chunk) => {
        sent += (chunk as Buffer).length;
        if (fault?.cutAfterBytes !== undefined && sent >= fault.cutAfterBytes) {
          stream.destroy();
          req.destroy();
        }
      });
      stream.on('error', () => req.destroy());
      // A positive delta really sends delta extra bytes (a body larger than the signed size).
      stream.pipe(req, { end: false });
      stream.on('end', () => req.end(declared > length ? Buffer.alloc(declared - length) : undefined));
    });
  }
}
