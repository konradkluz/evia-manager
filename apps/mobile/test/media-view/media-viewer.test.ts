// EVM-142 AC3, AC5: the viewer - images only in memory, aborted and late answers, the permission to load, one silent renewal of an expired address, the wait of a 429.
import type { BytesAnswer, MediaSource, UrlAnswer } from '../../src/media-view/http-media-source';
import { MAX_IMAGE_BACKOFF_MS, MAX_PARALLEL, MediaViewer } from '../../src/media-view/media-viewer';
import type { ImageRequest } from '../../src/media-view/types';

const WO = '10000000-0000-4000-8000-000000000001';
const id = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const URL1 = 'https://media.example.eu/a?X-Amz-Signature=SYNTHETIC';
const FUTURE = 1_000_000;

interface Held<T> {
  readonly resolve: (value: T) => void;
}

function rig(overrides: Partial<MediaSource> = {}) {
  let now = 0;
  const urlRequests: ImageRequest[] = [];
  const imageRequests: string[] = [];
  const heldUrls: Held<UrlAnswer>[] = [];
  const heldImages: Held<BytesAnswer>[] = [];
  const answers: { url: UrlAnswer[]; image: BytesAnswer[] } = { url: [], image: [] };
  const source: MediaSource = {
    requestUrl: (request) => {
      urlRequests.push(request);
      const next = answers.url.shift();
      return next === undefined ? new Promise<UrlAnswer>((resolve) => heldUrls.push({ resolve })) : Promise.resolve(next);
    },
    fetchImage: (url) => {
      imageRequests.push(url);
      const next = answers.image.shift();
      return next === undefined ? new Promise<BytesAnswer>((resolve) => heldImages.push({ resolve })) : Promise.resolve(next);
    },
    requestVideoUrl: () => Promise.resolve({ kind: 'error' }),
    ...overrides,
  };
  const viewer = new MediaViewer({ source, now: () => now });
  viewer.setAllowed(true);
  const ok = (expiresAt = FUTURE): UrlAnswer => ({ kind: 'ok', url: URL1, expiresAt });
  const bytes = (...values: number[]): BytesAnswer => ({ kind: 'ok', bytes: new Uint8Array(values) });
  const load = (n = 1, variant: 'thumbnail' | 'preview' = 'thumbnail', controller = new AbortController()) => ({
    controller,
    promise: viewer.load({ workOrderId: WO, mediaAssetId: id(n), variant, signal: controller.signal }),
  });
  return {
    viewer,
    answers,
    urlRequests,
    imageRequests,
    heldUrls,
    heldImages,
    ok,
    bytes,
    load,
    setNow: (value: number) => {
      now = value;
    },
  };
}

const flush = async (): Promise<void> => {
  for (let n = 0; n < 10; n += 1) await Promise.resolve();
};

