import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { afterEach, describe, expect, it } from 'vitest';
import { RoutePolicyCheck } from '../../src/modules/authorization/index.ts';
import { joinPath, routeProblems, toRouteTemplate } from '../../src/modules/authorization/route-policies.ts';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.ts';
import { loadConfig } from '../../src/platform/config/config.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { createTestApp, validEnv, type TestApp } from '../support/app.ts';
import { ProtectedRouteModule } from '../support/test-routes.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('route policies (EVM-008 AC2, AC4; ADR-0004)', () => {
  it('EVM-008 AC2 routes equal contract operations (every route has an operation and every operation a route)', async () => {
    current = await createTestApp();
    const routes = current.app.get(RoutePolicyCheck).routes();
    const byOperation = (a: { operationId?: string }, b: { operationId?: string }) =>
      (a.operationId ?? '').localeCompare(b.operationId ?? '');
    expect(routes.map(({ operationId, method, path }) => ({ operationId, method, path })).sort(byOperation)).toEqual(
      Object.entries(AUTHZ_MANIFEST)
        .map(([operationId, operation]) => ({ operationId, method: operation.method, path: toRouteTemplate(operation.path) }))
        .sort(byOperation),
    );
    expect(routeProblems(routes, AUTHZ_MANIFEST)).toEqual([]);
  });

  it('EVM-008 AC4 the startup check sees every route handler and skips methods that are not routes', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register({ config: loadConfig(validEnv()), logger: createLogger({ level: 'fatal' }) }), ProtectedRouteModule],
    }).compile();
    const handlers = moduleRef
      .get(RoutePolicyCheck)
      .routes()
      .map((route) => route.handler);
    expect(handlers).toContain('HealthController.getHealth');
    expect(handlers).toContain('ProtectedRouteController.list');
    expect(handlers).not.toContain('ProtectedRouteController.helper');
    expect(() => {
      moduleRef.get(RoutePolicyCheck).onApplicationBootstrap();
    }).toThrow(/ProtectedRouteController\.list/);
  });

  it('EVM-008 AC4 route problems name handlers without a policy and handlers borrowing another operation', () => {
    const manifest = { getHealth: { method: 'get', path: '/api/health', query: [], authz: { public: true as const } } };
    expect(routeProblems([{ handler: 'A.a', method: 'get', path: '/x', operationId: undefined }], manifest)[0]).toContain('A.a');
    expect(routeProblems([{ handler: 'B.b', method: 'get', path: '/x', operationId: 'hasOwnProperty' }], manifest)[0]).toContain('B.b');
    expect(routeProblems([{ handler: 'C.c', method: 'post', path: '/api/health', operationId: 'getHealth' }], manifest)[0]).toContain(
      'operationId getHealth w kontrakcie to get /api/health',
    );
    expect(routeProblems([{ handler: 'D.d', method: 'get', path: '/api/health', operationId: 'getHealth' }], manifest)).toEqual([]);
  });

  it('EVM-008 AC2 paths of Nest and of the contract are compared in one form', () => {
    expect(joinPath('/', '/api/health')).toBe('/api/health');
    expect(joinPath('api/v1/', 'work-orders/:workOrderId')).toBe('/api/v1/work-orders/:workOrderId');
    expect(joinPath(undefined, '/')).toBe('/');
    expect(toRouteTemplate('/api/v1/work-orders/{workOrderId}/media-assets/{mediaAssetId}')).toBe(
      '/api/v1/work-orders/:workOrderId/media-assets/:mediaAssetId',
    );
  });
});
