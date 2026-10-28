import type { CurrentSession, MediaAsset } from '@evia/contracts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler, type Recorded } from './api-fake.ts';
import { journalApi } from './journal-api.ts';
import { ORDER_ID } from './work-order-api.ts';

/** Synthetic media of the order ZL-2026-0042 (EVM-044): a fake of the media API with sessions, parts and the verdict of the scan. */
export const MEDIA_BASE = `/api/v1/work-orders/${ORDER_ID}/media-assets`;
export const BUCKET_URL = 'https://bucket.example.test/media/2026/10/part';

export function asset(n: number, extra: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: `01968f3e-0000-7000-8000-00000c${String(n).padStart(6, '0')}`,
    workOrderId: ORDER_ID,
    mediaType: 'photo',
    category: 'in_progress',
    description: null,
    origin: 'web',
    capturedAt: null,
    createdAt: '2026-10-11T11:55:00.000Z',
    fileState: 'clean',
    stateReasonCode: null,
    needsAttention: false,
    quarantine: null,
    declaredSize: 1000,
    originalFilename: null,
    uploadSession: null,
    ...extra,
  };
}

export function unfinished(n: number, name: string, size: number, extra: Partial<MediaAsset> = {}): MediaAsset {
  const id = `01968f3e-0000-7000-8000-00000c${String(n).padStart(6, '0')}`;
  return asset(n, {
    fileState: 'pending_upload',
    declaredSize: size,
    originalFilename: name,
    uploadSession: {
      id: `01968f3e-0000-7000-8000-00000d${String(n).padStart(6, '0')}`,
      expiresAt: '2026-10-18T11:55:00.000Z',
      partSize: 16_777_216,
      partCount: 1,
    },
    id,
    ...extra,
  });
}

export interface MediaServerOptions {
  readonly assets?: readonly MediaAsset[];
  readonly unfinished?: readonly MediaAsset[];
  readonly session?: CurrentSession;
  /** The state a created medium has after `complete` and on the next reads. */
  readonly stateAfterComplete?: MediaAsset['fileState'];
  readonly stateReasonCode?: MediaAsset['stateReasonCode'];
  readonly partCount?: number;
  readonly confirmedParts?: readonly number[];
  readonly create?: Handler;
  readonly sessionHandler?: Handler;
  readonly complete?: Handler;
  readonly routes?: Record<string, Handler>;
}

/** A stateful fake: created media appear in the list; the list shows them in `stateAfterComplete` once `complete` has been called. */
export function mediaApi(options: MediaServerOptions = {}) {
  const created: MediaAsset[] = [];
  const completed = new Set<string>();
  const finalState = options.stateAfterComplete ?? 'clean';
  const list: Handler = (request) => {
    if (request.query.get('uploadState') === 'unfinished')
      return json(200, { items: options.unfinished ?? [], nextCursor: null, needsAttentionCount: 0 });
    const all = [
      ...created.map((entry) =>
        completed.has(entry.id) ? { ...entry, fileState: finalState, stateReasonCode: options.stateReasonCode ?? null } : entry,
      ),
      ...(options.assets ?? []),
    ];
    return json(200, { items: all, nextCursor: null, needsAttentionCount: 0 });
  };
  const create: Handler =
    options.create ??
    ((request) => {
      const body = parseBody(request.body) as { items: { id: string; category: MediaAsset['category']; declaredSize: number }[] };
      const items = body.items.map((item, index) =>
        asset(500 + created.length + index, {
          id: item.id,
          category: item.category,
          declaredSize: item.declaredSize,
          fileState: 'pending_upload',
        }),
      );
      created.push(...items);
      return json(201, { items });
    });
  const session: Handler =
    options.sessionHandler ??
    ((request) => {
      const body = parseBody(request.body) as { id: string };
      return json(201, {
        id: body.id,
        mediaAssetId: request.path.split('/').at(-2),
        state: 'active',
        partSize: 16_777_216,
        partCount: options.partCount ?? 1,
        expiresAt: '2026-10-18T11:55:00.000Z',
      });
    });
  const complete: Handler =
    options.complete ??
    ((request) => {
      const id = request.path.split('/')[6] ?? '';
      completed.add(id);
      const found = created.find((entry) => entry.id === id) ?? asset(0, { id });
      return json(200, { ...found, fileState: 'uploaded' });
    });
  const api = journalApi({
    entries: [],
    session: options.session ?? ACTIVE_SESSION,
    routes: {
      [`GET ${MEDIA_BASE}`]: list,
      [`POST ${MEDIA_BASE}`]: create,
      ...options.routes,
    },
  });
  // The routes of a session carry the id of the medium and of the session in the path: they are resolved by shape.
  const dynamic = new Map<RegExp, Handler>([
    [/\/upload-sessions$/, session],
    [
      /\/upload-sessions\/[^/]+\/parts$/,
      () => json(200, { items: (options.confirmedParts ?? []).map((partNumber) => ({ partNumber, size: 1 })) }),
    ],
    [
      /\/parts\/\d+\/url$/,
      () =>
        json(
          200,
          { url: `${BUCKET_URL}?X-Amz-Signature=sig`, expiresAt: '2026-10-11T13:00:00.000Z', contentLength: 1 },
          { 'Cache-Control': 'no-store' },
        ),
    ],
    [/\/upload-sessions\/[^/]+\/complete$/, complete],
  ]);
  const base = api.fetch;
  const routed = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.startsWith(`${MEDIA_BASE}/`)) {
      for (const [pattern, handler] of dynamic) {
        if (!pattern.test(path)) continue;
        const recorded: Recorded = {
          method: request.method,
          path,
          query: new URL(request.url).searchParams,
          headers: request.headers,
          body: await request.clone().text(),
        };
        api.requests.push(recorded);
        return handler(recorded);
      }
    }
    return base(input, init);
  }) as typeof fetch;
  return { ...api, fetch: routed, created, completed };
}

export { problem, json, SESSION_ROUTE };
