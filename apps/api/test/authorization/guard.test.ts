import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { POLICY_SOURCE } from '../../src/modules/authorization/index.ts';
import { PRINCIPAL_RESOLVER } from '../../src/platform/http/principal.ts';
import { createTestApp, type TestApp } from '../support/app.ts';
import { ProtectedRouteController, ProtectedRouteModule, TEST_POLICIES } from '../support/test-routes.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const withProtectedRoute = (resolve: () => unknown) =>
  createTestApp({
    imports: [ProtectedRouteModule],
    configure: (builder) =>
      builder.overrideProvider(POLICY_SOURCE).useValue(TEST_POLICIES).overrideProvider(PRINCIPAL_RESOLVER).useValue({ resolve }),
  });

describe('authorization guard on a protected operation (EVM-008 AC4; SR-AUTHZ-01, SR-ERR-01)', () => {
  it('EVM-008 AC4 a protected operation without a session is 401 and the handler never runs', async () => {
    current = await withProtectedRoute(() => null);
    const response = await request(current.app.getHttpServer()).get('/api/v1/work-orders').expect(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
    expect(current.app.get(ProtectedRouteController).helper()).toBe(0);
  });

  it('EVM-008 AC4 with a principal but no role model yet (E1) the operation is still denied with 403', async () => {
    current = await withProtectedRoute(() => ({ userId: 'synthetic-user' }));
    await request(current.app.getHttpServer()).get('/api/v1/work-orders').expect(403);
    expect(current.app.get(ProtectedRouteController).helper()).toBe(0);
  });

  it('EVM-008 AC4 an error while resolving the principal denies the request (500 without details)', async () => {
    current = await withProtectedRoute(() => {
      throw new Error('synthetic session store failure');
    });
    const response = await request(current.app.getHttpServer()).get('/api/v1/work-orders').expect(500);
    expect(response.body).toMatchObject({ code: 'internal_error' });
    expect(response.text).not.toContain('session store');
    expect(current.app.get(ProtectedRouteController).helper()).toBe(0);
  });
});