describe('MediaViewer - loading (EVM-142 AC3, AC5)', () => {
  it('EVM-142 AC5: the image is kept as a data address in memory (the address of the server is never handed out) and a second load is served from memory', async () => {
    const r = rig();
    r.answers.url.push(r.ok());
    r.answers.image.push(r.bytes(1, 2, 3));
    expect(await r.load().promise).toEqual({ kind: 'ok' });
    expect(r.viewer.peek('thumbnail', id(1))).toBe(`data:image/webp;base64,${Buffer.from([1, 2, 3]).toString('base64')}`);
    expect(r.viewer.peek('preview', id(1))).toBeUndefined();
    expect(r.imageRequests).toEqual([URL1]);
    expect(await r.load().promise).toEqual({ kind: 'ok' });
    expect(r.urlRequests).toHaveLength(1);
    r.viewer.release('thumbnail', id(1));
    expect(r.viewer.peek('thumbnail', id(1))).toBeUndefined();
  });

  it('EVM-142 AC5: nothing is requested unless the viewer is allowed (lock, hidden data, background, no session) - and a request that is not allowed makes no network call', async () => {
    const r = rig();
    r.viewer.setAllowed(false);
    expect(r.viewer.allowed).toBe(false);
    expect(await r.load().promise).toEqual({ kind: 'aborted' });
    expect(r.urlRequests).toHaveLength(0);
    const aborted = new AbortController();
    aborted.abort();
    r.viewer.setAllowed(true);
    expect(await r.load(1, 'thumbnail', aborted).promise).toEqual({ kind: 'aborted' });
    expect(r.urlRequests).toHaveLength(0);
  });

  it('EVM-142 AC5: turning the permission off aborts the request in flight and forgets every image; the late answer stores nothing and shows nothing', async () => {
    const r = rig();
    r.answers.url.push(r.ok());
    r.answers.image.push(r.bytes(1));
    await r.load(1).promise;
    const inflight = r.load(2);
    await flush();
    expect(r.urlRequests).toHaveLength(2);
    r.viewer.setAllowed(false);
    expect(r.viewer.peek('thumbnail', id(1))).toBeUndefined();
    expect(r.urlRequests[1]?.signal.aborted).toBe(true);
    // the answer of the server arrives after the lock: dropped
    r.heldUrls[0]?.resolve(r.ok());
    expect(await inflight.promise).toEqual({ kind: 'aborted' });
    expect(r.imageRequests).toHaveLength(1);
    expect(r.viewer.peek('thumbnail', id(2))).toBeUndefined();
  });

  it('EVM-142 AC5: a late image (the bytes arrive after the permission went away and came back) is dropped - the epoch of the request is not the present one', async () => {
    const r = rig();
    r.answers.url.push(r.ok());
    const pending = r.load(1);
    await flush();
    expect(r.heldImages).toHaveLength(1);
    // the bytes request is in flight; the app goes to the background and returns
    r.viewer.setAllowed(false);
    r.viewer.setAllowed(true);
    r.heldImages[0]?.resolve(r.bytes(7));
    expect(await pending.promise).toEqual({ kind: 'aborted' });
    expect(r.viewer.peek('thumbnail', id(1))).toBeUndefined();
  });

  it('EVM-142 AC3: aborting the request of the screen (the tile left the window, the preview closed) is "aborted" and stores nothing', async () => {
    const r = rig();
    r.answers.url.push(r.ok());
    const pending = r.load(1, 'preview');
    await flush();
    pending.controller.abort();
    r.heldImages[0]?.resolve(r.bytes(1));
    expect(await pending.promise).toEqual({ kind: 'aborted' });
    expect(r.viewer.peek('preview', id(1))).toBeUndefined();
  });

  it('EVM-142 AC3: a refusal of the bucket (an address that expired meanwhile) gets ONE new address, silently; a second failure is "failed"', async () => {
    const r = rig();
    // the bucket says 403 (expired signature): one new address, then it works
    r.answers.url.push(r.ok(), r.ok());
    r.answers.image.push({ kind: 'status', status: 403 }, r.bytes(2));
    expect(await r.load(2).promise).toEqual({ kind: 'ok' });
    expect(r.urlRequests).toHaveLength(2);
    // some stores answer 400 for an expired signature: the same
    r.answers.url.push(r.ok(), r.ok());
    r.answers.image.push({ kind: 'status', status: 400 }, r.bytes(3));
    expect(await r.load(5).promise).toEqual({ kind: 'ok' });
    // the second address fails as well: the result is "failed", no third attempt
    const before = r.urlRequests.length;
    r.answers.url.push(r.ok(), r.ok(), r.ok());
    r.answers.image.push({ kind: 'status', status: 403 }, { kind: 'status', status: 403 });
    expect(await r.load(3).promise).toEqual({ kind: 'failed' });
    expect(r.urlRequests.length - before).toBe(2);
    expect(r.viewer.peek('thumbnail', id(3))).toBeUndefined();
  });

  it('EVM-142 AC3 (m4): an address that looks out of date by the clock of the phone (the clock runs ahead) is still tried - ONE address request per photo, not two', async () => {
    const r = rig();
    r.setNow(5_000);
    r.answers.url.push(r.ok(1_000), r.ok());
    r.answers.image.push(r.bytes(1));
    expect(await r.load(1).promise).toEqual({ kind: 'ok' });
    expect(r.urlRequests).toHaveLength(1);
    expect(r.imageRequests).toEqual([URL1]);
    // when the bucket does refuse it, there is exactly ONE more attempt, whatever the clock says of the new address
    r.answers.url.push(r.ok(1), r.ok(1), r.ok(1));
    r.answers.image.push({ kind: 'status', status: 403 }, { kind: 'status', status: 403 });
    const before = r.urlRequests.length;
    expect(await r.load(2).promise).toEqual({ kind: 'failed' });
    expect(r.urlRequests.length - before).toBe(2);
    expect(r.imageRequests).toHaveLength(3);
  });

  it('EVM-142 AC4: 403 and 404 of the address are final results of their own; other statuses, errors and a bad image are "failed"; no session is "aborted"', async () => {
    const r = rig();
    const status = (code: number): UrlAnswer => ({ kind: 'status', status: code, retryAfter: null });
    r.answers.url.push(status(403), status(404), status(503), status(401), status(400), { kind: 'error' }, { kind: 'none' });
    expect((await r.load(1).promise).kind).toBe('forbidden');
    expect((await r.load(2).promise).kind).toBe('not_found');
    expect((await r.load(3).promise).kind).toBe('failed');
    expect((await r.load(4).promise).kind).toBe('failed');
    expect((await r.load(5).promise).kind).toBe('failed');
    expect((await r.load(6).promise).kind).toBe('failed');
    expect((await r.load(7).promise).kind).toBe('aborted');
    r.answers.url.push(r.ok());
    r.answers.image.push({ kind: 'error' });
    expect((await r.load(8).promise).kind).toBe('failed');
    r.answers.url.push(r.ok());
    r.answers.image.push({ kind: 'status', status: 404 });
    expect((await r.load(9).promise).kind).toBe('failed');
  });

  it('EVM-142 AC4: a thrown error of the source is "failed" (never thrown to the screen)', async () => {
    const r = rig({ requestUrl: () => Promise.reject(new Error(URL1)) });
    expect(await r.load().promise).toEqual({ kind: 'failed' });
  });
});

