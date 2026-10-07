/**
 * Search of parties (EVM-021 AC3, AC6, AC7; SR-API-04, SR-API-02, SR-INPUT-03, SR-DATA-03). The guard has decided before this runs
 * (the three roles, web channel, CSRF). Order: the per-user limit counts EVERY authorised search, one refused by the validation as
 * well (a loop of 2-character phrases is no way round it); then the body is validated (400), the phrase resolved (NFC, 3–100
 * characters); then the mass-read meter is asked (429) BEFORE the query, and the records returned are counted AFTER the answer is
 * built — so a refused or invalid request counts nothing towards policy P10.
 *
 * The limit has its own bucket (`search-parties`): the two comboboxes of the form (OSD, manager) ask at the same time and must not
 * eat the limit of the customer search; the mass-read meter counts the records of every kind of search together.
 *
 * The result has `id`, `kind`, `legalForm` and `displayName` only (never the telephone, the e-mail, the contact person or the
 * notes), at most 20 rows, in a list envelope with `nextCursor: null`. Neither the phrase nor a name is ever logged, put in a
 * metric or in `errors[]`.
 */
import { zPartySearchRequest, zPartySearchResult } from '@evia/contracts/zod';
import type { PartySearchResult } from '@evia/contracts';
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
import type { PartyKind } from '../domain/party.ts';
import { searchVisibleParties } from '../infrastructure/party-store.ts';
import { partyTables } from '../infrastructure/tables.ts';

export const PARTY_SEARCH_RATE_BUCKET = 'search-parties';
export const PARTY_SEARCH_LIMIT = 20;
export const PARTY_SEARCH_RATE_LIMITED_METRIC = 'party_search_rate_limited';

const searchBody = strictObjects(zPartySearchRequest);

@Injectable()
export class SearchPartiesService {
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
    this.#rateLimited = metrics.counter(PARTY_SEARCH_RATE_LIMITED_METRIC, []);
  }

  async search(principal: Principal, rawBody: unknown, context: EventContext): Promise<PartySearchResult> {
    const decision = this.#limiter.consumeSubject(PARTY_SEARCH_RATE_BUCKET, principal.userId, RATE_LIMITS.search);
    if (!decision.allowed) {
      this.#rateLimited.increment({});
      throw new ProblemException('rate_limited', { retryAfterSeconds: decision.retryAfterSeconds });
    }
    const { query, kinds } = parseInput(searchBody, rawBody) as { query: string; kinds?: PartyKind[] };
    const phrase = normalizeSearchPhrase(query);
    if (!phrase.ok) throw new ProblemException('validation_failed', { errors: phrase.errors });
    // The contract says `uniqueItems`; the generated schema cannot state it, so the rule is kept here.
    if (kinds !== undefined && new Set(kinds).size !== kinds.length) {
      throw new ProblemException('validation_failed', { errors: [{ pointer: '/kinds', code: 'not_unique' }] });
    }

    await this.#bulkRead.before(principal.userId, { ...context, sessionId: principal.sessionId }, 'party');
    const rows = await searchVisibleParties(partyTables(this.#db), principal, phrase.phrase, kinds, PARTY_SEARCH_LIMIT);
    const result = zPartySearchResult.safeParse({
      items: rows.map((row) => ({ id: row.id, kind: row.kind, legalForm: row.legal_form, displayName: row.display_name })),
      nextCursor: null,
    });
    if (!result.success) throw new ProblemException('internal_error');
    this.#bulkRead.after(principal.userId, result.data.items.length);
    return result.data;
  }
}
