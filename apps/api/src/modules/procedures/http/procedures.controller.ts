/**
 * HTTP surface of the procedures module (EVM-031: the list of the processes of an order, the change of a stage; EVM-032: the transition of its status). The handlers contain
 * no authorization — the global guard decides before they run (operation in the manifest, CSRF, channel, role); here only the call and
 * the headers of the answer. The answers are never cached (the global `Cache-Control: no-store`).
 */
import type { ProcedureList, ProcedureStage } from '@evia/contracts';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { entityTag } from '../../../platform/http/if-match.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { ListProceduresService } from '../application/list-procedures.service.ts';
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

  constructor(
    @Inject(ListProceduresService) lists: ListProceduresService,
    @Inject(UpdateStageService) updates: UpdateStageService,
    @Inject(TransitionStageService) transitions: TransitionStageService,
  ) {
    this.#lists = lists;
    this.#updates = updates;
    this.#transitions = transitions;
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
}
