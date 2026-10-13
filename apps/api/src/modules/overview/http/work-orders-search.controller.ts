/**
 * HTTP surface of the search of work orders (EVM-072): `POST /api/v1/work-orders/search` — a POST because the phrase may name a person
 * and must not reach a URL, an access log or the history of a browser (SR-API-04). The handler contains no authorization: the global
 * guard decides before it runs (operation in the manifest, CSRF, channel, role); the body is validated and the response parsed in the
 * service with the schemas of the contract. The answers are never cached (the global `Cache-Control: no-store`).
 */
import type { WorkOrderList } from '@evia/contracts';
import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { SearchWorkOrdersService } from '../application/search-work-orders.service.ts';

@Controller()
export class WorkOrdersSearchController {
  readonly #searches: SearchWorkOrdersService;

  constructor(@Inject(SearchWorkOrdersService) searches: SearchWorkOrdersService) {
    this.#searches = searches;
  }

  @Post('/api/v1/work-orders/search')
  @OperationId('searchWorkOrders')
  @HttpCode(200)
  searchWorkOrders(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<WorkOrderList> {
    const principal = principalOf(request);
    if (principal === null) throw new ProblemException('unauthenticated');
    return this.#searches.search(principal, body, webEventContext(request, response));
  }
}
