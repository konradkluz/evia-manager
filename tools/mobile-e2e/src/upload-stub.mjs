// @ts-check
/**
 * Scenario server of the background upload (EVM-130 AC8): the five operations of the upload session of the contract
 * (`packages/contracts/openapi/paths/media.yaml`: createUploadSession, listUploadParts, getUploadPartUrl, completeUploadSession,
 * abortUploadSession), the `PUT` of a part with the `Content-Length` check (the emulator reaches it as 10.0.2.2), an idempotent `complete`,
 * the rotating refresh of the token (tolerance window) and the injection of failures (`403` expired part address, a connection dropped in the
 * middle of a part, `401 session_revoked` / `device_wipe_required`, `426`, `id_conflict`). Two listeners, both on the loopback only:
 * the APP port (API + parts) and the CONTROL port (host only: Maestro and the scripts of the orchestrator) with the checkpoint
 * (objects per assetId, SHA-256, orphaned multiparts). Everything here is synthetic: no real person, no real files; the part addresses carry
 * `X-Amz-*` parameters (signature and expiry) so that the logcat assertion of AC5 proves something; the tokens are fixed test words.
 * It keeps counters and identifiers, never addresses or bodies of the requests.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { authAnswer, healthAnswer } from './stub-api.mjs';

/** @typedef {'expired_url' | 'drop_mid_part' | 'session_revoked' | 'device_wipe_required' | 'version_unsupported' | 'id_conflict'} FaultName */
/** @typedef {'pending_upload' | 'uploaded' | 'clean' | 'quarantined' | 'failed'} FileState */
/**
 * @typedef {object} Part
 * @property {number} size
 * @property {string} etag
 * @property {Buffer[]} chunks
 */
/**
 * @typedef {object} Session
 * @property {string} id
 * @property {string} assetId
 * @property {string} workOrderId
 * @property {'active' | 'completed' | 'aborted' | 'expired'} state
 * @property {number} partSize
 * @property {number} partCount
 * @property {number} expiresAt
 * @property {string} idempotencyKey
 * @property {Map<number, Part>} parts
 */
/**
 * @typedef {object} Asset
 * @property {string} workOrderId
 * @property {number} declaredSize
 * @property {FileState} state
 * @property {number} objects
 * @property {string | null} sha256
 */
/** @typedef {{ status: number, type: string, body: unknown, headers?: Record<string, string> }} Answer */

export const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
/** Refresh tolerance window of the server (a lost answer is retried with the same token within it; the client keeps <= 20 s). */
export const TOLERANCE_MS = 30_000;
export const SIGNED_URL_TTL_S = 3600;
export const MAX_PART_SESSIONS = 1000;
const MAX_JSON = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PERSISTENT_FAULTS = new Set(['session_revoked', 'device_wipe_required', 'version_unsupported']);
const FAULTS = new Set(['expired_url', 'drop_mid_part', 'session_revoked', 'device_wipe_required', 'version_unsupported', 'id_conflict']);

const SESSIONS_PATH =
  /^\/api\/v1\/work-orders\/([^/]+)\/media-assets\/([^/]+)\/upload-sessions(?:\/([^/]+)(?:\/(parts|complete|abort)(?:\/(\d+)\/url)?)?)?$/;
const PART_PATH = /^\/storage\/([^/]+)\/(\d+)$/;

/**
 * @param {number} status
 * @param {string} code
 * @param {Record<string, string>} [headers]
 * @param {unknown[]} [errors]
 * @returns {Answer}
 */
function problem(status, code, headers, errors) {
  return {
    status,
    type: 'application/problem+json',
    body: { type: `/problems/${code}`, title: code, status, code, traceId: '0'.repeat(32), ...(errors === undefined ? {} : { errors }) },
    ...(headers === undefined ? {} : { headers }),
  };
}

