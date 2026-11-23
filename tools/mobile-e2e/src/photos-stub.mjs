// @ts-check
/**
 * The photos part of the scenario server (EVM-142 AC2-AC5; flows 140-143 of apps/mobile/e2e): what the phone asks for when it shows "Zdjęcia zlecenia".
 *
 * - the replica: five `media_asset` entities of the order ZL-E2E-1 (three `ready`, one `processing`, one `quarantined`), added to the snapshot page by the
 *   synchronization part while the mode `photos` is `on`;
 * - `createMediaAssetDownloadUrl` for the channel `mobile` (`POST /api/v1/work-orders/<id>/media-assets/<id>/download-url`): `thumbnail` and `preview` of a `ready`
 *   photo only (`original` is `403`, a file that is not `ready` is `404`, like the real server), the address `http://10.0.2.2:<port>/bucket/photos/<id>/<variant>.webp?
 *   X-Amz-Signature=E2EMARK<n>&X-Amz-Expires=300`;
 * - the bucket: `GET /bucket/...` answers the bytes of a synthetic WebP with `Content-Type: image/webp` and - ON PURPOSE, the worst case - `Cache-Control: private,
 *   max-age=300`, which lets a client keep the image in an HTTP cache on the disk. The server records, for every image request, the headers that matter to the proof of
 *   AC5 (the `Cache-Control` of the REQUEST, an `Authorization`, a `Cookie`, a cache-buster `_=` in the address) - never the address and never the signature;
 * - the faults the scenarios steer (control port, host only): a status on the next N requests for addresses or for images (`403` of an expired address, `500`, `429`,
 *   `404`), a delay of the IMAGES (the window in which the app is locked with the download in progress) and the count of image requests the app abandoned.
 *
 * `/bucket/control.webp` (signature `E2EMARK-CTRL`) is the image of the POSITIVE CONTROL of the proof: the hook of the e2e variant fetches it with the plain global
 * `fetch` and no `Cache-Control: no-store`, so the HTTP cache of the app MAY keep it; the search of the app directories must then find it.
 *
 * EVM-143 (flows 144-148): the mode `photos: 'videos'` adds ONE ready film to the replica (`VIDEO_ASSET`, the newest tile). The addresses of its `thumbnail` (the WebP of the
 * photos) and of its `preview` (`/bucket/videos/<id>/preview.mp4?X-Amz-Signature=E2EMARK<n>...`) come from the same `download-url`; the bucket answers the preview with the
 * bytes of an MP4 FIXTURE (`loadVideoFixture`: a real H.264 file - the player must really play it; it is NOT in the repository, it is read from the Android SDK of the machine,
 * `EVIA_E2E_VIDEO_FIXTURE` overrides) with `Accept-Ranges`, `206` for a `Range` request (its `moov` is at the end), `Cache-Control: private, max-age=300` on purpose, and an
 * optional throttle (the film is served in 16 KiB chunks, `/control/photos-video-throttle`) - the window in which the app is locked / left / signed out with the film in progress.
 * The faults of the target `video` (`403` of an expired address, `500`) are answered to the request for the bytes. The counters of the film never hold an address.
 * Only synthetic data; the three images are 48-96 px lossless WebP made for this file (`RIFF....WEBPVP8L`).
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The order of the scenario server that owns the photos (`sync-stub.mjs`: ZL-E2E-1). */
export const PHOTO_ORDER_ID = '30000000-0000-4000-8000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOWNLOAD_PATH = /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/media-assets\/([0-9a-f-]{36})\/download-url$/;
const BUCKET_PHOTO = /^\/bucket\/photos\/([0-9a-f-]{36})\/(thumbnail|preview)\.webp$/;
const BUCKET_VIDEO = /^\/bucket\/videos\/([0-9a-f-]{36})\/preview\.mp4$/;
const CONTROL_PATH = '/bucket/control.webp';
const VIDEO_CHUNK = 16 * 1024;
const MAX_THROTTLE_MS = 5000;
const RANGE = /^bytes=(\d*)-(\d*)$/;
export const SIGNATURE_MARK = 'E2EMARK';
export const CONTROL_SIGNATURE = `${SIGNATURE_MARK}-CTRL`;
export const URL_TTL_S = 300;
const MAX_BODY = 4096;
const MAX_DELAY_MS = 120_000;
const RETRY_AFTER_S = 5;
/** @type {Record<number, string>} */
const FAULT_CODES = { 400: 'validation_failed', 403: 'forbidden', 404: 'not_found', 500: 'internal_error' };

