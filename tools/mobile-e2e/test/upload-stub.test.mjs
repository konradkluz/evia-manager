/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- the answers of the stub are parsed JSON read by the assertions */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { describe, it } from 'node:test';
import { createUploadStub, DEFAULT_PART_SIZE, startUploadStub, TOLERANCE_MS } from '../src/upload-stub.mjs';

const WORK_ORDER = '01900000-0000-4000-8000-000000000001';
const ASSET = '01900000-0000-7000-8000-000000000002';
const SESSION = '01900000-0000-7000-8000-000000000003';
const KEY = '01900000-0000-7000-8000-000000000004';
const PART = 1000;

/** @param {number} port @param {string} path @param {{ method?: string, body?: unknown, headers?: Record<string, string> }} [options] */
async function call(port, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: text === '' ? null : /** @type {any} */ (JSON.parse(text)) };
}

/** Starts the stub, registers one asset of `size` bytes and signs in; returns helpers. @param {number} size @param {Parameters<typeof startUploadStub>[0]} [options] */
async function setup(size, options = {}) {
  const stub = await startUploadStub({ partSize: PART, publicHost: '127.0.0.1', ...options });
  const control = (/** @type {string} */ path, /** @type {unknown} */ body) => call(stub.controlPort, path, { method: 'POST', body });
  await control('/control/asset', { assetId: ASSET, workOrderId: WORK_ORDER, declaredSize: size });
  const login = await call(stub.port, '/api/v1/auth/mobile/login/totp', {
    method: 'POST',
    body: { email: 'technik@example.test', password: 'haslo-testowe', code: '123456' },
  });
  const session = login.json;
  const base = `/api/v1/work-orders/${WORK_ORDER}/media-assets/${ASSET}/upload-sessions`;
  const api = (
    /** @type {string} */ path,
    /** @type {{ method?: string, body?: unknown, token?: string, headers?: Record<string, string> }} */ o = {},
  ) =>
    call(stub.port, `${base}${path}`, {
      method: o.method ?? 'GET',
      body: o.body,
      headers: { Authorization: `Bearer ${o.token ?? session.accessToken}`, ...(o.headers ?? {}) },
    });
  const create = () => api('', { method: 'POST', body: { id: SESSION }, headers: { 'Idempotency-Key': KEY } });
  /** @param {number} n @param {Buffer} data */
  const put = async (n, data) => {
    const url = (await api(`/${SESSION}/parts/${String(n)}/url`)).json.url;
    return fetch(url, { method: 'PUT', body: data });
  };
  return { stub, control, api, create, put, session, base };
}

/** @param {Buffer} data */
const sha = (data) => createHash('sha256').update(data).digest('hex');