describe('MediaViewer - 429 and the parallel limit (EVM-142 AC4)', () => {
  it('EVM-142 AC4: a 429 stops new requests until the end of Retry-After (capped); after it requests go again', async () => {
    const r = rig();
    r.answers.url.push({ kind: 'status', status: 429, retryAfter: '30' });
    expect((await r.load(1).promise).kind).toBe('rate_limited');
    expect(r.urlRequests).toHaveLength(1);
    r.setNow(29_000);
    expect((await r.load(2).promise).kind).toBe('rate_limited');
    expect(r.urlRequests).toHaveLength(1);
    r.setNow(30_001);
    r.answers.url.push(r.ok(30_001 + FUTURE));
    r.answers.image.push(r.bytes(1));
    expect((await r.load(3).promise).kind).toBe('ok');
    // a huge value is capped
    r.answers.url.push({ kind: 'status', status: 429, retryAfter: '999999' });
    await r.load(4).promise;
    r.setNow(30_001 + MAX_IMAGE_BACKOFF_MS - 1);
    expect((await r.load(5).promise).kind).toBe('rate_limited');
    r.setNow(30_001 + MAX_IMAGE_BACKOFF_MS + 1);
    r.answers.url.push(r.ok(30_001 + MAX_IMAGE_BACKOFF_MS + FUTURE));
    r.answers.image.push(r.bytes(2));
    expect((await r.load(6).promise).kind).toBe('ok');
  });

  it('EVM-142 AC2: at most MAX_PARALLEL thumbnails are fetched at a time; a waiting one that is aborted never goes; a preview does not wait', async () => {
    const r = rig();
    const loads = Array.from({ length: MAX_PARALLEL + 2 }, (_, n) => r.load(n + 1));
    await flush();
    expect(r.urlRequests).toHaveLength(MAX_PARALLEL);
    // a preview goes at once
    const preview = r.load(50, 'preview');
    await flush();
    expect(r.urlRequests).toHaveLength(MAX_PARALLEL + 1);
    // the last waiting thumbnail leaves the window: it never asks
    loads[MAX_PARALLEL + 1]?.controller.abort();
    expect((await loads[MAX_PARALLEL + 1]?.promise)?.kind).toBe('aborted');
    // one finishes: the other waiting one goes
    r.heldUrls[0]?.resolve({ kind: 'status', status: 404, retryAfter: null });
    await flush();
    expect(r.urlRequests).toHaveLength(MAX_PARALLEL + 2);
    expect(r.urlRequests.some((request) => request.mediaAssetId === id(MAX_PARALLEL + 2))).toBe(false);
    for (const held of r.heldUrls.splice(0)) held.resolve({ kind: 'status', status: 404, retryAfter: null });
    await flush();
    await Promise.all([...loads.slice(0, MAX_PARALLEL + 1).map((l) => l.promise), preview.promise]);
    expect(r.urlRequests.filter((request) => request.mediaAssetId === id(MAX_PARALLEL + 2))).toHaveLength(0);
  });

  it('EVM-142 AC4 (m2): tiles that waited for a slot while a 429 arrived do not send their request after it - they get "rate_limited"', async () => {
    const r = rig();
    const loads = Array.from({ length: MAX_PARALLEL + 3 }, (_, n) => r.load(n + 1));
    await flush();
    expect(r.urlRequests).toHaveLength(MAX_PARALLEL);
    // the first request is answered with 429: the slot is freed, the waiting tiles take their turn
    r.heldUrls[0]?.resolve({ kind: 'status', status: 429, retryAfter: '30' });
    await flush();
    expect((await loads[0]?.promise)?.kind).toBe('rate_limited');
    expect((await loads[MAX_PARALLEL]?.promise)?.kind).toBe('rate_limited');
    expect(r.urlRequests).toHaveLength(MAX_PARALLEL);
    // the requests that were already in flight finish as they will; the rest of the queue is refused one by one
    for (const held of r.heldUrls.splice(1)) held.resolve({ kind: 'status', status: 404, retryAfter: null });
    const rest = await Promise.all(loads.map((l) => l.promise));
    expect(rest.slice(MAX_PARALLEL).every((result) => result.kind === 'rate_limited')).toBe(true);
    expect(r.urlRequests).toHaveLength(MAX_PARALLEL);
  });

  it('EVM-142 AC5: releasing everything frees the waiting thumbnails and the slots (nothing is left blocked)', async () => {
    const r = rig();
    const loads = Array.from({ length: MAX_PARALLEL + 2 }, (_, n) => r.load(n + 1));
    await flush();
    r.viewer.releaseAll();
    const results = await Promise.all(loads.map((l) => l.promise));
    expect(results.every((result) => result.kind === 'aborted')).toBe(true);
    r.answers.url.push(r.ok());
    r.answers.image.push(r.bytes(1));
    expect((await r.load(20).promise).kind).toBe('ok');
  });

  it('EVM-142 AC4 (m3): freeing the images (the lock, the background) does not end the wait of a 429 - only the end of the session does', async () => {
    const r = rig();
    r.answers.url.push({ kind: 'status', status: 429, retryAfter: '30' });
    expect((await r.load(1).promise).kind).toBe('rate_limited');
    r.viewer.releaseAll();
    r.viewer.setAllowed(false);
    r.viewer.setAllowed(true);
    r.setNow(10_000);
    expect((await r.load(2).promise).kind).toBe('rate_limited');
    expect(r.urlRequests).toHaveLength(1);
    // the end of the session forgets the wait (the next sign-in starts clean)
    r.viewer.endSession();
    expect(r.viewer.allowed).toBe(false);
    r.viewer.setAllowed(true);
    r.answers.url.push(r.ok());
    r.answers.image.push(r.bytes(1));
    expect((await r.load(3).promise).kind).toBe('ok');
  });

  it('EVM-142 AC5: subscribers learn about every release and every change of the permission (the screens load again); an unsubscribed one does not', () => {
    const r = rig();
    let calls = 0;
    const stop = r.viewer.subscribe(() => {
      calls += 1;
    });
    const epoch = r.viewer.getEpoch();
    r.viewer.releaseAll();
    r.viewer.setAllowed(false);
    r.viewer.setAllowed(false);
    r.viewer.setAllowed(true);
    expect(calls).toBe(3);
    expect(r.viewer.getEpoch()).toBe(epoch + 3);
    stop();
    r.viewer.releaseAll();
    expect(calls).toBe(3);
  });
});

