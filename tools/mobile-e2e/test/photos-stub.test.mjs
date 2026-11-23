/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-confusing-void-expression, no-useless-assignment -- the answers of the servers are parsed JSON read by the assertions */
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { describe, it } from 'node:test';
import { zMediaDerivativeUrl, zSyncChangesResponse } from '@evia/contracts/zod';
import {
  CONTROL_SIGNATURE,
  IMAGES,
  PHOTO_ASSETS,
  PHOTO_ORDER_ID,
  READY_IDS,
  SIGNATURE_MARK,
  URL_TTL_S,
  createPhotosStub,
  photoReplicaChanges,
} from '../src/photos-stub.mjs';
import { snapshotPage } from '../src/sync-stub.mjs';
import { startStubApi } from '../src/stub-api.mjs';

const [FIRST, SECOND, THIRD, PROCESSING, QUARANTINED] = /** @type {[string, string, string, string, string]} */ (
  PHOTO_ASSETS.map((photo) => photo.id)
);
const OK = 'Bearer e2e-ok';

/** @param {{ now?: () => number }} [options] */
async function started(options = {}) {
  const stub = createPhotosStub({
    authorize: (header) => (header === OK ? null : { status: 401, type: 'application/problem+json', body: { code: 'unauthenticated' } }),
    ...options,
  });
  const server = createServer((req, res) => {
    if (stub.claims(req.method, new URL(req.url ?? '/', 'http://x').pathname)) stub.handleApp(req, res);
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  stub.setPort(port);
  /**
   * @param {string} method @param {string} path @param {{ headers?: Record<string, string>, body?: unknown, raw?: string }} [init]
   * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer, json: any }>}
   */
  const call = (method, path, { headers = {}, body, raw } = {}) =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on('data', (/** @type {Buffer} */ chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          /** @type {any} */
          let json = null;
          try {
            json = JSON.parse(buffer.toString('utf8'));
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buffer, json });
        });
      });
      req.on('error', reject);
      req.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
    });
  /** @param {string} asset @param {unknown} variant */
  const address = (asset, variant) =>
    call('POST', `/api/v1/work-orders/${PHOTO_ORDER_ID}/media-assets/${asset}/download-url`, {
      headers: { authorization: OK },
      body: { variant },
    });
  /** @param {string} url @param {Record<string, string>} [headers] */
  const fetchImage = (url, headers = { 'cache-control': 'no-store' }) => {
    const target = new URL(url);
    return call('GET', `${target.pathname}${target.search}`, { headers });
  };
  /** @param {string} path @param {unknown} [body] */
  const control = (path, body) => stub.control('POST', path, body);
  return {
    stub,
    port,
    call,
    address,
    fetchImage,
    control,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined)).closeAllConnections()),
  };
}

describe('the replica of the photos (EVM-142 AC2)', () => {
  it('EVM-142 AC2: five media_asset entities of the order - three ready, one processing, one quarantined - valid against the contract, newest first by time', () => {
    const page = snapshotPage(true);
    assert.equal(zSyncChangesResponse.safeParse(page).success, true);
    /** @type {any[]} */
    const media = page.changes.filter((change) => change.entity.type === 'media_asset');
    assert.equal(media.length, 5);
    assert.deepEqual(
      media.map((change) => change.entity.fileState),
      ['ready', 'ready', 'ready', 'processing', 'quarantined'],
    );
    assert.ok(media.every((change) => change.entity.workOrderId === PHOTO_ORDER_ID && change.entity.mediaType === 'photo'));
    const times = PHOTO_ASSETS.map((photo) => Date.parse(photo.capturedAt));
    assert.deepEqual(
      [...times].sort((a, b) => b - a),
      times,
    );
    assert.deepEqual(READY_IDS, [FIRST, SECOND, THIRD]);
    assert.equal(photoReplicaChanges().length, 5);
  });

  it('EVM-142 AC2: without the mode the snapshot carries no photo', () => {
    assert.equal(
      snapshotPage().changes.some((change) => change.entity.type === 'media_asset'),
      false,
    );
    assert.equal(
      snapshotPage(false).changes.some((change) => change.entity.type === 'media_asset'),
      false,
    );
  });

  it('EVM-142 AC5: the images are lossless WebP with the signature the proof searches for', () => {
    for (const image of Object.values(IMAGES)) {
      assert.equal(image.subarray(0, 4).toString('latin1'), 'RIFF');
      assert.equal(image.subarray(8, 15).toString('latin1'), 'WEBPVP8');
    }
    assert.equal(IMAGES.control.length, 48);
  });
});

