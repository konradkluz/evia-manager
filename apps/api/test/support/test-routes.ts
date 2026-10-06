/**
 * Test-only controllers (EVM-008 AC4). They are imported by single tests and never by AppModule — the test
 * "routes equal contract operations" proves that production has no such routes.
 */
import { Controller, Get, Module } from '@nestjs/common';
import { AUTHZ_MANIFEST, type AuthzManifest } from '@evia/contracts/authz';
import { CONTRACT_POLICIES, type PolicySource } from '../../src/modules/authorization/index.ts';
import { OperationId } from '../../src/platform/http/operation-id.ts';

@Controller()
export class RouteWithoutPolicyController {
  @Get('/test/no-policy')
  noPolicy(): { reached: true } {
    return { reached: true };
  }

  @Get('/test/unknown-operation')
  @OperationId('notInTheContract')
  unknownOperation(): { reached: true } {
    return { reached: true };
  }
}

@Module({ controllers: [RouteWithoutPolicyController] })
export class RouteWithoutPolicyModule {}

/** Borrows the public operation getHealth on another path — rejected by the startup check, so tests override it. */
@Controller()
export class FailingRouteController {
  @Get('/test/failure')
  @OperationId('getHealth')
  fail(): never {
    throw new TypeError('synthetic failure at /srv/app/internal/secret-module.ts with value jan.przykladowy@example.invalid');
  }
}

@Module({ controllers: [FailingRouteController] })
export class FailingRouteModule {}

/** A protected operation (not public) for guard tests; only reachable with a test policy source. */
@Controller()
export class ProtectedRouteController {
  calls = 0;

  @Get('/api/v1/work-orders')
  @OperationId('listWorkOrders')
  list(): { reached: true } {
    this.calls += 1;
    return { reached: true };
  }

  /** Not a route: the startup check skips methods without a route decorator. */
  helper(): number {
    return this.calls;
  }
}

@Module({ controllers: [ProtectedRouteController] })
export class ProtectedRouteModule {}

/** The policies of the contract plus a synthetic protected operation (the contract has none for work orders yet). */
const syntheticManifest: AuthzManifest = {
  ...AUTHZ_MANIFEST,
  listWorkOrders: { method: 'get', path: '/api/v1/work-orders', query: [], authz: { roles: ['administrator'], channels: ['web'] } },
};

export const TEST_POLICIES: PolicySource = Object.freeze({ ...CONTRACT_POLICIES, manifest: syntheticManifest });
