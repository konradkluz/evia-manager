import type { MediaAsset } from '@evia/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/api/client.ts';
import { UploadEngine, findUnfinished, type EngineDeps, type PutResult } from '../src/work-orders/media-upload-engine.ts';
import { json, parseBody, problem } from './api-fake.ts';
import { MEDIA_BASE, asset, mediaApi, unfinished } from './media-api.ts';
import { ORDER_ID } from './work-order-api.ts';

const HASH = 'a'.repeat(64);
const jpeg = (name: string, size = 1000) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
const types = (files: File[]) => new Map(files.map((file) => [file, 'image/jpeg']));
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(api = mediaApi(), overrides: Partial<EngineDeps> = {}) {
  const puts: { url: string; size: number }[] = [];
  const put = vi.fn((url: string, body: Blob, _signal: AbortSignal, onProgress: (loaded: number) => void): Promise<PutResult> => {
    puts.push({ url, size: body.size });
    onProgress(body.size);
    return Promise.resolve({ ok: true, status: 200 });
  });
  let n = 0;
  const engine = new UploadEngine({
    client: createApiClient(api.fetch),
    workOrderId: ORDER_ID,
    hash: () => Promise.resolve(HASH),
    put,
    isOnline: () => true,
    whenOnline: () => Promise.resolve(),
    newId: () => `01968f3e-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
    ...overrides,
  });
  return { engine, put, puts, api };
}

async function settle(engine: UploadEngine, done: (statuses: string[]) => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (done(engine.getSnapshot().map((item) => item.status))) return;
    await tick();
  }
  throw new Error(
    `not settled: ${engine
      .getSnapshot()
      .map((item) => item.status)
      .join(',')}`,
  );
}

describe('EVM-044 AC1 the upload engine: the media of a batch, the session, the parts, complete', () => {
  it('EVM-044 AC1 creates the media of the batch in ONE request, then per file the session, the parts and complete; the PUT has no cookies', async () => {
    const { engine, puts, api } = setup();
    const files = [jpeg('IMG_0412.jpg'), jpeg('IMG_0413.jpg')];
    await engine.add(files, { category: 'in_progress', description: ' ', contentTypes: types(files) });
    await settle(engine, (all) => all.every((status) => status === 'checking'));

    const [create] = api.calls(`POST ${MEDIA_BASE}`);
    const sent = parseBody(create?.body ?? '{}') as { items: Record<string, unknown>[] };
    expect(sent.items).toHaveLength(2);
    expect(sent.items[0]).toMatchObject({
      category: 'in_progress',
      fileName: 'IMG_0412.jpg',
      declaredSize: 1000,
      contentType: 'image/jpeg',
      sha256: HASH,
    });
    expect(sent.items[0]).not.toHaveProperty('description');
    expect(create?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/upload-sessions'))).toHaveLength(2);
    expect(puts).toHaveLength(2);
    expect(puts[0]?.url).toContain('bucket.example.test');
    expect(api.requests.filter((entry) => entry.path.endsWith('/complete'))).toHaveLength(2);
    expect(engine.hasUnsent()).toBe(false);
    expect(engine.getSnapshot().map((item) => item.name)).toEqual(['IMG_0412.jpg', 'IMG_0413.jpg']);
  });

  it('EVM-044 AC1 a file is cut into the parts of the session and only the parts the server does not have are sent (resume from ListParts)', async () => {
    const api = mediaApi({ partCount: 3, confirmedParts: [1] });
    const { engine, puts } = setup(api);
    // the plan of the fake: parts of 16 MiB, so a file of 40 MiB has 3 parts; the first is already confirmed
    const big = new File([new Uint8Array(40 * 1024 * 1024)], 'IMG_BIG.jpg', { type: 'image/jpeg' });
    await engine.add([big], { category: 'before_work', description: '', contentTypes: types([big]) });
    await settle(engine, (all) => all.every((status) => status === 'checking'));
    expect(puts.map((entry) => entry.size)).toEqual([16_777_216, 40 * 1024 * 1024 - 2 * 16_777_216]);
    expect(api.requests.filter((entry) => entry.path.endsWith('/url')).map((entry) => entry.path.split('/').at(-2))).toEqual(['2', '3']);
  });

  it('EVM-044 AC4 a file chosen again that fits an unfinished session resumes it: no new medium, no new session', async () => {
    const waiting = unfinished(7, 'IMG_0412.jpg', 1000);
    const api = mediaApi({ unfinished: [waiting] });
    const { engine, puts } = setup(api);
    const files = [jpeg('IMG_0412.jpg')];
    await engine.add(files, {
      category: 'in_progress',
      description: '',
      contentTypes: types(files),
      unfinished: [
        {
          mediaAssetId: waiting.id,
          name: 'IMG_0412.jpg',
          size: 1000,
          session: { id: waiting.uploadSession?.id ?? '', partSize: 16_777_216, partCount: 1 },
        },
      ],
    });
    await settle(engine, (all) => all.every((status) => status === 'checking'));
    expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(0);
    expect(api.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/upload-sessions'))).toHaveLength(0);
    expect(api.requests.some((entry) => entry.path.includes(`/upload-sessions/${waiting.uploadSession?.id ?? ''}/parts`))).toBe(true);
    expect(puts).toHaveLength(1);
    expect(engine.getSnapshot()[0]?.key).toBe(waiting.id);
  });

  it('EVM-044 AC4 findUnfinished matches by name and size and takes each session once', () => {
    const entry = { mediaAssetId: 'm1', name: 'a.jpg', size: 5, session: { id: 's', partSize: 1, partCount: 1 } };
    expect(findUnfinished({ name: 'a.jpg', size: 5 }, [entry], new Set())).toBe(entry);
    expect(findUnfinished({ name: 'a.jpg', size: 6 }, [entry], new Set())).toBeUndefined();
    expect(findUnfinished({ name: 'b.jpg', size: 5 }, [entry], new Set())).toBeUndefined();
    expect(findUnfinished({ name: 'a.jpg', size: 5 }, [entry], new Set(['m1']))).toBeUndefined();
  });
});

describe('EVM-044 AC1 AC3 AC5 the verdicts of the server reach the files of the tab', () => {
  async function checking() {
    const ctx = setup();
    const files = [jpeg('IMG_0412.jpg')];
    await ctx.engine.add(files, { category: 'in_progress', description: '', contentTypes: types(files) });
    await settle(ctx.engine, (all) => all.every((status) => status === 'checking'));
    return { ...ctx, key: ctx.engine.getSnapshot()[0]?.key ?? '' };
  }
  const as = (id: string, extra: Partial<MediaAsset>): MediaAsset => asset(1, { id, ...extra });

  it('EVM-044 AC1 clean becomes "done"; scanning keeps "Sprawdzanie pliku"', async () => {
    const { engine, key } = await checking();
    engine.applyServerStates([as(key, { fileState: 'scanning' })]);
    expect(engine.getSnapshot()[0]?.status).toBe('checking');
    engine.applyServerStates([as(key, { fileState: 'clean' })]);
    expect(engine.getSnapshot()[0]?.status).toBe('done');
    engine.applyServerStates([as(key, { fileState: 'failed' })]);
    expect(engine.getSnapshot()[0]?.status).toBe('done');
  });

  it('EVM-044 AC3 a quarantined file is "attention" ("Wymaga uwagi"), without a reason', async () => {
    const { engine, key } = await checking();
    engine.applyServerStates([as(key, { fileState: 'quarantined', needsAttention: true })]);
    expect(engine.getSnapshot()[0]).toMatchObject({ status: 'attention', failure: null });
  });

  it('EVM-044 AC5 failed with checksum_mismatch is a failure "checksum"; "Ponów" opens a NEW session for the same medium and sends from the memory of the tab', async () => {
    const { engine, key, api, puts } = await checking();
    engine.applyServerStates([as(key, { fileState: 'failed', stateReasonCode: 'checksum_mismatch' })]);
    expect(engine.getSnapshot()[0]).toMatchObject({ status: 'failed', failure: 'checksum' });
    expect(engine.hasUnsent()).toBe(true);
    const sessionsBefore = api.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/upload-sessions')).length;
    engine.retry(key);
    await settle(engine, (all) => all.every((status) => status === 'checking'));
    const sessions = api.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/upload-sessions'));
    expect(sessions).toHaveLength(sessionsBefore + 1);
    expect(sessions.every((entry) => entry.path.includes(`/media-assets/${key}/`))).toBe(true);
    expect(puts).toHaveLength(2);
  });

  it('EVM-044 AC1 a verdict for a file that is not in the queue, or is still being sent, changes nothing', async () => {
    const { engine, key } = await checking();
    engine.applyServerStates([asset(99, { fileState: 'clean' })]);
    expect(engine.getSnapshot()).toHaveLength(1);
    engine.pause(key);
    expect(engine.getSnapshot()[0]?.status).toBe('checking');
  });
});

describe('EVM-044 AC8 states: offline, 429, errors, "Wstrzymaj"', () => {
  it('EVM-044 AC8 a failed PUT while offline pauses the file and it resumes from ListParts when the connection is back', async () => {
    let online = false;
    let back: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      back = resolve;
    });
    const api = mediaApi();
    let first = true;
    const { engine, puts } = setup(api, {
      isOnline: () => online,
      whenOnline: () => waiting,
      put: (url, body, _signal, onProgress) => {
        if (first) {
          first = false;
          return Promise.reject(new Error('put_failed'));
        }
        puts.push({ url, size: body.size });
        onProgress(body.size);
        return Promise.resolve({ ok: true, status: 200 });
      },
    });
    const files = [jpeg('IMG_0412.jpg')];
    await engine.add(files, { category: 'in_progress', description: '', contentTypes: types(files) });
    await settle(engine, (all) => all[0] === 'paused');
    expect(engine.getSnapshot()[0]).toMatchObject({ status: 'paused', byPerson: false });
    expect(engine.hasUnsent()).toBe(true);
    online = true;
    back();
    await settle(engine, (all) => all[0] === 'checking');
    expect(puts).toHaveLength(1);
    expect(api.requests.filter((entry) => entry.path.endsWith('/parts'))).toHaveLength(2);
  });

  it('EVM-044 AC8 429 on the creation of the media is a failure "rate" with the Retry-After; "Ponów" repeats the SAME batch with the same Idempotency-Key', async () => {
    let attempts = 0;
    const api = mediaApi({
      create: (request) => {
        attempts += 1;
        if (attempts === 1) return problem(429, 'rate_limited', {}, { 'Retry-After': '60' });
        const body = parseBody(request.body) as { items: { id: string }[] };
        return json(201, { items: body.items.map((item) => asset(1, { id: item.id, fileState: 'pending_upload' })) });
      },
    });
    const { engine } = setup(api);
    const files = [jpeg('IMG_0412.jpg')];
    await engine.add(files, { category: 'in_progress', description: '', contentTypes: types(files) });
    expect(engine.getSnapshot()[0]).toMatchObject({ status: 'failed', failure: 'rate', retryAfterSeconds: 60 });
    const key = engine.getSnapshot()[0]?.key ?? '';
    engine.retry(key);
    await settle(engine, (all) => all[0] === 'checking');
    const [first, second] = api.calls(`POST ${MEDIA_BASE}`);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect(second?.body).toBe(first?.body);
  });

  it('EVM-044 AC8 503 media_storage_unavailable, 5xx, 4xx and 422 upload_incomplete are told apart', async () => {
    const cases: [number, string, string][] = [
      [503, 'media_storage_unavailable', 'storage'],
      [500, 'internal_error', 'network'],
      [404, 'not_found', 'server'],
      [422, 'upload_incomplete', 'incomplete'],
    ];
    for (const [status, code, failure] of cases) {
      const api = mediaApi({ complete: () => problem(status, code) });
      const { engine } = setup(api);
      const files = [jpeg('IMG_0412.jpg')];
      await engine.add(files, { category: 'in_progress', description: '', contentTypes: types(files) });
      await settle(engine, (all) => all[0] === 'failed');
      expect(engine.getSnapshot()[0]?.failure, `${String(status)} ${code}`).toBe(failure);
    }
  });

  it('EVM-044 AC8 an address the bucket refuses twice fails the file; a refusal once is retried with a new address', async () => {
    const statuses = [403, 200];
    const api = mediaApi();
    const { engine, puts } = setup(api, {
      put: (url, body, _signal, onProgress) => {
        const status = statuses.shift() ?? 200;
        puts.push({ url, size: body.size });
        onProgress(body.size);
        return Promise.resolve({ ok: status === 200, status });
      },
    });
    const files = [jpeg('IMG_0412.jpg')];
    await engine.add(files, { category: 'in_progress', description: '', contentTypes: types(files) });
    await settle(engine, (all) => all[0] === 'checking');
    expect(puts).toHaveLength(2);
    expect(api.requests.filter((entry) => entry.path.endsWith('/url'))).toHaveLength(2);

    statuses.push(403, 403);
    const second = setup(mediaApi(), {
      put: () => Promise.resolve({ ok: false, status: statuses.shift() ?? 403 }),
    });
    const more = [jpeg('IMG_0413.jpg')];
    await second.engine.add(more, { category: 'in_progress', description: '', contentTypes: types(more) });
    await settle(second.engine, (all) => all[0] === 'failed');
    expect(second.engine.getSnapshot()[0]?.failure).toBe('server');
  });

  it('EVM-044 AC8 "Wstrzymaj" stops the part in flight without aborting the session and "Wznów" continues', async () => {
    let release: (result: PutResult) => void = () => undefined;
    let signalSeen: AbortSignal | null = null;
    let calls = 0;
    const api = mediaApi();
    const { engine } = setup(api, {
      put: (_url, _body, signal) => {
        calls += 1;
        if (calls === 1) {
          signalSeen = signal;
          return new Promise<PutResult>((resolve, reject) => {
            release = resolve;
            signal.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
        }
        return Promise.resolve({ ok: true, status: 200 });
      },
    });
    const files = [jpeg('IMG_0412.jpg')];
    void engine.add(files, { category: 'in_progress', description: '', contentTypes: types(files) });
    await settle(engine, (all) => all[0] === 'uploading');
    const key = engine.getSnapshot()[0]?.key ?? '';
    await tick();
    engine.pause(key);
    expect(engine.getSnapshot()[0]).toMatchObject({ status: 'paused', byPerson: true });
    await tick();
    expect((signalSeen as AbortSignal | null)?.aborted).toBe(true);
    expect(api.requests.some((entry) => entry.path.endsWith('/abort'))).toBe(false);
    release({ ok: true, status: 200 });
    engine.resume(key);
    await settle(engine, (all) => all[0] === 'checking');
    expect(calls).toBe(2);
    // pause and resume of a file that is neither running nor paused change nothing
    engine.pause(key);
    engine.resume(key);
    engine.retry(key);
    engine.retry('missing');
    expect(engine.getSnapshot()[0]?.status).toBe('checking');
  });

  it('EVM-044 AC1 a hash that cannot be computed fails the file and "Ponów" computes it again, then creates the media', async () => {
    let attempts = 0;
    const { engine, api } = setup(mediaApi(), {
      hash: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('hash_failed')) : Promise.resolve(HASH);
      },
    });
    const files = [jpeg('IMG_0412.jpg')];
    await engine.add(files, { category: 'in_progress', description: '', contentTypes: types(files) });
    expect(engine.getSnapshot()[0]).toMatchObject({ status: 'failed', failure: 'server' });
    expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(0);
    engine.retry(engine.getSnapshot()[0]?.key ?? '');
    await settle(engine, (all) => all[0] === 'checking');
    expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(1);
  });

  it('EVM-044 AC1 at most 50 files go in one batch (the limit of the API)', async () => {
    const { engine, api } = setup();
    const files = Array.from({ length: 52 }, (_, index) => jpeg(`IMG_${String(index)}.jpg`, 10));
    await engine.add(files, { category: 'other', description: 'Opis', contentTypes: types(files) });
    await settle(engine, (all) => all.length === 50 && all.every((status) => status === 'checking'));
    const [create] = api.calls(`POST ${MEDIA_BASE}`);
    const sent = parseBody(create?.body ?? '{}') as { items: Record<string, unknown>[] };
    expect(sent.items).toHaveLength(50);
    expect(sent.items[0]?.['description']).toBe('Opis');
  });

  it('EVM-044 AC1 the listener is told about every change and can unsubscribe', async () => {
    const { engine } = setup();
    const listener = vi.fn();
    const off = engine.subscribe(listener);
    const files = [jpeg('IMG_0412.jpg')];
    await engine.add(files, { category: 'in_progress', description: '', contentTypes: types(files) });
    await settle(engine, (all) => all[0] === 'checking');
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;
    off();
    engine.applyServerStates([asset(1, { id: engine.getSnapshot()[0]?.key ?? '', fileState: 'clean' })]);
    expect(listener.mock.calls.length).toBe(calls);
  });
});
