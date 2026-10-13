/**
 * The body of the search of work orders (EVM-072 AC2, AC3, AC4; SR-API-04, SR-INPUT-01, SR-INPUT-03, SR-INPUT-08; ASVS V1.2.4,
 * V2.2.1; CWE-89, CWE-20). A strict schema (an unknown field is `unknown_field`, never ignored), the phrase normalised by the platform
 * (NFC, white space, 3–100 code points, no control character — an error names the pointer and the code, never the phrase) and the
 * filters resolved into the same {@link WorkOrderListQuery} the list uses, so the two share one reader and one meaning of a filter.
 * Pure functions of the input; no database.
 *
 * The cursor of a search is bound to the filters AND the phrase: {@link searchFilterPartsOf} appends the phrase to the filter parts
 * that `scopeOf` hashes, so the phrase appears in the cursor only as part of a digest (ADR-0017 W8).
 */
import { zPartyKind, zSiteType, zWorkOrderSort, zWorkOrderStatus, zWorkOrderView, zWorkOrderWaitingOnFilter } from '@evia/contracts/zod';
import { z } from 'zod';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import { normalizeSearchPhrase } from '../../../platform/input/search-phrase.ts';
import {
  DEFAULT_LIMIT,
  DEFAULT_SORT,
  MAX_LIMIT,
  MAX_WAITING_DAYS,
  MIN_WAITING_DAYS,
  filterPartsOf,
  type WorkOrderListQuery,
} from './work-order-list-query.ts';

/** The most sources a search may match in one of the modules before it is refused as too broad (ADR-0017 W6). */
export const SEARCH_ID_LIMIT = 10_000;
const MAX_STATUS_LIST = 20;
const MAX_RAW_PHRASE = 200;

const searchBodySchema = z
  .strictObject({
    query: z.string().max(MAX_RAW_PHRASE),
    status: z.array(zWorkOrderStatus).max(MAX_STATUS_LIST).optional(),
    view: zWorkOrderView.optional(),
    coordinatorId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    siteType: zSiteType.optional(),
    templateId: z.uuid().optional(),
    waitingOn: zWorkOrderWaitingOnFilter.optional(),
    waitingOnPartyKind: zPartyKind.optional(),
    waitingLongerThanDays: z.int().min(MIN_WAITING_DAYS).max(MAX_WAITING_DAYS).optional(),
    sort: zWorkOrderSort.optional(),
    limit: z.int().min(1).max(MAX_LIMIT).optional(),
    cursor: z
      .string()
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .superRefine((body, context) => {
    // the same contradiction as in the list: a KIND of party cannot be waited for together with the customer
    if (body.waitingOn === 'customer' && body.waitingOnPartyKind !== undefined) {
      context.addIssue({ code: 'custom', path: ['waitingOnPartyKind'], message: 'contradicts waitingOn' });
    }
  });

export interface WorkOrderSearchQuery {
  /** the normalised phrase: NFC, white space collapsed, 3–100 code points — never logged, never in a URL */
  readonly phrase: string;
  /** the filters, defaults applied, statuses normalised — exactly what the list resolves from its query string */
  readonly filters: WorkOrderListQuery;
}

/**
 * @throws ProblemException `validation_failed` with `errors[]` of a pointer and a code (`unknown_field`, `invalid_type`, `too_short`,
 * `too_long`, `invalid_characters` …) — the value of a field is never echoed
 */
export function resolveWorkOrderSearchQuery(rawBody: unknown): WorkOrderSearchQuery {
  const body = parseInput(searchBodySchema, rawBody);
  const phrase = normalizeSearchPhrase(body.query);
  if (!phrase.ok) throw new ProblemException('validation_failed', { errors: phrase.errors });
  return {
    phrase: phrase.phrase,
    filters: {
      statuses: [...new Set(body.status ?? [])].sort(),
      view: body.view,
      coordinatorId: body.coordinatorId,
      customerId: body.customerId,
      siteType: body.siteType,
      templateId: body.templateId,
      waitingOn: body.waitingOn ?? (body.waitingOnPartyKind === undefined ? undefined : 'party'),
      waitingOnPartyKind: body.waitingOnPartyKind,
      waitingLongerThanDays: body.waitingLongerThanDays,
      sort: body.sort ?? DEFAULT_SORT,
      limit: body.limit ?? DEFAULT_LIMIT,
      cursor: body.cursor,
    },
  };
}

/** What a cursor of a search is bound to: the filters of the list and the phrase (hashed by the caller; see the module comment). */
export const searchFilterPartsOf = (query: WorkOrderSearchQuery): string[] => [...filterPartsOf(query.filters), query.phrase];
