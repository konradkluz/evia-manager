/**
 * Test-only controllers (EVM-008 AC4). They are imported by single tests and never by AppModule — the test
 * "routes equal contract operations" proves that production has no such routes.
 */
import { Controller, Get, Module, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AUTHZ_MANIFEST, type AuthzManifest } from '@evia/contracts/authz';
import { CONTRACT_POLICIES, type PolicySource } from '../../src/modules/authorization/index.ts';
import { OperationId } from '../../src/platform/http/operation-id.ts';
import { principalOf } from '../../src/platform/http/principal.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';

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

  @Post('/api/v1/work-orders')
  @OperationId('createWorkOrder')
  create(): { created: true } {
    this.calls += 1;
    return { created: true };
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
  createWorkOrder: { method: 'post', path: '/api/v1/work-orders', query: [], authz: { roles: ['administrator'], channels: ['web'] } },
};

export const TEST_POLICIES: PolicySource = Object.freeze({ ...CONTRACT_POLICIES, manifest: syntheticManifest });

/**
 * A synthetic object operation for the IDOR case of the role matrix (the contract has none yet): a thing belongs to the
 * user it is named after. The object policy lives in the handler (the use case), never in the guard: somebody else's
 * object does not exist for the caller — 404, not 403 (api-guidelines.md → Format błędów).
 */
@Controller()
export class ThingController {
  @Get('/api/v1/test-things/:thingId')
  @OperationId('getTestThing')
  get(@Param('thingId') thingId: string, @Req() request: Request): { id: string } {
    const principal = principalOf(request);
    if (principal === null || thingId !== `thing-of-${principal.userId}`) throw new ProblemException('not_found');
    return { id: thingId };
  }
}

@Module({ controllers: [ThingController] })
export class ThingModule {}

/** The same route without the object policy — what a forgotten ownership check looks like (the matrix must catch it). */
@Controller()
export class LeakyThingController {
  @Get('/api/v1/test-things/:thingId')
  @OperationId('getTestThing')
  get(@Param('thingId') thingId: string): { id: string } {
    return { id: thingId };
  }
}

@Module({ controllers: [LeakyThingController] })
export class LeakyThingModule {}

export const THING_OPERATION: AuthzManifest[string] = {
  method: 'get',
  path: '/api/v1/test-things/{thingId}',
  query: [],
  authz: { roles: ['administrator', 'editor'], channels: ['web'], policy: 'testThing.read', anchor: 'path.thingId' },
};

export const THING_OBJECTS = {
  own: (userId: string): string => `/api/v1/test-things/thing-of-${userId}`,
  foreign: (): string => '/api/v1/test-things/thing-of-someone-else',
};
