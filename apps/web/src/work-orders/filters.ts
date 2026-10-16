import type { ListWorkOrdersData, PartyKind, SiteType, WorkOrderSearchRequest, WorkOrderSort, WorkOrderStatus } from '@evia/contracts';
import { partyKindLabels } from '../i18n/catalog-labels.ts';
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

/** The saved view "Czekamy na OSD > 14 dni" (EVM-034 AC3): the one view that is itself a "Czekamy na" filter. */
export const DSO_VIEW = 'waiting_on_dso_over_14_days';

/**
 * The saved views of the payments (EVM-056 AC2; only orders that are not closed): "Po terminie" and "Nieopłacone". They need the
 * right to read payments (`restrictedParams` of the contract — a test keeps this list equal to it).
 */
export const PAYMENT_VIEWS = ['overdue_payments', 'unpaid'] as const;
export type PaymentView = (typeof PAYMENT_VIEWS)[number];
/** The sort that needs the right to read payments (`restrictedParams`): "Najpilniejsze" (EVM-056 AC3). */
export const PAYMENT_SORTS = ['urgency'] as const satisfies readonly WorkOrderSort[];

/**
 * `all_open` — "Wszystkie niezamknięte" (the default view of the panel, sent to the API explicitly), `mine` — "Moje",
 * `waiting_on_dso_over_14_days` — "Czekamy na OSD > 14 dni" (EVM-034), `overdue_payments` and `unpaid` — "Po terminie" and
 * "Nieopłacone" (EVM-056), `all` — every status (the panel's own identifier: the API gets no `view`), `unknown` — an identifier
 * from a link that this panel does not know or the person may not use ("Nie znaleziono widoku").
 */
export type ViewId = 'all_open' | 'mine' | 'all' | typeof DSO_VIEW | PaymentView | 'deleted' | 'unknown';

const isPaymentView = (view: string): view is PaymentView => (PAYMENT_VIEWS as readonly string[]).includes(view);

/**
 * The target of "Czekamy na" (EVM-034 AC2): `customer`, any `party`, or a kind of party (the code of the dictionary) — a code,
 * never the identifier or the name of a party. `''` — the filter is off.
 */
export type WaitingTarget = '' | 'customer' | 'party' | PartyKind;

/** The default of "dłużej niż [X] dni" and the range the API accepts (`400` outside of it). */
export const DEFAULT_WAITING_DAYS = 14;
export const WAITING_DAYS_MIN = 1;
export const WAITING_DAYS_MAX = 365;

/**
 * What the address carries (styleguide § 3.7): the statuses and the view, and — for "Czekamy na" — only the kind of party and X
 * (EVM-034 AC2); never a person, a party, a cursor or a title.
 */
export interface WorkOrderSearch {
  readonly status?: string;
  readonly view?: string;
  readonly waitingOn?: string;
  /** A number, so that the address reads `waitingDays=14` and not a quoted string. */
  readonly waitingDays?: number;
}

export interface WorkOrderFilters {
  readonly view: ViewId;
  readonly statuses: readonly WorkOrderStatus[];
  /** Only in the memory of the tab: a person is personal data and never goes to the address (AC2). */
  readonly coordinatorId: string;
  readonly sort: WorkOrderSort;
  /** "Czekamy na" (EVM-034): whom we wait for; the address carries it with `waitingDays`. */
  readonly waitingOn: WaitingTarget;
  /** "dłużej niż [X] dni", 1–365; meaningful only with `waitingOn`. */
  readonly waitingDays: number;
  /**
   * "Typ obiektu" and "Szablon" of "Więcej filtrów" (EVM-072 AC4): codes and identifiers of the catalogue, kept only in the memory
   * of the tab (the address stays free of them, § 3.7). `''` — the filter is off.
   */
  readonly siteType: SiteType | '';
  readonly templateId: string;
  /**
   * The text of the search field as typed (EVM-072 AC2): memory of the tab only, sent in the body of `POST …/search` and never in
   * the address. Whether it is long enough to be sent is the page's decision (`phraseState`).
   */
  readonly phrase: string;
}

/** "Najpilniejsze" (EVM-056 AC3): the default of W-10, sent to the API explicitly (the API's own default stays `-number`). */
export const DEFAULT_SORT: WorkOrderSort = 'urgency';
/** The default of a role without the right to read payments (it has no "Najpilniejsze" — W4): the newest number first. */
const PLAIN_SORT: WorkOrderSort = '-number';
export const NO_FILTERS: WorkOrderFilters = {
  view: 'all_open',
  statuses: [],
  coordinatorId: '',
  sort: DEFAULT_SORT,
  waitingOn: '',
  waitingDays: DEFAULT_WAITING_DAYS,
  siteType: '',
  templateId: '',
  phrase: '',
};

