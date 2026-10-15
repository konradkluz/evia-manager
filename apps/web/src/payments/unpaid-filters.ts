import type { ListUnpaidPaymentMilestonesData, UnpaidView } from '@evia/contracts';
import { isDayInRange } from '../work-orders/milestone-days.ts';

/** Rows on a page: the story EVM-055 AC1 (25 by default) — within the limit of the API (100, `api-guidelines.md`). */
export const PAGE_SIZES: readonly number[] = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

/**
 * What the address of W-11 carries (EVM-055 AC4; flows/08 → "Filtry i URL"): only the view — "Wszystkie wystawione" (no `view`),
 * "Po terminie" (`view=overdue`) or "Do wystawienia" (`view=planned`, EVM-059). The range of the due dates and the customer are the memory of the tab: a customer is personal
 * data and the range is outside the list of the parameters the address may carry (SR-API-04, SR-WEB-05).
 */
export interface UnpaidSearch {
  readonly view?: 'overdue' | 'planned';
}

/** Anything but `view=overdue` in the address is dropped (the router keeps only what this returns). */
export const validateSearch = (search: Record<string, unknown>): UnpaidSearch =>
  search['view'] === 'overdue' || search['view'] === 'planned' ? { view: search['view'] } : {};

export const viewOf = (search: UnpaidSearch): UnpaidView => search.view ?? 'unpaid';
export const searchOf = (view: UnpaidView): UnpaidSearch => (view === 'unpaid' ? {} : { view });

/** The filters of the list; `''` — the filter is off. The customer and the dates never reach the address. */
export interface UnpaidFilters {
  readonly view: UnpaidView;
  /** `YYYY-MM-DD` (the value of the date field) or `''`. */
  readonly dueFrom: string;
  readonly dueTo: string;
  /** The identifier of the customer chosen in the search (never the name). */
  readonly customerId: string;
}

export const NO_FILTERS: UnpaidFilters = { view: 'unpaid', dueFrom: '', dueTo: '', customerId: '' };

export const isFiltered = (filters: UnpaidFilters): boolean =>
  filters.view !== 'unpaid' || filters.dueFrom !== '' || filters.dueTo !== '' || filters.customerId !== '';

/** Whether anything narrows the list within its view (the view itself does not: "Do wystawienia" with no more filters is the whole of it). */
export const isNarrowed = (filters: UnpaidFilters): boolean =>
  filters.customerId !== '' || (filters.view !== 'planned' && (filters.dueFrom !== '' || filters.dueTo !== ''));

export type RangeProblem = 'range' | 'order';

/** What is wrong with a date of the range (outside 2000–2100: the field is advisory, the API refuses it) — or `undefined`. */
export const dayProblem = (day: string): 'range' | undefined => (day === '' || isDayInRange(day) ? undefined : 'range');

/** The range of the due dates as the API takes it: both ends in 2000–2100 and `dueFrom` not after `dueTo`. */
export function rangeProblem(filters: Pick<UnpaidFilters, 'dueFrom' | 'dueTo'> & { readonly view?: UnpaidView }): RangeProblem | undefined {
  // "Do wystawienia" has no due date (EVM-059): the range is not sent, so it cannot be a problem.
  if (filters.view === 'planned') return undefined;
  if (dayProblem(filters.dueFrom) !== undefined || dayProblem(filters.dueTo) !== undefined) return 'range';
  if (filters.dueFrom !== '' && filters.dueTo !== '' && filters.dueFrom > filters.dueTo) return 'order';
  return undefined;
}

/** The query of `GET /payment-milestones`: only what is set (`view=unpaid` is the default of the API and is not sent). */
export function toQuery(
  filters: UnpaidFilters,
  cursor: string | undefined,
  limit: number,
): NonNullable<ListUnpaidPaymentMilestonesData['query']> {
  return {
    ...(filters.view === 'unpaid' ? {} : { view: filters.view }),
    ...(filters.dueFrom === '' || filters.view === 'planned' ? {} : { dueFrom: filters.dueFrom }),
    ...(filters.dueTo === '' || filters.view === 'planned' ? {} : { dueTo: filters.dueTo }),
    ...(filters.customerId === '' ? {} : { customerId: filters.customerId }),
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  };
}
