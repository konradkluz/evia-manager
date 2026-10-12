/**
 * HTTP surface of the work-orders module (EVM-017: the list — moved to `overview` in EVM-034; EVM-022: the creation; EVM-018: the four reads of one order; EVM-030: the status command;
 * EVM-035: the change of the data of an order and the five operations on its scope). The handlers contain no authorization — the
 * global guard decides before they run (operation in the manifest, CSRF, channel, role); here only the call and the headers of the
 * answer. The query of the list is validated and its response parsed in the service, with the schemas of the contract. The answers
 * are never cached (the global `Cache-Control: no-store`).
 */
import type {
  CustomerCard,
  ScopeItem,
  ScopeItemAddition,
  ScopeItemList,
  SiteCard,
  SiteOrders,
  WorkOrder,
  WorkOrderDetails,
} from '@evia/contracts';
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { entityTag } from '../../../platform/http/if-match.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { requestEventContext, webEventContext } from '../../../platform/http/request-context.ts';
import { CreateScopeItemService } from '../application/create-scope-item.service.ts';
import { CreateWorkOrderService } from '../application/create-work-order.service.ts';
import { DeleteScopeItemService } from '../application/delete-scope-item.service.ts';
import { ListSiteOrdersService } from '../application/list-site-orders.service.ts';
import { ReadWorkOrderService } from '../application/read-work-order.service.ts';
import { TransitionWorkOrderService } from '../application/transition-work-order.service.ts';
import { UpdateScopeItemService } from '../application/update-scope-item.service.ts';
import { UpdateWorkOrderService } from '../application/update-work-order.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class WorkOrdersController {
  readonly #creations: CreateWorkOrderService;
  readonly #reads: ReadWorkOrderService;
  readonly #transitions: TransitionWorkOrderService;
  readonly #siteOrders: ListSiteOrdersService;
  readonly #updates: UpdateWorkOrderService;
  readonly #scopeCreations: CreateScopeItemService;
  readonly #scopeUpdates: UpdateScopeItemService;
  readonly #scopeDeletions: DeleteScopeItemService;

  constructor(
    @Inject(CreateWorkOrderService) creations: CreateWorkOrderService,
    @Inject(ReadWorkOrderService) reads: ReadWorkOrderService,
    @Inject(TransitionWorkOrderService) transitions: TransitionWorkOrderService,
    @Inject(ListSiteOrdersService) siteOrders: ListSiteOrdersService,
    @Inject(UpdateWorkOrderService) updates: UpdateWorkOrderService,
    @Inject(CreateScopeItemService) scopeCreations: CreateScopeItemService,
    @Inject(UpdateScopeItemService) scopeUpdates: UpdateScopeItemService,
    @Inject(DeleteScopeItemService) scopeDeletions: DeleteScopeItemService,
  ) {
    this.#creations = creations;
    this.#reads = reads;
    this.#transitions = transitions;
    this.#siteOrders = siteOrders;
    this.#updates = updates;
    this.#scopeCreations = scopeCreations;
    this.#scopeUpdates = scopeUpdates;
    this.#scopeDeletions = scopeDeletions;
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

  @Patch('/api/v1/work-orders/:workOrderId')
  @OperationId('updateWorkOrder')
  async updateWorkOrder(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WorkOrderDetails> {
    const { workOrder, replayed } = await this.#updates.update(
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

  @Get('/api/v1/work-orders/:workOrderId/scope-items')
  @OperationId('listWorkOrderScopeItems')
  listWorkOrderScopeItems(@Param() params: unknown, @Req() request: Request): Promise<ScopeItemList> {
    return this.#reads.scopeItems(requirePrincipal(request), params);
  }

  @Post('/api/v1/work-orders/:workOrderId/scope-items')
  @OperationId('createWorkOrderScopeItem')
  @HttpCode(201)
  async createWorkOrderScopeItem(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ScopeItemAddition> {
    const { workOrderId, addition, replayed } = await this.#scopeCreations.create(
      requirePrincipal(request),
      params,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(addition.item.version));
    response.set('Location', `/api/v1/work-orders/${workOrderId}/scope-items/${addition.item.id}`);
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return addition;
  }

  @Get('/api/v1/work-orders/:workOrderId/scope-items/:scopeItemId')
  @OperationId('getWorkOrderScopeItem')
  async getWorkOrderScopeItem(
    @Param() params: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ScopeItem> {
    const item = await this.#reads.scopeItem(requirePrincipal(request), params);
    response.set('ETag', entityTag(item.version));
    return item;
  }

  @Patch('/api/v1/work-orders/:workOrderId/scope-items/:scopeItemId')
  @OperationId('updateWorkOrderScopeItem')
  async updateWorkOrderScopeItem(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ScopeItem> {
    const { item, replayed } = await this.#scopeUpdates.update(
      requirePrincipal(request),
      params,
      ifMatch,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(item.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return item;
  }

  @Delete('/api/v1/work-orders/:workOrderId/scope-items/:scopeItemId')
  @OperationId('deleteWorkOrderScopeItem')
  @HttpCode(204)
  async deleteWorkOrderScopeItem(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const replayed = await this.#scopeDeletions.delete(
      requirePrincipal(request),
      params,
      ifMatch,
      idempotencyKey,
      webEventContext(request, response),
    );
    if (replayed) response.set('Idempotent-Replayed', 'true');
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
