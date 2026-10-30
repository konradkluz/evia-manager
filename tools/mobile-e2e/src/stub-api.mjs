// @ts-check
/**
 * Scenario server for the smoke test (EVM-009 AC2, AC3; EVM-100): answers `GET /api/health` like the API of EVM-008
 * ({ status: 'ok', minSupportedAppVersion: { android, ios } }; 503 problem+json when "the database is down"), in the mode the
 * scenario needs ('hang' never answers, for the loading state), and the four operations of the mobile sign-in of the contract EVM-090
 * (login, login/totp, token, logout) for ONE synthetic account, in the sign-in mode of the scenario. It listens on the loopback only
 * (the emulator reaches it as 10.0.2.2) — never on all interfaces. It records only the compatibility headers of the requests
 * (api-guidelines → "Minimalna wersja aplikacji"), no addresses and no bodies; the tokens it hands out are fixed test words (gitleaks).
 */
import { createServer } from 'node:http';

/** @typedef {'ok' | 'update' | 'down' | 'hang'} StubMode */
/**
 * Sign-in mode (EVM-100): `ok`; `rate_limited` (429 with Retry-After 230 s); `channel_not_allowed` (403 after the code);
 * `version_unsupported` (426); `session_revoked` / `device_wipe_required` (401 at the refresh).
 * @typedef {'ok' | 'rate_limited' | 'channel_not_allowed' | 'version_unsupported' | 'session_revoked' | 'device_wipe_required'} AuthMode
 */
/** @typedef {Awaited<ReturnType<typeof startStubApi>>} StubApi */
/** @typedef {{ platform: string | undefined, version: string | undefined }} RecordedRequest */

export const OK_MINIMUM = '0.1.0';
export const UPDATE_MINIMUM = '99.0.0';

/** The synthetic account of the flows (never a real person). */
export const E2E_ACCOUNT = Object.freeze({ email: 'technik@example.test', password: 'haslo-testowe', code: '123456' });
const E2E_USER = { id: '90000000-0000-4000-8000-0000000000e2', displayName: 'Technik Testowy', role: 'editor' };
const E2E_DEVICE_ID = '7a000000-0000-4000-8000-0000000000e2';
const MAX_BODY = 8192;

/**
 * @param {StubMode} mode
 * @returns {{ status: number, type: string, body: unknown }}
 */
export function healthAnswer(mode) {
  if (mode === 'down') {
    return {
      status: 503,
      type: 'application/problem+json',
      body: { type: 'about:blank', title: 'Service Unavailable', status: 503, code: 'service_unavailable' },
    };
  }
  const minimum = mode === 'update' ? UPDATE_MINIMUM : OK_MINIMUM;
  return { status: 200, type: 'application/json', body: { status: 'ok', minSupportedAppVersion: { android: minimum, ios: minimum } } };
}

/**
 * @param {number} status
 * @param {string} code
 * @returns {{ status: number, type: string, body: unknown, headers?: Record<string, string> }}
 */
function problem(status, code) {
  return { status, type: 'application/problem+json', body: { type: 'about:blank', title: code, status, code, traceId: '0'.repeat(32) } };
}

/**
 * A session of the contract `MobileSession`, with padded test words for the tokens.
 * @param {number} n
 * @param {boolean} withSecret
 */
export function sessionBody(n, withSecret) {
  const now = Date.now();
  return {
    deviceId: E2E_DEVICE_ID,
    ...(withSecret ? { installationSecret: `e2e-installation-${String(n)}`.padEnd(43, 's') } : {}),
    accessToken: `e2e-access-${String(n)}`.padEnd(40, '-'),
    accessTokenExpiresAt: new Date(now + 15 * 60_000).toISOString(),
    refreshToken: `e2e-refresh-${String(n)}`.padEnd(40, '-'),
    refreshTokenExpiresAt: new Date(now + 14 * 86_400_000).toISOString(),
    serverTime: new Date(now).toISOString(),
    user: E2E_USER,
  };
}

