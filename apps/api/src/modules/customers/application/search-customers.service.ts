/**
 * Search of customers (EVM-020 AC1, AC3, AC6, AC7; SR-API-04, SR-API-02, SR-INPUT-03, SR-DATA-03). The guard has decided before this
 * runs (the three roles, web channel, CSRF). Order: the per-user limit counts EVERY authorised search, one refused by the
 * validation as well (a loop of 2-character phrases is no way round it); then the body is validated (400), the phrase resolved
 * (NFC, 3–100 characters, telephone phrases reduced to digits); then the mass-read meter is asked (429) BEFORE the query, and the
 * records returned are counted AFTER the answer is built — so a refused or invalid request counts nothing towards policy P10.
 *
 * The result has `id`, `displayName` and `phone` only (never e-mail, NIP, address, notes or the search text), at most 20 rows, in a
 * list envelope with `nextCursor: null` (pages can come later without a breaking change). Neither the phrase nor a telephone number
 * is ever logged, put in a metric or in `errors[]`.
 */
import { zCustomerSearchRequest, zCustomerSearchResult } from '@evia/contracts/zod';
import type { CustomerSearchResult } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { BulkReadControl } from '../../../platform/bulk-read/bulk-read-control.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { RATE_LIMITER, RATE_LIMITS, type RateLimiter } from '../../../platform/http/rate-limiter.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { BULK_READ_CONTROL, DATABASE, METRICS } from '../../../platform/tokens.ts';
import { resolveSearchQuery } from '../domain/search-query.ts';
import { searchVisibleCustomers } from '../infrastructure/customer-store.ts';
import { customerTables } from '../infrastructure/tables.ts';

export const SEARCH_RATE_BUCKET = 'search';
export const SEARCH_LIMIT = 20;
export const SEARCH_RATE_LIMITED_METRIC = 'customer_search_rate_limited';

const searchBody = strictObjects(zCustomerSearchRequest);

@Injectable()
export class SearchCustomersService {
  readonly #db: Kysely<Database>;
  readonly #limiter: RateLimiter;
  readonly #bulkRead: BulkReadControl;
  readonly #rateLimited: Counter;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(RATE_LIMITER) limiter: RateLimiter,
    @Inject(BULK_READ_CONTROL) bulkRead: BulkReadControl,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#db = db;
    this.#limiter = limiter;
    this.#bulkRead = bulkRead;
    this.#rateLimited = metrics.counter(SEARCH_RATE_LIMITED_METRIC, []);
  }

  async search(principal: Principal, rawBody: unknown, context: EventContext): Promise<CustomerSearchResult> {
    const decision = this.#limiter.consumeSubject(SEARCH_RATE_BUCKET, principal.userId, RATE_LIMITS.search);
    if (!decision.allowed) {
      this.#rateLimited.increment({});
      throw new ProblemException('rate_limited', { retryAfterSeconds: decision.retryAfterSeconds });
    }
    const { query } = parseInput(searchBody, rawBody) as { query: string };
    const phrase = resolveSearchQuery(query);
    if (!phrase.ok) throw new ProblemException('validation_failed', { errors: phrase.errors });

    await this.#bulkRead.before(principal.userId, { ...context, sessionId: principal.sessionId }, 'customer');
    const rows = await searchVisibleCustomers(customerTables(this.#db), principal, phrase.term, SEARCH_LIMIT);
    const result = zCustomerSearchResult.safeParse({
      items: rows.map((row) => ({ id: row.id, displayName: row.display_name, phone: row.phone })),
      nextCursor: null,
    });
    if (!result.success) throw new ProblemException('internal_error');
    this.#bulkRead.after(principal.userId, result.data.items.length);
    return result.data;
  }
}
