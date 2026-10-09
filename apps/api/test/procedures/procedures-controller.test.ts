import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { ListProceduresService } from '../../src/modules/procedures/application/list-procedures.service.ts';
import type { UpdateStageService } from '../../src/modules/procedures/application/update-stage.service.ts';
import { ProceduresController } from '../../src/modules/procedures/http/procedures.controller.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { resolveAuthentication } from '../../src/platform/http/principal.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { principal, resolverOf } from '../support/principals.ts';
import { uuidv7 } from '../support/uuid.ts';

// The controller over FAKE services: it holds no authorization (the guard decides before it) and no logic — it passes the principal
// and the raw input to the use case and sets the headers of the answer. A request that the guard would have stopped has no principal.
const STAGE = { id: uuidv7(), version: 3 };

async function signedIn(): Promise<Request> {
  const request = { ip: '203.0.113.9' } as unknown as Request;
  await new Promise<void>((resolve) => {
    resolveAuthentication(resolverOf({ principal: principal({ role: 'editor' }) }), createLogger({ level: 'fatal' }))(
      request,
      {} as Response,
      () => {
        resolve();
      },
    );
  });
  return request;
}
function response() {
  const set = vi.fn();
  return { set, reply: { set, locals: {} } as unknown as Response };
}

function setup(replayed = false) {
  const list = vi.fn(() => Promise.resolve({ items: [], openStageCount: 0 }));
  const update = vi.fn(() => Promise.resolve({ stage: STAGE, replayed }));
  const controller = new ProceduresController({ list } as unknown as ListProceduresService, { update } as unknown as UpdateStageService);
  return { list, update, controller };
}

describe('the controller of the processes (EVM-031 AC2, AC3, AC7; SR-AUTHZ-01)', () => {
  it('EVM-031 AC2 the read passes the principal of the session and the path to the use case, and returns its answer', async () => {
    const { list, controller } = setup();
    const request = await signedIn();
    const params = { workOrderId: uuidv7() };
    await expect(controller.listWorkOrderProcedures(params, request)).resolves.toEqual({ items: [], openStageCount: 0 });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ role: 'editor' }), params);
  });

  it('EVM-031 AC3 the change passes the headers and the body untouched, and answers with the ETag of the new version and no replay header', async () => {
    const { update, controller } = setup(false);
    const request = await signedIn();
    const { set, reply } = response();
    const params = { workOrderId: uuidv7(), stageId: STAGE.id };
    const body = { dueDate: '2026-10-20' };
    await expect(controller.updateProcedureStage(params, body, '"2"', undefined, request, reply)).resolves.toBe(STAGE);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      '"2"',
      body,
      undefined,
      expect.objectContaining({ origin: 'web' }),
    );
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('ETag', '"3"');
  });

  it('EVM-031 AC3 a repeat of the change (same key) says so: Idempotent-Replayed: true', async () => {
    const { controller } = setup(true);
    const { set, reply } = response();
    await controller.updateProcedureStage({}, {}, '"2"', uuidv7(), await signedIn(), reply);
    expect(set).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('EVM-031 AC7 a request without a principal (one the guard would have stopped) is 401 unauthenticated — the use case is never called', async () => {
    const { list, update, controller } = setup();
    const anonymous = {} as unknown as Request;
    expect(() => controller.listWorkOrderProcedures({}, anonymous)).toThrow(ProblemException);
    await expect(controller.updateProcedureStage({}, {}, '"1"', undefined, anonymous, response().reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(list).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
