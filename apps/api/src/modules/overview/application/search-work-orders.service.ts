/**
 * The search of work orders (EVM-072 AC2, AC3, AC5; SR-API-04, SR-API-02, SR-AUTHZ-03, SR-INPUT-03; ADR-0017 W1, W2, W6, W8). The guard
 * has decided before this runs (the three roles, web channel, CSRF). The phrase is in the BODY and nowhere else: it is never logged,
 * put in a metric, a cursor (only as a digest in its scope), an `errors[]` or a title.
 *
 * Order matters, and it is the order of the documentation of the operation:
 * 1. the limiter counts EVERY authorised search (a loop of invalid phrases is no way round it) — `429` with `Retry-After`;
 * 2. the body is validated and the phrase normalised (400 — before the database, so a NUL or a control character is `400`, never a `500`);
 * 3. the cursor is opened (400 `invalid_cursor`: a cursor of the list, of another phrase, another user or an expired one), and a
 *    payment view is refused to a caller who may not read payments (403, EVM-056 W4);
 * 4. the mass-read meter is asked (429) BEFORE any query;
 * 5. the three modules are asked for the identifiers the phrase matches — the orders (number, title), the customers (name, company,
 *    tax id, telephone, e-mail, city) and the sites (address) — each under ITS OWN read policy, `LIMIT` 10 001: a phrase that matches
 *    more than 10 000 in any of them is `400 too_broad` (W6), BEFORE the projection is queried;
 * 6. ONE page from the projection with the read policy of work orders IN the query, narrowed by `= ANY(ids)` (the sets are only an
 *    extra condition, never a source of permission — W2), the batches, the parsing and the counting of P10 — {@link WorkOrderPageService}.
 *
 * The cursor of a search is bound to the operation `searchWorkOrders` (a cursor of the list does not open here and the other way
 * round), to the user, to the filters and to the phrase; changing the phrase starts from the first page.
 */
import type { WorkOrderList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { BulkReadControl } from '../../../platform/bulk-read/bulk-read-control.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { RATE_LIMITER, RATE_LIMITS, type RateLimiter } from '../../../platform/http/rate-limiter.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { BULK_READ_CONTROL, DATABASE, METRICS } from '../../../platform/tokens.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { SITE_DIRECTORY, type SiteDirectory } from '../../sites/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { resolveWorkOrderSearchQuery, searchFilterPartsOf, SEARCH_ID_LIMIT } from '../domain/work-order-search-query.ts';
import type { SearchIdSets } from '../infrastructure/work-order-list-reader.ts';
import { WorkOrderPageService } from './work-order-page.service.ts';

/** Identifier of the operation in the contract; the cursor is bound to it (a cursor of the list is another operation). */
export const SEARCH_WORK_ORDERS_OPERATION = 'searchWorkOrders';
export const WORK_ORDER_SEARCH_RATE_BUCKET = 'search-work-orders';
export const WORK_ORDER_SEARCH_RATE_LIMITED_METRIC = 'work_order_search_rate_limited';

@Injectable()
export class SearchWorkOrdersService {
  readonly #db: Kysely<Database>;
  readonly #pages: WorkOrderPageService;
  readonly #limiter: RateLimiter;
  readonly #bulkRead: BulkReadControl;
  readonly #orders: WorkOrderDirectory;
  readonly #customers: CustomerDirectory;
  readonly #sites: SiteDirectory;
  readonly #rateLimited: Counter;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(WorkOrderPageService) pages: WorkOrderPageService,
    @Inject(RATE_LIMITER) limiter: RateLimiter,
    @Inject(BULK_READ_CONTROL) bulkRead: BulkReadControl,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory,
    @Inject(SITE_DIRECTORY) sites: SiteDirectory,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#db = db;
    this.#pages = pages;
    this.#limiter = limiter;
    this.#bulkRead = bulkRead;
    this.#orders = orders;
    this.#customers = customers;
    this.#sites = sites;
    // no label: neither the phrase nor the user is a dimension of a metric
    this.#rateLimited = metrics.counter(WORK_ORDER_SEARCH_RATE_LIMITED_METRIC, []);
  }

  async search(principal: Principal, rawBody: unknown, context: EventContext): Promise<WorkOrderList> {
    const decision = this.#limiter.consumeSubject(WORK_ORDER_SEARCH_RATE_BUCKET, principal.userId, RATE_LIMITS.search);
    if (!decision.allowed) {
      this.#rateLimited.increment({});
      throw new ProblemException('rate_limited', { retryAfterSeconds: decision.retryAfterSeconds });
    }
    const query = resolveWorkOrderSearchQuery(rawBody);
    const scope = this.#pages.scope(principal, searchFilterPartsOf(query));
    const start = this.#pages.start(principal, SEARCH_WORK_ORDERS_OPERATION, query.filters, scope);
    this.#pages.authorize(principal, query.filters);
    await this.#bulkRead.before(principal.userId, { ...context, sessionId: principal.sessionId });

    const narrowing = await this.#matches(principal, query.phrase);
    return this.#pages.page(principal, {
      operation: SEARCH_WORK_ORDERS_OPERATION,
      query: query.filters,
      scope,
      start,
      narrowing,
      context,
    });
  }

  /**
   * The identifiers the phrase matches in the three modules, each under its own read policy; one more than the limit is asked for, so
   * "more than the limit" is known without counting. Sequential on purpose: one connection at a time, and the first module that is too
   * broad ends the work.
   */
  async #matches(principal: Principal, phrase: string): Promise<SearchIdSets> {
    const max = SEARCH_ID_LIMIT + 1;
    const workOrders = await this.#orders.searchIds(this.#db, principal, phrase, max);
    this.#assertNotTooBroad(workOrders);
    const customers = await this.#customers.searchIds(this.#db, principal, phrase, max);
    this.#assertNotTooBroad(customers);
    const sites = await this.#sites.searchIds(this.#db, principal, phrase, max);
    this.#assertNotTooBroad(sites);
    return { workOrders, customers, sites };
  }

  #assertNotTooBroad(ids: readonly string[]): void {
    if (ids.length > SEARCH_ID_LIMIT) {
      throw new ProblemException('validation_failed', { errors: [{ pointer: '/query', code: 'too_broad' }] });
    }
  }
}
