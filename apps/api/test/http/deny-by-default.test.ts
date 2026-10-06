import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { RoutePolicyCheck } from '../../src/modules/authorization/index.ts';
import { SESSION_RESOLVER } from '../../src/platform/http/principal.ts';
import { DATABASE_PROBE } from '../../src/platform/tokens.ts';
import { createTestApp, type TestApp } from '../support/app.ts';
import { principal, resolverOf } from '../support/principals.ts';
import { FailingRouteModule, RouteWithoutPolicyModule } from '../support/test-routes.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const METHODS = ['get', 'post', 'put', 'delete', 'options', 'head', 'patch'] as const;
const PATHS = [
  '/',
  '/api',
  '/api/',
  '/api/v1',
  '/api/v1/work-orders',
  '/api/v1/work-orders/0190a1b2-0000-7000-8000-000000000000',
  '/api/nieistniejaca',
  '/api/health/',
  '/API/health',
  '/api/health/../v1/work-orders',
  '/api/%2e%2e/health',
  '//api/health/../x',
  '/api/health%2F',
];

const healthy = () =>
  createTestApp({ configure: (builder) => builder.overrideProvider(DATABASE_PROBE).useValue({ ping: () => Promise.resolve() }) });

describe('deny-by-default (EVM-008 AC4; SR-AUTHZ-01, ADR-0001)', () => {
  it('EVM-008 AC4 unauthenticated request to any resource except health returns 401 problem', async () => {
    current = await healthy();
    const server = current.app.getHttpServer();
    for (const path of PATHS) {
      for (const method of METHODS) {
        const response = await request(server)[method](path);
        expect(response.status, `${method.toUpperCase()} ${path}`).toBe(401);
        expect(response.headers['content-type'], `${method} ${path}`).toBe('application/problem+json; charset=utf-8');
        if (method !== 'head') {
          expect(response.body).toMatchObject({ type: '/problems/unauthenticated', status: 401, code: 'unauthenticated' });
          expect(response.text).not.toMatch(/Cannot|nieistniejaca|work-orders/);
        }
      }
    }
    for (const method of ['post', 'put', 'delete', 'options', 'patch'] as const) {
      expect((await request(server)[method]('/api/health')).status, `${method} /api/health`).toBe(401);
    }
  });

  it('EVM-008 AC4 unauthenticated request with malformed, oversized or badly encoded body returns 401', async () => {
    current = await healthy();
    const server = current.app.getHttpServer();
    const bodies: Array<[string, string, string]> = [
      ['malformed JSON', 'application/json', '{"a":'],
      ['oversized JSON', 'application/json', JSON.stringify({ a: 'x'.repeat(110_000) })],
      ['unsupported charset', 'application/json; charset=latin9', '{}'],
    ];
    for (const path of ['/api/v1/work-orders', '/api/v1/x', '/api/health']) {
      for (const [label, contentType, body] of bodies) {
        const response = await request(server).post(path).set('Content-Type', contentType).send(body);
        expect(response.status, `${label} → POST ${path}`).toBe(401);
        expect(response.body, `${label} → POST ${path}`).toMatchObject({ code: 'unauthenticated', status: 401 });
      }
    }
  });

  it('EVM-008 AC4 credentials sent by the client do not open anything before sessions exist (no bypass)', async () => {
    current = await healthy();
    const server = current.app.getHttpServer();
    const forged = {
      Authorization: 'Bearer synthetic-token',
      Cookie: '__Host-evia_session=synthetic-session; session=x',
      'X-Test-User': 'administrator',
      'X-User-Role': 'administrator',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    };
    const denied = await request(server).get('/api/v1/work-orders').set(forged).expect(401);
    expect((denied.body as { traceId: string }).traceId).not.toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    await request(server).get('/api/health').set(forged).expect(200);
  });

  it('EVM-008 AC4 route without authorization policy is rejected with 403', async () => {
    current = await createTestApp({
      imports: [RouteWithoutPolicyModule],
      configure: (builder) => builder.overrideProvider(RoutePolicyCheck).useValue({ onApplicationBootstrap: () => undefined }),
    });
    const server = current.app.getHttpServer();
    for (const path of ['/test/no-policy', '/test/unknown-operation']) {
      const response = await request(server).get(path).expect(403);
      expect(response.body).toMatchObject({ type: '/problems/forbidden', status: 403, code: 'forbidden' });
      expect(response.text).not.toContain('reached');
    }
  });

  it('EVM-008 AC4 startup check fails when a route lacks a policy or borrows another operation', async () => {
    await expect(createTestApp({ imports: [RouteWithoutPolicyModule] })).rejects.toThrow(/trasy bez polityki/);
    await expect(createTestApp({ imports: [RouteWithoutPolicyModule] })).rejects.toThrow(/RouteWithoutPolicyController\.noPolicy/);
    await expect(createTestApp({ imports: [FailingRouteModule] })).rejects.toThrow(
      /operationId getHealth w kontrakcie to get \/api\/health/,
    );
  });

  it('EVM-008 AC4 with a principal an unknown route is 404 and a failing session lookup is 401 (fail closed)', async () => {
    current = await createTestApp({
      configure: (builder) => builder.overrideProvider(SESSION_RESOLVER).useValue(resolverOf({ principal: principal() })),
    });
    const response = await request(current.app.getHttpServer()).get('/api/v1/work-orders').expect(404);
    expect(response.body).toMatchObject({ type: '/problems/not_found', status: 404, code: 'not_found' });
    await current.close();
    current = await createTestApp({
      configure: (builder) =>
        builder.overrideProvider(SESSION_RESOLVER).useValue(resolverOf(() => Promise.reject(new Error('session store unavailable')))),
    });
    await request(current.app.getHttpServer()).get('/api/v1/work-orders').expect(401);
    await request(current.app.getHttpServer())
      .post('/api/v1/work-orders')
      .set('Content-Type', 'application/json')
      .send('{"a":')
      .expect(401);
  });
});
