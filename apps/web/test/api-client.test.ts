import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, unwrap } from '../src/api/client.ts';
import { createQueryClient } from '../src/app.tsx';
import { getCsrfToken, setCsrfToken } from '../src/session/csrf.ts';
import { getLoginNotice, setLoginNotice } from '../src/session/login-flow.ts';
import { SESSION_KEY } from '../src/session/session.ts';
import { createFakeApi, json, problem } from './api-fake.ts';
import { logout, getCurrentSession } from '@evia/contracts';

describe('API client: CSRF header and problem handling (EVM-016 AC4, AC6; SR-SESS-10, SR-ERR-02)', () => {
  it('EVM-016 AC6 a mutation of a session carries X-CSRF-Token from memory; a read and a mutation without a token do not', async () => {
    const api = createFakeApi({
      'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }),
      'GET /api/v1/auth/session': () => json(200, {}),
    });
    const client = createApiClient(api.fetch);
    await logout({ client });
    expect(api.requests[0]?.headers.get('X-CSRF-Token')).toBeNull();
    setCsrfToken('csrf-1');
    await logout({ client });
    await getCurrentSession({ client });
    expect(api.requests[1]?.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(api.requests[2]?.headers.get('X-CSRF-Token')).toBeNull();
    expect(getCsrfToken()).toBe('csrf-1');
  });

  it('EVM-016 AC3 a problem response becomes an ApiError with status, code, trace id, field errors and Retry-After', async () => {
    const api = createFakeApi({
      'GET /api/v1/auth/session': () =>
        problem(429, 'rate_limited', { errors: [{ pointer: '/password', code: 'too_weak' }] }, { 'Retry-After': '90' }),
    });
    const failure = await unwrap(getCurrentSession({ client: createApiClient(api.fetch) })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 429,
      code: 'rate_limited',
      retryAfterSeconds: 90,
      traceId: 'abcdef0123456789abcdef0123456789',
    });
    expect((failure as ApiError).errors).toEqual([{ pointer: '/password', code: 'too_weak' }]);
  });

  it('EVM-016 AC3 a missing or invalid Retry-After is ignored, a non-problem body gets the code "unknown"', async () => {
    const api = createFakeApi({
      'GET /api/v1/auth/session': () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'Retry-After': 'soon' } }),
    });
    const failure = await unwrap(getCurrentSession({ client: createApiClient(api.fetch) })).catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 502, code: 'unknown', retryAfterSeconds: undefined });
  });

  it('EVM-016 AC3 no response at all (network failure) is status 0 "network_error"', async () => {
    const api = createFakeApi({
      'GET /api/v1/auth/session': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const failure = await unwrap(getCurrentSession({ client: createApiClient(api.fetch) })).catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('EVM-067 AC5 a 401 of any query drops the data and the CSRF token of the tab and reads the session again; a visitor without a session drops nothing', async () => {
    const client: QueryClient = createQueryClient();
    setCsrfToken('csrf-1');
    client.setQueryData(['work-orders'], ['synthetic']);
    // First read of a visitor without a session: nothing of a session to drop.
    await client
      .query({ queryKey: SESSION_KEY, queryFn: () => Promise.reject(new ApiError(401, undefined)), retry: false })
      .catch(() => undefined);
    expect(client.getQueryData(['work-orders'])).toEqual(['synthetic']);
    expect(getCsrfToken()).toBe('csrf-1');
    // A data query that is refused: the data goes, the session is read again (the gate then leaves for W-01).
    client.setQueryData(SESSION_KEY, { synthetic: true });
    await client
      .query({ queryKey: ['other'], queryFn: () => Promise.reject(new ApiError(401, undefined)), retry: false })
      .catch(() => undefined);
    expect(client.getQueryData(['work-orders'])).toBeUndefined();
    expect(client.getQueryData(['other'])).toBeUndefined();
    expect(getCsrfToken()).toBeNull();
    expect(client.getQueryState(SESSION_KEY)?.isInvalidated).toBe(true);
    // Other failures (server error, an unrelated exception) leave the session alone.
    setCsrfToken('csrf-2');
    client.setQueryData(['work-orders'], ['synthetic']);
    await client
      .query({ queryKey: ['again'], queryFn: () => Promise.reject(new ApiError(500, undefined)), retry: false })
      .catch(() => undefined);
    await client.query({ queryKey: ['again-2'], queryFn: () => Promise.reject(new Error('x')), retry: false }).catch(() => undefined);
    expect(client.getQueryData(['work-orders'])).toEqual(['synthetic']);
    expect(getCsrfToken()).toBe('csrf-2');
  });

  it('EVM-067 AC5 a session that was read and is then refused (expired) drops the other data but keeps its own error for the gate', async () => {
    const client = createQueryClient();
    setCsrfToken('csrf-1');
    client.setQueryData(['work-orders'], ['synthetic']);
    client.setQueryData(SESSION_KEY, { synthetic: true });
    await client
      .query({ queryKey: SESSION_KEY, queryFn: () => Promise.reject(new ApiError(401, undefined)), retry: false, staleTime: 0 })
      .catch(() => undefined);
    expect(client.getQueryData(['work-orders'])).toBeUndefined();
    expect(getCsrfToken()).toBeNull();
    expect(client.getQueryState(SESSION_KEY)?.status).toBe('error');
  });

  it('EVM-067 AC5 "session_expired" is noted for W-01, any other 401 is not', async () => {
    const client = createQueryClient();
    await client
      .query({ queryKey: ['a'], queryFn: () => Promise.reject(new ApiError(401, { code: 'unauthenticated' })), retry: false })
      .catch(() => undefined);
    expect(getLoginNotice()).toBeNull();
    await client
      .query({ queryKey: ['b'], queryFn: () => Promise.reject(new ApiError(401, { code: 'session_expired' })), retry: false })
      .catch(() => undefined);
    expect(getLoginNotice()).toBe('expired');
    setLoginNotice(null);
  });

  it('EVM-016 AC6 a 401 of a mutation clears the cache too', async () => {
    const client = createQueryClient();
    setCsrfToken('csrf-1');
    client.setQueryData(['work-orders'], ['synthetic']);
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(new ApiError(401, undefined)) })
      .execute(undefined)
      .catch(() => undefined);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(getCsrfToken()).toBeNull();
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(new ApiError(500, undefined)) })
      .execute(undefined)
      .catch(() => undefined);
    expect(getCsrfToken()).toBeNull();
  });
});

describe('API client: broken answers (EVM-016 AC3)', () => {
  it('EVM-016 AC3 an OK status with a body that is not JSON is a failure, not data', async () => {
    const api = createFakeApi({
      'GET /api/v1/auth/session': () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    const failure = await unwrap(getCurrentSession({ client: createApiClient(api.fetch) })).catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 200, code: 'unknown' });
  });
});
