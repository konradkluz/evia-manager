import { zProblem } from '@evia/contracts/zod';
import request, { type Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { RoutePolicyCheck } from '../../src/modules/authorization/index.ts';
import { DATABASE_PROBE } from '../../src/platform/tokens.ts';
import { createTestApp, type TestApp } from '../support/app.ts';
import { FailingRouteModule, RouteWithoutPolicyModule } from '../support/test-routes.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

/** The API with test-only routes (500 and 403); the startup check is replaced only here, never in production. */
const withTestRoutes = (env: Record<string, string> = {}) =>
  createTestApp({
    env,
    imports: [FailingRouteModule, RouteWithoutPolicyModule],
    configure: (builder) =>
      builder
        .overrideProvider(RoutePolicyCheck)
        .useValue({ onApplicationBootstrap: () => undefined })
        .overrideProvider(DATABASE_PROBE)
        .useValue({ ping: () => Promise.resolve() }),
  });

function expectSecurityHeaders(response: Response, label: string): void {
  expect(response.headers['cache-control'], label).toBe('no-store');
  expect(response.headers['x-content-type-options'], label).toBe('nosniff');
  expect(response.headers['referrer-policy'], label).toBe('no-referrer');
  expect(response.headers['content-security-policy'], label).toBe("default-src 'none'; frame-ancestors 'none'");
  expect(response.headers['x-powered-by'], label).toBeUndefined();
  expect(
    Object.keys(response.headers).filter((name) => name.startsWith('access-control-')),
    label,
  ).toEqual([]);
  expect(response.headers['content-type'], label).toMatch(/^application\/(problem\+)?json; charset=utf-8$/);
}

describe('API security headers (EVM-008 AC4; SR-API-03)', () => {
  it('EVM-008 AC4 API sends security headers on success and error responses', async () => {
    current = await withTestRoutes();
    const server = current.app.getHttpServer();
    const cases: Array<[string, () => Promise<Response>, number]> = [
      ['200 health', () => request(server).get('/api/health'), 200],
      ['400 malformed JSON', () => request(server).post('/api/v1/work-orders').set('Content-Type', 'application/json').send('{"a":'), 400],
      ['401 unknown route', () => request(server).get('/api/v1/work-orders').set('Origin', 'https://attacker.invalid'), 401],
      ['403 route without policy', () => request(server).get('/test/no-policy'), 403],
      [
        '413 body over the parser limit',
        () =>
          request(server)
            .post('/api/health')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify({ a: 'x'.repeat(110_000) })),
        413,
      ],
      ['500 unhandled error', () => request(server).get('/test/failure'), 500],
    ];
    for (const [label, send, status] of cases) {
      const response = await send();
      expect(response.status, label).toBe(status);
      expectSecurityHeaders(response, label);
    }
  });
});

describe('problem+json without internals (EVM-008 AC4; SR-API-01, SR-ERR-01)', () => {
  it('EVM-008 AC4 errors are problem+json without stack traces or internals', async () => {
    for (const nodeEnv of ['production', 'development']) {
      current = await withTestRoutes({ NODE_ENV: nodeEnv });
      const response = await request(current.app.getHttpServer()).get('/test/failure').expect(500);
      const body = zProblem.parse(response.body);
      expect(Object.keys(response.body as object).sort()).toEqual(['code', 'status', 'title', 'traceId', 'type']);
      expect(body).toMatchObject({ type: '/problems/internal_error', title: 'Internal server error', status: 500, code: 'internal_error' });
      expect(body.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(response.text).not.toMatch(/synthetic failure|TypeError|secret-module|\/srv\/|at |example\.invalid/);
      const logged = current.logs.entries.find((entry) => entry['msg'] === 'unhandled error');
      expect(logged, nodeEnv).toMatchObject({ level: 'error', traceId: body.traceId, err: { type: 'TypeError' } });
      await current.close();
      current = undefined;
    }
  });

  it('EVM-008 AC4 body parser errors are problems without the parser message', async () => {
    current = await withTestRoutes();
    const server = current.app.getHttpServer();
    const malformed = await request(server)
      .post('/api/v1/work-orders')
      .set('Content-Type', 'application/json')
      .send('{"email": jan}')
      .expect(400);
    expect(malformed.body).toMatchObject({ code: 'malformed_json', status: 400 });
    expect(malformed.text).not.toMatch(/Unexpected|token|position|jan/);
    const charset = await request(server)
      .post('/api/health')
      .set('Content-Type', 'application/json; charset=latin9')
      .send('{}')
      .expect(415);
    expect(charset.body).toMatchObject({ code: 'unsupported_media_type', status: 415 });
    const tooLarge = await request(server)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ a: 'x'.repeat(110_000) }))
      .expect(413);
    expect(tooLarge.body).toMatchObject({ code: 'payload_too_large', status: 413 });
  });
});

describe('request log (EVM-008 AC4; ADR-0013, SR-LOG-02)', () => {
  it('EVM-008 AC4 request log has method, route template, status, duration and trace id — no query, body or headers', async () => {
    current = await withTestRoutes();
    const server = current.app.getHttpServer();
    const response = await request(server)
      .get('/api/health?email=jan.przykladowy%40example.invalid')
      .set('Authorization', 'Bearer synthetic-token')
      .expect(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    await request(server).post('/api/v1/work-orders').send({ name: 'Klient Przykładowy' }).expect(401);
    const requests = current.logs.entries.filter((entry) => entry['msg'] === 'request completed');
    expect(requests).toEqual([
      expect.objectContaining({
        level: 'info',
        method: 'GET',
        route: '/api/health',
        status: 200,
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown,
      }),
      expect.objectContaining({ method: 'POST', route: '(unmatched)', status: 401 }),
    ]);
    expect(typeof requests[0]?.['durationMs']).toBe('number');
    expect(current.logs.text).not.toMatch(/example\.invalid|email=|synthetic-token|Klient Przykładowy|authorization/i);
  });
});
