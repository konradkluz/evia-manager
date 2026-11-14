/**
 * HTTP transport of the synchronization (EVM-107 AC1, AC2, AC5, AC8): maps the calls of the contract (`pushSyncMutations`,
 * `getSyncChanges`, `getSyncWorkOrder`, `getClientConfig`, and for EVM-106 `listWorkOrderTemplates`) to the `TransportResponse` of sync-core and nothing else.
 *
 * - The access token is added only by the injected `fetch` (`MobileSessionOwner.authorizedFetch`), and only to the origin of `baseUrl`,
 *   which comes from the build configuration and never from an answer (security S10).
 * - Refresh and the pauses for 401 / 403 / 426 stay in `SessionGate` of sync-core; this module only reports status and code.
 * - Nothing of an answer other than the status, an allow-listed `code` and `Retry-After` leaves this module: no body, no message, no
 *   address, no cause of an exception (SR-LOG-08, CWE-532). It never logs.
 * - `pendingItems` of a push comes from the engine; for a pull the provider supplies the same number (the transport does not count).
 */
import type { PullTransport, SyncRequest, Transport, TransportResponse } from '@evia/sync-core';
import type { TemplateTransport } from './types';

/** The shape of `MobileSessionOwner.authorizedFetch`: `null` = no session (nothing was sent). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response | null>;

export interface HttpSyncTransportOptions {
  readonly baseUrl: string;
  /** Plain HTTP only for the emulator host of the e2e variant. */
  readonly allowLocalHttp?: boolean;
  readonly fetch: FetchLike;
  /** Compatibility headers (`X-Client-Platform`, `X-Client-Version`). */
  readonly headers?: Readonly<Record<string, string>>;
  /** The number of unsent items for the pull requests (supplied by the service from the engine status). */
  readonly pendingItems: () => number;
  readonly timeoutMs?: number;
  /** Cancels the request in flight and refuses new ones (the end of the session, EVM-107 security S2). */
  readonly signal?: AbortSignal;
}

export const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Codes from outside pass only in this shape (allow-list, no free text). */
const CODE = /^[a-z_]{1,64}$/;
const NETWORK: TransportResponse = { kind: 'network' };

const safeCount = (value: number): number => (Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0);

export function createHttpSyncTransport(options: HttpSyncTransportOptions): Transport & PullTransport & TemplateTransport {
  const { baseUrl, fetch: fetchLike, timeoutMs = DEFAULT_SYNC_TIMEOUT_MS } = options;
  const secureOrigin = baseUrl.startsWith('https://') || (options.allowLocalHttp === true && baseUrl.startsWith('http://'));

  const aborted = (): boolean => options.signal?.aborted === true;

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<TransportResponse> {
    if (!secureOrigin || aborted()) return NETWORK;
    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);
    });
    const headers: Record<string, string> = { ...options.headers, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await Promise.race([
        fetchLike(`${baseUrl}${path}`, {
          method,
          headers,
          signal: controller.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        deadline,
      ]);
      if (response === null || aborted()) return NETWORK;
      return await map(response);
    } catch {
      // the error of fetch may carry the address or a body: it is dropped here (SR-LOG-08)
      return NETWORK;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    sendBatch: (request: SyncRequest) =>
      call('POST', '/api/v1/sync/mutations', { mutations: request.mutations, pendingItems: safeCount(request.pendingItems) }),
    getChanges: ({ cursor, limit }) => {
      const query = [`limit=${String(Math.trunc(limit))}`, `pendingItems=${String(safeCount(options.pendingItems()))}`];
      if (cursor !== undefined) query.push(`cursor=${encodeURIComponent(cursor)}`);
      return call('GET', `/api/v1/sync/changes?${query.join('&')}`);
    },
    getWorkOrderSnapshot: (workOrderId) =>
      UUID.test(workOrderId) ? call('GET', `/api/v1/sync/work-orders/${encodeURIComponent(workOrderId)}`) : Promise.resolve(NETWORK),
    getClientConfig: () => call('GET', '/api/v1/meta/client-config'),
    listWorkOrderTemplates: () => call('GET', '/api/v1/catalog/work-order-templates'),
  };
}

async function map(response: Response): Promise<TransportResponse> {
  const { status } = response;
  if (status >= 200 && status < 300) {
    if (status === 204) return NETWORK;
    try {
      return { kind: 'ok', body: (await response.json()) as unknown };
    } catch {
      return NETWORK;
    }
  }
  const out: { kind: 'http'; status: number; code?: string; retryAfter?: string } = { kind: 'http', status };
  if (status < 500) {
    const code = await codeOf(response);
    if (code !== undefined) out.code = code;
  }
  const retryAfter = status === 429 || status === 503 ? response.headers.get('Retry-After') : null;
  if (retryAfter !== null) out.retryAfter = retryAfter;
  return out;
}

/** The machine-readable `code` of a problem answer, only when it has the allowed shape; the rest of the body is dropped. */
async function codeOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
    return typeof code === 'string' && CODE.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}
