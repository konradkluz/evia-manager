import type { ListWorkOrdersData, WorkOrderSort, WorkOrderStatus } from '@evia/contracts';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';

/** Statuses of the filter, in the order of the life of an order (styleguide § 4.4). */
export const WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = [
  'new',
  'quoting',
  'accepted',
  'in_progress',
  'on_hold',
  'completed',
  'settled',
  'cancelled',
];

/** Orders on a page: the story EVM-017 AC3 (25) — within the API limit of 100. */
export const PAGE_SIZE = 25;

/**
 * `all_open` — "Wszystkie niezamknięte" (the default view of the panel, sent to the API explicitly), `mine` — "Moje",
 * `all` — every status (the panel's own identifier: the API gets no `view`), `unknown` — an identifier from a link that
 * this panel does not know ("Nie znaleziono widoku").
 */
export type ViewId = 'all_open' | 'mine' | 'all' | 'unknown';

/** What the address carries (styleguide § 3.7): the statuses and the view — never a person, a cursor or a title. */
export interface WorkOrderSearch {
  readonly status?: string;
  readonly view?: string;
}

export interface WorkOrderFilters {
  readonly view: ViewId;
  readonly statuses: readonly WorkOrderStatus[];
  /** Only in the memory of the tab: a person is personal data and never goes to the address (AC2). */
  readonly coordinatorId: string;
  readonly sort: WorkOrderSort;
}

export const DEFAULT_SORT: WorkOrderSort = '-number';
export const NO_FILTERS: WorkOrderFilters = { view: 'all_open', statuses: [], coordinatorId: '', sort: DEFAULT_SORT };

const isStatus = (value: string): value is WorkOrderStatus => Object.hasOwn(workOrderStatusLabels, value);

/** Router `validateSearch`: keeps only strings (everything else in the address is dropped). */
export function validateSearch(search: Record<string, unknown>): WorkOrderSearch {
  const status = search['status'];
  const view = search['view'];
  return {
    ...(typeof status === 'string' && status !== '' ? { status } : {}),
    ...(typeof view === 'string' && view !== '' ? { view } : {}),
  };
}

/** The statuses of the address: known codes only, each once, in the order of the filter. */
export function statusesOf(search: WorkOrderSearch): readonly WorkOrderStatus[] {
  const wanted = new Set((search.status ?? '').split(',').filter(isStatus));
  return WORK_ORDER_STATUSES.filter((status) => wanted.has(status));
}

export function viewOf(search: WorkOrderSearch): ViewId {
  switch (search.view) {
    case undefined:
    case 'all_open':
      return 'all_open';
    case 'mine':
    case 'all':
      return search.view;
    default:
      return 'unknown';
  }
}

/** The address for the filters: the default view is not written, an empty status list is not written. */
export function searchOf(filters: Pick<WorkOrderFilters, 'view' | 'statuses'>): WorkOrderSearch {
  return {
    ...(filters.statuses.length === 0 ? {} : { status: filters.statuses.join(',') }),
    ...(filters.view === 'all_open' || filters.view === 'unknown' ? {} : { view: filters.view }),
  };
}

/** Something narrower than "Wszystkie niezamknięte" is chosen ("Wyczyść filtry" has something to clear). */
export const isFiltered = (filters: WorkOrderFilters): boolean =>
  filters.view !== 'all_open' || filters.statuses.length > 0 || filters.coordinatorId !== '';

/** The query of `listWorkOrders`: an empty filter is left out; the view `all` sends no `view` at all. */
export function toQuery(filters: WorkOrderFilters, cursor: string | undefined): NonNullable<ListWorkOrdersData['query']> {
  return {
    limit: PAGE_SIZE,
    sort: filters.sort,
    ...(filters.view === 'all_open' || filters.view === 'mine' ? { view: filters.view } : {}),
    ...(filters.statuses.length === 0 ? {} : { status: filters.statuses.join(',') }),
    ...(filters.coordinatorId === '' ? {} : { coordinatorId: filters.coordinatorId }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}