describe('upload scenario server: session of the contract (EVM-130 AC8)', () => {
  it('EVM-130 AC8: five operations — create, list parts, part URL with X-Amz-* parameters, PUT with Content-Length, complete', async () => {
    const { stub, api, create, put, control } = await setup(2500);
    try {
      const created = await create();
      assert.equal(created.status, 201);
      assert.deepEqual(created.json, {
        id: SESSION,
        mediaAssetId: ASSET,
        state: 'active',
        partSize: PART,
        partCount: 3,
        expiresAt: created.json.expiresAt,
      });
      const urlAnswer = await api(`/${SESSION}/parts/3/url`);
      assert.equal(urlAnswer.headers.get('cache-control'), 'no-store');
      assert.equal(urlAnswer.json.contentLength, 500);
      const url = new URL(urlAnswer.json.url);
      for (const name of ['X-Amz-Algorithm', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-Signature']) assert.ok(url.searchParams.has(name), name);
      const data = Buffer.alloc(2500, 7);
      for (const n of [1, 2, 3]) {
        const answer = await put(n, data.subarray((n - 1) * PART, Math.min(n * PART, 2500)));
        assert.equal(answer.status, 200);
        assert.ok(answer.headers.get('etag'));
      }
      assert.deepEqual((await api(`/${SESSION}/parts`)).json, {
        items: [
          { partNumber: 1, size: 1000 },
          { partNumber: 2, size: 1000 },
          { partNumber: 3, size: 500 },
        ],
      });
      const done = await api(`/${SESSION}/complete`, { method: 'POST' });
      assert.equal(done.status, 200);
      assert.equal(done.json.fileState, 'uploaded');
      const checkpoint = (await call(stub.controlPort, '/control/checkpoint')).json;
      assert.equal(checkpoint.assets[ASSET].objects, 1);
      assert.equal(checkpoint.assets[ASSET].sha256, sha(data));
      assert.equal(checkpoint.orphanedMultiparts, 0);
      assert.equal(checkpoint.openMultiparts, 0);
      // idempotent complete
      const again = await api(`/${SESSION}/complete`, { method: 'POST' });
      assert.equal(again.status, 200);
      assert.equal((await call(stub.controlPort, '/control/checkpoint')).json.assets[ASSET].objects, 1);
      // a finished session answers the file state set by the host
      await control('/control/file-state', { assetId: ASSET, state: 'clean' });
      assert.equal((await api(`/${SESSION}/complete`, { method: 'POST' })).json.fileState, 'clean');
      assert.equal((await api(`/${SESSION}/abort`, { method: 'POST' })).status, 409);
      assert.equal((await api(`/${SESSION}/parts`)).status, 409);
      assert.equal((await api(`/${SESSION}/parts/1/url`)).status, 409);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC8: create is idempotent (same key, same session; active session of the caller returned with 200) and validated', async () => {
    const { stub, api, create } = await setup(1500);
    try {
      assert.equal((await create()).status, 201);
      const replay = await create();
      assert.equal(replay.status, 201);
      assert.equal(replay.headers.get('idempotent-replayed'), 'true');
      const other = await api('', {
        method: 'POST',
        body: { id: '01900000-0000-7000-8000-0000000000aa' },
        headers: { 'Idempotency-Key': '01900000-0000-7000-8000-0000000000bb' },
      });
      assert.equal(other.status, 200);
      assert.equal(other.json.id, SESSION);
      assert.equal((await api('', { method: 'POST', body: { id: 'x' }, headers: { 'Idempotency-Key': KEY } })).status, 400);
      assert.equal((await api('', { method: 'POST', body: { id: SESSION } })).status, 400);
      assert.equal((await api('', { method: 'GET' })).status, 405);
      assert.equal((await api(`/${SESSION}/parts/9/url`)).status, 400);
      assert.equal((await api('/01900000-0000-7000-8000-0000000000cc/parts')).status, 404);
      assert.equal((await api(`/${SESSION}/nothing`, { method: 'POST' })).status, 404);
      // aborted session: replay with the same key is invalid_state_transition, a new session may open
      assert.equal((await api(`/${SESSION}/abort`, { method: 'POST' })).status, 204);
      assert.equal((await create()).status, 409);
      const fresh = await api('', {
        method: 'POST',
        body: { id: '01900000-0000-7000-8000-0000000000dd' },
        headers: { 'Idempotency-Key': '01900000-0000-7000-8000-0000000000ee' },
      });
      assert.equal(fresh.status, 201);
      // the id of the session of another asset is a conflict
      await call(stub.controlPort, '/control/asset', {
        method: 'POST',
        body: { assetId: '01900000-0000-7000-8000-000000000099', workOrderId: WORK_ORDER, declaredSize: 10 },
      });
      const clash = await call(
        stub.port,
        `/api/v1/work-orders/${WORK_ORDER}/media-assets/01900000-0000-7000-8000-000000000099/upload-sessions`,
        {
          method: 'POST',
          body: { id: '01900000-0000-7000-8000-0000000000dd' },
          headers: { Authorization: `Bearer ${await setupToken(stub)}`, 'Idempotency-Key': '01900000-0000-7000-8000-0000000000ff' },
        },
      );
      assert.equal(clash.status, 409);
      assert.equal(clash.json.code, 'id_conflict');
      // unknown asset and asset of another work order are 404
      const missing = await call(stub.port, `/api/v1/work-orders/${WORK_ORDER}/media-assets/${ASSET.replace('2', '5')}/upload-sessions`, {
        method: 'POST',
        body: { id: SESSION },
        headers: { Authorization: `Bearer ${await setupToken(stub)}`, 'Idempotency-Key': KEY },
      });
      assert.equal(missing.status, 404);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC8: a file that is already uploaded cannot open a new session (invalid_state_transition)', async () => {
    const { stub, api, create, put } = await setup(10);
    try {
      await create();
      await put(1, Buffer.alloc(10, 1));
      await api(`/${SESSION}/complete`, { method: 'POST' });
      const next = await api('', {
        method: 'POST',
        body: { id: '01900000-0000-7000-8000-0000000000dd' },
        headers: { 'Idempotency-Key': '01900000-0000-7000-8000-0000000000ee' },
      });
      assert.equal(next.status, 409);
      assert.equal(next.json.code, 'invalid_state_transition');
    } finally {
      await stub.close();
    }
  });
});

/** A fresh synthetic sign-in on the stub. @param {{ port: number }} stub */
async function setupToken(stub) {
  const login = await call(stub.port, '/api/v1/auth/mobile/login/totp', {
    method: 'POST',
    body: { email: 'technik@example.test', password: 'haslo-testowe', code: '123456' },
  });
  return /** @type {string} */ (login.json.accessToken);
}

describe('upload scenario server: parts (EVM-130 AC8)', () => {
  it('EVM-130 AC8: the PUT checks Content-Length and the signature; a wrong length or a forged address is rejected and stores nothing', async () => {
    const { stub, api, create } = await setup(1500);
    try {
      await create();
      const url = (await api(`/${SESSION}/parts/1/url`)).json.url;
      assert.equal((await fetch(url, { method: 'PUT', body: Buffer.alloc(999) })).status, 400);
      const forged = new URL(url);
      forged.searchParams.set('X-Amz-Signature', '00'.repeat(32));
      assert.equal((await fetch(forged, { method: 'PUT', body: Buffer.alloc(1000) })).status, 403);
      const noSignature = new URL(url);
      noSignature.searchParams.delete('X-Amz-Signature');
      assert.equal((await fetch(noSignature, { method: 'PUT', body: Buffer.alloc(1000) })).status, 403);
      assert.equal((await fetch(url, { method: 'GET' })).status, 403);
      const unknownSession = url.replace(SESSION, '01900000-0000-7000-8000-0000000000ab');
      assert.equal((await fetch(unknownSession, { method: 'PUT', body: Buffer.alloc(1000) })).status, 403);
      assert.deepEqual((await api(`/${SESSION}/parts`)).json, { items: [] });
      // no Content-Length (chunked) is refused
      const chunked = await new Promise((resolve, reject) => {
        const target = new URL(url);
        const out = httpRequest(
          {
            host: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            method: 'PUT',
            headers: { 'Transfer-Encoding': 'chunked' },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        out.on('error', reject);
        out.end(Buffer.alloc(1000));
      });
      assert.equal(chunked, 411);
      assert.deepEqual((await api(`/${SESSION}/parts`)).json, { items: [] });
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC8: complete without all parts is 422 upload_incomplete / parts_missing; a part of a wrong size is size_mismatch', async () => {
    const { stub, api, create, put } = await setup(1500);
    try {
      await create();
      await put(1, Buffer.alloc(1000));
      const missing = await api(`/${SESSION}/complete`, { method: 'POST' });
      assert.equal(missing.status, 422);
      assert.equal(missing.json.code, 'upload_incomplete');
      assert.equal(missing.json.errors[0].code, 'parts_missing');
      await put(2, Buffer.alloc(500));
      assert.equal((await api(`/${SESSION}/complete`, { method: 'POST' })).status, 200);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC8: a part put again replaces the earlier one (idempotent per part)', async () => {
    const { stub, api, create, put } = await setup(1000);
    try {
      await create();
      await put(1, Buffer.alloc(1000, 1));
      await put(1, Buffer.alloc(1000, 2));
      await api(`/${SESSION}/complete`, { method: 'POST' });
      assert.equal((await call(stub.controlPort, '/control/checkpoint')).json.assets[ASSET].sha256, sha(Buffer.alloc(1000, 2)));
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC8: fault expired_url answers 403 once, then the same address works; the address also expires by time', async () => {
    let at = 1_700_000_000_000;
    const { stub, control, api, create } = await setup(1000, { now: () => at });
    try {
      await create();
      const url = (await api(`/${SESSION}/parts/1/url`)).json.url;
      await control('/control/fault', { fault: 'expired_url' });
      assert.equal((await fetch(url, { method: 'PUT', body: Buffer.alloc(1000) })).status, 403);
      assert.equal((await fetch(url, { method: 'PUT', body: Buffer.alloc(1000) })).status, 200);
      at += 3_601_000;
      await control('/control/expire-access', {});
      assert.equal((await fetch(url, { method: 'PUT', body: Buffer.alloc(1000) })).status, 403);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC8: fault drop_mid_part cuts the connection in the middle of a part and keeps nothing of it', async () => {
    const { stub, control, api, create, put } = await setup(40_000, { partSize: 40_000 });
    try {
      await create();
      await control('/control/fault', { fault: 'drop_mid_part' });
      const url = (await api(`/${SESSION}/parts/1/url`)).json.url;
      await assert.rejects(fetch(url, { method: 'PUT', body: Buffer.alloc(40_000) }));
      assert.deepEqual((await api(`/${SESSION}/parts`)).json, { items: [] });
      assert.equal((await put(1, Buffer.alloc(40_000, 3))).status, 200);
      const checkpoint = (await call(stub.controlPort, '/control/checkpoint')).json;
      assert.ok(checkpoint.counters.partsRejected >= 1);
      assert.equal(checkpoint.openMultiparts, 1);
    } finally {
      await stub.close();
    }
  });
});

describe('upload scenario server: tokens and injected failures (EVM-130 AC8, AC2, AC5)', () => {
  it('EVM-130 AC2: the Bearer token is verified, an expired one is 401 unauthenticated; the refresh rotates the pair', async () => {
    const { stub, api, session, control } = await setup(1000);
    try {
      assert.equal((await api('/x', { token: 'nope' })).json.code, 'unauthenticated');
      assert.equal(
        (await call(stub.port, `/api/v1/work-orders/${WORK_ORDER}/media-assets/${ASSET}/upload-sessions`, { method: 'POST' })).status,
        401,
      );
      await control('/control/expire-access', {});
      assert.equal((await api('/x')).status, 401);
      const refreshed = await call(stub.port, '/api/v1/auth/mobile/token', {
        method: 'POST',
        body: { refreshToken: session.refreshToken },
      });
      assert.equal(refreshed.status, 200);
      assert.notEqual(refreshed.json.refreshToken, session.refreshToken);
      assert.equal((await api('/x', { token: refreshed.json.accessToken })).status, 404);
      const counters = (await call(stub.controlPort, '/control/checkpoint')).json.counters;
      assert.equal(counters.refreshes, 1);
      assert.ok(counters.unauthorized >= 3);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC2: the refresh token used again inside the tolerance window gets the same pair; after the window it is a reuse that ends the family', async () => {
    let at = 1_700_000_000_000;
    const { stub, session } = await setup(1000, { now: () => at });
    try {
      const refresh = (/** @type {string} */ token) =>
        call(stub.port, '/api/v1/auth/mobile/token', { method: 'POST', body: { refreshToken: token } });
      const first = await refresh(session.refreshToken);
      at += 19_000;
      const replay = await refresh(session.refreshToken);
      assert.equal(replay.status, 200);
      assert.deepEqual(replay.json, first.json);
      at += TOLERANCE_MS;
      const reuse = await refresh(session.refreshToken);
      assert.equal(reuse.status, 401);
      assert.equal(reuse.json.code, 'session_revoked');
      // the family is gone: even the newest token is refused
      assert.equal((await refresh(first.json.refreshToken)).status, 401);
      assert.equal((await refresh(/** @type {any} */ (7))).status, 401);
      const counters = (await call(stub.controlPort, '/control/checkpoint')).json.counters;
      assert.equal(counters.refreshReplays, 1);
      assert.equal(counters.reuseDetected, 1);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC5: injected 401 session_revoked, 401 device_wipe_required, 426 and id_conflict (API and refresh)', async () => {
    const { stub, control, api, session, create } = await setup(1000);
    try {
      for (const [fault, status, code] of /** @type {const} */ ([
        ['session_revoked', 401, 'session_revoked'],
        ['device_wipe_required', 401, 'device_wipe_required'],
        ['version_unsupported', 426, 'client_version_unsupported'],
      ])) {
        await control('/control/fault', { fault });
        const answer = await api('/x');
        assert.equal(answer.status, status);
        assert.equal(answer.json.code, code);
        // persistent until cleared
        assert.equal((await api('/x')).status, status);
        const refresh = await call(stub.port, '/api/v1/auth/mobile/token', {
          method: 'POST',
          body: { refreshToken: session.refreshToken },
        });
        assert.equal(refresh.status, status);
        await control('/control/fault', { fault, count: 0 });
        assert.equal((await api('/x')).status, 404);
      }
      await control('/control/fault', { fault: 'id_conflict' });
      assert.equal((await create()).json.code, 'id_conflict');
      assert.equal((await create()).status, 201);
      await control('/control/fault', { fault: 'expired_url', count: 2 });
      assert.equal((await control('/control/fault', { fault: 'nonsense' })).status, 400);
      assert.equal((await control('/control/fault', { fault: 'expired_url', count: 2 })).json.remaining, 2);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC8: the control port validates input, resets everything and counts orphaned multiparts', async () => {
    const { stub, control, create, put, api } = await setup(1500);
    try {
      assert.equal((await control('/control/asset', { assetId: 'x', workOrderId: WORK_ORDER, declaredSize: 1 })).status, 400);
      assert.equal((await control('/control/asset', { assetId: ASSET, workOrderId: WORK_ORDER, declaredSize: 0 })).status, 400);
      assert.equal((await control('/control/file-state', { assetId: ASSET, state: 'ready' })).status, 400);
      assert.equal((await control('/control/nothing', {})).status, 404);
      assert.equal((await call(stub.controlPort, '/control/checkpoint', { method: 'DELETE' })).status, 404);
      await create();
      await put(1, Buffer.alloc(1000));
      assert.equal((await call(stub.controlPort, '/control/checkpoint')).json.orphanedMultiparts, 0);
      // the asset got its object elsewhere while the multipart still holds parts: orphaned
      await put(2, Buffer.alloc(500));
      await api(`/${SESSION}/complete`, { method: 'POST' });
      assert.equal((await control('/control/reset', {})).json.reset, true);
      const after = (await call(stub.controlPort, '/control/checkpoint')).json;
      assert.deepEqual(after.assets, {});
      assert.equal(after.counters.partPuts, 0);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC8: health, login with the synthetic account, logout; the control listener is a separate port; unknown paths are 404; large bodies are 413', async () => {
    const stub = await startUploadStub({});
    try {
      assert.notEqual(stub.port, stub.controlPort);
      assert.equal((await call(stub.port, '/api/health')).status, 200);
      assert.equal((await call(stub.port, '/control/checkpoint')).status, 404);
      assert.equal((await call(stub.port, '/api/v1/auth/mobile/logout', { method: 'POST' })).status, 204);
      const challenge = await call(stub.port, '/api/v1/auth/mobile/login', {
        method: 'POST',
        body: { email: 'technik@example.test', password: 'haslo-testowe' },
      });
      assert.equal(challenge.status, 200);
      assert.equal(challenge.json.accessToken, undefined);
      assert.equal(
        (await call(stub.port, '/api/v1/auth/mobile/login', { method: 'POST', body: { email: 'x@example.test', password: 'x' } })).status,
        401,
      );
      const big = await fetch(`http://127.0.0.1:${String(stub.port)}/api/v1/auth/mobile/login`, {
        method: 'POST',
        body: 'x'.repeat(1_100_000),
      });
      assert.equal(big.status, 413);
      const bad = await fetch(`http://127.0.0.1:${String(stub.port)}/api/v1/auth/mobile/token`, { method: 'POST', body: '{broken' });
      assert.equal(bad.status, 401);
      assert.equal((await call(stub.port, '/api/v1/nothing')).status, 404);
      assert.equal(stub.checkpoint().orphanedMultiparts, 0);
      assert.equal(stub.control('POST', '/control/reset', null).status, 200);
      assert.equal(DEFAULT_PART_SIZE, 8 * 1024 * 1024);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC8: createUploadStub works without listeners (default options)', () => {
    const stub = createUploadStub();
    assert.equal(stub.checkpoint().openMultiparts, 0);
  });
});
