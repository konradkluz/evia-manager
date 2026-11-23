/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-confusing-void-expression, no-useless-assignment -- the answers of the servers are parsed JSON read by the assertions */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer, request } from 'node:http';
import { describe, it } from 'node:test';
import { zMediaDerivativeUrl, zSyncChangesResponse } from '@evia/contracts/zod';
import { PHOTO_ORDER_ID, VIDEO_ASSET, VIDEO_ID, createPhotosStub, loadVideoFixture, photoReplicaChanges } from '../src/photos-stub.mjs';
import { snapshotPage } from '../src/sync-stub.mjs';

const OK = 'Bearer e2e-ok';
// 40 KiB so that a throttled answer (16 KiB chunks) takes three chunks; the bytes are a pattern, not a film
const FILM = Buffer.from(Array.from({ length: 40 * 1024 }, (_, index) => index % 251));

/** @param {{ now?: () => number, video?: Buffer | null }} [options] */
async function started(options = {}) {
  const stub = createPhotosStub({
    authorize: (header) => (header === OK ? null : { status: 401, type: 'application/problem+json', body: { code: 'unauthenticated' } }),
    video: FILM,
    ...options,
  });
  const server = createServer((req, res) => {
    if (stub.claims(req.method, new URL(req.url ?? '/', 'http://x').pathname)) stub.handleApp(req, res);
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  stub.setPort(port);
  /** @param {string} method @param {string} path @param {{ headers?: Record<string, string>, body?: unknown, abortAfterHeaders?: boolean }} [init] @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer, json: any }>} */
  const call = (method, path, { headers = {}, body, abortAfterHeaders = false } = {}) =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        if (abortAfterHeaders) {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.alloc(0), json: null });
          req.destroy();
          return;
        }
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
      req.on('error', (error) => {
        if (abortAfterHeaders) return;
        reject(error);
      });
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  /** @param {string} variant @param {string} [asset] */
  const address = (variant, asset = VIDEO_ID) =>
    call('POST', `/api/v1/work-orders/${PHOTO_ORDER_ID}/media-assets/${asset}/download-url`, {
      headers: { authorization: OK },
      body: { variant },
    });
  /** @param {string} url @param {Record<string, string>} [headers] @param {boolean} [abortAfterHeaders] */
  const get = (url, headers = {}, abortAfterHeaders = false) => {
    const target = new URL(url);
    return call('GET', `${target.pathname}${target.search}`, { headers, abortAfterHeaders });
  };
  /** @param {string} path @param {unknown} [body] */
  const control = (path, body) => stub.control('POST', path, body);
  const report = () => /** @type {any} */ (stub.report());
  const filmUrl = async () => (await address('preview')).json.url;
  return {
    stub,
    call,
    address,
    get,
    control,
    report,
    filmUrl,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined)).closeAllConnections()),
  };
}

describe('the replica with the film (EVM-143 AC1)', () => {
  it('EVM-143 AC1: the mode videos adds ONE ready film, the newest, valid against the contract; without it the replica is the one of EVM-142', () => {
    const page = snapshotPage(true, true);
    assert.equal(zSyncChangesResponse.safeParse(page).success, true);
    /** @type {any[]} */
    const media = page.changes.filter((change) => change.entity.type === 'media_asset');
    assert.equal(media.length, 6);
    assert.equal(media[0].entity.mediaType, 'video');
    assert.equal(media[0].entity.id, VIDEO_ID);
    assert.equal(media[0].entity.fileState, 'ready');
    assert.equal(media.filter((change) => change.entity.mediaType === 'photo').length, 5);
    assert.ok(Date.parse(VIDEO_ASSET.capturedAt) > Date.parse(media[1].entity.capturedAt));
    assert.equal(photoReplicaChanges().length, 5);
    assert.equal(photoReplicaChanges(true).length, 6);
    assert.equal(snapshotPage(true).changes.filter((change) => change.entity.type === 'media_asset').length, 5);
  });
});

