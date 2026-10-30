import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { authAnswer, E2E_ACCOUNT, healthAnswer, OK_MINIMUM, sessionBody, startStubApi, UPDATE_MINIMUM } from '../src/stub-api.mjs';

/** @param {number} port @param {string} path @param {string} [method] */
async function call(port, path, method = 'GET') {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method,
    headers: { 'X-Client-Platform': 'android', 'X-Client-Version': '0.1.0' },
  });
  return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
}

describe('scenario server (EVM-009 AC2, AC3)', () => {
  it('EVM-009 AC2: the answers have the shape of GET /api/health of the contract (EVM-008)', () => {
    assert.deepEqual(healthAnswer('ok'), {
      status: 200,
      type: 'application/json',
      body: { status: 'ok', minSupportedAppVersion: { android: OK_MINIMUM, ios: OK_MINIMUM } },
    });
    assert.equal(healthAnswer('down').status, 503);
    assert.equal(healthAnswer('down').type, 'application/problem+json');
  });

  it('EVM-009 AC3: the update mode raises the minimum version above any app version', () => {
    const body = /** @type {{ minSupportedAppVersion: { android: string } }} */ (healthAnswer('update').body);
    assert.equal(body.minSupportedAppVersion.android, UPDATE_MINIMUM);
  });

  it('EVM-009 AC2: serves the health in the mode set, on the loopback, and records only the compatibility headers', async () => {
    const stub = await startStubApi();
    try {
      assert.ok(stub.port > 0);
      const ok = await call(stub.port, '/api/health');
      assert.equal(ok.status, 200);
      assert.equal(ok.text, JSON.stringify(healthAnswer('ok').body));
      stub.setMode('update');
      assert.equal((await call(stub.port, '/api/health')).text, JSON.stringify(healthAnswer('update').body));
      stub.setMode('down');
      const down = await call(stub.port, '/api/health');
      assert.equal(down.status, 503);
      assert.equal(down.type, 'application/problem+json');
      assert.deepEqual(stub.requests(), [
        { platform: 'android', version: '0.1.0' },
        { platform: 'android', version: '0.1.0' },
        { platform: 'android', version: '0.1.0' },
      ]);
    } finally {
      await stub.close();
    }
  });

  it('EVM-009 AC2: every recorded request is also reported to the optional listener', async () => {
    /** @type {unknown[]} */
    const seen = [];
    const stub = await startStubApi({
      onRequest: (request) => {
        seen.push(request);
      },
    });
    try {
      await call(stub.port, '/api/health');
      assert.deepEqual(seen, [{ platform: 'android', version: '0.1.0' }]);
    } finally {
      await stub.close();
    }
  });

  it('EVM-009 AC1: the hang mode records the request and never answers, so the app stays in its loading state', async () => {
    const stub = await startStubApi();
    try {
      stub.setMode('hang');
      const controller = new AbortController();
      const pending = fetch(`http://127.0.0.1:${String(stub.port)}/api/health`, {
        headers: { 'X-Client-Platform': 'android', 'X-Client-Version': '0.1.0' },
        signal: controller.signal,
      });
      /** @type {string} */
      const outcome = await Promise.race([
        pending.then(() => 'answered'),
        new Promise((/** @type {(value: string) => void} */ resolve) => {
          setTimeout(() => {
            resolve('silent');
          }, 400);
        }),
      ]);
      assert.equal(outcome, 'silent');
      assert.deepEqual(stub.requests(), [{ platform: 'android', version: '0.1.0' }]);
      controller.abort();
      await assert.rejects(pending, /abort/i);
    } finally {
      await stub.close();
    }
  });

  it('EVM-009 AC2: anything but GET /api/health and the four sign-in operations is 404 and is not recorded', async () => {
    const stub = await startStubApi();
    try {
      assert.equal((await call(stub.port, '/api/v1/work-orders')).status, 404);
      assert.equal((await call(stub.port, '/api/health', 'POST')).status, 404);
      assert.deepEqual(stub.requests(), []);
    } finally {
      await stub.close();
    }
  });

  it('EVM-009 AC2: a request without the compatibility headers is recorded as such', async () => {
    const stub = await startStubApi();
    try {
      await fetch(`http://127.0.0.1:${String(stub.port)}/api/health`);
      assert.deepEqual(stub.requests(), [{ platform: undefined, version: undefined }]);
    } finally {
      await stub.close();
    }
  });

  it('EVM-009 AC2: a port that is taken is an error, not a silent second server', async () => {
    const first = await startStubApi();
    try {
      await assert.rejects(startStubApi({ port: first.port }), /EADDRINUSE/);
    } finally {
      await first.close();
    }
  });
});

/**
 * @param {number} port
 * @param {string} path
 * @param {unknown} [body]
 * @param {string} [raw]
 */
