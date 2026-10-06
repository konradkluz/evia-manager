import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, healthQueryOptions } from '../src/api/client.ts';

const HEALTH = { status: 'ok', minSupportedAppVersion: { android: '1.0.0', ios: '1.0.0' } };

describe('API client of the panel generated from the contract (EVM-008 AC2)', () => {
  it('EVM-008 AC2 web client is generated from the contract: the health query calls GET /api/health on the same origin', async () => {
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      expect(request.method).toBe('GET');
      expect(request.url).toBe(`${globalThis.location.origin}/api/health`);
      return Promise.resolve(
        new Response(JSON.stringify(HEALTH), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }),
      );
    });
    const queryClient = new QueryClient();
    const options = healthQueryOptions(createApiClient(fetch));
    expect(options.queryKey).toEqual(['health']);
    await expect(queryClient.query(options)).resolves.toEqual(HEALTH);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('EVM-008 AC2 a problem response (503) fails the query instead of returning data', async () => {
    const problem = {
      type: '/problems/service_unavailable',
      title: 'Usługa niedostępna',
      status: 503,
      code: 'service_unavailable',
      traceId: 'a'.repeat(32),
    };
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(problem), { status: 503, headers: { 'Content-Type': 'application/problem+json; charset=utf-8' } }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(queryClient.query(healthQueryOptions(createApiClient(fetch)))).rejects.toMatchObject({ code: 'service_unavailable' });
  });

  it('EVM-008 AC2 by default the client uses the browser fetch, resolved at call time', async () => {
    const browserFetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(HEALTH), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', browserFetch);
    try {
      await healthQueryOptions(createApiClient()).queryFn?.({ signal: new AbortController().signal } as never);
      expect(browserFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