/** @typedef {'thumbnail' | 'preview'} Variant */
/** @typedef {{ id: string, category: string, capturedAt: string, fileState: string }} PhotoAsset */

/**
 * The photos of the order, newest first: three the server has prepared, one it still works on, one it holds (a quarantine).
 * @type {readonly PhotoAsset[]}
 */
export const PHOTO_ASSETS = Object.freeze([
  { id: '0194c2a0-0000-7000-8000-0000000014a1', category: 'completed_work', capturedAt: '2026-11-20T12:30:00.000Z', fileState: 'ready' },
  { id: '0194c2a0-0000-7000-8000-0000000014a2', category: 'in_progress', capturedAt: '2026-11-20T11:30:00.000Z', fileState: 'ready' },
  { id: '0194c2a0-0000-7000-8000-0000000014a3', category: 'before_work', capturedAt: '2026-11-20T10:30:00.000Z', fileState: 'ready' },
  { id: '0194c2a0-0000-7000-8000-0000000014a4', category: 'defect', capturedAt: '2026-11-20T09:30:00.000Z', fileState: 'processing' },
  { id: '0194c2a0-0000-7000-8000-0000000014a5', category: 'measurement', capturedAt: '2026-11-20T08:30:00.000Z', fileState: 'quarantined' },
]);
/** The film of the mode `videos`: the newest of the order, ready (a thumbnail and a preview exist). @type {PhotoAsset} */
export const VIDEO_ASSET = Object.freeze({
  id: '0194c2a0-0000-7000-8000-0000000014b1',
  category: 'completed_work',
  capturedAt: '2026-11-20T13:30:00.000Z',
  fileState: 'ready',
});
export const VIDEO_ID = VIDEO_ASSET.id;

/**
 * The MP4 the bucket serves as the preview of the film: a real file from the Android SDK of this machine (not a part of the repository), or the file named by
 * `EVIA_E2E_VIDEO_FIXTURE`. `null` when there is none - the bucket then answers 500 and the scenario fails visibly.
 * @param {Record<string, string | undefined>} [env] @param {(path: string) => Buffer} [read]
 * @returns {Buffer | null}
 */
