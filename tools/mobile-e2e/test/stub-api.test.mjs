import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { healthAnswer, OK_MINIMUM, startStubApi, UPDATE_MINIMUM } from '../src/stub-api.mjs';

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

  it('EVM-009 AC2: anything but GET /api/health is 404 and is not recorded', async () => {
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
