import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { zGetClientConfigResponse, zSyncChangesResponse, zSyncMutationsResponse } from '@evia/contracts/zod';
import { startStubApi } from '../src/stub-api.mjs';
import { changesAnswer, createSyncStub, snapshotPage, SYNC_CLIENT_CONFIG } from '../src/sync-stub.mjs';

const A = '0194c2a0-0000-7000-8000-000000000001';
const B = '0194c2a0-0000-7000-8000-000000000002';
const none = new URLSearchParams();
/** @param {...string} ids */
const mutations = (...ids) => ({
  mutations: ids.map((mutationId) => ({ mutationId, type: 'CreateNote', commandVersion: 1, payload: { x: 1 } })),
  pendingItems: ids.length,
});
/**
 * @param {ReturnType<typeof createSyncStub>} stub
 * @param {unknown} body
 * @param {boolean} [authorized]
 */
const post = (stub, body, authorized = true) => stub.handle('POST', '/api/v1/sync/mutations', none, body, authorized);

describe('sync part of the scenario server (EVM-107 AC6)', () => {
  it('EVM-107 AC6: every answer is valid against the zod schemas of the contract (changes, client config, mutations)', () => {
    const stub = createSyncStub();
    assert.equal(zSyncChangesResponse.safeParse(snapshotPage()).success, true);
    assert.equal(zSyncChangesResponse.safeParse(changesAnswer('e2e-cursor-after-snapshot-0001')).success, true);
    assert.equal(zGetClientConfigResponse.safeParse(SYNC_CLIENT_CONFIG).success, true);
    assert.equal(zSyncChangesResponse.safeParse(stub.handle('GET', '/api/v1/sync/changes', none, null, true)?.body).success, true);
    assert.equal(zSyncMutationsResponse.safeParse(post(stub, mutations(A, B))?.body).success, true);
  });

  it('EVM-104 AC1: the snapshot carries the details of the work order 1 (scope, stages, journal) in invented text only', () => {
    /** @type {Record<string, unknown>[]} */
    const changes = snapshotPage().changes.map((change) => change.entity);
    /** @param {string} type */
    const types = (type) => changes.filter((entity) => entity.type === type);
    assert.equal(types('scope_item').length, 1);
    assert.equal(types('procedure_stage').length, 2);
    assert.equal(types('timeline_entry').length, 2);
    for (const entity of [...types('scope_item'), ...types('procedure_stage'), ...types('timeline_entry')]) {
      assert.equal(entity.workOrderId, '30000000-0000-4000-8000-000000000001');
    }
    assert.doesNotMatch(JSON.stringify(changes), /@|https?:/);
  });

  it('EVM-107 AC6: the first appearance of a mutation is "applied"; a repeat is "duplicate" (the saved result), counted separately', () => {
    const stub = createSyncStub();
    const first = /** @type {{ results: { outcome: string }[] }} */ (post(stub, mutations(A, B))?.body);
    assert.deepEqual(
      first.results.map((r) => r.outcome),
      ['applied', 'applied'],
    );
    const again = /** @type {{ results: { outcome: string }[] }} */ (post(stub, mutations(B, A))?.body);
    assert.deepEqual(
      again.results.map((r) => r.outcome),
      ['duplicate', 'duplicate'],
    );
    assert.deepEqual(stub.report(), { unique: 2, duplicates: 2, received: 4, requests: 2, lastPendingItems: 2 });
    stub.reset();
    assert.deepEqual(stub.report(), { unique: 0, duplicates: 0, received: 0, requests: 0, lastPendingItems: null });
  });

  it('EVM-107 AC6: invalid batches are refused with the contract problem and change nothing', () => {
    const stub = createSyncStub();
    for (const body of [
      null,
      {},
      { mutations: [], pendingItems: 0 },
      { mutations: [{ mutationId: 'not-a-uuid', type: 'CreateNote' }], pendingItems: 1 },
      { mutations: [{ mutationId: A, type: 'DeleteEverything' }], pendingItems: 1 },
      { mutations: [{ mutationId: A, type: 'CreateNote' }], pendingItems: -1 },
      { mutations: [{ mutationId: A, type: 'CreateNote' }], pendingItems: 1.5 },
      { mutations: Array.from({ length: 51 }, () => ({ mutationId: A, type: 'CreateNote' })), pendingItems: 51 },
      { mutations: [null], pendingItems: 1 },
    ]) {
      const answer = post(stub, body);
      assert.equal(answer?.status, 400);
      const refused = /** @type {{ code: string }} */ (/** @type {unknown} */ (answer.body));
      assert.equal(refused.code, 'validation_failed');
    }
    assert.equal(stub.report().unique, 0);
  });

  it('EVM-107 AC6: without a bearer token every sync call is 401; an unknown path is not a sync path; a work order is 404', () => {
    const stub = createSyncStub();
    assert.equal(post(stub, mutations(A), false)?.status, 401);
    assert.equal(stub.handle('GET', '/api/v1/sync/changes', none, null, false)?.status, 401);
    assert.equal(stub.handle('GET', '/api/v1/meta/client-config', none, null, false)?.status, 401);
    assert.equal(stub.handle('GET', '/api/v1/other', none, null, true), null);
    assert.equal(stub.handle('GET', `/api/v1/sync/work-orders/${A}`, none, null, true)?.status, 404);
    assert.equal(stub.report().unique, 0);
  });

  it('EVM-107 AC6: the changes follow the cursor (snapshot first, then an empty changes page) and the pending count of the request is recorded', () => {
    const stub = createSyncStub();
    const first = /** @type {{ phase: string }} */ (
      stub.handle('GET', '/api/v1/sync/changes', new URLSearchParams('limit=200&pendingItems=3'), null, true)?.body
    );
    assert.equal(first.phase, 'snapshot');
    assert.equal(stub.report().lastPendingItems, 3);
    const next = /** @type {{ phase: string, changes: unknown[] }} */ (
      stub.handle('GET', '/api/v1/sync/changes', new URLSearchParams('cursor=e2e-cursor-after-snapshot-0001'), null, true)?.body
    );
    assert.equal(next.phase, 'changes');
    assert.deepEqual(next.changes, []);
  });

  it('EVM-107 AC6: over HTTP the server listens on the loopback, needs the bearer token of the sign-in and counts the batches; a server that is down answers 503', async () => {
    const stub = await startStubApi();
    /** @param {string} path @param {RequestInit} [init] */
    const call = (path, init) => fetch(`http://127.0.0.1:${String(stub.port)}${path}`, init);
    try {
      const unauthorized = await call('/api/v1/meta/client-config');
      assert.equal(unauthorized.status, 401);
      const headers = { Authorization: 'Bearer e2e-access-1-------------------------------', 'Content-Type': 'application/json' };
      assert.equal((await call('/api/v1/meta/client-config', { headers })).status, 200);
      const body = JSON.stringify(mutations(A, B));
      assert.equal((await call('/api/v1/sync/mutations', { method: 'POST', headers, body })).status, 200);
      assert.equal((await call('/api/v1/sync/mutations', { method: 'POST', headers, body })).status, 200);
      assert.equal((await call('/api/v1/sync/mutations', { method: 'POST', headers, body: '{bad' })).status, 400);
      assert.deepEqual(stub.syncReport(), { unique: 2, duplicates: 2, received: 4, requests: 5, lastPendingItems: 2 });
      stub.syncReset();
      assert.equal(stub.syncReport().unique, 0);
      stub.setMode('down');
      assert.equal((await call('/api/v1/sync/changes', { headers })).status, 503);
      stub.setMode('ok');
      const big = JSON.stringify({ mutations: [{ mutationId: A, type: 'CreateNote', payload: 'x'.repeat(1_100_000) }], pendingItems: 1 });
      assert.equal((await call('/api/v1/sync/mutations', { method: 'POST', headers, body: big })).status, 413);
    } finally {
      await stub.close();
    }
  });
});