/** @param {number} status @param {unknown} body @param {Record<string, string>} [headers] @returns {Answer} */
function json(status, body, headers) {
  return { status, type: 'application/json', body, ...(headers === undefined ? {} : { headers }) };
}

/**
 * @param {{ partSize?: number, publicHost?: string, now?: () => number, accessTtlMs?: number }} [options] publicHost = the host the app puts in the part addresses
 */
export function createUploadStub({
  partSize = DEFAULT_PART_SIZE,
  publicHost = '10.0.2.2',
  now = Date.now,
  accessTtlMs = 15 * 60_000,
} = {}) {
  const secret = randomBytes(32);
  /** @type {Map<string, Asset>} */
  const assets = new Map();
  /** @type {Map<string, Session>} */
  const sessions = new Map();
  /** @type {Map<string, string>} idempotency key -> session id */
  const idempotency = new Map();
  /** @type {Map<string, number>} access token -> expiry (ms since epoch) */
  const access = new Map();
  /** @type {Map<string, number>} */
  const faults = new Map();
  const counters = { requests: 0, partPuts: 0, partsRejected: 0, refreshes: 0, refreshReplays: 0, reuseDetected: 0, unauthorized: 0 };
  let issued = 0;
  /** @type {{ refreshToken: string, previous: string | null, rotatedAt: number, lastPair: ReturnType<typeof pair> | null } | null} */
  let family = null;
  let port = 0;

  /** @param {number} n */
  function pair(n) {
    const at = now();
    const body = {
      deviceId: '7a000000-0000-4000-8000-0000000000e2',
      accessToken: `e2e-access-up${String(n)}`.padEnd(40, '-'),
      accessTokenExpiresAt: new Date(at + accessTtlMs).toISOString(),
      refreshToken: `e2e-refresh-up${String(n)}`.padEnd(40, '-'),
      refreshTokenExpiresAt: new Date(at + 14 * 86_400_000).toISOString(),
      serverTime: new Date(at).toISOString(),
      user: { id: '90000000-0000-4000-8000-0000000000e2', displayName: 'Technik Testowy', role: 'editor' },
    };
    return body;
  }

  /** @param {ReturnType<typeof pair>} body */
  function register(body) {
    access.set(body.accessToken, now() + accessTtlMs);
    family = { refreshToken: body.refreshToken, previous: family?.refreshToken ?? null, rotatedAt: now(), lastPair: body };
  }

  /** @param {string} name @returns {boolean} true when the fault fires (and is consumed) */
  function fire(name) {
    const left = faults.get(name);
    if (left === undefined || left <= 0) return false;
    if (left !== Infinity) faults.set(name, left - 1);
    return true;
  }

  /** @param {string} sessionId @param {number} partNumber @param {number} expires */
  function sign(sessionId, partNumber, expires) {
    return createHmac('sha256', secret)
      .update(`${sessionId}/${String(partNumber)}/${String(expires)}`)
      .digest('hex');
  }

  /** @param {Session} session @param {number} partNumber */
  function expectedSize(session, partNumber) {
    const asset = /** @type {Asset} */ (assets.get(session.assetId));
    return partNumber < session.partCount ? session.partSize : asset.declaredSize - session.partSize * (session.partCount - 1);
  }

  /** @param {Session} session */
  function sessionBody(session) {
    return {
      id: session.id,
      mediaAssetId: session.assetId,
      state: session.state,
      partSize: session.partSize,
      partCount: session.partCount,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  /** @param {string} assetId */
  function mediaAssetBody(assetId) {
    const asset = /** @type {Asset} */ (assets.get(assetId));
    const at = new Date(now()).toISOString();
    return {
      id: assetId,
      workOrderId: asset.workOrderId,
      mediaType: 'photo',
      category: 'other',
      description: null,
      procedureStageId: null,
      procedureStageName: null,
      version: 1,
      origin: 'mobile',
      capturedAt: at,
      createdAt: at,
      fileState: asset.state,
      stateReasonCode: asset.state === 'failed' ? 'checksum_mismatch' : null,
      needsAttention: asset.state === 'quarantined',
      quarantine: null,
      declaredSize: asset.declaredSize,
      durationSeconds: null,
      avScanned: false,
      originalFilename: null,
      uploadSession: null,
    };
  }

  /**
   * Bearer check of the API: the token must be one the stub issued and not expired; the injected session faults answer first.
   * @param {string | undefined} header
   * @returns {Answer | null}
   */
  function authorize(header) {
    if (fire('version_unsupported')) return problem(426, 'client_version_unsupported');
    if (fire('device_wipe_required')) return problem(401, 'device_wipe_required');
    if (fire('session_revoked')) return problem(401, 'session_revoked');
    const token = /^Bearer (\S+)$/.exec(header ?? '')?.[1];
    const expiry = token === undefined ? undefined : access.get(token);
    if (expiry === undefined || expiry <= now()) {
      counters.unauthorized += 1;
      return problem(401, 'unauthenticated');
    }
    return null;
  }

  /**
   * The refresh with rotation (ADR-0005): the current token rotates to a new pair; the just-used token inside the tolerance window gets
   * the same pair again (a lost answer); a stale one is a reuse and ends the family.
   * @param {unknown} body
   * @returns {Answer}
   */
  function refresh(body) {
    if (fire('version_unsupported')) return problem(426, 'client_version_unsupported');
    if (fire('device_wipe_required')) return problem(401, 'device_wipe_required');
    if (fire('session_revoked')) return problem(401, 'session_revoked');
    const token = typeof body === 'object' && body !== null ? /** @type {Record<string, unknown>} */ (body)['refreshToken'] : undefined;
    if (family === null || typeof token !== 'string') return problem(401, 'session_revoked');
    if (token === family.refreshToken) {
      issued += 1;
      const next = pair(issued);
      counters.refreshes += 1;
      register(next);
      return json(200, next, { 'Cache-Control': 'no-store' });
    }
    if (token === family.previous && family.lastPair !== null && now() - family.rotatedAt <= TOLERANCE_MS) {
      counters.refreshReplays += 1;
      return json(200, family.lastPair, { 'Cache-Control': 'no-store' });
    }
    counters.reuseDetected += 1;
    family = null;
    access.clear();
    return problem(401, 'session_revoked');
  }

  /**
   * @param {string} method
   * @param {string} workOrderId
   * @param {string} assetId
   * @param {string | undefined} sessionId
   * @param {string | undefined} operation
   * @param {string | undefined} partNumber
   * @param {unknown} body
   * @param {Record<string, string | string[] | undefined>} headers
   * @returns {Answer}
   */
  function sessionOperation(method, workOrderId, assetId, sessionId, operation, partNumber, body, headers) {
    const asset = assets.get(assetId);
    if (!UUID.test(workOrderId) || !UUID.test(assetId) || asset === undefined || asset.workOrderId !== workOrderId)
      return problem(404, 'not_found');
    if (sessionId === undefined) {
      if (method !== 'POST') return problem(405, 'method_not_allowed');
      return createSession(asset, workOrderId, assetId, body, headers);
    }
    const session = sessions.get(sessionId);
    if (!UUID.test(sessionId) || session === undefined || session.assetId !== assetId) return problem(404, 'not_found');
    if (operation === 'parts' && partNumber === undefined && method === 'GET') {
      if (session.state !== 'active') return problem(409, 'invalid_state_transition');
      const items = [...session.parts.entries()].sort((a, b) => a[0] - b[0]).map(([n, part]) => ({ partNumber: n, size: part.size }));
      return json(200, { items }, { 'Cache-Control': 'no-store' });
    }
    if (operation === 'parts' && partNumber !== undefined && method === 'GET') {
      const n = Number(partNumber);
      if (n < 1 || n > session.partCount) return problem(400, 'validation_failed');
      if (session.state !== 'active') return problem(409, 'invalid_state_transition');
      const expires = Math.floor(now() / 1000) + SIGNED_URL_TTL_S;
      const query = new URLSearchParams({
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Date': new Date(now()).toISOString().replaceAll(/[-:]|\.\d{3}/g, ''),
        'X-Amz-Expires': String(SIGNED_URL_TTL_S),
        'X-Amz-Expiry': String(expires),
        'X-Amz-SignedHeaders': 'content-length;host',
        'X-Amz-Signature': sign(session.id, n, expires),
      });
      return json(
        200,
        {
          url: `http://${publicHost}:${String(port)}/storage/${session.id}/${String(n)}?${query.toString()}`,
          expiresAt: new Date(expires * 1000).toISOString(),
          contentLength: expectedSize(session, n),
        },
        { 'Cache-Control': 'no-store' },
      );
    }
    if (operation === 'complete' && method === 'POST') return complete(session, asset);
    if (operation === 'abort' && method === 'POST') {
      if (session.state === 'completed') return problem(409, 'invalid_state_transition');
      session.state = 'aborted';
      session.parts.clear();
      return { status: 204, type: 'application/json', body: null };
    }
    return problem(404, 'not_found');
  }

  /**
   * @param {Asset} asset @param {string} workOrderId @param {string} assetId @param {unknown} body
   * @param {Record<string, string | string[] | undefined>} headers
   * @returns {Answer}
   */
  function createSession(asset, workOrderId, assetId, body, headers) {
    const key = headers['idempotency-key'];
    const id = typeof body === 'object' && body !== null ? /** @type {Record<string, unknown>} */ (body)['id'] : undefined;
    if (typeof key !== 'string' || !UUID7.test(key) || typeof id !== 'string' || !UUID7.test(id)) return problem(400, 'validation_failed');
    if (fire('id_conflict')) return problem(409, 'id_conflict');
    const replayed = idempotency.get(key);
    if (replayed !== undefined) {
      const earlier = /** @type {Session} */ (sessions.get(replayed));
      return earlier.state === 'active'
        ? json(201, sessionBody(earlier), { 'Idempotent-Replayed': 'true' })
        : problem(409, 'invalid_state_transition');
    }
    const taken = sessions.get(id);
    if (taken !== undefined && taken.assetId !== assetId) return problem(409, 'id_conflict');
    for (const existing of sessions.values()) {
      if (existing.assetId === assetId && existing.state === 'active') return json(200, sessionBody(existing));
    }
    if (asset.state !== 'pending_upload' && asset.state !== 'failed') return problem(409, 'invalid_state_transition');
    const partCount = Math.max(1, Math.ceil(asset.declaredSize / partSize));
    if (partCount > MAX_PART_SESSIONS) return problem(400, 'validation_failed');
    /** @type {Session} */
    const session = {
      id,
      assetId,
      workOrderId,
      state: 'active',
      partSize,
      partCount,
      expiresAt: now() + 7 * 86_400_000,
      idempotencyKey: key,
      parts: new Map(),
    };
    asset.state = 'pending_upload';
    sessions.set(id, session);
    idempotency.set(key, id);
    return json(201, sessionBody(session));
  }

  /** @param {Session} session @param {Asset} asset @returns {Answer} */
  function complete(session, asset) {
    if (session.state === 'completed') return json(200, mediaAssetBody(session.assetId));
    if (session.state !== 'active') return problem(409, 'invalid_state_transition');
    if (session.parts.size !== session.partCount)
      return problem(422, 'upload_incomplete', undefined, [{ pointer: '', code: 'parts_missing' }]);
    let total = 0;
    for (let n = 1; n <= session.partCount; n += 1) {
      const part = session.parts.get(n);
      if (part === undefined) return problem(422, 'upload_incomplete', undefined, [{ pointer: '', code: 'parts_missing' }]);
      if (part.size !== expectedSize(session, n))
        return problem(422, 'upload_incomplete', undefined, [{ pointer: '', code: 'size_mismatch' }]);
      total += part.size;
    }
    if (total !== asset.declaredSize) return problem(422, 'upload_incomplete', undefined, [{ pointer: '', code: 'size_mismatch' }]);
    const hash = createHash('sha256');
    for (let n = 1; n <= session.partCount; n += 1) {
      for (const chunk of /** @type {Part} */ (session.parts.get(n)).chunks) hash.update(chunk);
    }
    asset.sha256 = hash.digest('hex');
    asset.objects = 1;
    asset.state = 'uploaded';
    session.state = 'completed';
    // the parts are folded into the object: nothing stays in the multipart
    session.parts.clear();
    return json(200, mediaAssetBody(session.assetId));
  }

  /**
   * The `PUT` of one part: the signature and the expiry of the address, the exact `Content-Length`, the streaming SHA-256 of the received bytes.
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {URL} target
   * @param {RegExpExecArray} match
   */
  function putPart(request, response, target, match) {
    counters.partPuts += 1;
    const send = (/** @type {number} */ status, /** @type {string} */ code) => {
      counters.partsRejected += status === 200 ? 0 : 1;
      response.writeHead(status, { 'Content-Type': 'application/xml', Connection: 'close' });
      response.end(status === 200 ? '' : `<Error><Code>${code}</Code></Error>`);
    };
    const sessionId = /** @type {string} */ (match[1]);
    const n = Number(match[2]);
    const session = sessions.get(sessionId);
    const expires = Number(target.searchParams.get('X-Amz-Expiry'));
    const given = Buffer.from(target.searchParams.get('X-Amz-Signature') ?? '', 'hex');
    const wanted = Buffer.from(session === undefined ? '' : sign(sessionId, n, expires), 'hex');
    if (
      request.method !== 'PUT' ||
      session === undefined ||
      given.length !== wanted.length ||
      given.length === 0 ||
      !timingSafeEqual(given, wanted)
    ) {
      request.resume();
      send(403, 'SignatureDoesNotMatch');
      return;
    }
    if (fire('expired_url') || expires * 1000 <= now()) {
      request.resume();
      send(403, 'ExpiredToken');
      return;
    }
    const length = request.headers['content-length'];
    if (
      session.state !== 'active' ||
      n < 1 ||
      n > session.partCount ||
      length === undefined ||
      Number(length) !== expectedSize(session, n)
    ) {
      request.resume();
      send(length === undefined ? 411 : 400, 'InvalidRequest');
      return;
    }
    const total = Number(length);
    const dropAt = fire('drop_mid_part') ? Math.floor(total / 2) : -1;
    /** @type {Buffer[]} */
    const chunks = [];
    let bytes = 0;
    request.on('data', (/** @type {Buffer} */ chunk) => {
      bytes += chunk.length;
      chunks.push(chunk);
      if (dropAt >= 0 && bytes >= dropAt) {
        // a connection dropped in the middle of the part: nothing of it is kept (like an aborted S3 PUT)
        counters.partsRejected += 1;
        request.destroy();
        response.destroy();
      }
    });
    request.on('end', () => {
      if (bytes !== total || session.state !== 'active') {
        send(400, 'IncompleteBody');
        return;
      }
      const hash = createHash('sha256');
      for (const chunk of chunks) hash.update(chunk);
      const etag = `"${hash.digest('hex').slice(0, 32)}"`;
      session.parts.set(n, { size: total, etag, chunks });
      response.writeHead(200, { ETag: etag, Connection: 'close' });
      response.end();
    });
  }

  /**
   * The app listener: health, sign-in, refresh, the five session operations and the part addresses.
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  function handleApp(request, response) {
    counters.requests += 1;
    const target = new URL(request.url ?? '/', 'http://stub.local');
    const part = PART_PATH.exec(target.pathname);
    if (part !== null) {
      putPart(request, response, target, part);
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size <= MAX_JSON) chunks.push(chunk);
    });
    request.on('end', () => {
      /** @type {unknown} */
      let body;
      try {
        body = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = null;
      }
      const answer = size > MAX_JSON ? problem(413, 'payload_too_large') : route(request.method ?? 'GET', target, body, request.headers);
      response.writeHead(answer.status, { 'Content-Type': answer.type, 'Cache-Control': 'no-store', ...(answer.headers ?? {}) });
      response.end(answer.status === 204 ? undefined : JSON.stringify(answer.body));
    });
  }

  /**
   * @param {string} method @param {URL} target @param {unknown} body @param {Record<string, string | string[] | undefined>} headers
   * @returns {Answer}
   */
  function route(method, target, body, headers) {
    const path = target.pathname;
    if (method === 'GET' && path === '/api/health') return json(healthAnswer('ok').status, healthAnswer('ok').body);
    if (method === 'POST' && path === '/api/v1/auth/mobile/token') return refresh(body);
    if (method === 'POST' && (path === '/api/v1/auth/mobile/login' || path === '/api/v1/auth/mobile/login/totp')) {
      issued += 1;
      const answer = authAnswer(path, body, 'ok', issued);
      if (answer.status !== 200 || !('accessToken' in /** @type {object} */ (answer.body))) return answer;
      const session = pair(issued);
      register(session);
      return json(200, { .../** @type {Record<string, unknown>} */ (answer.body), ...session });
    }
    if (method === 'POST' && path === '/api/v1/auth/mobile/logout') return { status: 204, type: 'application/json', body: null };
    const match = SESSIONS_PATH.exec(path);
    if (match === null) return problem(404, 'not_found');
    const denied = authorize(/** @type {string | undefined} */ (headers['authorization']));
    if (denied !== null) return denied;
    const [, workOrderId, assetId, sessionId, operation, partNumber] = match;
    return sessionOperation(
      method,
      /** @type {string} */ (workOrderId),
      /** @type {string} */ (assetId),
      sessionId,
      operation,
      partNumber,
      body,
      headers,
    );
  }

  /** The checkpoint: per asset the objects, the SHA-256 and the parts; plus the orphaned multiparts and the counters (no addresses, no tokens). */
  function checkpoint() {
    /** @type {Record<string, { state: FileState, objects: number, sha256: string | null, declaredSize: number, sessions: number }>} */
    const byAsset = {};
    for (const [id, asset] of assets) {
      byAsset[id] = {
        state: asset.state,
        objects: asset.objects,
        sha256: asset.sha256,
        declaredSize: asset.declaredSize,
        sessions: [...sessions.values()].filter((s) => s.assetId === id).length,
      };
    }
    // a multipart is orphaned when it holds parts but can no longer be completed: it is not active, or its asset already has the object
    const orphanedMultiparts = [...sessions.values()].filter(
      (s) => s.state !== 'completed' && s.parts.size > 0 && (s.state !== 'active' || (assets.get(s.assetId)?.objects ?? 0) > 0),
    ).length;
    const openMultiparts = [...sessions.values()].filter((s) => s.state === 'active').length;
    return { assets: byAsset, orphanedMultiparts, openMultiparts, counters: { ...counters } };
  }

  /**
   * The control listener (host only): register an asset, inject a fault, expire the access token, set the file state, read the checkpoint.
   * @param {string} method @param {string} path @param {unknown} body
   * @returns {Answer}
   */
  function control(method, path, body) {
    const fields = /** @type {Record<string, unknown>} */ (typeof body === 'object' && body !== null ? body : {});
    if (method === 'GET' && path === '/control/checkpoint') return json(200, checkpoint());
    if (method !== 'POST') return problem(404, 'not_found');
    if (path === '/control/asset') {
      const { assetId, workOrderId, declaredSize } = fields;
      if (typeof assetId !== 'string' || !UUID.test(assetId) || typeof workOrderId !== 'string' || !UUID.test(workOrderId))
        return problem(400, 'validation_failed');
      if (typeof declaredSize !== 'number' || !Number.isInteger(declaredSize) || declaredSize < 1) return problem(400, 'validation_failed');
      assets.set(assetId, { workOrderId, declaredSize, state: 'pending_upload', objects: 0, sha256: null });
      return json(201, { assetId });
    }
    if (path === '/control/fault') {
      const { fault, count } = fields;
      if (typeof fault !== 'string' || !FAULTS.has(fault)) return problem(400, 'validation_failed');
      const times =
        count === 0 ? 0 : typeof count === 'number' && count > 0 ? Math.floor(count) : PERSISTENT_FAULTS.has(fault) ? Infinity : 1;
      faults.set(fault, times);
      return json(200, { fault, remaining: times === Infinity ? 'persistent' : times });
    }
    if (path === '/control/expire-access') {
      for (const token of access.keys()) access.set(token, 0);
      return json(200, { expired: true });
    }
    if (path === '/control/file-state') {
      const { assetId, state } = fields;
      const asset = typeof assetId === 'string' ? assets.get(assetId) : undefined;
      if (asset === undefined || (state !== 'clean' && state !== 'failed' && state !== 'quarantined'))
        return problem(400, 'validation_failed');
      asset.state = state;
      return json(200, { assetId, state });
    }
    if (path === '/control/reset') {
      assets.clear();
      sessions.clear();
      idempotency.clear();
      access.clear();
      faults.clear();
      family = null;
      issued = 0;
      for (const key of /** @type {(keyof typeof counters)[]} */ (Object.keys(counters))) counters[key] = 0;
      return json(200, { reset: true });
    }
    return problem(404, 'not_found');
  }

  return {
    handleApp,
    control,
    checkpoint,
    /** @param {number} value the port of the app listener (it goes into the part addresses) */
    setPort: (value) => {
      port = value;
    },
  };
}

