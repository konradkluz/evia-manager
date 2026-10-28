import type { Answer } from './mock-locations.ts';

/**
 * The part of the synthetic API that serves the media of an order (EVM-044): the batch of media, the upload sessions, the parts the
 * bucket has confirmed, `complete` and the verdict of the scan that the next reads show. The bucket itself is `page.route` of the spec
 * (a `PUT` answered with an `ETag`); real S3 (SeaweedFS) and ClamAV (EICAR) are covered by the API integration tests. Synthetic data only.
 */
export const BUCKET_ORIGIN = 'https://bucket.e2e.test';
const PART_SIZE = 16 * 1024 * 1024;

export type Verdict = 'clean' | 'quarantined' | 'checksum_mismatch';

interface Media {
  readonly id: string;
  readonly orderId: string;
  readonly category: string;
  readonly fileName: string;
  readonly size: number;
  readonly userId: string;
  state: 'pending_upload' | 'uploaded' | 'scanning' | 'clean' | 'quarantined' | 'failed';
  reason: 'checksum_mismatch' | null;
  readonly createdAt: string;
  sessionId: string | null;
  /** EVM-049: the quarantine of the file; `null` when it is not held. */
  quarantine: 'held' | 'purged' | null;
  quarantineReason: 'malware_detected' | 'type_mismatch' | null;
}

export interface MediaServer {
  readonly media: Media[];
  /** `sessionId` → the parts the bucket has confirmed. */
  readonly parts: Map<string, Set<number>>;
  /** The scan verdict of the files completed from now on. */
  verdict: Verdict;
  /** The keys of the batches already created (idempotency). */
  readonly keys: Map<string, string>;
  /** The number of `complete` calls and of sessions created (assertions of the specs). */
  completes: number;
  sessionsCreated: number;
  /** The number of accepted `rescan` calls (EVM-049). */
  rescans: number;
}

export const newMediaServer = (): MediaServer => ({
  media: [],
  parts: new Map(),
  verdict: 'clean',
  keys: new Map(),
  completes: 0,
  sessionsCreated: 0,
  rescans: 0,
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  body: JSON.stringify(body),
});

const problem = (status: number, code: string): Answer =>
  json(status, { type: `/problems/${code}`, title: code, status, code, traceId: 'abcdef0123456789abcdef0123456789' });

const shown = (entry: Media, withName: boolean, role: Input['role'] = 'administrator') => ({
  id: entry.id,
  workOrderId: entry.orderId,
  mediaType: 'photo',
  category: entry.category,
  description: null,
  origin: 'web',
  capturedAt: null,
  createdAt: entry.createdAt,
  fileState: entry.state,
  stateReasonCode: entry.reason,
  needsAttention: entry.quarantine === 'held' || (entry.state === 'quarantined' && entry.quarantine === null),
  quarantine:
    entry.quarantine === null
      ? null
      : {
          state: entry.quarantine,
          expiresAt: '2026-10-30T23:00:00.000Z',
          purgedAt: entry.quarantine === 'purged' ? '2026-10-31T00:05:00.000Z' : null,
        },
  // The reason only for the Administrator and only for a file held (the field is absent for the others, like the API).
  ...(role === 'administrator' && entry.quarantine === 'held' && entry.quarantineReason !== null
    ? { quarantineReasonCode: entry.quarantineReason }
    : {}),
  declaredSize: entry.size,
  originalFilename: withName ? entry.fileName : null,
  uploadSession:
    withName && entry.sessionId !== null
      ? {
          id: entry.sessionId,
          expiresAt: '2026-10-18T11:55:00.000Z',
          partSize: PART_SIZE,
          partCount: Math.max(1, Math.ceil(entry.size / PART_SIZE)),
        }
      : null,
});

/** A synthetic unfinished upload of the person: the medium and its active session exist, no part reached the bucket (flows/06, makieta 1). */
export function seedUnfinished(server: MediaServer, orderId: string, userId: string, name: string, size: number): string {
  const n = server.media.length + 1;
  const entry: Media = {
    id: `01968f3e-0000-7000-8000-00000c${String(n).padStart(6, '0')}`,
    orderId,
    category: 'in_progress',
    fileName: name,
    size,
    userId,
    state: 'pending_upload',
    reason: null,
    createdAt: '2026-10-03T11:55:00.000Z',
    sessionId: `01968f3e-0000-7000-8000-00000d${String(n).padStart(6, '0')}`,
    quarantine: null,
    quarantineReason: null,
  };
  server.media.push(entry);
  server.parts.set(entry.sessionId ?? '', new Set());
  return entry.id;
}

/** A synthetic file in the quarantine (EVM-049): held with a reason, or removed after 30 days. */
export function seedQuarantined(
  server: MediaServer,
  orderId: string,
  kind: 'held' | 'purged',
  reason: 'malware_detected' | 'type_mismatch' = 'malware_detected',
): string {
  const n = server.media.length + 1;
  const entry: Media = {
    id: `01968f3e-0000-7000-8000-00000c${String(n).padStart(6, '0')}`,
    orderId,
    category: 'in_progress',
    fileName: 'synthetic.jpg',
    size: 1000,
    userId: '11111111-1111-4111-8111-111111111111',
    state: 'quarantined',
    reason: null,
    createdAt: '2026-10-03T11:55:00.000Z',
    sessionId: null,
    quarantine: kind,
    quarantineReason: reason,
  };
  server.media.push(entry);
  return entry.id;
}

interface Input {
  readonly role: 'administrator' | 'editor' | 'read_only';
  readonly userId: string;
  readonly key: string | undefined;
  readonly raw: string;
}

