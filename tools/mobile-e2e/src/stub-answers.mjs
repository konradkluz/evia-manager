// @ts-check
/**
 * Shared answers of the scenario server (EVM-009, EVM-100): the health answer and the four sign-in operations of the mobile contract (EVM-090),
 * kept apart from the servers so that stub-api.mjs and upload-stub.mjs do not import each other. Fixed test words only (gitleaks).
 */

/** @typedef {'ok' | 'update' | 'down' | 'hang'} StubMode */
/**
 * Sign-in mode (EVM-100): `ok`; `rate_limited` (429 with Retry-After 230 s); `channel_not_allowed` (403 after the code);
 * `version_unsupported` (426); `session_revoked` / `device_wipe_required` (401 at the refresh).
 * @typedef {'ok' | 'rate_limited' | 'channel_not_allowed' | 'version_unsupported' | 'session_revoked' | 'device_wipe_required'} AuthMode
 */

export const OK_MINIMUM = '0.1.0';
export const UPDATE_MINIMUM = '99.0.0';

/** The synthetic account of the flows (never a real person). */
export const E2E_ACCOUNT = Object.freeze({ email: 'technik@example.test', password: 'haslo-testowe', code: '123456' });
const E2E_USER = { id: '90000000-0000-4000-8000-0000000000e2', displayName: 'Technik Testowy', role: 'editor' };
const E2E_DEVICE_ID = '7a000000-0000-4000-8000-0000000000e2';

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
export function problem(status, code) {
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