/**
 * Starts both listeners on the loopback: the app port (API + parts) and the control port (host only).
 * @param {{ port?: number, controlPort?: number, partSize?: number, publicHost?: string, now?: () => number, accessTtlMs?: number }} [options]
 */
export async function startUploadStub({ port = 0, controlPort = 0, ...options } = {}) {
  const stub = createUploadStub(options);
  const app = createServer((request, response) => {
    stub.handleApp(request, response);
  });
  const controlServer = createServer((request, response) => {
    /** @type {Buffer[]} */
    const chunks = [];
    request.on('data', (/** @type {Buffer} */ chunk) => {
      if (chunks.length < 64) chunks.push(chunk);
    });
    request.on('end', () => {
      /** @type {unknown} */
      let body;
      try {
        body = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = null;
      }
      const answer = stub.control(request.method ?? 'GET', new URL(request.url ?? '/', 'http://control.local').pathname, body);
      response.writeHead(answer.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(answer.body));
    });
  });
  /** @param {import('node:http').Server} server @param {number} at */
  const listen = (server, at) =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(at, '127.0.0.1', () => {
        resolve(undefined);
      });
    });
  await listen(app, port);
  await listen(controlServer, controlPort);
  /** @param {import('node:http').Server} server */
  const portOf = (server) => {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('the upload stub has no TCP address');
    return address.port;
  };
  stub.setPort(portOf(app));
  return {
    port: portOf(app),
    controlPort: portOf(controlServer),
    checkpoint: stub.checkpoint,
    control: stub.control,
    close: () =>
      Promise.all(
        [app, controlServer].map(
          (server) =>
            new Promise((resolve) => {
              server.close(() => {
                resolve(undefined);
              });
              server.closeAllConnections();
            }),
        ),
      ).then(() => undefined),
  };
}
