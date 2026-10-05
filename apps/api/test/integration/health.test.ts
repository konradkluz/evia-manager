import { zHealth } from '@evia/contracts/zod';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/app.ts';
import { freshDatabaseUrl } from './database.ts';

let current: TestApp;

beforeAll(async () => {
  current = await createTestApp({ env: { DATABASE_URL: await freshDatabaseUrl() } });
});

afterAll(async () => {
  await current.close();
});

describe('GET /api/health with PostgreSQL (EVM-008 AC1, AC2)', () => {
  it('EVM-008 AC1 GET /api/health returns ok and minimum supported app version without sensitive data', async () => {
    const response = await request(current.app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', minSupportedAppVersion: { android: '1.2.0', ios: '1.1.0' } });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('EVM-008 AC2 health response matches the contract schema', async () => {
    const response = await request(current.app.getHttpServer()).get('/api/health').expect(200);
    expect(zHealth.parse(response.body)).toEqual(response.body);
  });
});