/** The answer to a request under `/api/v1/work-orders/{id}/media-assets…`, or `null` when the path is not one of the media. */
export function answerMedia(server: MediaServer, method: string, path: string, query: URLSearchParams, input: Input): Answer | null {
  const match =
    /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/media-assets(?:\/([^/]+)(?:\/(rescan)|\/upload-sessions(?:\/([^/]+)(?:\/(parts|complete|abort)(?:\/(\d+)\/url)?)?)?)?)?$/.exec(
      path,
    );
  if (match === null) return null;
  const [, orderId = '', mediaId, rescan, sessionId, action, partText] = match;
  const writes = input.role !== 'read_only';
  if (mediaId === undefined) {
    if (method === 'GET') {
      const unfinished = query.get('uploadState') === 'unfinished';
      const items = server.media
        .filter(
          (entry) =>
            entry.orderId === orderId &&
            (!unfinished || (entry.state === 'pending_upload' && entry.sessionId !== null && entry.userId === input.userId)),
        )
        .filter((entry) => query.get('needsAttention') !== 'true' || entry.quarantine === 'held')
        .map((entry) => shown(entry, unfinished, input.role))
        .reverse();
      const needsAttentionCount = server.media.filter((entry) => entry.orderId === orderId && entry.quarantine === 'held').length;
      return json(200, { items, nextCursor: null, needsAttentionCount }, { 'Cache-Control': 'no-store' });
    }
    if (method !== 'POST') return problem(405, 'method_not_allowed');
    if (!writes) return problem(403, 'forbidden');
    const replay = input.key === undefined ? undefined : server.keys.get(input.key);
    if (replay !== undefined) return json(201, JSON.parse(replay) as unknown, { 'Idempotent-Replayed': 'true' });
    const body = JSON.parse(input.raw) as { items: { id: string; category: string; fileName: string; declaredSize: number }[] };
    for (const item of body.items) {
      server.media.push({
        id: item.id,
        orderId,
        category: item.category,
        fileName: item.fileName,
        size: item.declaredSize,
        userId: input.userId,
        state: 'pending_upload',
        reason: null,
        createdAt: new Date().toISOString(),
        sessionId: null,
        quarantine: null,
        quarantineReason: null,
      });
    }
    const created = JSON.stringify({
      items: body.items.map((item) => shown(server.media.find((entry) => entry.id === item.id) as Media, false)),
    });
    if (input.key !== undefined) server.keys.set(input.key, created);
    return json(201, JSON.parse(created) as unknown);
  }
  const entry = server.media.find((value) => value.id === mediaId && value.orderId === orderId);
  if (entry === undefined) return problem(404, 'not_found');
  if (rescan !== undefined) {
    if (method !== 'POST') return problem(405, 'method_not_allowed');
    if (input.role !== 'administrator') return problem(403, 'forbidden');
    if (entry.quarantine !== 'held') return problem(409, 'invalid_state_transition');
    // The scan is quick in the synthetic server and the file stays held (a positive verdict); W-04 is covered by the component tests.
    server.rescans += 1;
    // The file stays held while it is scanned again; the next reads of the list say `scanning` (EVM-049 AC3).
    entry.state = 'scanning';
    return json(202, { ...shown(entry, false, input.role), needsAttention: false }, {});
  }
  if (!writes) return problem(403, 'forbidden');
  if (sessionId === undefined) {
    if (method !== 'POST') return problem(405, 'method_not_allowed');
    const id = (JSON.parse(input.raw) as { id: string }).id;
    server.sessionsCreated += 1;
    entry.sessionId = id;
    entry.state = 'pending_upload';
    entry.reason = null;
    server.parts.set(id, new Set());
    return json(201, {
      id,
      mediaAssetId: entry.id,
      state: 'active',
      partSize: PART_SIZE,
      partCount: Math.max(1, Math.ceil(entry.size / PART_SIZE)),
      expiresAt: '2026-10-18T11:55:00.000Z',
    });
  }
  if (entry.sessionId !== sessionId || entry.userId !== input.userId) return problem(404, 'not_found');
  const confirmed = server.parts.get(sessionId) ?? new Set<number>();
  const count = Math.max(1, Math.ceil(entry.size / PART_SIZE));
  if (action === 'parts' && partText === undefined && method === 'GET') {
    return json(200, { items: [...confirmed].map((partNumber) => ({ partNumber, size: Math.min(PART_SIZE, entry.size) })) });
  }
  if (action === 'parts' && partText !== undefined) {
    const part = Number(partText);
    const length = part === count ? entry.size - (count - 1) * PART_SIZE : PART_SIZE;
    return json(
      200,
      {
        url: `${BUCKET_ORIGIN}/media/${entry.id}/original?partNumber=${partText}&uploadId=${sessionId}`,
        expiresAt: '2026-10-11T13:00:00.000Z',
        contentLength: length,
      },
      { 'Cache-Control': 'no-store' },
    );
  }
  if (action === 'complete' && method === 'POST') {
    if (confirmed.size !== count) return problem(422, 'upload_incomplete');
    server.completes += 1;
    // The scan is quick in the synthetic server: the next read shows its verdict.
    entry.state = server.verdict === 'clean' ? 'clean' : server.verdict === 'quarantined' ? 'quarantined' : 'failed';
    entry.reason = server.verdict === 'checksum_mismatch' ? 'checksum_mismatch' : null;
    entry.quarantine = server.verdict === 'quarantined' ? 'held' : null;
    const shownState = { ...shown(entry, false), fileState: 'uploaded', stateReasonCode: null, needsAttention: false };
    return json(200, shownState);
  }
  if (action === 'abort' && method === 'POST') return { status: 204, headers: {}, body: '' };
  return problem(404, 'not_found');
}
