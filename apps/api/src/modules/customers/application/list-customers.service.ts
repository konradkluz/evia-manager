/**
 * The list of customers (EVM-039 AC1, AC6, AC7; W-14). The guard has decided before this runs (the three roles, web channel); here: the
 * validated query (a strict schema — no phrase, no sort) and ONE page through {@link CustomerPagesService}.
 */
import type { CustomerList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import { resolveCustomerListQuery } from '../domain/customer-list-query.ts';
import { CustomerPagesService } from './customer-pages.service.ts';

@Injectable()
export class ListCustomersService {
  readonly #pages: CustomerPagesService;

  constructor(@Inject(CustomerPagesService) pages: CustomerPagesService) {
    this.#pages = pages;
  }

  /** @param rawQuery the query string as parsed by the framework (strings only) */
  list(principal: Principal, rawQuery: unknown, context: EventContext): Promise<CustomerList> {
    const query = parseInput(resolveCustomerListQuery, rawQuery);
    return this.#pages.page(principal, { operation: 'listCustomers', term: undefined, ...query }, context);
  }
}
