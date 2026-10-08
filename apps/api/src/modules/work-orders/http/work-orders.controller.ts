/**
 * HTTP surface of the work-orders module (EVM-017: the list; EVM-022: the creation). The handlers contain no authorization — the
 * global guard decides before they run (operation in the manifest, CSRF, channel, role); here only the call and the headers of the
 * answer. The query of the list is validated and its response parsed in the service, with the schemas of the contract. The answers
 * are never cached (the global `Cache-Control: no-store`).
 */
import type { WorkOrder, WorkOrderList } from '@evia/contracts';
import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { requestEventContext, webEventContext } from '../../../platform/http/request-context.ts';
import { CreateWorkOrderService } from '../application/create-work-order.service.ts';
import { ListWorkOrdersService } from '../application/list-work-orders.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class WorkOrdersController {
  readonly #lists: ListWorkOrdersService;
  readonly #creations: CreateWorkOrderService;

  constructor(
    @Inject(ListWorkOrdersService) lists: ListWorkOrdersService,
    @Inject(CreateWorkOrderService) creations: CreateWorkOrderService,
  ) {
    this.#lists = lists;
    this.#creations = creations;
  }

  @Get('/api/v1/work-orders')
  @OperationId('listWorkOrders')
  listWorkOrders(@Query() query: unknown, @Req() request: Request): Promise<WorkOrderList> {
    return this.#lists.list(requirePrincipal(request), query, requestEventContext(request));
  }

  @Post('/api/v1/work-orders')
  @OperationId('createWorkOrder')
  @HttpCode(201)
  async createWorkOrder(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WorkOrder> {
    const { workOrder, replayed } = await this.#creations.create(
      requirePrincipal(request),
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', `"${workOrder.version}"`);
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return workOrder;
  }
}
