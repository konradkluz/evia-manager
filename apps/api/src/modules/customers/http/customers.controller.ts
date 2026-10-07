/**
 * HTTP surface of the customers module (EVM-020): the search and the creation. The handlers contain no authorization — the global
 * guard decides before they run (operation in the manifest, CSRF, channel, role); here only the call and the headers of the answer.
 * The answers are never cached (the global `Cache-Control: no-store`).
 */
import type { Customer, CustomerSearchResult } from '@evia/contracts';
import { Body, Controller, Headers, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { CreateCustomerService } from '../application/create-customer.service.ts';
import { SearchCustomersService } from '../application/search-customers.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class CustomersController {
  readonly #searches: SearchCustomersService;
  readonly #creations: CreateCustomerService;

  constructor(
    @Inject(SearchCustomersService) searches: SearchCustomersService,
    @Inject(CreateCustomerService) creations: CreateCustomerService,
  ) {
    this.#searches = searches;
    this.#creations = creations;
  }

  @Post('/api/v1/customers/search')
  @OperationId('searchCustomers')
  @HttpCode(200)
  searchCustomers(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerSearchResult> {
    return this.#searches.search(requirePrincipal(request), body, webEventContext(request, response));
  }

  @Post('/api/v1/customers')
  @OperationId('createCustomer')
  @HttpCode(201)
  async createCustomer(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Customer> {
    const { customer, replayed } = await this.#creations.create(
      requirePrincipal(request),
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', `"${customer.version}"`);
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return customer;
  }
}
