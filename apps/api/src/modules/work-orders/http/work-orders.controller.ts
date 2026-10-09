/**
 * HTTP surface of the work-orders module (EVM-017: the list; EVM-022: the creation; EVM-018: the four reads of one order; EVM-030: the status command). The handlers contain no authorization — the
 * global guard decides before they run (operation in the manifest, CSRF, channel, role); here only the call and the headers of the
 * answer. The query of the list is validated and its response parsed in the service, with the schemas of the contract. The answers
 * are never cached (the global `Cache-Control: no-store`).
 */
import type { CustomerCard, ScopeItemList, SiteCard, SiteOrders, WorkOrder, WorkOrderDetails, WorkOrderList } from '@evia/contracts';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { entityTag } from '../../../platform/http/if-match.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { requestEventContext, webEventContext } from '../../../platform/http/request-context.ts';
import { CreateWorkOrderService } from '../application/create-work-order.service.ts';
import { ListSiteOrdersService } from '../application/list-site-orders.service.ts';
import { ListWorkOrdersService } from '../application/list-work-orders.service.ts';
import { ReadWorkOrderService } from '../application/read-work-order.service.ts';
import { TransitionWorkOrderService } from '../application/transition-work-order.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class WorkOrdersController {
  readonly #lists: ListWorkOrdersService;
  readonly #creations: CreateWorkOrderService;
  readonly #reads: ReadWorkOrderService;
  readonly #transitions: TransitionWorkOrderService;
  readonly #siteOrders: ListSiteOrdersService;

  constructor(
    @Inject(ListWorkOrdersService) lists: ListWorkOrdersService,
    @Inject(CreateWorkOrderService) creations: CreateWorkOrderService,
    @Inject(ReadWorkOrderService) reads: ReadWorkOrderService,
    @Inject(TransitionWorkOrderService) transitions: TransitionWorkOrderService,
    @Inject(ListSiteOrdersService) siteOrders: ListSiteOrdersService,
  ) {
    this.#lists = lists;
    this.#creations = creations;
    this.#reads = reads;
    this.#transitions = transitions;
    this.#siteOrders = siteOrders;
  }

  @Get('/api/v1/work-orders')
  @OperationId('listWorkOrders')
  listWorkOrders(@Query() query: unknown, @Req() request: Request): Promise<WorkOrderList> {
    return this.#lists.list(requirePrincipal(request), query, requestEventContext(request));
  }

  @Get('/api/v1/work-orders/:workOrderId')
  @OperationId('getWorkOrder')
  async getWorkOrder(
    @Param() params: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WorkOrderDetails> {
    const details = await this.#reads.header(requirePrincipal(request), params);
    response.set('ETag', entityTag(details.version));
    return details;
  }

  @Get('/api/v1/work-orders/:workOrderId/scope-items')
  @OperationId('listWorkOrderScopeItems')
  listWorkOrderScopeItems(@Param() params: unknown, @Req() request: Request): Promise<ScopeItemList> {
    return this.#reads.scopeItems(requirePrincipal(request), params);
  }

  @Get('/api/v1/work-orders/:workOrderId/customer')
  @OperationId('getWorkOrderCustomer')
  getWorkOrderCustomer(@Param() params: unknown, @Req() request: Request): Promise<CustomerCard> {
    return this.#reads.customerCard(requirePrincipal(request), params, requestEventContext(request));
  }

  @Get('/api/v1/work-orders/:workOrderId/site')
  @OperationId('getWorkOrderSite')
  getWorkOrderSite(@Param() params: unknown, @Req() request: Request): Promise<SiteCard> {
    return this.#reads.siteCard(requirePrincipal(request), params);
  }

  @Get('/api/v1/work-orders/:workOrderId/site-orders')
  @OperationId('listWorkOrderSiteOrders')
  listWorkOrderSiteOrders(@Param() params: unknown, @Req() request: Request): Promise<SiteOrders> {
    return this.#siteOrders.list(requirePrincipal(request), params);
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
    response.set('ETag', entityTag(workOrder.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return workOrder;
  }

  @Post('/api/v1/work-orders/:workOrderId/transitions')
  @OperationId('transitionWorkOrder')
  @HttpCode(200)
  async transitionWorkOrder(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WorkOrderDetails> {
    const { workOrder, replayed } = await this.#transitions.transition(
      requirePrincipal(request),
      params,
      ifMatch,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(workOrder.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return workOrder;
  }
}
