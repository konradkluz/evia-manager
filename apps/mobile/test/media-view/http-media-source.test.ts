// EVM-142 AC1, AC5: the two network steps of an image - the signed address from the API (with the token) and the bytes from the bucket (without it).
import { createHttpMediaSource, MAX_IMAGE_BYTES, type HttpMediaSourceOptions } from '../../src/media-view/http-media-source';

const WO = '10000000-0000-4000-8000-000000000001';
const ASSET = '0194c2a0-0000-7000-8000-000000000001';
const SIGNED = 'https://media.example.eu/derived/thumb.webp?X-Amz-Signature=SYNTHETIC';
const signal = new AbortController().signal;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function source(overrides: Partial<HttpMediaSourceOptions> = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const bucket: { url: string; init: RequestInit }[] = [];
  let answer: Response | null = json(200, { url: SIGNED, expiresAt: '2030-01-01T00:00:00Z' });
  let image: () => Promise<Response> = () =>
    Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/webp' } }));
  const instance = createHttpMediaSource({
    baseUrl: 'https://api.example.eu',
    headers: { 'X-Client-Platform': 'android', 'X-Client-Version': '1.0.0' },
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(answer);
    },
    fetchBytes: (url, init) => {
      bucket.push({ url, init });
      return image();
    },
    ...overrides,
  });
  return {
    instance,
    calls,
    bucket,
    answer: (next: Response | null) => {
      answer = next;
    },
    image: (next: () => Promise<Response>) => {
      image = next;
    },
  };
}

describe('address of the derivative (EVM-142 AC1)', () => {
  it('EVM-142 AC1: POSTs { variant } with the headers of the phone to the contract path and returns the validated address and its expiry', async () => {
    const s = source();
    const answer = await s.instance.requestUrl({ workOrderId: WO, mediaAssetId: ASSET, variant: 'preview', signal });
    expect(answer).toEqual({ kind: 'ok', url: SIGNED, expiresAt: Date.UTC(2030, 0, 1) });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.url).toBe(`https://api.example.eu/api/v1/work-orders/${WO}/media-assets/${ASSET}/download-url`);
    expect(s.calls[0]?.init?.method).toBe('POST');
    expect(s.calls[0]?.init?.body).toBe('{"variant":"preview"}');
    expect(s.calls[0]?.init?.headers).toMatchObject({
      'X-Client-Platform': 'android',
      'X-Client-Version': '1.0.0',
      'Content-Type': 'application/json',
    });
    expect(s.calls[0]?.init?.signal).toBe(signal);
  });

  it('EVM-142 AC1: every refusal is the status and Retry-After only (no body); no session is "none"; a malformed answer, a network error and bad ids are "error"', async () => {
    const s = source();
    s.answer(json(429, { code: 'rate_limited', detail: 'SECRET-DETAIL' }, { 'Retry-After': '12' }));
    expect(await s.instance.requestUrl({ workOrderId: WO, mediaAssetId: ASSET, variant: 'thumbnail', signal })).toEqual({
      kind: 'status',
      status: 429,
      retryAfter: '12',
    });
    s.answer(json(404, { code: 'not_found' }));
    expect(await s.instance.requestUrl({ workOrderId: WO, mediaAssetId: ASSET, variant: 'thumbnail', signal })).toEqual({
      kind: 'status',
      status: 404,
      retryAfter: null,
    });
    s.answer(null);
    expect(await s.instance.requestUrl({ workOrderId: WO, mediaAssetId: ASSET, variant: 'thumbnail', signal })).toEqual({ kind: 'none' });
    s.answer(json(200, { url: 'not-a-url', expiresAt: 'x' }));
    expect(await s.instance.requestUrl({ workOrderId: WO, mediaAssetId: ASSET, variant: 'thumbnail', signal })).toEqual({ kind: 'error' });
    const throwing = source({ fetch: () => Promise.reject(new Error(`network ${SIGNED}`)) });
    const failed = await throwing.instance.requestUrl({ workOrderId: WO, mediaAssetId: ASSET, variant: 'thumbnail', signal });
    expect(failed).toEqual({ kind: 'error' });
    const before = s.calls.length;
    expect(await s.instance.requestUrl({ workOrderId: 'not-an-id', mediaAssetId: ASSET, variant: 'thumbnail', signal })).toEqual({
      kind: 'error',
    });
    expect(await s.instance.requestUrl({ workOrderId: WO, mediaAssetId: '../x', variant: 'thumbnail', signal })).toEqual({ kind: 'error' });
    expect(s.calls).toHaveLength(before);
  });

  it('EVM-142 AC1: nothing is sent when the API address is not secure', async () => {
    const s = source({ baseUrl: 'http://api.example.eu' });
    expect(await s.instance.requestUrl({ workOrderId: WO, mediaAssetId: ASSET, variant: 'thumbnail', signal })).toEqual({ kind: 'error' });
    expect(s.calls).toHaveLength(0);
    const local = source({ baseUrl: 'http://10.0.2.2:3000', allowLocalHttp: true });
    await local.instance.requestUrl({ workOrderId: WO, mediaAssetId: ASSET, variant: 'thumbnail', signal });
    expect(local.calls).toHaveLength(1);
  });
});