/** The filters a fresh W-10 starts with — for a role without the right to read payments without "Najpilniejsze". */
export const noFiltersFor = (paymentsReadable: boolean): WorkOrderFilters =>
  paymentsReadable ? NO_FILTERS : { ...NO_FILTERS, sort: PLAIN_SORT };

/**
 * The options of "Sortuj" (EVM-056 AC3; flows/07): "Najpilniejsze" first, then "Najdłużej czekamy", "Termin" and the numbers and
 * dates of EVM-017; without the right to read payments "Najpilniejsze" is not offered (W4).
 */
export function sortsFor(paymentsReadable: boolean): readonly WorkOrderSort[] {
  const rest: WorkOrderSort[] = ['longestWaitingSince', 'nextDueDate', '-number', 'number', '-createdAt', 'createdAt'];
  return paymentsReadable ? [...PAYMENT_SORTS, ...rest] : rest;
}

const isStatus = (value: string): value is WorkOrderStatus => Object.hasOwn(workOrderStatusLabels, value);

/** Router `validateSearch`: keeps only strings (everything else in the address is dropped). */
export function validateSearch(search: Record<string, unknown>): WorkOrderSearch {
  const status = search['status'];
  const view = search['view'];
  const waitingOn = search['waitingOn'];
  // The router parses a number out of the address; a text of digits (a link made by hand) is read the same way.
  const days = search['waitingDays'];
  const waitingDays = typeof days === 'number' ? days : typeof days === 'string' ? parseWaitingDays(days) : undefined;
  return {
    ...(typeof status === 'string' && status !== '' ? { status } : {}),
    ...(typeof view === 'string' && view !== '' ? { view } : {}),
    ...(typeof waitingOn === 'string' && waitingOn !== '' ? { waitingOn } : {}),
    ...(waitingDays === undefined ? {} : { waitingDays }),
  };
}

/** The statuses of the address: known codes only, each once, in the order of the filter. */
export function statusesOf(search: WorkOrderSearch): readonly WorkOrderStatus[] {
  const wanted = new Set((search.status ?? '').split(',').filter(isStatus));
  return WORK_ORDER_STATUSES.filter((status) => wanted.has(status));
}

/**
 * The view of the address. The payment views exist only with the right to read payments (`paymentsReadable`, deny-by-default):
 * without it a link to one is "Nie znaleziono widoku" (EVM-056 → "UX / UI"). "Usunięte" (EVM-060) is the Administrator's
 * (`deletedReadable`): for the others a link to it is the same "Nie znaleziono widoku".
 */
export function viewOf(search: WorkOrderSearch, paymentsReadable = false, deletedReadable = false): ViewId {
  switch (search.view) {
    case undefined:
    case 'all_open':
      return 'all_open';
    case 'mine':
    case 'all':
    case DSO_VIEW:
      return search.view;
    case 'deleted':
      return deletedReadable ? 'deleted' : 'unknown';
    default:
      return paymentsReadable && isPaymentView(search.view) ? search.view : 'unknown';
  }
}

const isWaitingTarget = (value: string): value is WaitingTarget =>
  value === 'customer' || value === 'party' || Object.hasOwn(partyKindLabels, value);

/** The target of "Czekamy na" of the address: a known code only (a link with another value is read as "no filter"). */
export function waitingOnOf(search: WorkOrderSearch): WaitingTarget {
  const value = search.waitingOn ?? '';
  return value !== '' && isWaitingTarget(value) ? value : '';
}

/** `'14'` → 14; text that is not a whole number of days 1–365 → `undefined` (nothing is sent for it). */
export function parseWaitingDays(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= WAITING_DAYS_MIN && value <= WAITING_DAYS_MAX ? value : undefined;
}

/** X of the address: a whole number 1–365, otherwise the default (the field of the panel shows what is asked for). */
export const waitingDaysOf = (search: WorkOrderSearch): number =>
  parseWaitingDays(String(search.waitingDays ?? '')) ?? DEFAULT_WAITING_DAYS;

/**
 * The address for the filters: the default view is not written, an empty status list is not written; "Czekamy na" writes the
 * kind of party and X only (the view "Czekamy na OSD > 14 dni" is its own identifier).
 */
