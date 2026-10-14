import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CreateProcedureService } from '../../src/modules/procedures/application/create-procedure.service.ts';
import type { CreateStageService } from '../../src/modules/procedures/application/create-stage.service.ts';
import type { DeleteProcedureService } from '../../src/modules/procedures/application/delete-procedure.service.ts';
import type { DeleteStageService } from '../../src/modules/procedures/application/delete-stage.service.ts';
import type { ListDeletedService } from '../../src/modules/procedures/application/list-deleted.service.ts';
import type { RestoreProcedureService } from '../../src/modules/procedures/application/restore-procedure.service.ts';
import type { RestoreStageService } from '../../src/modules/procedures/application/restore-stage.service.ts';
import type { ListProceduresService } from '../../src/modules/procedures/application/list-procedures.service.ts';
import type { TransitionStageService } from '../../src/modules/procedures/application/transition-stage.service.ts';
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

const PROCEDURE = { id: uuidv7(), version: 5 };

function setup(replayed = false) {
  const list = vi.fn(() => Promise.resolve({ items: [], openStageCount: 0 }));
  const update = vi.fn(() => Promise.resolve({ stage: STAGE, replayed }));
  const transition = vi.fn(() => Promise.resolve({ stage: STAGE, replayed }));
  const createProcedure = vi.fn(() => Promise.resolve({ procedure: PROCEDURE, replayed }));
  const createStage = vi.fn(() => Promise.resolve({ stage: STAGE, replayed }));
  const deleteProcedure = vi.fn(() => Promise.resolve(replayed));
  const deleteStage = vi.fn(() => Promise.resolve(replayed));
  const restoreProcedure = vi.fn(() => Promise.resolve({ procedure: PROCEDURE, replayed }));
  const restoreStage = vi.fn(() => Promise.resolve({ stage: STAGE, replayed }));
  const listDeleted = vi.fn(() => Promise.resolve({ procedures: [], stages: [], truncated: false }));
  const controller = new ProceduresController(
    { list } as unknown as ListProceduresService,
    { update } as unknown as UpdateStageService,
    { transition } as unknown as TransitionStageService,
    { create: createProcedure } as unknown as CreateProcedureService,
    { create: createStage } as unknown as CreateStageService,
    { delete: deleteProcedure } as unknown as DeleteProcedureService,
    { delete: deleteStage } as unknown as DeleteStageService,
    { restore: restoreProcedure } as unknown as RestoreProcedureService,
    { restore: restoreStage } as unknown as RestoreStageService,
    { list: listDeleted } as unknown as ListDeletedService,
  );
  return {
    list,
    update,
    transition,
    createProcedure,
    createStage,
    deleteProcedure,
    deleteStage,
    restoreProcedure,
    restoreStage,
    listDeleted,
    controller,
  };
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

  it('EVM-032 AC1 the transition passes the headers and the command untouched, and answers with the ETag of the new version', async () => {
    const { transition, controller } = setup(false);
    const { set, reply } = response();
    const params = { workOrderId: uuidv7(), stageId: STAGE.id };
    const body = { to: 'in_progress' };
    await expect(controller.transitionProcedureStage(params, body, '"2"', undefined, await signedIn(), reply)).resolves.toBe(STAGE);
    expect(transition).toHaveBeenCalledWith(
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

  it('EVM-032 AC6 a repeat of the transition (same key) says so: Idempotent-Replayed: true', async () => {
    const { controller } = setup(true);
    const { set, reply } = response();
    await controller.transitionProcedureStage({}, { to: 'done' }, '"2"', uuidv7(), await signedIn(), reply);
    expect(set).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('EVM-031 AC7 a request without a principal (one the guard would have stopped) is 401 unauthenticated — the use case is never called', async () => {
    const { list, update, transition, controller } = setup();
    const anonymous = {} as unknown as Request;
    expect(() => controller.listWorkOrderProcedures({}, anonymous)).toThrow(ProblemException);
    await expect(controller.updateProcedureStage({}, {}, '"1"', undefined, anonymous, response().reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(controller.transitionProcedureStage({}, {}, '"1"', undefined, anonymous, response().reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(list).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });
  it('EVM-042 AC1 AC2 the additions pass the body and the key untouched; the answer has the ETag of the new version and no replay header', async () => {
    const { createProcedure, createStage, controller } = setup(false);
    const params = { workOrderId: uuidv7(), procedureId: PROCEDURE.id };
    const key = uuidv7();
    const first = response();
    await expect(controller.createWorkOrderProcedure(params, { id: 'x' }, key, await signedIn(), first.reply)).resolves.toBe(PROCEDURE);
    expect(createProcedure).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      { id: 'x' },
      key,
      expect.objectContaining({ origin: 'web' }),
    );
    expect(first.set).toHaveBeenCalledTimes(1);
    expect(first.set).toHaveBeenCalledWith('ETag', '"5"');
    const second = response();
    await expect(controller.createProcedureStage(params, { id: 'y' }, undefined, await signedIn(), second.reply)).resolves.toBe(STAGE);
    expect(createStage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      { id: 'y' },
      undefined,
      expect.any(Object),
    );
    expect(second.set).toHaveBeenCalledTimes(1);
    expect(second.set).toHaveBeenCalledWith('ETag', '"3"');
  });

  it('EVM-042 AC3 the deletions pass the headers untouched and answer with nothing; a repeat says Idempotent-Replayed: true', async () => {
    const fresh = setup(false);
    const params = { workOrderId: uuidv7(), procedureId: PROCEDURE.id };
    const quiet = response();
    await expect(
      fresh.controller.deleteWorkOrderProcedure(params, '"2"', undefined, await signedIn(), quiet.reply),
    ).resolves.toBeUndefined();
    await expect(fresh.controller.deleteProcedureStage(params, '"2"', undefined, await signedIn(), quiet.reply)).resolves.toBeUndefined();
    expect(fresh.deleteProcedure).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      '"2"',
      undefined,
      expect.any(Object),
    );
    expect(fresh.deleteStage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      '"2"',
      undefined,
      expect.any(Object),
    );
    expect(quiet.set).not.toHaveBeenCalled();

    const repeated = setup(true);
    const loud = response();
    await repeated.controller.deleteWorkOrderProcedure(params, '"2"', uuidv7(), await signedIn(), loud.reply);
    await repeated.controller.deleteProcedureStage(params, '"2"', uuidv7(), await signedIn(), loud.reply);
    expect(loud.set).toHaveBeenCalledTimes(2);
    expect(loud.set).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('EVM-042 AC3 the restorations answer with the ETag of the new version; a repeat says Idempotent-Replayed: true', async () => {
    const fresh = setup(false);
    const params = { workOrderId: uuidv7(), procedureId: PROCEDURE.id };
    const first = response();
    await expect(fresh.controller.restoreWorkOrderProcedure(params, '"2"', undefined, await signedIn(), first.reply)).resolves.toBe(
      PROCEDURE,
    );
    await expect(fresh.controller.restoreProcedureStage(params, '"2"', undefined, await signedIn(), first.reply)).resolves.toBe(STAGE);
    expect(fresh.restoreProcedure).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      '"2"',
      undefined,
      expect.any(Object),
    );
    expect(fresh.restoreStage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      '"2"',
      undefined,
      expect.any(Object),
    );
    expect(first.set.mock.calls).toEqual([
      ['ETag', '"5"'],
      ['ETag', '"3"'],
    ]);

    const repeated = setup(true);
    const loud = response();
    await repeated.controller.restoreWorkOrderProcedure(params, '"2"', uuidv7(), await signedIn(), loud.reply);
    await repeated.controller.restoreProcedureStage(params, '"2"', uuidv7(), await signedIn(), loud.reply);
    expect(loud.set).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
    expect(loud.set).toHaveBeenCalledTimes(4);
  });

  it('EVM-042 AC3 the list of the deleted ones passes the principal and the path to the use case', async () => {
    const { listDeleted, controller } = setup();
    const params = { workOrderId: uuidv7() };
    await expect(controller.listDeletedWorkOrderProcedures(params, await signedIn())).resolves.toEqual({
      procedures: [],
      stages: [],
      truncated: false,
    });
    expect(listDeleted).toHaveBeenCalledWith(expect.objectContaining({ role: 'editor' }), params);
  });

  it('EVM-042 AC6 a request without a principal is 401 unauthenticated on every new operation — no use case is called', async () => {
    const s = setup();
    const anonymous = {} as unknown as Request;
    const reply = response().reply;
    await expect(s.controller.createWorkOrderProcedure({}, {}, undefined, anonymous, reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(s.controller.createProcedureStage({}, {}, undefined, anonymous, reply)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(s.controller.deleteWorkOrderProcedure({}, '"1"', undefined, anonymous, reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(s.controller.deleteProcedureStage({}, '"1"', undefined, anonymous, reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(s.controller.restoreWorkOrderProcedure({}, '"1"', undefined, anonymous, reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(s.controller.restoreProcedureStage({}, '"1"', undefined, anonymous, reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(() => s.controller.listDeletedWorkOrderProcedures({}, anonymous)).toThrow(ProblemException);
    for (const call of [
      s.createProcedure,
      s.createStage,
      s.deleteProcedure,
      s.deleteStage,
      s.restoreProcedure,
      s.restoreStage,
      s.listDeleted,
    ]) {
      expect(call).not.toHaveBeenCalled();
    }
  });
});
