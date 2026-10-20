import { createHealthClient } from '../src/api/health';
import type { HealthClientOptions } from '../src/api/health';

const BASE_URL = 'https://api.example.test';

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, ...init });
}

function client(fetchImpl: (request: Request) => Promise<Response>, overrides: Partial<HealthClientOptions> = {}) {
  return createHealthClient({ baseUrl: BASE_URL, platform: 'android', appVersion: '0.1.0', fetch: fetchImpl, timeoutMs: 50, ...overrides });
}

const OK = { status: 'ok', minSupportedAppVersion: { android: '1.0.0', ios: '2.0.0' } };

describe('API health client (EVM-009 AC2, AC3, AC6)', () => {
  it('EVM-009 AC2: a valid answer of GET /api/health gives the minimum versions', async () => {
    const result = await client(() => Promise.resolve(json(OK))).fetchHealth();
    expect(result).toEqual({ kind: 'ok', minSupportedAppVersion: { android: '1.0.0', ios: '2.0.0' } });
  });

  it('EVM-009 AC2: the request goes to the configured address over GET without a body', async () => {
    const seen: Request[] = [];
    await client((request) => {
      seen.push(request);
      return Promise.resolve(json(OK));
    }).fetchHealth();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.url).toBe(`${BASE_URL}/api/health`);
  });

  it('EVM-009 AC3: every request carries X-Client-Platform and X-Client-Version in one place (api-guidelines, minimum app version)', async () => {
    let headers: Headers | undefined;
    await client(
      (request) => {
        headers = request.headers;
        return Promise.resolve(json(OK));
      },
      { platform: 'ios', appVersion: '3.4.5' },
    ).fetchHealth();
    expect(headers?.get('X-Client-Platform')).toBe('ios');
    expect(headers?.get('X-Client-Version')).toBe('3.4.5');
  });

  it('EVM-009 AC3: the contract changes only additively — an extra field and an extra platform still give a valid answer', async () => {
    const result = await client(() =>
      Promise.resolve(json({ ...OK, buildInfo: 'x', minSupportedAppVersion: { ...OK.minSupportedAppVersion, windows: '9.0.0' } })),
    ).fetchHealth();
    expect(result).toEqual({ kind: 'ok', minSupportedAppVersion: { android: '1.0.0', ios: '2.0.0' } });
  });

  it('EVM-009 AC2: a rejected request (no network, DNS, refused connection) is reported as "network"', async () => {
    const result = await client(() => Promise.reject(new TypeError('Network request failed'))).fetchHealth();
    expect(result).toEqual({ kind: 'network' });
  });

  it('EVM-009 AC2: no answer within the time limit is reported as "timeout", also when the transport ignores the abort signal', async () => {
    const result = await client(() => new Promise<Response>(() => undefined)).fetchHealth();
    expect(result).toEqual({ kind: 'timeout' });
  });

  it('EVM-009 AC2: an abort of the transport inside the time limit is reported as "timeout"', async () => {
    const result = await client(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    ).fetchHealth();
    expect(result).toEqual({ kind: 'timeout' });
  });

  it.each([503, 500, 404])('EVM-009 AC2: HTTP %i (a problem+json answer or a proxy page) is reported as "server"', async (status) => {
    const result = await client(() => Promise.resolve(json({ code: 'service_unavailable' }, { status }))).fetchHealth();
    expect(result).toEqual({ kind: 'server' });
  });

  it('EVM-009 AC2: a non-JSON answer with status 200 is reported as "invalid"', async () => {
    const result = await client(() => Promise.resolve(new Response('<html>portal</html>', { status: 200 }))).fetchHealth();
    expect(result).toEqual({ kind: 'invalid' });
  });

  it.each([
    ['wrong status literal', { ...OK, status: 'degraded' }],
    ['missing minimum versions', { status: 'ok' }],
    ['version of a platform is not a string', { status: 'ok', minSupportedAppVersion: { android: 1, ios: '1.0.0' } }],
  ])('EVM-009 AC6: an answer that does not match the contract (%s) is reported as "invalid"', async (_name, body) => {
    const result = await client(() => Promise.resolve(json(body))).fetchHealth();
    expect(result).toEqual({ kind: 'invalid' });
  });

  it('EVM-009 AC6: results never carry the address or the content of the answer (SR-LOG-08)', async () => {
    const secretBody = { code: 'x', detail: 'user@example.test', url: BASE_URL };
    for (const result of [
      await client(() => Promise.resolve(json(secretBody, { status: 500 }))).fetchHealth(),
      await client(() => Promise.reject(new TypeError(`failed ${BASE_URL}`))).fetchHealth(),
      await client(() => Promise.resolve(json({ ...secretBody, status: 'nope' }))).fetchHealth(),
    ]) {
      expect(JSON.stringify(result)).not.toContain('example.test');
    }
  });
});