export function searchOf(
  filters: Pick<WorkOrderFilters, 'view' | 'statuses'> & Partial<Pick<WorkOrderFilters, 'waitingOn' | 'waitingDays'>>,
): WorkOrderSearch {
  const waitingOn = filters.waitingOn ?? '';
  return {
    ...(filters.statuses.length === 0 ? {} : { status: filters.statuses.join(',') }),
    ...(filters.view === 'all_open' || filters.view === 'unknown' ? {} : { view: filters.view }),
    ...(waitingOn === '' ? {} : { waitingOn, waitingDays: filters.waitingDays ?? DEFAULT_WAITING_DAYS }),
  };
}

/** Something narrower than "Wszystkie niezamknięte" is chosen ("Wyczyść filtry" has something to clear). */
export const isFiltered = (filters: WorkOrderFilters): boolean =>
  filters.view !== 'all_open' ||
  filters.statuses.length > 0 ||
  filters.coordinatorId !== '' ||
  filters.waitingOn !== '' ||
  filters.siteType !== '' ||
  filters.templateId !== '' ||
  filters.phrase !== '';

/** How many filters of the panel "Więcej filtrów" are on ("Więcej filtrów (2)"). */
export const moreFiltersCount = (filters: Pick<WorkOrderFilters, 'siteType' | 'templateId'>): number =>
  (filters.siteType === '' ? 0 : 1) + (filters.templateId === '' ? 0 : 1);

/** The two filters that are not part of the address and are cleared with "Wyczyść te filtry". */
const moreFiltersOf = (filters: WorkOrderFilters) => ({
  ...(filters.siteType === '' ? {} : { siteType: filters.siteType }),
  ...(filters.templateId === '' ? {} : { templateId: filters.templateId }),
});

/**
 * "Czekamy na" of the query: `customer`; `party` for any party; a kind of party is `party` with `waitingOnPartyKind` (the API
 * refuses a kind together with `customer`). X goes with it. Nothing for a filter that is off.
 */
function waitingQuery(filters: WorkOrderFilters): NonNullable<ListWorkOrdersData['query']> {
  const { waitingOn, waitingDays } = filters;
  if (waitingOn === '') return {};
  if (waitingOn === 'customer' || waitingOn === 'party') return { waitingOn, waitingLongerThanDays: waitingDays };
  return { waitingOn: 'party', waitingOnPartyKind: waitingOn, waitingLongerThanDays: waitingDays };
}

/** The view sent to the API: every view of the panel but `all` (its own identifier) and `unknown` (nothing is asked). */
const apiViewOf = (view: ViewId) => (view === 'all' || view === 'unknown' ? {} : { view });

/** The query of `listWorkOrders`: an empty filter is left out; the view `all` sends no `view` at all. */
export function toQuery(filters: WorkOrderFilters, cursor: string | undefined): NonNullable<ListWorkOrdersData['query']> {
  return {
    limit: PAGE_SIZE,
    sort: filters.sort,
    ...apiViewOf(filters.view),
    ...(filters.statuses.length === 0 ? {} : { status: filters.statuses.join(',') }),
    ...(filters.coordinatorId === '' ? {} : { coordinatorId: filters.coordinatorId }),
    ...moreFiltersOf(filters),
    ...waitingQuery(filters),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/**
 * The body of `searchWorkOrders` (EVM-072 AC2, AC3): the phrase `phrase` (already normalised and long enough — the caller decides)
 * and the same filters as the list, the cursor in the body. Nothing of it goes to the address.
 */
export function toSearchBody(filters: WorkOrderFilters, phrase: string, cursor: string | undefined): WorkOrderSearchRequest {
  const { waitingOn, waitingOnPartyKind, waitingLongerThanDays } = waitingQuery(filters);
  return {
    query: phrase,
    limit: PAGE_SIZE,
    sort: filters.sort,
    ...apiViewOf(filters.view),
    ...(filters.statuses.length === 0 ? {} : { status: [...filters.statuses] }),
    ...(filters.coordinatorId === '' ? {} : { coordinatorId: filters.coordinatorId }),
    ...moreFiltersOf(filters),
    ...(waitingOn === undefined ? {} : { waitingOn }),
    ...(waitingOnPartyKind === undefined ? {} : { waitingOnPartyKind }),
    ...(waitingLongerThanDays === undefined ? {} : { waitingLongerThanDays }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}
