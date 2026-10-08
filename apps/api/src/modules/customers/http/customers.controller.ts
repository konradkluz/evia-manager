/**
 * HTTP surface of the customers module (EVM-020: the search and the creation; EVM-039: the list, the detail and the edit). The handlers contain no authorization — the global
 * guard decides before they run (operation in the manifest, CSRF, channel, role); here only the call and the headers of the answer.
 * The answers are never cached (the global `Cache-Control: no-store`).
 */
import type { Customer, CustomerList, CustomerSearchResult } from '@evia/contracts';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { entityTag } from '../../../platform/http/if-match.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { requestEventContext, webEventContext } from '../../../platform/http/request-context.ts';
import { CreateCustomerService } from '../application/create-customer.service.ts';
import { ListCustomersService } from '../application/list-customers.service.ts';
import { ReadCustomerService } from '../application/read-customer.service.ts';
import { SearchCustomersService } from '../application/search-customers.service.ts';
import { UpdateCustomerService } from '../application/update-customer.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class CustomersController {
  readonly #searches: SearchCustomersService;
  readonly #creations: CreateCustomerService;
  readonly #lists: ListCustomersService;
  readonly #reads: ReadCustomerService;
  readonly #updates: UpdateCustomerService;

  constructor(
    @Inject(SearchCustomersService) searches: SearchCustomersService,
    @Inject(CreateCustomerService) creations: CreateCustomerService,
    @Inject(ListCustomersService) lists: ListCustomersService,
    @Inject(ReadCustomerService) reads: ReadCustomerService,
    @Inject(UpdateCustomerService) updates: UpdateCustomerService,
  ) {
    this.#searches = searches;
    this.#creations = creations;
    this.#lists = lists;
    this.#reads = reads;
    this.#updates = updates;
  }

  @Get('/api/v1/customers')
  @OperationId('listCustomers')
  listCustomers(@Query() query: unknown, @Req() request: Request): Promise<CustomerList> {
    return this.#lists.list(requirePrincipal(request), query, requestEventContext(request));
  }

  @Get('/api/v1/customers/:customerId')
  @OperationId('getCustomer')
  async getCustomer(@Param() params: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<Customer> {
    const customer = await this.#reads.get(requirePrincipal(request), params, requestEventContext(request));
    response.set('ETag', entityTag(customer.version));
    return customer;
  }

  @Patch('/api/v1/customers/:customerId')
  @OperationId('updateCustomer')
  @HttpCode(200)
  async updateCustomer(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Customer> {
    const { customer, replayed } = await this.#updates.update(
      requirePrincipal(request),
      params,
      ifMatch,
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('ETag', entityTag(customer.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return customer;
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
    response.set('ETag', entityTag(customer.version));
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return customer;
  }
}