describe('MediaViewer - the address of a film (EVM-143 AC2, AC3, AC5)', () => {
  const video = (r: ReturnType<typeof rig>, controller = new AbortController()) => ({
    controller,
    promise: r.viewer.requestVideoUrl({ workOrderId: WO, mediaAssetId: id(1), signal: controller.signal }),
  });
  const withVideo = (answer: () => Promise<UrlAnswer>, spy: string[] = []) =>
    rig({
      requestVideoUrl: () => {
        spy.push('asked');
        return answer();
      },
    });

  it('EVM-143 AC2: the address is handed out once and kept nowhere in the viewer (no image is stored for it)', async () => {
    const r = withVideo(() => Promise.resolve({ kind: 'ok', url: URL1, expiresAt: FUTURE }));
    expect(await video(r).promise).toEqual({ kind: 'ok', url: URL1 });
    expect(r.viewer.peek('preview', id(1))).toBeUndefined();
    expect(r.imageRequests).toHaveLength(0);
  });

  it('EVM-143 AC3: 403 and 404 are final answers, 429 stops further requests until the end of Retry-After, other statuses and errors are "failed"', async () => {
    for (const [status, kind] of [
      [403, 'forbidden'],
      [404, 'not_found'],
      [500, 'failed'],
    ] as const) {
      const r = withVideo(() => Promise.resolve({ kind: 'status', status, retryAfter: null }));
      expect((await video(r).promise).kind).toBe(kind);
    }
    const r = withVideo(() => Promise.resolve({ kind: 'status', status: 429, retryAfter: '30' }));
    expect((await video(r).promise).kind).toBe('rate_limited');
    expect((await video(r).promise).kind).toBe('rate_limited');
    r.setNow(31_000);
    expect((await video(r).promise).kind).toBe('rate_limited');
    const failing = withVideo(() => Promise.resolve({ kind: 'error' }));
    expect((await video(failing).promise).kind).toBe('failed');
    const thrown = withVideo(() => Promise.reject(new Error('https://media.example.eu/a?X-Amz-Signature=SECRET')));
    expect(await video(thrown).promise).toEqual({ kind: 'failed' });
  });

  it('EVM-143 AC5: nothing is asked while the viewer is not allowed (lock, hidden data, background) or the signal is aborted; "no session" is aborted', async () => {
    const spy: string[] = [];
    const r = withVideo(() => Promise.resolve({ kind: 'none' }), spy);
    expect(await video(r).promise).toEqual({ kind: 'aborted' });
    r.viewer.setAllowed(false);
    expect(r.viewer.isAllowed()).toBe(false);
    expect(await video(r).promise).toEqual({ kind: 'aborted' });
    r.viewer.setAllowed(true);
    const controller = new AbortController();
    controller.abort();
    expect(await video(r, controller).promise).toEqual({ kind: 'aborted' });
    expect(spy).toHaveLength(1);
  });

  it('EVM-143 AC5: the lock during the request aborts it and the late address is dropped; a source that ignores the signal cannot keep the request alive', async () => {
    let release: (answer: UrlAnswer) => void = () => undefined;
    const r = withVideo(() => new Promise<UrlAnswer>((resolve) => (release = resolve)));
    const pending = video(r);
    await flush();
    r.viewer.setAllowed(false);
    expect(pending.controller.signal.aborted).toBe(false);
    expect(await pending.promise).toEqual({ kind: 'aborted' });
    release({ kind: 'ok', url: URL1, expiresAt: FUTURE });
    r.viewer.setAllowed(true);
    const second = video(r);
    await flush();
    r.viewer.releaseAll();
    expect(await second.promise).toEqual({ kind: 'aborted' });
  });

  it('EVM-143 AC5: the caller aborting its own signal ends the request as aborted', async () => {
    const r = withVideo(() => new Promise<UrlAnswer>(() => undefined));
    const pending = video(r);
    await flush();
    pending.controller.abort();
    expect(await pending.promise).toEqual({ kind: 'aborted' });
  });
});