export function loadVideoFixture(env = process.env, read = readFileSync) {
  const given = env['EVIA_E2E_VIDEO_FIXTURE'];
  const home = env['ANDROID_HOME'] ?? env['ANDROID_SDK_ROOT'];
  const path = given ?? (home === undefined ? null : join(home, 'emulator', 'resources', 'macroPreviews', 'Track_horizontal_plane.mp4'));
  if (path === null) return null;
  try {
    const bytes = read(path);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

/** The ones whose images the server serves. */
export const READY_IDS = Object.freeze(PHOTO_ASSETS.filter((photo) => photo.fileState === 'ready').map((photo) => photo.id));

/** The synthetic images (lossless WebP, `RIFF....WEBPVP8L`): the thumbnail is blue, the preview green and bigger, the control red. */
export const IMAGES = Object.freeze({
  thumbnail: Buffer.from('UklGRioAAABXRUJQVlA4TB0AAAAvL8ALAAWZtI3P+hdQGbvLjiEeo/5PAKdU9rekgQA=', 'base64'),
  preview: Buffer.from('UklGRi4AAABXRUJQVlA4TCEAAAAvX8AXAIWitm0g/lLBFkef1zaSQ9z/CcBnUaL//vOLOyQA', 'base64'),
  control: Buffer.from('UklGRigAAABXRUJQVlA4TBwAAAAvL8ALAAWZtI2d+ldWGbvLjhGM/k8AU6r9LWkg', 'base64'),
});

/** The `media_asset` entities of the snapshot page (the minimal projection of `SyncMediaAsset`, EVM-131). */
export function photoReplicaChanges(withVideo = false) {
  return [...(withVideo ? [VIDEO_ASSET] : []), ...PHOTO_ASSETS].map((photo) => ({
    op: 'upsert',
    entity: {
      type: 'media_asset',
      id: photo.id,
      version: 1,
      workOrderId: PHOTO_ORDER_ID,
      mediaType: photo.id === VIDEO_ID ? 'video' : 'photo',
      category: photo.category,
      description: photo.fileState === 'ready' ? `Opis testowy ${photo.category}` : null,
      procedureStageId: null,
      capturedAt: photo.capturedAt,
      fileState: photo.fileState,
      fileStateReasonCode: null,
      sizeBytes: null,
      durationSeconds: null,
      widthPx: null,
      heightPx: null,
    },
  }));
}

/**
 * @typedef {object} Fault
 * @property {'url' | 'image' | 'video'} target the request for an address, for the bytes of an image or for the bytes of the film
 * @property {400 | 403 | 404 | 429 | 500} status
 * @property {number} remaining how many more requests it answers (`Infinity` = until cleared)
 * @property {Variant | null} variant only this variant (`null` = any)
 */
/** @typedef {{ status: number, type: string, body: unknown, headers?: Record<string, string> }} Answer */

/** @param {number} status @param {string} code @param {Record<string, string>} [headers] @returns {Answer} */
function problem(status, code, headers) {
  return {
    status,
    type: 'application/problem+json',
    body: { type: 'about:blank', title: code, status, code, traceId: '0'.repeat(32) },
    ...(headers === undefined ? {} : { headers }),
  };
}

/** @param {string | string[] | undefined} value @returns {string | null} */
const single = (value) => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/**
 * @param {{ authorize: (header: string | undefined) => Answer | null, publicHost?: string, now?: () => number, video?: Buffer | null }} options `authorize`: the Bearer
 *   check of the upload part (the sign-in of these scenarios is served by it); `video`: the bytes of the MP4 of the preview (`loadVideoFixture`)
 */
export function createPhotosStub({ authorize, publicHost = '10.0.2.2', now = Date.now, video = null }) {
  let port = 0;
  let serial = 0;
  /** @type {Map<string, { assetId: string, variant: Variant, expiresAt: number, film: boolean }>} */
  let signatures = new Map();
  /** @type {Fault[]} */
  let faults = [];
  let delayMs = 0;
  let throttleMs = 0;
  /** How many of the next addresses of a film are issued ALREADY EXPIRED (every request with them is `403`, the way an address that expired in the middle of a film behaves). */
  let expireNext = 0;
  /** @type {ReturnType<typeof fresh>} */
  let counters = fresh();

  function fresh() {
    return {
      urls: { thumbnail: 0, preview: 0, original: 0, videoPreview: 0, byAsset: /** @type {Record<string, number>} */ ({}) },
      film: {
        requests: 0,
        ranges: 0,
        ok: 0,
        failed: 0,
        authorization: 0,
        cookie: 0,
        cacheBust: 0,
        unknownAddress: 0,
        abandoned: 0,
        bytes: 0,
      },
      images: {
        thumbnail: 0,
        preview: 0,
        control: 0,
        total: 0,
        ok: 0,
        failed: 0,
        noStore: 0,
        notNoStore: 0,
        authorization: 0,
        cookie: 0,
        cacheBust: 0,
        unknownAddress: 0,
        abandoned: 0,
      },
    };
  }

  /** @param {'url' | 'image' | 'video'} target @param {Variant | null} variant @returns {Fault | null} the fault that answers this request (it is used up by it) */
  function takeFault(target, variant) {
    const fault = faults.find(
      (entry) => entry.target === target && entry.remaining > 0 && (entry.variant === null || entry.variant === variant),
    );
    if (fault === undefined) return null;
    fault.remaining -= 1;
    return fault;
  }

  /** @param {number} status @returns {Answer} */
  const faultAnswer = (status) => {
    if (status === 429) return problem(429, 'rate_limited', { 'Retry-After': String(RETRY_AFTER_S) });
    return problem(status, FAULT_CODES[status] ?? 'internal_error');
  };

  /**
   * `createMediaAssetDownloadUrl` for the phone (EVM-142 AC1): the order and the asset must be the ones of the replica, `original` is refused before anything else.
   * @param {string} workOrderId @param {string} assetId @param {unknown} body @param {string | undefined} authorization
   * @returns {Answer}
   */
  function downloadUrl(workOrderId, assetId, body, authorization) {
    const denied = authorize(authorization);
    if (denied !== null) return denied;
    const variant = typeof body === 'object' && body !== null ? /** @type {Record<string, unknown>} */ (body)['variant'] : undefined;
    if (variant !== 'thumbnail' && variant !== 'preview' && variant !== 'original') return problem(400, 'validation_failed');
    if (variant === 'original') {
      counters.urls.original += 1;
      return problem(403, 'forbidden');
    }
    const film = assetId === VIDEO_ID;
    counters.urls[variant] += 1;
    if (film && variant === 'preview') counters.urls.videoPreview += 1;
    counters.urls.byAsset[assetId] = (counters.urls.byAsset[assetId] ?? 0) + 1;
    const fault = takeFault('url', variant);
    if (fault !== null) return faultAnswer(fault.status);
    if (workOrderId !== PHOTO_ORDER_ID || !(READY_IDS.includes(assetId) || film)) return problem(404, 'not_found');
    serial += 1;
    const signature = `${SIGNATURE_MARK}${String(serial).padStart(6, '0')}`;
    const expiresAt = now() + URL_TTL_S * 1000;
    const expired = film && variant === 'preview' && expireNext > 0;
    if (expired) expireNext -= 1;
    signatures.set(signature, { assetId, variant, expiresAt: expired ? 0 : expiresAt, film: film && variant === 'preview' });
    const place = film && variant === 'preview' ? `videos/${assetId}/preview.mp4` : `photos/${assetId}/${variant}.webp`;
    return {
      status: 200,
      type: 'application/json',
      body: {
        url: `http://${publicHost}:${String(port)}/bucket/${place}?X-Amz-Signature=${signature}&X-Amz-Expires=${String(URL_TTL_S)}`,
        expiresAt: new Date(expiresAt).toISOString(),
      },
    };
  }

  /**
   * `GET` of the bucket: the bytes of the image of a signed address, with the headers of a cacheable answer.
   * @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response @param {URL} target
   */
  function bucket(request, response, target) {
    if (BUCKET_VIDEO.test(target.pathname)) {
      bucketVideo(request, response, target);
      return;
    }
    const photo = BUCKET_PHOTO.exec(target.pathname);
    const control = target.pathname === CONTROL_PATH;
    const signature = target.searchParams.get('X-Amz-Signature');
    const known = signature === null ? undefined : signatures.get(signature);
    /** @type {Variant | null} */
    let variant = null;
    if (photo !== null) variant = /** @type {Variant} */ (photo[2]);
    const kind = control ? 'control' : (variant ?? 'unknown');
    const header = single(request.headers['cache-control']);
    const images = counters.images;
    images.total += 1;
    if (kind === 'thumbnail' || kind === 'preview' || kind === 'control') images[kind] += 1;
    // what the proof of AC5 asks of every request of the VIEWER: the `no-store` of the request, no token, no cookie, no cache-buster (the control image is
    // fetched on purpose without them, by the hook of the e2e variant)
    if (!control) {
      if (header !== null && header.trim().toLowerCase() === 'no-store') images.noStore += 1;
      else images.notNoStore += 1;
      if (request.headers['authorization'] !== undefined) images.authorization += 1;
      if (request.headers['cookie'] !== undefined) images.cookie += 1;
      if (target.searchParams.has('_')) images.cacheBust += 1;
    }
    /** @type {{ status: number, body: Buffer | null }} */
    let result;
    const fault = control ? null : takeFault('image', variant);
    if (control && signature === CONTROL_SIGNATURE) result = { status: 200, body: IMAGES.control };
    else if (fault !== null) result = { status: fault.status, body: null };
    else if (photo === null || known === undefined || known.assetId !== photo[1] || known.variant !== variant) {
      images.unknownAddress += 1;
      result = { status: 403, body: null };
    } else if (known.expiresAt <= now()) result = { status: 403, body: null };
    else result = { status: 200, body: IMAGES[known.variant] };
    if (result.status === 200) images.ok += 1;
    else images.failed += 1;
    let finished = false;
    response.on('finish', () => {
      finished = true;
    });
    response.on('close', () => {
      if (!finished) images.abandoned += 1;
    });
    const answer = () => {
      if (response.destroyed) return;
      if (result.body === null) {
        const failure = faultAnswer(result.status);
        response.writeHead(result.status, { 'Content-Type': failure.type, 'Cache-Control': 'no-store', ...(failure.headers ?? {}) });
        response.end(JSON.stringify(failure.body));
        return;
      }
      // the worst case on purpose: a cacheable answer, so a client that does not send `no-store` MAY keep the image on the disk
      response.writeHead(200, {
        'Content-Type': 'image/webp',
        'Content-Length': String(result.body.length),
        'Cache-Control': 'private, max-age=300',
      });
      response.end(result.body);
    };
    if (delayMs > 0) setTimeout(answer, delayMs).unref();
    else answer();
  }

  /**
   * `GET` of the film: the MP4 of a signed address, whole or a range (the `moov` is at the end, so the player asks for ranges), a throttle on request.
   * @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response @param {URL} target
   */
  function bucketVideo(request, response, target) {
    const film = counters.film;
    const match = BUCKET_VIDEO.exec(target.pathname);
    const signature = target.searchParams.get('X-Amz-Signature');
    const known = signature === null ? undefined : signatures.get(signature);
    const header = single(request.headers['range']);
    film.requests += 1;
    if (header !== null) film.ranges += 1;
    if (request.headers['authorization'] !== undefined) film.authorization += 1;
    if (request.headers['cookie'] !== undefined) film.cookie += 1;
    if (target.searchParams.has('_')) film.cacheBust += 1;
    const fault = takeFault('video', null);
    let status = 200;
    if (fault !== null) status = fault.status;
    else if (match === null || known === undefined || !known.film || known.assetId !== match[1]) {
      film.unknownAddress += 1;
      status = 403;
    } else if (known.expiresAt <= now()) status = 403;
    else if (video === null) status = 500;
    let finished = false;
    response.on('finish', () => {
      finished = true;
    });
    response.on('close', () => {
      if (!finished) film.abandoned += 1;
    });
    if (status !== 200 || video === null) {
      film.failed += 1;
      const failure = faultAnswer(status);
      response.writeHead(status, { 'Content-Type': failure.type, 'Cache-Control': 'no-store', ...(failure.headers ?? {}) });
      response.end(JSON.stringify(failure.body));
      return;
    }
    const total = video.length;
    let from = 0;
    let to = total - 1;
    let partial = false;
    const range = header === null ? null : RANGE.exec(header.trim());
    if (range !== null) {
      const [, first = '', last = ''] = range;
      if (first === '') {
        from = Math.max(0, total - Number(last));
      } else {
        from = Number(first);
        if (last !== '') to = Math.min(to, Number(last));
      }
      partial = true;
    }
    if (from > to || from >= total) {
      film.failed += 1;
      response.writeHead(416, { 'Content-Range': `bytes */${String(total)}`, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    film.ok += 1;
    const body = video.subarray(from, to + 1);
    response.writeHead(partial ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Content-Length': String(body.length),
      'Accept-Ranges': 'bytes',
      ...(partial ? { 'Content-Range': `bytes ${String(from)}-${String(to)}/${String(total)}` } : {}),
      // the worst case on purpose: a cacheable answer, so a player that keeps what it streams MAY keep it on the disk
      'Cache-Control': 'private, max-age=300',
    });
    if (throttleMs <= 0) {
      film.bytes += body.length;
      response.end(body);
      return;
    }
    let at = 0;
    const timer = setInterval(() => {
      if (response.destroyed) {
        clearInterval(timer);
        return;
      }
      const chunk = body.subarray(at, at + VIDEO_CHUNK);
      at += chunk.length;
      film.bytes += chunk.length;
      if (at >= body.length) {
        clearInterval(timer);
        response.end(chunk);
      } else response.write(chunk);
    }, throttleMs);
    timer.unref();
    response.on('close', () => {
      clearInterval(timer);
    });
  }

  /**
   * @param {string | undefined} method @param {string} pathname
   */
  function claims(method, pathname) {
    return (method === 'POST' && DOWNLOAD_PATH.test(pathname)) || (method === 'GET' && pathname.startsWith('/bucket/'));
  }

  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  function handleApp(request, response) {
    const target = new URL(request.url ?? '/', 'http://stub.local');
    if (request.method === 'GET') {
      bucket(request, response, target);
      return;
    }
    const match = DOWNLOAD_PATH.exec(target.pathname);
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
      const answer =
        match === null || size > MAX_BODY
          ? problem(size > MAX_BODY ? 413 : 404, size > MAX_BODY ? 'payload_too_large' : 'not_found')
          : UUID.test(match[1] ?? '') && UUID.test(match[2] ?? '')
            ? downloadUrl(
                /** @type {string} */ (match[1]),
                /** @type {string} */ (match[2]),
                body,
                single(request.headers['authorization']) ?? undefined,
              )
            : problem(400, 'validation_failed');
      const respond = () => {
        if (response.destroyed) return;
        response.writeHead(answer.status, { 'Content-Type': answer.type, 'Cache-Control': 'no-store', ...(answer.headers ?? {}) });
        response.end(JSON.stringify(answer.body));
      };
      respond();
    });
  }

  /** The report of the host: counts only - no address, no signature, no token. */
  function report() {
    return {
      urls: { ...counters.urls, byAsset: { ...counters.urls.byAsset } },
      images: { ...counters.images },
      film: { ...counters.film },
      videoLoaded: video !== null,
      delayMs,
      throttleMs,
      faults: faults.filter((fault) => fault.remaining > 0).length,
    };
  }

  /**
   * The control of the host (`/control/photos-*`), loopback only.
   * @param {string} method @param {string} path @param {unknown} body
   * @returns {Answer | null} `null` = not a path of this part
   */
  function control(method, path, body) {
    if (!path.startsWith('/control/photos-')) return null;
    const fields = /** @type {Record<string, unknown>} */ (typeof body === 'object' && body !== null ? body : {});
    const ok = (/** @type {unknown} */ value) => ({ status: 200, type: 'application/json', body: value });
    if (method === 'GET' && path === '/control/photos-report') return ok(report());
    if (method !== 'POST') return problem(404, 'not_found');
    if (path === '/control/photos-reset') {
      counters = fresh();
      faults = [];
      signatures = new Map();
      delayMs = 0;
      throttleMs = 0;
      expireNext = 0;
      serial = 0;
      return ok({ reset: true });
    }
    if (path === '/control/photos-fault') {
      const { target, status, count, variant } = fields;
      if ((target !== 'url' && target !== 'image' && target !== 'video') || ![400, 403, 404, 429, 500].includes(Number(status)))
        return problem(400, 'validation_failed');
      if (variant !== undefined && variant !== 'thumbnail' && variant !== 'preview') return problem(400, 'validation_failed');
      const remaining = typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : Infinity;
      faults.push({ target, status: /** @type {Fault['status']} */ (Number(status)), remaining, variant: variant ?? null });
      return ok({ target, status: Number(status), remaining: remaining === Infinity ? 'persistent' : remaining });
    }
    if (path === '/control/photos-fault-clear') {
      faults = [];
      return ok({ faults: 0 });
    }
    if (path === '/control/photos-delay') {
      const { ms } = fields;
      if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > MAX_DELAY_MS) return problem(400, 'validation_failed');
      delayMs = ms;
      return ok({ delayMs });
    }
    if (path === '/control/photos-video-expire') {
      const { count } = fields;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 10) return problem(400, 'validation_failed');
      expireNext = count;
      return ok({ expireNext });
    }
    if (path === '/control/photos-video-throttle') {
      const { ms } = fields;
      if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > MAX_THROTTLE_MS) return problem(400, 'validation_failed');
      throttleMs = ms;
      return ok({ throttleMs });
    }
    return problem(404, 'not_found');
  }

  return {
    claims,
    handleApp,
    control,
    report,
    /** @param {number} value the port of the app listener (it goes into the addresses) */
    setPort: (value) => {
      port = value;
    },
  };
}
