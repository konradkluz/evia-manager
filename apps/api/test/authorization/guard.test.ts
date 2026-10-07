import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { POLICY_SOURCE } from '../../src/modules/authorization/index.ts';
import { ANONYMOUS, SESSION_RESOLVER } from '../../src/platform/http/principal.ts';
import { principal, resolverOf } from '../support/principals.ts';
import { createTestApp, PANEL_ORIGIN, type TestApp } from '../support/app.ts';
import { ProtectedRouteController, ProtectedRouteModule, TEST_POLICIES } from '../support/test-routes.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const withProtectedRoute = (resolver: ReturnType<typeof resolverOf>) =>
  createTestApp({
    imports: [ProtectedRouteModule],
    configure: (builder) =>
      builder.overrideProvider(POLICY_SOURCE).useValue(TEST_POLICIES).overrideProvider(SESSION_RESOLVER).useValue(resolver),
  });

const calls = (app: TestApp): number => app.app.get(ProtectedRouteController).helper();

describe('authorization guard on a protected operation (EVM-008 AC4; SR-AUTHZ-01, SR-ERR-01)', () => {
  it('EVM-008 AC4 a protected operation without a session is 401 and the handler never runs', async () => {
    current = await withProtectedRoute(resolverOf(ANONYMOUS));
    const response = await request(current.app.getHttpServer()).get('/api/v1/test-widgets').expect(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
    expect(calls(current)).toBe(0);
  });

  it('EVM-016 AC8 an Administrator on the web channel reaches the handler; another role or channel is 403 and the handler never runs', async () => {
    current = await withProtectedRoute(resolverOf({ principal: principal() }));
    await request(current.app.getHttpServer()).get('/api/v1/test-widgets').expect(200);
    expect(calls(current)).toBe(1);
    for (const denied of [{ role: 'editor' }, { role: 'read_only' }, { channel: 'mobile' }] as const) {
      await current.close();
      current = await withProtectedRoute(resolverOf({ principal: principal(denied) }));
      const response = await request(current.app.getHttpServer()).get('/api/v1/test-widgets').expect(403);
      expect(response.body, JSON.stringify(denied)).toMatchObject({ code: 'forbidden' });
      expect(calls(current)).toBe(0);
    }
  });

  it('EVM-016 AC4 a session in mfa_enrollment is 403 mfa_enrollment_required for every operation outside the enrolment list', async () => {
    current = await withProtectedRoute(resolverOf({ principal: principal({ state: 'mfa_enrollment' }) }));
    const response = await request(current.app.getHttpServer()).get('/api/v1/test-widgets').expect(403);
    expect(response.body).toMatchObject({ code: 'mfa_enrollment_required' });
    expect(calls(current)).toBe(0);
  });

  it('EVM-016 AC6 a revoked session is 401 session_revoked', async () => {
    current = await withProtectedRoute(resolverOf({ principal: null, reason: 'revoked' }));
    const response = await request(current.app.getHttpServer()).get('/api/v1/test-widgets').expect(401);
    expect(response.body).toMatchObject({ code: 'session_revoked' });
  });

  it('EVM-016 AC8 the query string is checked against the parameters of the contract after the access decision (400)', async () => {
    current = await withProtectedRoute(resolverOf({ principal: principal() }));
    const server = current.app.getHttpServer();
    expect((await request(server).get('/api/v1/test-widgets?limit=5').expect(400)).body).toMatchObject({ code: 'unknown_parameter' });
    await current.close();
    const declared = {
      ...TEST_POLICIES,
      manifest: {
        ...TEST_POLICIES.manifest,
        listTestWidgets: {
          method: 'get',
          path: '/api/v1/test-widgets',
          query: ['limit'],
          authz: { roles: ['administrator'], channels: ['web'] },
        },
      },
    };
    current = await createTestApp({
      imports: [ProtectedRouteModule],
      configure: (builder) =>
        builder
          .overrideProvider(POLICY_SOURCE)
          .useValue(declared)
          .overrideProvider(SESSION_RESOLVER)
          .useValue(resolverOf({ principal: principal() })),
    });
    const served = current.app.getHttpServer();
    await request(served).get('/api/v1/test-widgets?limit=5').expect(200);
    expect((await request(served).get('/api/v1/test-widgets?limit=5&limit=6').expect(400)).body).toMatchObject({
      code: 'duplicate_parameter',
    });
    expect((await request(served).get('/api/v1/test-widgets?limit=5&other=1').expect(400)).body).toMatchObject({
      code: 'unknown_parameter',
    });
    expect((await request(served).get('/api/v1/test-widgets?filter[a]=1').expect(400)).body).toMatchObject({ code: 'unknown_parameter' });
  });

  it('EVM-016 AC6 a mutation of a session passes the guard only with the Origin of the panel, Sec-Fetch-Site and the CSRF token of the session', async () => {
    current = await withProtectedRoute(resolverOf({ principal: principal() }));
    const server = current.app.getHttpServer();
    const token = principal().csrfToken;
    const post = (headers: Record<string, string>) =>
      request(server).post('/api/v1/test-widgets').set(headers).set('Content-Type', 'application/json').send('{}');
    const good = { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Token': token };
    expect((await post(good)).status).toBe(201);
    expect(calls(current)).toBe(1);
    for (const headers of [
      { ...good, 'X-CSRF-Token': `${token}x` },
      { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
      { ...good, Origin: 'https://attacker.invalid' },
      { ...good, 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const response = await post(headers);
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(response.body).toMatchObject({ code: 'csrf_failed' });
    }
    expect(calls(current)).toBe(1);
  });

  it('EVM-008 AC4 an error while resolving the session denies the request (401, fail closed) and is logged without details', async () => {
    current = await withProtectedRoute(resolverOf(() => Promise.reject(new Error('synthetic session store failure'))));
    const response = await request(current.app.getHttpServer()).get('/api/v1/test-widgets').expect(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
    expect(calls(current)).toBe(0);
    const entry = current.logs.entries.find((item) => item['msg'] === 'session lookup failed; the request continues without a principal');
    expect(entry).toMatchObject({ level: 'warn' });
    expect(current.logs.text).not.toContain('synthetic session store failure at');
  });
});
