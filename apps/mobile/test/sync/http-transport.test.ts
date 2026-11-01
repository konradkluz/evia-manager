import { createHttpSyncTransport, type FetchLike } from '../../src/sync/http-transport';

const BASE = 'https://api.example.test';
const WO = '0194c2a0-0000-7000-8000-000000000001';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function harness(reply: (call: Call) => Response | null | Promise<Response | null>, pending = 4) {
  const calls: Call[] = [];
  const fetchLike: FetchLike = async (url, init) => {
    const call = { url, init: init ?? {} };
    calls.push(call);
    return reply(call);
  };
  const transport = createHttpSyncTransport({
    baseUrl: BASE,
    fetch: fetchLike,
    pendingItems: () => pending,
    timeoutMs: 50,
  });
  return { transport, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('http sync transport (EVM-107 AC2, AC5, AC8)', () => {
  it('EVM-107 AC2: sendBatch posts the contract envelope plus the count it was given (it does not count itself)', async () => {
    const { transport, calls } = harness(() => json(200, { serverTime: '2026-11-02T08:00:00Z', results: [] }));
    const mutation = { mutationId: 'a', type: 'CreateNote' as const, commandVersion: 1, payload: { x: 1 } };
    const result = await transport.sendBatch({ mutations: [mutation], pendingItems: 7 });
    expect(result).toEqual({ kind: 'ok', body: { serverTime: '2026-11-02T08:00:00Z', results: [] } });
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/sync/mutations`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ mutations: [mutation], pendingItems: 7 });
  });

  it('EVM-107 AC2: getChanges sends cursor, limit and the pending count of the provider; the cursor is encoded', async () => {
    const { transport, calls } = harness(() => json(200, { result: 'changes' }), 9);
    await transport.getChanges({ cursor: 'abc_DEF-0123456789&x=1', limit: 200 });
    await transport.getChanges({ limit: 50 });
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/sync/changes?limit=200&pendingItems=9&cursor=abc_DEF-0123456789%26x%3D1`);
    expect(calls[1]?.url).toBe(`${BASE}/api/v1/sync/changes?limit=50&pendingItems=9`);
    expect(calls[0]?.init.method).toBe('GET');
  });

  it('EVM-107 AC2: a pending count that is not a safe integer is sent as 0 (never a negative or fractional number)', async () => {
    const calls: Call[] = [];
    const transport = createHttpSyncTransport({
      baseUrl: BASE,
      fetch: (url, init) => {
        calls.push({ url, init: init ?? {} });
        return Promise.resolve(json(200, {}));
      },
      pendingItems: () => -3.5,
    });
    await transport.getChanges({ limit: 10 });
    expect(calls[0]?.url).toContain('pendingItems=0');
  });

  it('EVM-107 AC1: the work order id is a UUID and is encoded into the path; anything else is not sent', async () => {
    const { transport, calls } = harness(() => json(200, { entities: [] }));
    await transport.getWorkOrderSnapshot(WO);
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/sync/work-orders/${WO}`);
    const bad = await transport.getWorkOrderSnapshot('../../auth/logout');
    expect(bad).toEqual({ kind: 'network' });
    expect(calls).toHaveLength(1);
  });

  it('EVM-107 AC1: client config comes from the meta endpoint', async () => {
    const { transport, calls } = harness(() => json(200, { scopeRuleVersion: 3 }));
    expect(await transport.getClientConfig()).toEqual({ kind: 'ok', body: { scopeRuleVersion: 3 } });
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/meta/client-config`);
  });

  it('EVM-107 AC5: 401, 403 and 426 are mapped to status and allow-listed code; the body, the message and the headers do not travel on', async () => {
    const cases: [number, unknown, string | undefined][] = [
      [401, { code: 'session_revoked', message: 'Jan Kowalski ul. Testowa 1' }, 'session_revoked'],
      [401, { code: 'device_wipe_required' }, 'device_wipe_required'],
      [403, { code: 'channel_not_allowed', detail: 'secret' }, 'channel_not_allowed'],
      [403, { code: 'forbidden' }, 'forbidden'],
      [426, { code: 'client_version_unsupported' }, 'client_version_unsupported'],
    ];
    for (const [status, body, code] of cases) {
      const { transport } = harness(() => json(status, body, { 'X-Secret': 'v' }));
      const result = await transport.sendBatch({ mutations: [], pendingItems: 0 });
      expect(result).toEqual({ kind: 'http', status, code });
      expect(JSON.stringify(result)).not.toMatch(/Kowalski|secret/);
    }
  });

  it('EVM-107 AC5: an unusual or missing code is dropped (allow-list), the status stays', async () => {
    for (const body of [{ code: 'Has Spaces & text' }, { code: 42 }, { code: 'x'.repeat(100) }, 'text', null, {}]) {
      const { transport } = harness(() => json(401, body));
      expect(await transport.sendBatch({ mutations: [], pendingItems: 0 })).toEqual({ kind: 'http', status: 401 });
    }
    const { transport } = harness(() => new Response('<html>', { status: 502 }));
    expect(await transport.getClientConfig()).toEqual({ kind: 'http', status: 502 });
  });

  it('EVM-107 AC8: 429 carries Retry-After (seconds or HTTP date) as given; the core clamps it', async () => {
    const seconds = harness(() => json(429, { code: 'rate_limited' }, { 'Retry-After': '30' }));
    expect(await seconds.transport.getChanges({ limit: 1 })).toEqual({ kind: 'http', status: 429, code: 'rate_limited', retryAfter: '30' });
    const date = harness(() => json(429, {}, { 'Retry-After': 'Mon, 02 Nov 2026 08:00:00 GMT' }));
    expect(await date.transport.getChanges({ limit: 1 })).toEqual({
      kind: 'http',
      status: 429,
      retryAfter: 'Mon, 02 Nov 2026 08:00:00 GMT',
    });
    const none = harness(() => json(429, {}));
    expect(await none.transport.getChanges({ limit: 1 })).toEqual({ kind: 'http', status: 429 });
  });

  it('EVM-107 AC8: no answer (null, an exception, a timeout), or an unreadable 2xx body, is a network failure without a cause', async () => {
    expect(await harness(() => null).transport.getClientConfig()).toEqual({ kind: 'network' });
    expect(
      await harness(() => {
        throw new Error('https://api.example.test/secret?token=abc');
      }).transport.sendBatch({ mutations: [], pendingItems: 0 }),
    ).toEqual({ kind: 'network' });
    const slow = harness(() => new Promise<Response | null>(() => undefined));
    expect(await slow.transport.getClientConfig()).toEqual({ kind: 'network' });
    expect(await harness(() => new Response('not json', { status: 200 })).transport.getClientConfig()).toEqual({ kind: 'network' });
    expect(await harness(() => new Response(null, { status: 204 })).transport.getClientConfig()).toEqual({ kind: 'network' });
  });

  it('EVM-107 AC8: the cancel signal stops the request; after it every call is a network failure', async () => {
    const controller = new AbortController();
    const calls: Call[] = [];
    const transport = createHttpSyncTransport({
      baseUrl: BASE,
      fetch: (url, init) => {
        calls.push({ url, init: init ?? {} });
        return Promise.resolve(json(200, {}));
      },
      pendingItems: () => 0,
      signal: controller.signal,
    });
    controller.abort();
    expect(await transport.getClientConfig()).toEqual({ kind: 'network' });
    expect(calls).toHaveLength(0);
  });

  it('EVM-107 AC1: a base address that is not https (and not allowed plain http) sends nothing', async () => {
    const calls: Call[] = [];
    const transport = createHttpSyncTransport({
      baseUrl: 'http://api.example.test',
      fetch: (url, init) => {
        calls.push({ url, init: init ?? {} });
        return Promise.resolve(json(200, {}));
      },
      pendingItems: () => 0,
    });
    expect(await transport.getClientConfig()).toEqual({ kind: 'network' });
    expect(calls).toHaveLength(0);
    const local = createHttpSyncTransport({
      baseUrl: 'http://10.0.2.2:3000',
      allowLocalHttp: true,
      fetch: (url, init) => {
        calls.push({ url, init: init ?? {} });
        return Promise.resolve(json(200, {}));
      },
      pendingItems: () => 0,
    });
    await local.getClientConfig();
    expect(calls).toHaveLength(1);
  });
});
