import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { zGetClientConfigResponse, zSyncChangesResponse, zSyncMutationsResponse, zWorkOrderTemplateList } from '@evia/contracts/zod';
import { startStubApi } from '../src/stub-api.mjs';
import {
  changesAnswer,
  createSyncStub,
  DELETED_ORDER_ID,
  snapshotPage,
  SYNC_CLIENT_CONFIG,
  TEMPLATE_HOUSE_ID,
  TEMPLATE_LIST,
} from '../src/sync-stub.mjs';

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

  it('EVM-105 AC6: a note or comment for the deleted order is rejected with target_unavailable (valid against the contract), counted apart and rejected again on a repeat', () => {
    const stub = createSyncStub();
    /** @param {string} mutationId @param {string} type @param {string} workOrderId */
    const one = (mutationId, type, workOrderId) => ({
      mutations: [{ mutationId, type, commandVersion: 1, payload: { workOrderId } }],
      pendingItems: 1,
    });
    const first = post(stub, one(A, 'CreateNote', DELETED_ORDER_ID));
    assert.equal(zSyncMutationsResponse.safeParse(first?.body).success, true);
    const firstBody = /** @type {{ results: unknown[] }} */ (first?.body);
    assert.deepEqual(firstBody.results, [{ mutationId: A, outcome: 'rejected', code: 'target_unavailable' }]);
    const comment = /** @type {{ results: { outcome: string, code?: string }[] }} */ (
      post(stub, one(B, 'CreateComment', DELETED_ORDER_ID))?.body
    );
    assert.deepEqual(
      comment.results.map((r) => [r.outcome, r.code]),
      [['rejected', 'target_unavailable']],
    );
    // a repeat is the same answer, never a duplicate and never a second acceptance
    const again = /** @type {{ results: { outcome: string }[] }} */ (post(stub, one(A, 'CreateNote', DELETED_ORDER_ID))?.body);
    assert.deepEqual(
      again.results.map((r) => r.outcome),
      ['rejected'],
    );
    assert.deepEqual(stub.report(), { unique: 0, duplicates: 0, rejected: 2, received: 3, requests: 3, lastPendingItems: 1 });
    // another order and a quick work order are accepted as before
    const other = /** @type {{ results: { outcome: string }[] }} */ (
      post(stub, one('0194c2a0-0000-7000-8000-000000000003', 'CreateNote', '30000000-0000-4000-8000-000000000001'))?.body
    );
    assert.deepEqual(
      other.results.map((r) => r.outcome),
      ['applied'],
    );
    assert.equal(stub.report().unique, 1);
    stub.reset();
    assert.equal(stub.report().rejected, 0);
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
    assert.deepEqual(stub.report(), { unique: 2, duplicates: 2, rejected: 0, received: 4, requests: 2, lastPendingItems: 2 });
    stub.reset();
    assert.deepEqual(stub.report(), { unique: 0, duplicates: 0, rejected: 0, received: 0, requests: 0, lastPendingItems: null });
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
      assert.deepEqual(stub.syncReport(), { unique: 2, duplicates: 2, rejected: 0, received: 4, requests: 5, lastPendingItems: 2 });
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

describe('templates and quick work orders of the scenario server (EVM-106)', () => {
  const WO = '0194c2a0-0000-7000-8000-0000000000c1';
  const CUSTOMER = '0194c2a0-0000-7000-8000-0000000000c2';
  const SITE = '0194c2a0-0000-7000-8000-0000000000c3';
  /** @param {string} mutationId @param {string} [workOrderId] */
  const quick = (mutationId, workOrderId = WO) => ({
    mutations: [
      {
        mutationId,
        type: 'CreateQuickWorkOrder',
        commandVersion: 1,
        payload: {
          workOrderId,
          templateId: TEMPLATE_HOUSE_ID,
          title: 'Dom — sam montaż',
          newCustomer: { id: CUSTOMER, kind: 'person', displayName: 'Anna Fikcyjna', phone: '600000009' },
          newSite: {
            id: SITE,
            siteType: 'single_family_house',
            street: 'Testowa',
            buildingNumber: '5',
            postalCode: '05-500',
            city: 'Piaseczno',
          },
        },
      },
    ],
    pendingItems: 1,
  });
  /** @param {{ status: number, type: string, body: unknown } | null} answer @returns {{ status: number, type: string, body: unknown }} */
  const present = (answer) => {
    assert.ok(answer !== null);
    return answer;
  };
  const templates = (/** @type {ReturnType<typeof createSyncStub>} */ stub) =>
    present(stub.handle('GET', '/api/v1/catalog/work-order-templates', none, null, true));
  /** @param {ReturnType<typeof createSyncStub>} stub @param {unknown} body */
  const send = (stub, body) => present(post(stub, body));
  /** @param {ReturnType<typeof createSyncStub>} stub @param {string} cursor */
  const changesPage = (stub, cursor) =>
    present(stub.handle('GET', '/api/v1/sync/changes', new URLSearchParams(`cursor=${cursor}`), null, true));
  const A1 = '0194c2a0-0000-7000-8000-0000000000a1';

  it('EVM-106 AC1: the list of templates is valid against the contract (the one the phone validates), has a template for the garage and needs the bearer token', () => {
    const stub = createSyncStub();
    const answer = templates(stub);
    assert.equal(answer.status, 200);
    assert.equal(zWorkOrderTemplateList.safeParse(answer.body).success, true);
    assert.deepEqual(
      TEMPLATE_LIST.items.map((template) => template.siteTypeHint),
      ['single_family_house', 'multi_family_garage'],
    );
    assert.equal(stub.handle('GET', '/api/v1/catalog/work-order-templates', none, null, false)?.status, 401);
    assert.doesNotMatch(JSON.stringify(TEMPLATE_LIST), /@|https?:/);
  });

  it('EVM-106 AC1: the mode "none" gives an empty catalogue (valid) and "channel_not_allowed" gives 403 with that code', () => {
    const stub = createSyncStub();
    stub.setModes({ templates: 'none' });
    const empty = templates(stub);
    assert.equal(zWorkOrderTemplateList.safeParse(empty.body).success, true);
    assert.deepEqual(empty.body, { items: [], nextCursor: null });
    stub.setModes({ templates: 'channel_not_allowed' });
    const refused = templates(stub);
    assert.equal(refused.status, 403);
    assert.equal(/** @type {{ code: string }} */ (refused.body).code, 'channel_not_allowed');
    stub.setModes({ templates: 'ok' });
    assert.equal(templates(stub).status, 200);
  });

  it('EVM-106 AC4: an accepted quick order is applied once and its number arrives with the next changes page (valid against the contract); a replay is a duplicate', () => {
    const stub = createSyncStub();
    const first = /** @type {{ results: { outcome: string }[] }} */ (send(stub, quick(A1)).body);
    assert.deepEqual(
      first.results.map((r) => r.outcome),
      ['applied'],
    );
    const page = changesPage(stub, 'e2e-cursor-after-snapshot-0001');
    assert.equal(zSyncChangesResponse.safeParse(page.body).success, true);
    const changes = /** @type {{ changes: { entity: Record<string, unknown> }[] }} */ (page.body).changes.map((change) => change.entity);
    assert.deepEqual(
      changes.map((entity) => entity['type']),
      ['customer', 'site', 'work_order'],
    );
    const order = changes[2] ?? {};
    assert.equal(order['id'], WO);
    assert.equal(order['number'], 'ZL-E2E-3');
    assert.equal(order['customerId'], CUSTOMER);
    assert.equal(order['siteId'], SITE);
    // the next page has nothing new; the order is delivered once
    const next = /** @type {{ changes: unknown[] }} */ (changesPage(stub, 'e2e-cursor-changes-000000001').body);
    assert.deepEqual(next.changes, []);
    // a replay of the same mutation is a duplicate, it does not create a second order
    const again = /** @type {{ results: { outcome: string }[] }} */ (send(stub, quick(A1)).body);
    assert.deepEqual(
      again.results.map((r) => r.outcome),
      ['duplicate'],
    );
    assert.deepEqual(stub.report(), { unique: 1, duplicates: 1, rejected: 0, received: 2, requests: 4, lastPendingItems: 1 });
    // an entry for the created order is accepted (it is not the deleted one)
    const note = {
      mutations: [
        { mutationId: '0194c2a0-0000-7000-8000-0000000000a2', type: 'CreateNote', commandVersion: 1, payload: { workOrderId: WO } },
      ],
      pendingItems: 1,
    };
    assert.deepEqual(
      /** @type {{ results: { outcome: string }[] }} */ (send(stub, note).body).results.map((r) => r.outcome),
      ['applied'],
    );
    // the second order of the scenario gets the next number
    send(stub, quick('0194c2a0-0000-7000-8000-0000000000a3', '0194c2a0-0000-7000-8000-0000000000d1'));
    const second = /** @type {{ changes: { entity: Record<string, unknown> }[] }} */ (
      changesPage(stub, 'e2e-cursor-changes-000000001').body
    );
    assert.equal(second.changes.at(-1)?.entity['number'], 'ZL-E2E-4');
  });

  it('EVM-106 AC5: in the mode "quota_exceeded" the order is rejected with that code on every repeat, counted as rejected, never created', () => {
    const stub = createSyncStub();
    stub.setModes({ quick: 'quota_exceeded' });
    for (let i = 0; i < 2; i += 1) {
      const answer = send(stub, quick(A1));
      assert.equal(zSyncMutationsResponse.safeParse(answer.body).success, true);
      assert.deepEqual(/** @type {{ results: unknown[] }} */ (answer.body).results, [
        { mutationId: A1, outcome: 'rejected', code: 'quota_exceeded' },
      ]);
    }
    assert.deepEqual(stub.report(), { unique: 0, duplicates: 0, rejected: 1, received: 2, requests: 2, lastPendingItems: 1 });
    const page = /** @type {{ changes: unknown[] }} */ (changesPage(stub, 'e2e-cursor-after-snapshot-0001').body);
    assert.deepEqual(page.changes, []);
    // the other types are not affected by the mode
    assert.equal(/** @type {{ results: { outcome: string }[] }} */ (send(stub, mutations(B)).body).results[0]?.outcome, 'applied');
    // reset forgets what the server created and rejected
    stub.reset();
    assert.equal(stub.report().rejected, 0);
  });

  it('EVM-106 AC1: over HTTP the catalogue is a sync path (the bearer token is needed) and the modes are set on the stub', async () => {
    const stub = await startStubApi();
    /** @param {string} path @param {RequestInit} [init] */
    const call = (path, init) => fetch(`http://127.0.0.1:${String(stub.port)}${path}`, init);
    const headers = { Authorization: 'Bearer e2e-access-1-------------------------------' };
    try {
      assert.equal((await call('/api/v1/catalog/work-order-templates')).status, 401);
      assert.equal((await call('/api/v1/catalog/work-order-templates', { headers })).status, 200);
      stub.setSyncModes({ templates: 'channel_not_allowed' });
      assert.equal((await call('/api/v1/catalog/work-order-templates', { headers })).status, 403);
    } finally {
      await stub.close();
    }
  });
});
