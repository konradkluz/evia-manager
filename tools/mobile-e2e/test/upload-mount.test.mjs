/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- the answers and replica changes are parsed JSON read by the assertions */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { E2E_ACCOUNT, startStubApi } from '../src/stub-api.mjs';

const WORK_ORDER = '30000000-0000-4000-8000-000000000001';
const ASSET = '01900000-0000-7000-8000-000000000002';
const SESSION = '01900000-0000-7000-8000-000000000003';
const KEY = '01900000-0000-7000-8000-000000000004';
const MUTATION = '01900000-0000-7000-8000-000000000005';

/** @param {number} port @param {string} path @param {{ method?: string, body?: unknown, headers?: Record<string, string> }} [options] */
async function call(port, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : /** @type {any} */ (JSON.parse(text)) };
}

describe('upload part mounted on the scenario server (EVM-130 stage C, AC1, AC4, AC8)', () => {
  it('EVM-130 AC8: the control listener is a second loopback port; the sign-in of the run goes to the upload part only while it is on', async () => {
    const stub = await startStubApi();
    try {
      assert.ok((stub.uploadControlPort ?? 0) > 0);
      assert.notEqual(stub.uploadControlPort, stub.port);
      const login = { method: 'POST', body: { email: E2E_ACCOUNT.email, password: E2E_ACCOUNT.password, code: E2E_ACCOUNT.code } };
      // off: the sign-in of the earlier scenarios (tokens `e2e-access-<n>`)
      assert.match((await call(stub.port, '/api/v1/auth/mobile/login/totp', login)).json.accessToken, /^e2e-access-1-+$/);
      assert.equal(
        (await call(/** @type {number} */ (stub.uploadControlPort), '/control/active', { method: 'POST', body: { active: true } })).json
          .active,
        true,
      );
      assert.match((await call(stub.port, '/api/v1/auth/mobile/login/totp', login)).json.accessToken, /^e2e-access-up\d+-+$/);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC1: `applied` for CreateMediaAsset registers the asset; the session, the parts and `complete` work on the same port; the replica follows the file state', async () => {
    const stub = await startStubApi();
    const control = /** @type {number} */ (stub.uploadControlPort);
    try {
      await call(control, '/control/active', { method: 'POST', body: { active: true } });
      await call(control, '/control/default-size', { method: 'POST', body: { bytes: 20 * 1024 * 1024 } });
      const session = (
        await call(stub.port, '/api/v1/auth/mobile/login/totp', {
          method: 'POST',
          body: { email: E2E_ACCOUNT.email, password: E2E_ACCOUNT.password, code: E2E_ACCOUNT.code },
        })
      ).json;
      const auth = { Authorization: `Bearer ${session.accessToken}` };
      // the first pull (snapshot) and the command
      const first = await call(stub.port, '/api/v1/sync/changes', { headers: auth });
      assert.equal(first.status, 200);
      const sent = await call(stub.port, '/api/v1/sync/mutations', {
        method: 'POST',
        headers: auth,
        body: {
          pendingItems: 1,
          mutations: [
            {
              mutationId: MUTATION,
              type: 'CreateMediaAsset',
              commandVersion: 1,
              payload: { id: ASSET, workOrderId: WORK_ORDER, mediaType: 'photo', category: 'other' },
            },
          ],
        },
      });
      assert.deepEqual(sent.json.results, [{ mutationId: MUTATION, outcome: 'applied' }]);
      assert.deepEqual(Object.keys((await call(control, '/control/checkpoint')).json.assets), [ASSET]);
      const mediaOf = async () =>
        (await call(stub.port, `/api/v1/sync/changes?cursor=${String(first.json.cursor)}`, { headers: auth })).json.changes.filter(
          (/** @type {any} */ change) => change.entity.type === 'media_asset',
        );
      assert.deepEqual(
        (await mediaOf()).map((/** @type {any} */ change) => change.entity.fileState),
        ['pending'],
      );
      // the five operations of the session on the SAME port; the part address points back to it
      const sessions = `/api/v1/work-orders/${WORK_ORDER}/media-assets/${ASSET}/upload-sessions`;
      const created = await call(stub.port, sessions, {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': KEY },
        // EVM-131: the medium of the command has no file yet, so the session declares it (the contract refuses a session without `file`)
        body: {
          id: SESSION,
          file: { fileName: `${ASSET}.jpg`, declaredSize: 18 * 1024 * 1024, contentType: 'image/jpeg', sha256: 'ab'.repeat(32) },
        },
      });
      assert.equal(created.status, 201);
      assert.equal(created.json.partCount, 5);
      const url = (await call(stub.port, `${sessions}/${SESSION}/parts/1/url`, { headers: auth })).json.url;
      assert.equal(new URL(url).port, String(stub.port));
      assert.equal(new URL(url).hostname, '10.0.2.2');
      // a fault is injected through the control port and reaches the next call
      await call(control, '/control/fault', { method: 'POST', body: { fault: 'version_unsupported' } });
      assert.equal((await call(stub.port, `${sessions}/${SESSION}/parts`, { headers: auth })).status, 426);
      await call(control, '/control/fault', { method: 'POST', body: { fault: 'version_unsupported', count: 0 } });
      assert.equal((await call(stub.port, `${sessions}/${SESSION}/parts`, { headers: auth })).status, 200);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC4: a state set at the control port is a new version of the replica (clean is announced as clean)', async () => {
    const stub = await startStubApi();
    const control = /** @type {number} */ (stub.uploadControlPort);
    try {
      const auth = { Authorization: 'Bearer e2e-access-1' };
      const first = await call(stub.port, '/api/v1/sync/changes', { headers: auth });
      await call(stub.port, '/api/v1/sync/mutations', {
        method: 'POST',
        headers: auth,
        body: {
          pendingItems: 1,
          mutations: [
            {
              mutationId: MUTATION,
              type: 'CreateMediaAsset',
              commandVersion: 1,
              payload: { id: ASSET, workOrderId: WORK_ORDER, mediaType: 'photo', category: 'other' },
            },
          ],
        },
      });
      await call(control, '/control/file-state', { method: 'POST', body: { assetId: ASSET, state: 'clean' } });
      const changes = (await call(stub.port, `/api/v1/sync/changes?cursor=${String(first.json.cursor)}`, { headers: auth })).json.changes;
      assert.deepEqual(
        changes.map((/** @type {any} */ change) => [change.entity.version, change.entity.fileState]),
        [
          [1, 'pending'],
          [2, 'clean'],
        ],
      );
    } finally {
      await stub.close();
    }
  });
});
