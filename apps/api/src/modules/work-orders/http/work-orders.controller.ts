/**
 * HTTP surface of the work-orders module (EVM-017): ONE read operation so far. The handler contains no authorization — the
 * global guard decides before it runs (the three roles, web channel); here only the call. The query is validated and the
 * response parsed in the service, with the schemas of the contract.
 */
import type { WorkOrderList } from '@evia/contracts';
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { requestEventContext } from '../../../platform/http/request-context.ts';
import { ListWorkOrdersService } from '../application/list-work-orders.service.ts';

@Controller()
export class WorkOrdersController {
  readonly #lists: ListWorkOrdersService;

  constructor(@Inject(ListWorkOrdersService) lists: ListWorkOrdersService) {
    this.#lists = lists;
  }

  @Get('/api/v1/work-orders')
  @OperationId('listWorkOrders')
  listWorkOrders(@Query() query: unknown, @Req() request: Request): Promise<WorkOrderList> {
    const principal = principalOf(request);
    if (principal === null) throw new ProblemException('unauthenticated');
    return this.#lists.list(principal, query, requestEventContext(request));
  }
}
