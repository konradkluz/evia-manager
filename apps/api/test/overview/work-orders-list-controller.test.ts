import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { ListWorkOrdersService } from '../../src/modules/overview/application/list-work-orders.service.ts';
import { WorkOrdersListController } from '../../src/modules/overview/http/work-orders-list.controller.ts';
import { resolveAuthentication } from '../../src/platform/http/principal.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { principal, resolverOf } from '../support/principals.ts';

// The controller over a FAKE service: it holds no authorization (the guard decides before it) and no logic — it passes the principal,
// the raw query and the context of the request to the use case. A request the guard would have stopped has no principal.
async function signedIn(): Promise<Request> {
  const request = { ip: '203.0.113.9' } as unknown as Request;
  await new Promise<void>((resolve) => {
    resolveAuthentication(resolverOf({ principal: principal({ role: 'read_only' }) }), createLogger({ level: 'fatal' }))(
      request,
      {} as Response,
      () => {
        resolve();
      },
    );
  });
  return request;
}

describe('the controller of the list of work orders in overview (EVM-034; EVM-017 AC7; SR-AUTHZ-01)', () => {
  it('EVM-034 AC7 the list passes the principal of the session, the raw query and the context of the request, and returns the answer', async () => {
    const list = vi.fn(() => Promise.resolve({ items: [], nextCursor: null }));
    const controller = new WorkOrdersListController({ list } as unknown as ListWorkOrdersService);
    const query = { waitingLongerThanDays: '14' };
    await expect(controller.listWorkOrders(query, await signedIn())).resolves.toEqual({ items: [], nextCursor: null });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ role: 'read_only' }), query, expect.objectContaining({ origin: 'web' }));
  });

  it('EVM-034 AC7 a request without a principal is 401 unauthenticated and the use case is not reached', () => {
    const list = vi.fn();
    const controller = new WorkOrdersListController({ list } as unknown as ListWorkOrdersService);
    expect(() => controller.listWorkOrders({}, { ip: '203.0.113.9' } as unknown as Request)).toThrow(ProblemException);
    expect(list).not.toHaveBeenCalled();
  });
});