describe('the fixture (EVM-143)', () => {
  it('EVM-143: the fixture is the file named by EVIA_E2E_VIDEO_FIXTURE, else the sample of the Android SDK; none = null', () => {
    /** @type {string[]} */
    const read = [];
    const reader = (/** @type {string} */ path) => {
      read.push(path);
      return Buffer.from('mp4');
    };
    assert.equal(loadVideoFixture({ EVIA_E2E_VIDEO_FIXTURE: 'C:/x/film.mp4' }, reader)?.toString(), 'mp4');
    assert.deepEqual(read, ['C:/x/film.mp4']);
    loadVideoFixture({ ANDROID_HOME: 'C:/sdk' }, reader);
    assert.match(read[1] ?? '', /sdk[\\/]emulator[\\/]resources[\\/]macroPreviews[\\/]Track_horizontal_plane\.mp4$/);
    loadVideoFixture({ ANDROID_SDK_ROOT: 'C:/sdk2' }, reader);
    assert.match(read[2] ?? '', /sdk2/);
    assert.equal(loadVideoFixture({}, reader), null);
    assert.equal(
      loadVideoFixture({ ANDROID_HOME: 'C:/sdk' }, () => {
        throw new Error('missing');
      }),
      null,
    );
    assert.equal(
      loadVideoFixture({ ANDROID_HOME: 'C:/sdk' }, () => Buffer.alloc(0)),
      null,
    );
    assert.ok(loadVideoFixture({ EVIA_E2E_VIDEO_FIXTURE: 'D:/nowhere/none.mp4' }) === null);
  });
});

