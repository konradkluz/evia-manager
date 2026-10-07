/**
 * Search of sites (EVM-021 AC1, AC6, AC7; SR-API-04, SR-API-02, SR-INPUT-03, SR-DATA-03). The guard has decided before this runs (the
 * three roles, web channel, CSRF). Order: the per-user limit counts EVERY authorised search, one refused by the validation as well
 * (a loop of 2-character phrases is no way round it); then the body is validated (400), the phrase resolved (NFC, 3–100 characters);
 * then the mass-read meter is asked (429) BEFORE the query, and the records returned are counted AFTER the answer is built — so a
 * refused or invalid request counts nothing towards policy P10.
 *
 * The limit has its own bucket (`search-sites`); the mass-read meter counts the records of every kind of search together (the
 * separate buckets are compensated by the one counter of P10, EVM-021 security consultation).
 *
 * The result has the type, the address and the parking spot only (never the notes, the PPE, the connection power or the parties), at
 * most 20 rows, in a list envelope with `nextCursor: null`. Neither the phrase nor an address is ever logged, put in a metric or in
 * `errors[]`.
 */
import { zSiteSearchRequest, zSiteSearchResult } from '@evia/contracts/zod';
import type { SiteSearchResult } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { BulkReadControl } from '../../../platform/bulk-read/bulk-read-control.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { RATE_LIMITER, RATE_LIMITS, type RateLimiter } from '../../../platform/http/rate-limiter.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { normalizeSearchPhrase } from '../../../platform/input/search-phrase.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { BULK_READ_CONTROL, DATABASE, METRICS } from '../../../platform/tokens.ts';
import { searchVisibleSites } from '../infrastructure/site-store.ts';
import { siteTables } from '../infrastructure/tables.ts';
import { toSiteSearchItem } from './site-representation.ts';

export const SITE_SEARCH_RATE_BUCKET = 'search-sites';
export const SITE_SEARCH_LIMIT = 20;
export const SITE_SEARCH_RATE_LIMITED_METRIC = 'site_search_rate_limited';

const searchBody = strictObjects(zSiteSearchRequest);

@Injectable()
export class SearchSitesService {
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
    this.#rateLimited = metrics.counter(SITE_SEARCH_RATE_LIMITED_METRIC, []);
  }

  async search(principal: Principal, rawBody: unknown, context: EventContext): Promise<SiteSearchResult> {
    const decision = this.#limiter.consumeSubject(SITE_SEARCH_RATE_BUCKET, principal.userId, RATE_LIMITS.search);
    if (!decision.allowed) {
      this.#rateLimited.increment({});
      throw new ProblemException('rate_limited', { retryAfterSeconds: decision.retryAfterSeconds });
    }
    const { query } = parseInput(searchBody, rawBody) as { query: string };
    const phrase = normalizeSearchPhrase(query);
    if (!phrase.ok) throw new ProblemException('validation_failed', { errors: phrase.errors });

    await this.#bulkRead.before(principal.userId, { ...context, sessionId: principal.sessionId }, 'site');
    const rows = await searchVisibleSites(siteTables(this.#db), principal, phrase.phrase, SITE_SEARCH_LIMIT);
    const result = zSiteSearchResult.safeParse({ items: rows.map(toSiteSearchItem), nextCursor: null });
    if (!result.success) throw new ProblemException('internal_error');
    this.#bulkRead.after(principal.userId, result.data.items.length);
    return result.data;
  }
}
