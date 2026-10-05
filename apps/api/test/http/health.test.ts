import { zHealth, zProblem } from '@evia/contracts/zod';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { DATABASE_PROBE } from '../../src/platform/tokens.ts';
import { createTestApp, UNREACHABLE_DATABASE_URL, type TestApp } from '../support/app.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const withResponsiveDatabase = () =>
  createTestApp({ configure: (builder) => builder.overrideProvider(DATABASE_PROBE).useValue({ ping: () => Promise.resolve() }) });

describe('GET /api/health (EVM-008 AC1, AC2; SR-API-12)', () => {
  it('EVM-008 AC1 health returns ok and the minimum supported app versions without sensitive data', async () => {
    current = await withResponsiveDatabase();
    const response = await request(current.app.getHttpServer()).get('/api/health').expect(200);
    expect(Object.keys(response.body as object).sort()).toEqual(['minSupportedAppVersion', 'status']);
    expect(response.body).toEqual({ status: 'ok', minSupportedAppVersion: { android: '1.2.0', ios: '1.1.0' } });
    expect(Object.keys((response.body as { minSupportedAppVersion: object }).minSupportedAppVersion).sort()).toEqual(['android', 'ios']);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('EVM-008 AC2 health response matches the contract schema', async () => {
    current = await withResponsiveDatabase();
    const response = await request(current.app.getHttpServer()).get('/api/health').expect(200);
    expect(zHealth.parse(response.body)).toEqual(response.body);
  });

  it('EVM-008 AC1 health returns 503 problem without details when the database is unreachable', async () => {
    current = await createTestApp();
    const started = performance.now();
    const response = await request(current.app.getHttpServer()).get('/api/health').expect(503);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    const body = zProblem.parse(response.body);
    expect(body).toEqual({
      type: '/problems/service_unavailable',
      title: 'Service unavailable',
      status: 503,
      code: 'service_unavailable',
      traceId: body.traceId,
    });
    expect(response.text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|5432|evia|password|postgres|stack/i);
    expect(current.logs.text).not.toContain('evia-test');
    expect(current.logs.text).not.toContain(UNREACHABLE_DATABASE_URL);
  });

  it('EVM-008 AC1 HEAD /api/health answers like GET without a body', async () => {
    current = await withResponsiveDatabase();
    const response = await request(current.app.getHttpServer()).head('/api/health').expect(200);
    expect(response.text).toBeUndefined();
  });
});