describe('the addresses of the film (EVM-143 AC2 AC3)', () => {
  it('EVM-143 AC2: the thumbnail of the film is the WebP of the photos, the preview an MP4 address of the bucket valid against the contract, and the original is refused', async () => {
    const h = await started();
    try {
      const thumbnail = await h.address('thumbnail');
      assert.equal(thumbnail.status, 200);
      assert.match(thumbnail.json.url, /\/bucket\/photos\/[0-9a-f-]{36}\/thumbnail\.webp\?X-Amz-Signature=E2EMARK\d{6}/);
      const preview = await h.address('preview');
      assert.equal(preview.status, 200);
      assert.equal(zMediaDerivativeUrl.safeParse(preview.json).success, true);
      assert.match(
        preview.json.url,
        new RegExp(`/bucket/videos/${VIDEO_ID}/preview\\.mp4\\?X-Amz-Signature=E2EMARK\\d{6}&X-Amz-Expires=300$`),
      );
      assert.equal((await h.address('original')).status, 403);
      assert.equal(h.report().urls.videoPreview, 1);
      assert.equal(h.report().urls.original, 1);
      assert.equal(h.report().videoLoaded, true);
    } finally {
      await h.close();
    }
  });

  it('EVM-143 AC3: the bytes of the preview are the whole file, or the range asked for (a closed, an open and a suffix range), with Accept-Ranges and a cacheable answer on purpose', async () => {
    const h = await started();
    try {
      const url = await h.filmUrl();
      const whole = await h.get(url);
      assert.equal(whole.status, 200);
      assert.equal(whole.headers['content-type'], 'video/mp4');
      assert.equal(whole.headers['accept-ranges'], 'bytes');
      assert.equal(whole.headers['cache-control'], 'private, max-age=300');
      assert.ok(whole.body.equals(FILM));
      const closed = await h.get(url, { range: 'bytes=10-19' });
      assert.equal(closed.status, 206);
      assert.equal(closed.headers['content-range'], `bytes 10-19/${String(FILM.length)}`);
      assert.ok(closed.body.equals(FILM.subarray(10, 20)));
      const open = await h.get(url, { range: 'bytes=40000-' });
      assert.equal(open.status, 206);
      assert.ok(open.body.equals(FILM.subarray(40000)));
      const suffix = await h.get(url, { range: 'bytes=-100' });
      assert.equal(suffix.status, 206);
      assert.ok(suffix.body.equals(FILM.subarray(FILM.length - 100)));
      const beyond = await h.get(url, { range: `bytes=${String(FILM.length)}-` });
      assert.equal(beyond.status, 416);
      const garbage = await h.get(url, { range: 'items=1-2' });
      assert.equal(garbage.status, 200);
      const film = h.report().film;
      assert.equal(film.requests, 6);
      assert.equal(film.ranges, 5);
      assert.equal(film.ok, 5);
      assert.equal(film.failed, 1);
    } finally {
      await h.close();
    }
  });

  it('EVM-143 AC3: an address that was issued expired answers 403 on every request, the next one is good (an address that expired in the middle of a film)', async () => {
    const h = await started();
    try {
      assert.equal(h.control('/control/photos-video-expire', { count: 1 })?.status, 200);
      const expired = await h.filmUrl();
      assert.equal((await h.get(expired, { range: 'bytes=0-9' })).status, 403);
      assert.equal((await h.get(expired)).status, 403);
      const renewed = await h.filmUrl();
      assert.equal((await h.get(renewed, { range: 'bytes=0-9' })).status, 206);
      assert.equal(h.report().urls.videoPreview, 2);
    } finally {
      await h.close();
    }
  });

  it('EVM-143 AC3: an address past its time, an address of another asset or kind, an unknown signature and a missing film are refused or fail; the counters hold the wrong requests', async () => {
    let at = 1_000_000;
    const h = await started({ now: () => at });
    try {
      const url = await h.filmUrl();
      at += 301_000;
      assert.equal((await h.get(url)).status, 403);
      const thumbnail = (await h.address('thumbnail')).json.url;
      const target = new URL(url);
      const wrongKind = `${target.origin}${target.pathname}?X-Amz-Signature=${new URL(thumbnail).searchParams.get('X-Amz-Signature') ?? ''}`;
      assert.equal((await h.get(wrongKind)).status, 403);
      assert.equal(
        (await h.get(`${target.origin}${target.pathname}?X-Amz-Signature=E2EMARK999999&_=1`, { authorization: 'x', cookie: 'y' })).status,
        403,
      );
      const other = (await h.address('preview')).json.url.replace(VIDEO_ID, '0194c2a0-0000-7000-8000-0000000014b2');
      assert.equal((await h.get(other)).status, 403);
      const film = h.report().film;
      assert.equal(film.unknownAddress, 3);
      assert.equal(film.authorization, 1);
      assert.equal(film.cookie, 1);
      assert.equal(film.cacheBust, 1);
    } finally {
      await h.close();
    }
    const empty = await started({ video: null });
    try {
      assert.equal(empty.report().videoLoaded, false);
      const answer = await empty.get(await empty.filmUrl());
      assert.equal(answer.status, 500);
      assert.equal(answer.json.code, 'internal_error');
    } finally {
      await empty.close();
    }
  });

  it('EVM-143 AC3: a fault of the target video answers the request for the bytes (500, 403 with a count), and clearing it makes the film play again', async () => {
    const h = await started();
    try {
      assert.equal(h.control('/control/photos-fault', { target: 'video', status: 500 })?.status, 200);
      const url = await h.filmUrl();
      assert.equal((await h.get(url)).status, 500);
      assert.equal((await h.get(url)).status, 500);
      h.control('/control/photos-fault-clear');
      assert.equal((await h.get(url)).status, 200);
      h.control('/control/photos-fault', { target: 'video', status: 429, count: 1 });
      const limited = await h.get(url);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers['retry-after'], '5');
      assert.equal(h.report().film.failed, 3);
    } finally {
      await h.close();
    }
  });

  it('EVM-143 AC5: a throttled answer comes in chunks and the request the app drops is counted as abandoned', async () => {
    const h = await started();
    try {
      assert.equal(h.control('/control/photos-video-throttle', { ms: 5 })?.status, 200);
      const url = await h.filmUrl();
      const slow = await h.get(url);
      assert.equal(slow.status, 200);
      assert.ok(slow.body.equals(FILM));
      assert.equal(h.report().throttleMs, 5);
      assert.equal(h.report().film.bytes, FILM.length);
      h.control('/control/photos-video-throttle', { ms: 400 });
      await h.get(url, {}, true);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(h.report().film.abandoned, 1);
    } finally {
      await h.close();
    }
  });

  it('EVM-143 AC5: the controls refuse a bad throttle or expiry; a reset clears the counters, the throttle and the expiry', async () => {
    const h = await started();
    try {
      for (const body of [{ ms: -1 }, { ms: 5001 }, { ms: 1.5 }, { ms: 'x' }, {}]) {
        assert.equal(h.control('/control/photos-video-throttle', body)?.status, 400, JSON.stringify(body));
      }
      for (const body of [{ count: -1 }, { count: 11 }, { count: 0.5 }, {}]) {
        assert.equal(h.control('/control/photos-video-expire', body)?.status, 400, JSON.stringify(body));
      }
      assert.equal(h.control('/control/photos-fault', { target: 'film', status: 500 })?.status, 400);
      h.control('/control/photos-video-throttle', { ms: 10 });
      h.control('/control/photos-video-expire', { count: 3 });
      await h.get(await h.filmUrl());
      h.control('/control/photos-reset');
      const report = h.report();
      assert.equal(report.throttleMs, 0);
      assert.equal(report.film.requests, 0);
      assert.equal(report.urls.videoPreview, 0);
      assert.equal((await h.get(await h.filmUrl(), { range: 'bytes=0-1' })).status, 206);
    } finally {
      await h.close();
    }
  });
});