describe('bytes of the image (EVM-142 AC5)', () => {
  it('EVM-142 AC5: a plain GET without credentials or token to the address; the bytes are returned', async () => {
    const s = source();
    const answer = await s.instance.fetchImage(SIGNED, signal);
    expect(answer).toEqual({ kind: 'ok', bytes: new Uint8Array([1, 2, 3]) });
    expect(s.bucket).toHaveLength(1);
    expect(s.bucket[0]?.init.credentials).toBe('omit');
    expect(JSON.stringify(s.bucket[0]?.init.headers)).not.toMatch(/authorization/i);
    expect(s.calls).toHaveLength(0);
  });

  it('EVM-142 AC5: the request forbids the HTTP cache (the network stack of React Native keeps a 10 MB cache on the disk), so no image bytes stay in the app directories', async () => {
    const s = source();
    await s.instance.fetchImage(SIGNED, signal);
    expect(s.bucket[0]?.init.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    // `cache` is not an option of the fetch of expo (and the polyfill would append `_=` to the signed address, breaking the signature): the header is the only means
    expect(s.bucket[0]?.init).not.toHaveProperty('cache');
  });

  it('EVM-142 AC5 (S6): a redirect is never followed (the signed address is answered by the bucket itself) - the option is set and a 3xx is "error"', async () => {
    const s = source();
    await s.instance.fetchImage(SIGNED, signal);
    expect(s.bucket[0]?.init.redirect).toBe('error');
    s.image(() => Promise.resolve(new Response(null, { status: 302, headers: { Location: 'https://obcy.example/x' } })));
    expect(await s.instance.fetchImage(SIGNED, signal)).toEqual({ kind: 'error' });
    s.image(() => Promise.reject(new TypeError('redirect mode is set to error')));
    expect(await s.instance.fetchImage(SIGNED, signal)).toEqual({ kind: 'error' });
  });

  it('EVM-142 AC5: an address that fails the policy never leaves the phone (no request)', async () => {
    const s = source({ allowedHosts: ['media.example.eu'] });
    for (const url of ['http://media.example.eu/x', 'https://other.example.eu/x', 'https://u:p@media.example.eu/x', 'file:///x']) {
      expect(await s.instance.fetchImage(url, signal)).toEqual({ kind: 'error' });
    }
    expect(s.bucket).toHaveLength(0);
  });

  it('EVM-142 AC3: a refusal of the bucket is its status only; a wrong type, an empty body, a huge body and a thrown error are "error"', async () => {
    const s = source();
    s.image(() => Promise.resolve(new Response('denied', { status: 403 })));
    expect(await s.instance.fetchImage(SIGNED, signal)).toEqual({ kind: 'status', status: 403 });
    s.image(() => Promise.resolve(new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'text/html' } })));
    expect(await s.instance.fetchImage(SIGNED, signal)).toEqual({ kind: 'error' });
    s.image(() => Promise.resolve(new Response(new Uint8Array([]), { status: 200, headers: { 'Content-Type': 'image/webp' } })));
    expect(await s.instance.fetchImage(SIGNED, signal)).toEqual({ kind: 'error' });
    s.image(() =>
      Promise.resolve(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'Content-Type': 'image/webp', 'Content-Length': String(MAX_IMAGE_BYTES + 1) },
        }),
      ),
    );
    expect(await s.instance.fetchImage(SIGNED, signal)).toEqual({ kind: 'error' });
    s.image(() =>
      Promise.resolve(new Response(new Uint8Array(MAX_IMAGE_BYTES + 1), { status: 200, headers: { 'Content-Type': 'image/webp' } })),
    );
    expect(await s.instance.fetchImage(SIGNED, signal)).toEqual({ kind: 'error' });
    s.image(() => Promise.reject(new Error(SIGNED)));
    expect(await s.instance.fetchImage(SIGNED, signal)).toEqual({ kind: 'error' });
  });

  it('EVM-142 AC5: without an injected fetch it uses the global one', async () => {
    const original = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = ((url: string) => {
      seen.push(url);
      return Promise.resolve(new Response(new Uint8Array([9]), { status: 200, headers: { 'Content-Type': 'image/webp' } }));
    }) as typeof fetch;
    try {
      const plain = createHttpMediaSource({ baseUrl: 'https://api.example.eu', headers: {}, fetch: () => Promise.resolve(null) });
      expect(await plain.fetchImage(SIGNED, signal)).toEqual({ kind: 'ok', bytes: new Uint8Array([9]) });
      expect(seen).toEqual([SIGNED]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
