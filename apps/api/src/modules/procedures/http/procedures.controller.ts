/**
 * HTTP surface of the procedures module (EVM-031: the list of the processes of an order, the change of a stage; EVM-032: the transition of its status; EVM-042: the addition, the deletion and the restoration of a process or a stage, and the list of the deleted ones). The handlers contain
 * no authorization — the global guard decides before they run (operation in the manifest, CSRF, channel, role); here only the call and
 * the headers of the answer. The answers are never cached (the global `Cache-Control: no-store`).
 */
import type { DeletedProcedureList, Procedure, ProcedureList, ProcedureStage } from '@evia/contracts';
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { entityTag } from '../../../platform/http/if-match.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { CreateProcedureService } from '../application/create-procedure.service.ts';
import { CreateStageService } from '../application/create-stage.service.ts';
import { DeleteProcedureService } from '../application/delete-procedure.service.ts';
import { DeleteStageService } from '../application/delete-stage.service.ts';
import { ListDeletedService } from '../application/list-deleted.service.ts';
import { ListProceduresService } from '../application/list-procedures.service.ts';
import { RestoreProcedureService } from '../application/restore-procedure.service.ts';
import { RestoreStageService } from '../application/restore-stage.service.ts';
import { TransitionStageService } from '../application/transition-stage.service.ts';
import { UpdateStageService } from '../application/update-stage.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class ProceduresController {
  readonly #lists: ListProceduresService;
  readonly #updates: UpdateStageService;
  readonly #transitions: TransitionStageService;
  readonly #procedureCreations: CreateProcedureService;
  readonly #stageCreations: CreateStageService;
  readonly #procedureDeletions: DeleteProcedureService;
  readonly #stageDeletions: DeleteStageService;
  readonly #procedureRestorations: RestoreProcedureService;
  readonly #stageRestorations: RestoreStageService;
  readonly #deletedLists: ListDeletedService;

  constructor(
    @Inject(ListProceduresService) lists: ListProceduresService,
    @Inject(UpdateStageService) updates: UpdateStageService,
    @Inject(TransitionStageService) transitions: TransitionStageService,
    @Inject(CreateProcedureService) procedureCreations: CreateProcedureService,
    @Inject(CreateStageService) stageCreations: CreateStageService,
    @Inject(DeleteProcedureService) procedureDeletions: DeleteProcedureService,
    @Inject(DeleteStageService) stageDeletions: DeleteStageService,
    @Inject(RestoreProcedureService) procedureRestorations: RestoreProcedureService,
    @Inject(RestoreStageService) stageRestorations: RestoreStageService,
    @Inject(ListDeletedService) deletedLists: ListDeletedService,
  ) {
    this.#lists = lists;
    this.#updates = updates;
    this.#transitions = transitions;
    this.#procedureCreations = procedureCreations;
    this.#stageCreations = stageCreations;
    this.#procedureDeletions = procedureDeletions;
    this.#stageDeletions = stageDeletions;
    this.#procedureRestorations = procedureRestorations;
    this.#stageRestorations = stageRestorations;
    this.#deletedLists = deletedLists;
  }

  @Get('/api/v1/work-orders/:workOrderId/procedures')
  @OperationId('listWorkOrderProcedures')
  listWorkOrderProcedures(@Param() params: unknown, @Req() request: Request): Promise<ProcedureList> {
    return this.#lists.list(requirePrincipal(request), params);
  }

  @Patch('/api/v1/work-orders/:workOrderId/procedure-stages/:stageId')
  @OperationId('updateProcedureStage')
  @HttpCode(200)
  async updateProcedureStage(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProcedureStage> {
    const { stage, replayed } = await this.#updates.update(
      requirePrincipal(request),
      params,
      ifMatch,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(stage.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return stage;
  }

  @Post('/api/v1/work-orders/:workOrderId/procedure-stages/:stageId/transitions')
  @OperationId('transitionProcedureStage')
  @HttpCode(200)
  async transitionProcedureStage(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProcedureStage> {
    const { stage, replayed } = await this.#transitions.transition(
      requirePrincipal(request),
      params,
      ifMatch,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(stage.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return stage;
  }

  @Post('/api/v1/work-orders/:workOrderId/procedures')
  @OperationId('createWorkOrderProcedure')
  async createWorkOrderProcedure(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Procedure> {
    const { procedure, replayed } = await this.#procedureCreations.create(
      requirePrincipal(request),
      params,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(procedure.version ?? 1));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return procedure;
  }

  @Post('/api/v1/work-orders/:workOrderId/procedures/:procedureId/stages')
  @OperationId('createProcedureStage')
  async createProcedureStage(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProcedureStage> {
    const { stage, replayed } = await this.#stageCreations.create(
      requirePrincipal(request),
      params,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(stage.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return stage;
  }

  @Delete('/api/v1/work-orders/:workOrderId/procedures/:procedureId')
  @OperationId('deleteWorkOrderProcedure')
  @HttpCode(204)
  async deleteWorkOrderProcedure(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const replayed = await this.#procedureDeletions.delete(
      requirePrincipal(request),
      params,
      ifMatch,
      idempotencyKey,
      webEventContext(request, response),
    );
    if (replayed) response.set('Idempotent-Replayed', 'true');
  }

  @Post('/api/v1/work-orders/:workOrderId/procedures/:procedureId/restore')
  @OperationId('restoreWorkOrderProcedure')
  @HttpCode(200)
  async restoreWorkOrderProcedure(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Procedure> {
    const { procedure, replayed } = await this.#procedureRestorations.restore(
      requirePrincipal(request),
      params,
      ifMatch,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(procedure.version ?? 1));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return procedure;
  }

  @Delete('/api/v1/work-orders/:workOrderId/procedure-stages/:stageId')
  @OperationId('deleteProcedureStage')
  @HttpCode(204)
  async deleteProcedureStage(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const replayed = await this.#stageDeletions.delete(
      requirePrincipal(request),
      params,
      ifMatch,
      idempotencyKey,
      webEventContext(request, response),
    );
    if (replayed) response.set('Idempotent-Replayed', 'true');
  }

  @Post('/api/v1/work-orders/:workOrderId/procedure-stages/:stageId/restore')
  @OperationId('restoreProcedureStage')
  @HttpCode(200)
  async restoreProcedureStage(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProcedureStage> {
    const { stage, replayed } = await this.#stageRestorations.restore(
      requirePrincipal(request),
      params,
      ifMatch,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(stage.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return stage;
  }

  @Get('/api/v1/work-orders/:workOrderId/deleted-procedures')
  @OperationId('listDeletedWorkOrderProcedures')
  listDeletedWorkOrderProcedures(@Param() params: unknown, @Req() request: Request): Promise<DeletedProcedureList> {
    return this.#deletedLists.list(requirePrincipal(request), params);
  }
}
