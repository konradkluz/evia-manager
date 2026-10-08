/**
 * Search of customers (EVM-020 AC1, AC3, AC6, AC7; EVM-039 AC1, AC5; SR-API-04, SR-API-02, SR-INPUT-03, SR-DATA-03). The guard has decided
 * before this runs (the three roles, web channel, CSRF). Order: the per-user limit counts EVERY authorised search, one refused by the
 * validation as well (a loop of 2-character phrases is no way round it); then the body is validated (400), the phrase resolved
 * (NFC, 3–100 characters, telephone phrases reduced to digits); then ONE page through {@link CustomerPagesService} — the cursor is
 * opened (400), the mass-read meter asked (429) BEFORE the query, and the customers returned counted AFTER the answer is built, so a
 * refused or invalid request counts nothing towards policy P10.
 *
 * The result is the same page as the list has (`id`, `kind`, `displayName`, `sortName`, `phone`, `email` — never NIP, address, notes or
 * the search text), 25 rows by default, in a list envelope with `nextCursor`. The cursor is bound to the phrase and to the user.
 * Neither the phrase nor a telephone number is ever logged, put in a metric or in `errors[]`.
 */
import { zCustomerSearchRequest } from '@evia/contracts/zod';
import type { CustomerSearchResult } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { RATE_LIMITER, RATE_LIMITS, type RateLimiter } from '../../../platform/http/rate-limiter.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { METRICS } from '../../../platform/tokens.ts';
import { resolveSearchQuery } from '../domain/search-query.ts';
import { CustomerPagesService } from './customer-pages.service.ts';

export const SEARCH_RATE_BUCKET = 'search';
export const SEARCH_RATE_LIMITED_METRIC = 'customer_search_rate_limited';

const searchBody = strictObjects(zCustomerSearchRequest);

@Injectable()
export class SearchCustomersService {
  readonly #pages: CustomerPagesService;
  readonly #limiter: RateLimiter;
  readonly #rateLimited: Counter;

  constructor(
    @Inject(CustomerPagesService) pages: CustomerPagesService,
    @Inject(RATE_LIMITER) limiter: RateLimiter,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#pages = pages;
    this.#limiter = limiter;
    this.#rateLimited = metrics.counter(SEARCH_RATE_LIMITED_METRIC, []);
  }

  async search(principal: Principal, rawBody: unknown, context: EventContext): Promise<CustomerSearchResult> {
    const decision = this.#limiter.consumeSubject(SEARCH_RATE_BUCKET, principal.userId, RATE_LIMITS.search);
    if (!decision.allowed) {
      this.#rateLimited.increment({});
      throw new ProblemException('rate_limited', { retryAfterSeconds: decision.retryAfterSeconds });
    }
    const { query, limit, cursor } = parseInput(searchBody, rawBody) as { query: string; limit: number; cursor?: string };
    const phrase = resolveSearchQuery(query);
    if (!phrase.ok) throw new ProblemException('validation_failed', { errors: phrase.errors });
    return this.#pages.page(principal, { operation: 'searchCustomers', term: phrase.term, limit, cursor }, context);
  }
}