async function post(port, path, body, raw) {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: 'POST',
    headers: { 'X-Client-Platform': 'android', 'X-Client-Version': '0.1.0', 'Content-Type': 'application/json' },
    ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  /** @type {Record<string, unknown>} */
  const parsed = text === '' ? {} : /** @type {Record<string, unknown>} */ (JSON.parse(text));
  return { status: response.status, retryAfter: response.headers.get('retry-after'), body: parsed };
}

const LOGIN = '/api/v1/auth/mobile/login';
const TOTP = '/api/v1/auth/mobile/login/totp';
const TOKEN = '/api/v1/auth/mobile/token';
const LOGOUT = '/api/v1/auth/mobile/logout';
const CREDENTIALS = {
  email: E2E_ACCOUNT.email,
  password: E2E_ACCOUNT.password,
  device: { model: 'x', osVersion: '15', securityPatch: '2026-09-05' },
};

describe('scenario server: the mobile sign-in (EVM-100 AC1–AC7; contract EVM-090)', () => {
  it('EVM-100 AC1: login → challenge, totp with the right code → a session of the contract shape; refresh rotates; logout 204', async () => {
    const stub = await startStubApi();
    try {
      const step1 = await post(stub.port, LOGIN, CREDENTIALS);
      assert.equal(step1.status, 200);
      assert.match(String(step1.body['challengeToken']), /^[A-Za-z0-9_-]{43}$/);
      const step2 = await post(stub.port, TOTP, { challengeToken: step1.body['challengeToken'], code: E2E_ACCOUNT.code });
      assert.equal(step2.status, 200);
      assert.match(String(step2.body['deviceId']), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.match(String(step2.body['installationSecret']), /^[A-Za-z0-9_-]{43}$/);
      for (const field of ['accessToken', 'refreshToken']) assert.ok(String(step2.body[field]).length >= 32, field);
      const refreshed = await post(stub.port, TOKEN, { refreshToken: step2.body['refreshToken'] });
      assert.equal(refreshed.status, 200);
      assert.equal(refreshed.body['installationSecret'], undefined);
      assert.notEqual(refreshed.body['refreshToken'], step2.body['refreshToken']);
      assert.equal((await post(stub.port, LOGOUT)).status, 204);
      // only the compatibility headers are recorded, never a body
      assert.deepEqual(
        stub.requests(),
        Array.from({ length: 4 }, () => ({ platform: 'android', version: '0.1.0' })),
      );
    } finally {
      await stub.close();
    }
  });

  it('EVM-100 AC2: a wrong password or code is 401 invalid_credentials; rate_limited is 429 with Retry-After 230', async () => {
    const stub = await startStubApi();
    try {
      assert.equal((await post(stub.port, LOGIN, { ...CREDENTIALS, password: 'wrong' })).body['code'], 'invalid_credentials');
      assert.equal((await post(stub.port, TOTP, { challengeToken: 'x', code: '000000' })).body['code'], 'invalid_credentials');
      assert.equal((await post(stub.port, LOGIN, undefined, 'not json')).body['code'], 'invalid_credentials');
      stub.setMode('ok', 'rate_limited');
      const limited = await post(stub.port, LOGIN, CREDENTIALS);
      assert.equal(limited.status, 429);
      assert.equal(limited.retryAfter, '230');
      assert.match(String(limited.body['traceId']), /^[0-9a-f]{32}$/);
    } finally {
      await stub.close();
    }
  });

  it('EVM-100 AC3–AC5: role, version and revocation modes answer in the order of EVM-094', async () => {
    const stub = await startStubApi();
    try {
      stub.setMode('ok', 'channel_not_allowed');
      assert.equal((await post(stub.port, LOGIN, CREDENTIALS)).status, 200);
      assert.equal((await post(stub.port, TOTP, { code: E2E_ACCOUNT.code })).body['code'], 'channel_not_allowed');
      stub.setMode('ok', 'version_unsupported');
      assert.equal((await post(stub.port, LOGIN, CREDENTIALS)).status, 426);
      for (const mode of /** @type {const} */ (['session_revoked', 'device_wipe_required'])) {
        stub.setMode('ok', mode);
        const answer = await post(stub.port, TOKEN, { refreshToken: 'x' });
        assert.equal(answer.status, 401);
        assert.equal(answer.body['code'], mode);
      }
      stub.setMode('down');
      assert.equal((await post(stub.port, LOGIN, CREDENTIALS)).status, 503);
      stub.setMode('hang');
      assert.equal((await post(stub.port, LOGIN, CREDENTIALS)).status, 200);
    } finally {
      await stub.close();
    }
  });

  it('EVM-100: a body over 8 KB is refused (contract limit)', async () => {
    const stub = await startStubApi();
    try {
      assert.equal((await post(stub.port, LOGIN, undefined, 'x'.repeat(9000))).status, 413);
      assert.equal(authAnswer(LOGIN, null, 'ok', 1).status, 401);
      assert.equal(sessionBody(1, false).installationSecret, undefined);
    } finally {
      await stub.close();
    }
  });
});