describe('createMediaAssetDownloadUrl for the phone (EVM-142 AC1, AC3)', () => {
  it('EVM-142 AC3: a ready photo gets an address of the bucket valid for 300 s with the marker in the signature; the answer is valid against the contract', async () => {
    let clock = Date.parse('2026-11-23T10:00:00.000Z');
    const s = await started({ now: () => clock });
    const answer = await s.address(FIRST, 'thumbnail');
    assert.equal(answer.status, 200);
    assert.equal(answer.headers['cache-control'], 'no-store');
    assert.equal(zMediaDerivativeUrl.safeParse(answer.json).success, true);
    const target = new URL(answer.json.url);
    assert.equal(target.host, `10.0.2.2:${String(s.port)}`);
    assert.equal(target.pathname, `/bucket/photos/${FIRST}/thumbnail.webp`);
    assert.match(target.searchParams.get('X-Amz-Signature') ?? '', new RegExp(`^${SIGNATURE_MARK}\\d{6}$`));
    assert.equal(target.searchParams.get('X-Amz-Expires'), String(URL_TTL_S));
    assert.equal(answer.json.expiresAt, new Date(clock + URL_TTL_S * 1000).toISOString());
    clock += 1;
    const second = await s.address(FIRST, 'preview');
    assert.notEqual(new URL(second.json.url).searchParams.get('X-Amz-Signature'), target.searchParams.get('X-Amz-Signature'));
    await s.close();
  });

  it('EVM-142 AC1 AC2: the original is 403, a file that is not ready is 404 (the request is counted by asset), another order is 404, a bad variant or id is 400, no token is 401', async () => {
    const s = await started();
    assert.equal((await s.address(FIRST, 'original')).status, 403);
    assert.equal((await s.address(PROCESSING, 'thumbnail')).status, 404);
    assert.equal((await s.address(QUARANTINED, 'preview')).status, 404);
    assert.equal((await s.address(FIRST, 'huge')).status, 400);
    assert.equal((await s.address(FIRST, undefined)).status, 400);
    assert.equal(
      (
        await s.call('POST', `/api/v1/work-orders/${PHOTO_ORDER_ID}/media-assets/${FIRST}/download-url`, {
          headers: { authorization: OK },
          raw: '{not json',
        })
      ).status,
      400,
    );
    const other = await s.call('POST', `/api/v1/work-orders/30000000-0000-4000-8000-000000000002/media-assets/${FIRST}/download-url`, {
      headers: { authorization: OK },
      body: { variant: 'thumbnail' },
    });
    assert.equal(other.status, 404);
    const anonymous = await s.call('POST', `/api/v1/work-orders/${PHOTO_ORDER_ID}/media-assets/${FIRST}/download-url`, {
      body: { variant: 'thumbnail' },
    });
    assert.equal(anonymous.status, 401);
    const report = s.stub.report();
    assert.equal(report.urls.original, 1);
    assert.equal(report.urls.byAsset[PROCESSING], 1);
    assert.equal(report.urls.byAsset[QUARANTINED], 1);
    await s.close();
  });

  it('EVM-142 AC3: a body over the limit is 413 and a path that is no address request is 404', async () => {
    const s = await started();
    const big = await s.call('POST', `/api/v1/work-orders/${PHOTO_ORDER_ID}/media-assets/${FIRST}/download-url`, {
      headers: { authorization: OK },
      raw: JSON.stringify({ variant: 'thumbnail', pad: 'x'.repeat(5000) }),
    });
    assert.equal(big.status, 413);
    const server = createServer((req, res) => {
      s.stub.handleApp(req, res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    const status = await new Promise((resolve) => {
      request({ host: '127.0.0.1', port, method: 'POST', path: '/api/v1/other' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).end();
    });
    assert.equal(status, 404);
    server.closeAllConnections();
    server.close();
    const invalid = await s.call(
      'POST',
      '/api/v1/work-orders/not-a-uuid-not-a-uuid-not-a-uuid-1234/media-assets/also-not-a-uuid-also-not-a-uuid-12345/download-url',
      {
        headers: { authorization: OK },
        body: { variant: 'thumbnail' },
      },
    );
    assert.equal(invalid.status, 404);
    await s.close();
  });
});

describe('the bucket (EVM-142 AC3, AC5)', () => {
  it('EVM-142 AC5: the picture comes with `Cache-Control: private, max-age=300` (the worst case on purpose) and the headers of the request are counted: no-store, no token, no cookie, no cache-buster', async () => {
    const s = await started();
    const thumbnail = await s.fetchImage((await s.address(FIRST, 'thumbnail')).json.url);
    assert.equal(thumbnail.status, 200);
    assert.equal(thumbnail.headers['content-type'], 'image/webp');
    assert.equal(thumbnail.headers['cache-control'], 'private, max-age=300');
    assert.equal(thumbnail.headers['content-length'], String(IMAGES.thumbnail.length));
    assert.deepEqual(thumbnail.body, IMAGES.thumbnail);
    const preview = await s.fetchImage((await s.address(FIRST, 'preview')).json.url);
    assert.deepEqual(preview.body, IMAGES.preview);
    let images = s.stub.report().images;
    assert.deepEqual([images.thumbnail, images.preview, images.total, images.ok, images.noStore, images.notNoStore], [1, 1, 2, 2, 2, 0]);
    // a request that carries what it must not
    const url = (await s.address(SECOND, 'thumbnail')).json.url;
    await s.fetchImage(`${url}&_=1`, { authorization: OK, cookie: 'a=b' });
    images = s.stub.report().images;
    assert.deepEqual([images.notNoStore, images.authorization, images.cookie, images.cacheBust], [1, 1, 1, 1]);
    await s.close();
  });

  it('EVM-142 AC5: the control image answers its own signature, is counted apart and is NOT part of the header counters (it is fetched without no-store on purpose)', async () => {
    const s = await started();
    const control = await s.call('GET', `/bucket/control.webp?X-Amz-Signature=${CONTROL_SIGNATURE}&X-Amz-Expires=300`);
    assert.equal(control.status, 200);
    assert.deepEqual(control.body, IMAGES.control);
    assert.equal(control.headers['cache-control'], 'private, max-age=300');
    const images = s.stub.report().images;
    assert.deepEqual([images.control, images.total, images.notNoStore, images.noStore], [1, 1, 0, 0]);
    const wrong = await s.call('GET', '/bucket/control.webp?X-Amz-Signature=E2EMARK-OTHER');
    assert.equal(wrong.status, 403);
    await s.close();
  });

  it('EVM-142 AC3: an unknown address, another variant of a known one and an expired address are 403 (S3 says AccessDenied), unknown ones are counted', async () => {
    let clock = 1_000_000;
    const s = await started({ now: () => clock });
    const url = (await s.address(FIRST, 'thumbnail')).json.url;
    assert.equal((await s.fetchImage(url.replace('thumbnail', 'preview'))).status, 403);
    assert.equal((await s.fetchImage(url.replace(FIRST, SECOND))).status, 403);
    assert.equal((await s.fetchImage(url.replace(/X-Amz-Signature=[^&]+/, 'X-Amz-Signature=nothing'))).status, 403);
    assert.equal((await s.call('GET', '/bucket/elsewhere.webp')).status, 403);
    assert.equal(s.stub.report().images.unknownAddress, 4);
    clock += (URL_TTL_S + 1) * 1000;
    assert.equal((await s.fetchImage(url)).status, 403);
    assert.equal(s.stub.report().images.unknownAddress, 4);
    await s.close();
  });
});

describe('the faults and the control of the host (EVM-142 AC3, AC4, AC5)', () => {
  it('EVM-142 AC3: a fault of the images answers the next N requests of the variant only (the expired address is renewed once) and is used up', async () => {
    const s = await started();
    assert.equal(s.control('/control/photos-fault', { target: 'image', status: 403, count: 1, variant: 'preview' })?.status, 200);
    const thumbnail = (await s.address(FIRST, 'thumbnail')).json.url;
    assert.equal((await s.fetchImage(thumbnail)).status, 200);
    const first = (await s.address(FIRST, 'preview')).json.url;
    assert.equal((await s.fetchImage(first)).status, 403);
    const second = (await s.address(FIRST, 'preview')).json.url;
    assert.equal((await s.fetchImage(second)).status, 200);
    assert.deepEqual([s.stub.report().images.failed, s.stub.report().faults], [1, 0]);
    await s.close();
  });

  it('EVM-142 AC3: a persistent fault (no count) lasts until it is cleared; 500 and 429 (with Retry-After) answer like the server would', async () => {
    const s = await started();
    s.control('/control/photos-fault', { target: 'image', status: 500 });
    const url = (await s.address(FIRST, 'preview')).json.url;
    assert.equal((await s.fetchImage(url)).status, 500);
    assert.equal((await s.fetchImage(url)).status, 500);
    assert.equal(s.stub.report().faults, 1);
    s.control('/control/photos-fault-clear');
    assert.equal((await s.fetchImage(url)).status, 200);
    s.control('/control/photos-fault', { target: 'url', status: 429, count: 1, variant: 'preview' });
    const limited = await s.address(FIRST, 'preview');
    assert.equal(limited.status, 429);
    assert.equal(limited.headers['retry-after'], '5');
    assert.equal((await s.address(FIRST, 'preview')).status, 200);
    s.control('/control/photos-fault', { target: 'url', status: 404, count: 1 });
    assert.equal((await s.address(FIRST, 'thumbnail')).status, 404);
    s.control('/control/photos-fault', { target: 'image', status: 429, count: 1 });
    const slow = await s.fetchImage(url);
    assert.equal(slow.status, 429);
    assert.equal(slow.headers['retry-after'], '5');
    await s.close();
  });

  it('EVM-142 AC5: a delay holds the answer for the image; an image the app abandoned is counted', async () => {
    const s = await started();
    const url = (await s.address(FIRST, 'preview')).json.url;
    assert.equal(s.control('/control/photos-delay', { ms: 5000 })?.status, 200);
    const target = new URL(url);
    await new Promise((resolve) => {
      const req = request({
        host: '127.0.0.1',
        port: s.port,
        method: 'GET',
        path: `${target.pathname}${target.search}`,
        headers: { 'cache-control': 'no-store' },
      });
      req.on('error', () => undefined);
      req.on('socket', () => {
        setTimeout(() => {
          req.destroy();
          setTimeout(() => resolve(undefined), 100);
        }, 150);
      });
      req.end();
    });
    assert.equal(s.stub.report().images.abandoned, 1);
    assert.equal(s.stub.report().delayMs, 5000);
    s.control('/control/photos-delay', { ms: 0 });
    assert.equal((await s.fetchImage(url)).status, 200);
    assert.equal(s.stub.report().images.abandoned, 1);
    await s.close();
  });

  it('EVM-142 AC5: a delayed answer is delivered when the client waits', async () => {
    const s = await started();
    const url = (await s.address(FIRST, 'thumbnail')).json.url;
    s.control('/control/photos-delay', { ms: 50 });
    const late = await s.fetchImage(url);
    assert.equal(late.status, 200);
    assert.equal(late.body.length, IMAGES.thumbnail.length);
    s.control('/control/photos-fault', { target: 'image', status: 500, count: 1 });
    assert.equal((await s.fetchImage(url)).status, 500);
    await s.close();
  });

  it('EVM-142 AC5: the report holds counts only - no address, no signature, no token - and the reset clears counters, faults, signatures and the delay', async () => {
    const s = await started();
    const url = (await s.address(FIRST, 'thumbnail')).json.url;
    await s.fetchImage(url);
    s.control('/control/photos-fault', { target: 'image', status: 500, count: 3 });
    s.control('/control/photos-delay', { ms: 10 });
    const text = JSON.stringify(s.stub.control('GET', '/control/photos-report', null)?.body);
    assert.equal(text.includes('X-Amz'), false);
    assert.equal(text.includes(SIGNATURE_MARK), false);
    assert.equal(text.includes('bucket'), false);
    assert.equal(s.control('/control/photos-reset')?.status, 200);
    const report = s.stub.report();
    assert.deepEqual([report.images.total, report.urls.thumbnail, report.faults, report.delayMs], [0, 0, 0, 0]);
    // the signature of the old address is gone with the reset
    assert.equal((await s.fetchImage(url)).status, 403);
    await s.close();
  });

  it('EVM-142 AC5: the control validates its input and answers only its own paths', async () => {
    const s = await started();
    assert.equal(s.stub.control('POST', '/control/asset', {}), null);
    assert.equal(s.stub.control('GET', '/control/checkpoint', null), null);
    assert.equal(s.stub.control('GET', '/control/photos-reset', null)?.status, 404);
    assert.equal(s.control('/control/photos-fault', { target: 'disk', status: 500 })?.status, 400);
    assert.equal(s.control('/control/photos-fault', { target: 'image', status: 418 })?.status, 400);
    assert.equal(s.control('/control/photos-fault', { target: 'image', status: 500, variant: 'original' })?.status, 400);
    assert.equal(
      /** @type {any} */ (s.control('/control/photos-fault', { target: 'image', status: 500, count: 0 })).body.remaining,
      'persistent',
    );
    assert.equal(s.control('/control/photos-fault')?.status, 400);
    assert.equal(s.control('/control/photos-delay', { ms: -1 })?.status, 400);
    assert.equal(s.control('/control/photos-delay', { ms: 120001 })?.status, 400);
    assert.equal(s.control('/control/photos-delay', {})?.status, 400);
    assert.equal(s.control('/control/photos-unknown')?.status, 404);
    await s.close();
  });
});

describe('the photos part is mounted on the scenario server (EVM-142)', () => {
  it('EVM-142 AC3: the same port serves the address request (Bearer of the upload part) and the bucket; the control port serves the photos paths and the upload paths', async () => {
    const stub = await startStubApi({ port: 0, uploadControlPort: 0 });
    try {
      const base = `http://127.0.0.1:${String(stub.port)}`;
      const control = `http://127.0.0.1:${String(stub.uploadControlPort)}`;
      const anonymous = await fetch(`${base}/api/v1/work-orders/${PHOTO_ORDER_ID}/media-assets/${FIRST}/download-url`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ variant: 'thumbnail' }),
      });
      assert.equal(anonymous.status, 401);
      assert.equal((await fetch(`${base}/bucket/control.webp?X-Amz-Signature=${CONTROL_SIGNATURE}`)).status, 200);
      const report = /** @type {any} */ (await (await fetch(`${control}/control/photos-report`)).json());
      assert.equal(report.images.control, 1);
      assert.equal((await fetch(`${control}/control/photos-reset`, { method: 'POST' })).status, 200);
      assert.equal((await fetch(`${control}/control/checkpoint`)).status, 200);
      stub.setSyncModes({ photos: 'on' });
      const login = await fetch(`${base}/api/health`);
      assert.equal(login.status, 200);
    } finally {
      await stub.close();
    }
  });
});