/**
 * The answer of one sign-in operation in the given mode (order of errors of EVM-094: version → limit → password → code → role).
 * @param {string} path
 * @param {unknown} body
 * @param {AuthMode} auth
 * @param {number} n serial number of the issued session
 * @returns {{ status: number, type: string, body: unknown, headers?: Record<string, string> }}
 */
export function authAnswer(path, body, auth, n) {
  const fields = /** @type {Record<string, unknown>} */ (typeof body === 'object' && body !== null ? body : {});
  if (path === '/api/v1/auth/mobile/logout') return { status: 204, type: 'application/json', body: null };
  if (path === '/api/v1/auth/mobile/token') {
    if (auth === 'session_revoked' || auth === 'device_wipe_required') return problem(401, auth);
    return { status: 200, type: 'application/json', body: sessionBody(n, false) };
  }
  if (auth === 'version_unsupported') return problem(426, 'client_version_unsupported');
  if (auth === 'rate_limited') return { ...problem(429, 'too_many_requests'), headers: { 'Retry-After': '230' } };
  if (path === '/api/v1/auth/mobile/login') {
    if (fields['email'] !== E2E_ACCOUNT.email || fields['password'] !== E2E_ACCOUNT.password) return problem(401, 'invalid_credentials');
    return {
      status: 200,
      type: 'application/json',
      body: {
        challengeToken: `e2e-challenge-${String(n)}`.padEnd(43, 'c'),
        challengeExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    };
  }
  if (fields['code'] !== E2E_ACCOUNT.code) return problem(401, 'invalid_credentials');
  if (auth === 'channel_not_allowed') return problem(403, 'channel_not_allowed');
  return { status: 200, type: 'application/json', body: sessionBody(n, true) };
}

const AUTH_PATHS = [
  '/api/v1/auth/mobile/login',
  '/api/v1/auth/mobile/login/totp',
  '/api/v1/auth/mobile/token',
  '/api/v1/auth/mobile/logout',
];

/**
 * @param {{ port?: number, onRequest?: (request: RecordedRequest) => void }} [options] port 0 = a free port; onRequest sees every recorded request
 * @returns {Promise<{ port: number, setMode: (mode: StubMode, auth?: AuthMode) => void, requests: () => RecordedRequest[], close: () => Promise<void> }>}
 */
export async function startStubApi({ port = 0, onRequest } = {}) {
  /** @type {StubMode} */
  let mode = 'ok';
  /** @type {AuthMode} */
  let auth = 'ok';
  let issued = 0;
  /** @type {RecordedRequest[]} */
  const recorded = [];
  const server = createServer((request, response) => {
    const isHealth = request.method === 'GET' && request.url === '/api/health';
    const isAuth = request.method === 'POST' && AUTH_PATHS.includes(request.url ?? '');
    if (!isHealth && !isAuth) {
      response.writeHead(404, { 'Content-Type': 'application/problem+json' }).end('{"code":"not_found"}');
      return;
    }
    const header = (/** @type {string} */ name) => {
      const value = request.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const request_ = { platform: header('x-client-platform'), version: header('x-client-version') };
    recorded.push(request_);
    onRequest?.(request_);
    // 'hang': the request is held without an answer (the app keeps its loading state until its own timeout); close() ends it
    if (mode === 'hang' && isHealth) return;
    if (isHealth || mode === 'down') {
      const answer = healthAnswer(mode);
      response.writeHead(answer.status, { 'Content-Type': answer.type, 'Cache-Control': 'no-store' }).end(JSON.stringify(answer.body));
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    request.on('end', () => {
      /** @type {unknown} */
      let body;
      try {
        body = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = null;
      }
      issued += 1;
      const answer = size > MAX_BODY ? problem(413, 'payload_too_large') : authAnswer(request.url ?? '', body, auth, issued);
      response.writeHead(answer.status, { 'Content-Type': answer.type, 'Cache-Control': 'no-store', ...(answer.headers ?? {}) });
      response.end(answer.status === 204 ? undefined : JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(undefined);
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the scenario server has no TCP address');
  return {
    port: address.port,
    setMode: (next, nextAuth = 'ok') => {
      mode = next;
      auth = nextAuth;
    },
    requests: () => [...recorded],
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
