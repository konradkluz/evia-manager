import { listWorkOrders, searchWorkOrders, type CurrentSession, type WorkOrderListItem, type WorkOrderSort } from '@evia/contracts';
import {
  Banner,
  Button,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  EmptyState,
  InlineAlert,
  Skeleton,
  WifiOff,
} from '@evia/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { workOrderSortLabels } from '../i18n/work-order-labels.ts';
import { NEW_WORK_ORDER_PATH, WORK_ORDERS_PATH } from '../paths.ts';
import { canReadPayments } from '../payments/payment-access.ts';
import { phraseOf, phraseState } from '../search/use-phrase-search.ts';
import { setWorkOrderMoreFilters, setWorkOrderPhrase, useWorkOrderSearch } from '../search/work-order-search-store.ts';
import { SESSION_KEY } from '../session/session.ts';
import { useDebounced } from '../shell/use-debounced.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { useOnline } from '../shell/use-online.ts';
import {
  DEFAULT_WAITING_DAYS,
  DSO_VIEW,
  isFiltered,
  noFiltersFor,
  searchOf,
  statusesOf,
  toQuery,
  toSearchBody,
  viewOf,
  waitingDaysOf,
  waitingOnOf,
  type ViewId,
  type WorkOrderFilters,
  type WorkOrderSearch,
} from '../work-orders/filters.ts';
import { formatClock } from '../work-orders/format.ts';
import { WORK_ORDERS_KEY } from '../work-orders/query-keys.ts';
import { WorkOrderFilterBar } from '../work-orders/work-order-filter-bar.tsx';
import { WorkOrderTable } from '../work-orders/work-order-table.tsx';
import { retryMinutes } from './login-failure.tsx';

/** After this long a load is called slow (styleguide § 4.12; the story: "po 10 s"). */
const SLOW_MS = 10_000;

/** The search starts when the typing pauses; the API allows 60 searches a minute per person (EVM-072 AC5). */
const SEARCH_DELAY_MS = 300;

/** The server did not accept the cursor (changed list, expired, other filters): `invalid_cursor`. */
const isBadCursor = (error: unknown): boolean => error instanceof ApiError && error.status === 400 && error.code === 'invalid_cursor';

/** A `400 validation_failed` on the phrase: which of the codes the server gave (`too_broad`, `invalid_characters`; no value is echoed). */
const phraseProblem = (error: unknown): 'too_broad' | 'invalid_characters' | null => {
  if (!(error instanceof ApiError) || error.status !== 400) return null;
  for (const entry of error.errors) {
    if (entry.code === 'too_broad' || entry.code === 'invalid_characters') return entry.code;
  }
  return null;
};

/** The filters that live only in the memory of the tab. */
interface LocalFilters {
  readonly coordinatorId: string;
  readonly sort: WorkOrderSort;
}

interface LoadedPage {
  /** The filters (with the sort order) the page was read for: offline the page is shown only for the same ones. */
  readonly key: string;
  readonly items: readonly WorkOrderListItem[];
  readonly at: number;
}

/**
 * W-10 "Zlecenia" (EVM-017 AC1–AC8): the list of work orders with views, statuses, coordinator and sorting, cursor pages
 * (25 on a page), and the states empty / filtered-empty / loading / error / `429` / offline. The address carries only
 * `status` and `view` and — for "Czekamy na" (EVM-034) — the kind of party and the number of days; the coordinator, the sort
 * order, the cursors and the last loaded page live in the memory of the tab (titles are free text — SR-WEB-05); the tab title
 * stays "Zlecenia · EVia Manager". The server decides who sees what.
 *
 * EVM-072: the phrase of the search (this page and the TopBar share it through a store of the tab's memory), "Typ obiektu" and
 * "Szablon" narrow the same list. A phrase of 3–100 characters goes — after a pause in typing — in the body of
 * `POST /api/v1/work-orders/search` with the cursor and the filters; a shorter one is never sent and the plain list stays. The
 * answer is not kept once it is not shown (`gcTime: 0`); the phrase is in no address, title or store of the browser.
 *
 * EVM-056: "Najpilniejsze" is the default sort (sent as `sort=urgency`), the views "Po terminie" and "Nieopłacone" (the address carries
 * the identifier only) and the column "Płatność" — for a role that reads payments (W4; the server decides all the same). A change of
 * the sort or the view is announced when the list arrives (`aria-live="polite"`); the amounts stay in the memory of the tab.
 */
export function WorkOrdersPage() {
  const { t } = useTranslation();
  usePageTitle(t('workOrders.title'));
  const client = useApi();
  const online = useOnline();
  // The state of the session is only read (no observer): logout clears the cache and an observer here would read it again.
  const session = useQueryClient().getQueryData<CurrentSession>(SESSION_KEY);
  const sessionState = session?.state;
  // Only Administrator and Edytor create work orders (R does not see the button; the server decides — EVM-020 AC7).
  const canCreate = session?.user.role === 'administrator' || session?.user.role === 'editor';
  const payments = canReadPayments(session?.user.role);
  const noFilters = noFiltersFor(payments);
  const navigate = useNavigate();
  const search: WorkOrderSearch = useSearch({ strict: false });
  // What the address does not carry (coordinator, sort order). A change that also changes the address waits in `pending`
  // until the address has changed, so that the list is never asked for a mix of the old and the new filters (one request).
  const [local, setLocal] = useState<LocalFilters>({ coordinatorId: '', sort: noFilters.sort });
  const [pending, setPending] = useState<{ readonly key: string; readonly values: LocalFilters } | null>(null);
  // Cursors of the pages passed through (empty = the first page, the last = the current one) with the filters they belong to.
  const [paging, setPaging] = useState<{ readonly key: string; readonly cursors: readonly string[] }>({ key: '', cursors: [] });
  const [people, setPeople] = useState<ReadonlyMap<string, string>>(new Map());
  const [lastPage, setLastPage] = useState<LoadedPage | null>(null);
  const [notice, setNotice] = useState<'reset' | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef<'next' | 'previous' | 'search' | 'sort' | 'view' | null>(null);

  const view = viewOf(search, payments);
  const statuses = statusesOf(search);
  const waitingOn = waitingOnOf(search);
  const waitingDays = waitingDaysOf(search);
  const addressKey = JSON.stringify([view, statuses, waitingOn, waitingDays]);
  const { coordinatorId, sort } = pending !== null && pending.key === addressKey ? pending.values : local;
  // The phrase and the filters of the panel come from the memory of the tab (the TopBar writes there too).
  const stored = useWorkOrderSearch();
  const typed = phraseOf(stored.phrase);
  const settledPhrase = useDebounced(typed, SEARCH_DELAY_MS);
  const searching = phraseState(stored.phrase) === 'ok';
  // The phrase the query is made for: one that is too short or too long is never sent (the plain list stays).
  const activePhrase = searching ? settledPhrase : '';
  const waitingForPause = searching && settledPhrase !== typed;
  const filters: WorkOrderFilters = {
    view,
    statuses,
    coordinatorId,
    sort,
    waitingOn,
    waitingDays,
    siteType: stored.siteType,
    templateId: stored.templateId,
    phrase: stored.phrase,
  };
  // What the server is asked for: the same filters with the phrase that is actually sent.
  const asked: WorkOrderFilters = { ...filters, phrase: activePhrase };
  const filterKey = JSON.stringify([
    asked.view,
    asked.statuses,
    asked.coordinatorId,
    asked.sort,
    asked.waitingOn,
    asked.waitingDays,
    asked.siteType,
    asked.templateId,
    asked.phrase,
  ]);
  const cursors = paging.key === filterKey ? paging.cursors : [];
  const cursor = cursors.at(-1);

  const query = useQuery({
    queryKey: [WORK_ORDERS_KEY, asked, cursor ?? null],
    queryFn: ({ signal }) =>
      activePhrase === ''
        ? unwrap(listWorkOrders({ client, signal, query: toQuery(asked, cursor) }))
        : unwrap(searchWorkOrders({ client, signal, body: toSearchBody(asked, activePhrase, cursor) })),
    // Only an active session reads the list: during the hand-over to W-03 (`mfa_enrollment`) the page may still be mounted for a moment.
    enabled: view !== 'unknown' && sessionState === 'active' && !waitingForPause,
    retry: false,
    // Titles are free text: the page does not stay in the cache after it is left (SR-WEB-05); logout and `401` clear it as well.
    gcTime: 0,
  });
  const data = query.data;
  const error = query.error;

  // The last loaded page stays in the memory of this tab only — the offline view shows it (AC8); never in a store of the browser.
  useEffect(() => {
    if (data !== undefined) setLastPage({ key: filterKey, items: data.items, at: query.dataUpdatedAt });
    // The key belongs to the data it was read for; it changes together with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query.dataUpdatedAt]);

  // The coordinators seen so far feed the "Opiekun" filter (the list of accounts, W-16, does not exist yet).
  useEffect(() => {
    if (data === undefined) return;
    setPeople((known) => {
      const next = new Map(known);
      for (const { coordinator } of data.items) if (coordinator !== null) next.set(coordinator.id, coordinator.displayName);
      return next.size === known.size ? known : next;
    });
  }, [data]);

  // After a change of page the focus goes to the heading of the list and the change is announced (WCAG 2.4.3, 4.1.3).
  useEffect(() => {
    if (data === undefined || moved.current === null) return;
    if (moved.current === 'search') setAnnouncement(t('workOrders.search.loaded'));
    else if (moved.current === 'sort') setAnnouncement(t('workOrders.announce.sort', { sort: workOrderSortLabels[sort] }));
    else if (moved.current === 'view') setAnnouncement(t('workOrders.announce.view', { view: viewLabel(t, view) }));
    else {
      setAnnouncement(moved.current === 'next' ? t('workOrders.pages.loadedNext') : t('workOrders.pages.loadedPrevious'));
      heading.current?.focus();
    }
    moved.current = null;
    // Only the arrival of the data matters here (the sort and the view are the ones it was read for).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, t]);

  // The address has changed to the one a pending change waits for: the change becomes the state of the page.
  useEffect(() => {
    if (pending === null || pending.key !== addressKey) return;
    setLocal(pending.values);
    setPending(null);
  }, [pending, addressKey]);

  // A cursor the server no longer accepts: back to the first page with a message (AC3); the filters stay.
  const badCursor = cursors.length > 0 && isBadCursor(error);
  useEffect(() => {
    if (!badCursor) return;
    setPaging({ key: filterKey, cursors: [] });
    setNotice('reset');
  }, [badCursor, filterKey]);

  // The connection is back: a list that failed meanwhile is read again.
  useEffect(() => {
    if (online && query.error instanceof ApiError && query.error.status === 0) void query.refetch();
    // Only the return of the connection matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const change = (changed: WorkOrderFilters) => {
    // A new phrase is announced when its results arrive; the focus stays in the field (WCAG 4.1.3).
    // A new sort order or view is announced when the list arrives (EVM-056; aria-live="polite").
    moved.current =
      changed.phrase !== filters.phrase && phraseState(changed.phrase) === 'ok'
        ? 'search'
        : changed.sort !== filters.sort
          ? 'sort'
          : changed.view !== filters.view && changed.view !== 'all'
            ? 'view'
            : null;
    setNotice(null);
    // X means something only with a "Czekamy na" filter: without one the address does not carry it and the default stands.
    const next = changed.waitingOn === '' ? { ...changed, waitingDays: DEFAULT_WAITING_DAYS } : changed;
    const values = { coordinatorId: next.coordinatorId, sort: next.sort };
    // The phrase and the filters of the panel are memory of the tab, shared with the TopBar (never the address).
    setWorkOrderPhrase(next.phrase);
    setWorkOrderMoreFilters({ siteType: next.siteType, templateId: next.templateId });
    const nextKey = JSON.stringify([next.view, next.statuses, next.waitingOn, next.waitingDays]);
    if (nextKey === addressKey) {
      setPending(null);
      setLocal(values);
      return;
    }
    setPending({ key: nextKey, values });
    void navigate({ to: WORK_ORDERS_PATH, search: searchOf(next) });
  };
  const go = (direction: 'next' | 'previous') => {
    moved.current = direction;
    setNotice(null);
    if (direction === 'next') {
      if (data?.nextCursor) setPaging({ key: filterKey, cursors: [...cursors, data.nextCursor] });
    } else setPaging({ key: filterKey, cursors: cursors.slice(0, -1) });
  };
  const retry = () => {
    void query.refetch();
  };

  const heading1 = <h1 className="font-display text-heading-1 text-text-primary">{t('workOrders.title')}</h1>;
  const title = canCreate ? (
    <div className="flex flex-wrap items-center justify-between gap-inline-md">
      {heading1}
      <Button
        onClick={() => {
          void navigate({ to: NEW_WORK_ORDER_PATH });
        }}
      >
        {t('workOrders.create')}
      </Button>
    </div>
  ) : (
    heading1
  );

  if (view === 'unknown') {
    return (
      <div className="flex flex-col gap-stack-md">
        {title}
        <EmptyState
          icon={ClipboardList}
          title={t('workOrders.viewNotFound.title')}
          description={t('workOrders.viewNotFound.description')}
          action={
            <Button
              onClick={() => {
                change(noFilters);
              }}
            >
              {t('workOrders.viewNotFound.action')}
            </Button>
          }
        />
      </div>
    );
  }

  const offlineCopy = !online && lastPage?.key === filterKey ? lastPage : null;
  const rateLimited = error instanceof ApiError && error.status === 429;
  const items = offlineCopy?.items ?? (waitingForPause ? undefined : data?.items);
  const failed = error !== null && !badCursor && offlineCopy === null && !waitingForPause;
  const problem = phraseProblem(error);

  return (
    <div className="flex flex-col gap-stack-md">
      {title}
      <WorkOrderFilterBar filters={filters} people={people} disabled={!online} payments={payments} onChange={change} />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {notice === 'reset' ? <InlineAlert tone="info">{t('workOrders.error.cursorReset')}</InlineAlert> : null}
      {offlineCopy === null ? null : <Banner icon={WifiOff}>{t('workOrders.offline.stale', { time: formatClock(offlineCopy.at) })}</Banner>}
      {failed ? (
        problem !== null ? (
          <InlineAlert tone="info">
            {problem === 'too_broad' ? t('workOrders.error.tooBroad') : t('workOrders.error.invalidPhrase')}
          </InlineAlert>
        ) : rateLimited ? (
          <InlineAlert
            tone="error"
            action={
              <Button variant="secondary" onClick={retry}>
                {t('workOrders.error.retry')}
              </Button>
            }
          >
            {t('workOrders.error.rateLimited', { minutes: retryMinutes(error) })}
          </InlineAlert>
        ) : (
          <EmptyState
            icon={CircleAlert}
            title={t('workOrders.error.title')}
            description={t('workOrders.error.description')}
            action={<Button onClick={retry}>{t('workOrders.error.retry')}</Button>}
          />
        )
      ) : items === undefined ? (
        <Loading />
      ) : items.length === 0 ? (
        onlyView(asked, DSO_VIEW) ? (
          <EmptyState icon={CircleCheck} title={t('workOrders.dsoEmpty.title')} description={t('workOrders.dsoEmpty.description')} />
        ) : onlyView(asked, 'overdue_payments') ? (
          <EmptyState
            icon={CircleCheck}
            title={t('workOrders.overduePaymentsEmpty.title')}
            description={t('workOrders.filters.paymentViewHint')}
          />
        ) : onlyView(asked, 'unpaid') ? (
          <EmptyState icon={CircleCheck} title={t('workOrders.unpaidEmpty.title')} description={t('workOrders.filters.paymentViewHint')} />
        ) : isFiltered(asked) ? (
          <EmptyState
            icon={ClipboardList}
            title={t('workOrders.filteredEmpty.title')}
            description={t('workOrders.filteredEmpty.description')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  change({ ...noFilters, sort });
                }}
              >
                {t('workOrders.filters.clear')}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={ClipboardList} title={t('workOrders.empty.title')} description={t('workOrders.empty.description')} />
        )
      ) : (
        <>
          <h2 ref={heading} tabIndex={-1} className="text-heading-3 text-text-primary focus-visible:focus-ring">
            {t('workOrders.table.heading')}
          </h2>
          <WorkOrderTable items={items} sort={sort} payments={payments} />
          <nav aria-label={t('workOrders.pages.label')} className="flex flex-wrap items-center justify-center gap-inline-md">
            <Button
              variant="secondary"
              icon={ChevronLeft}
              disabled={!online || cursors.length === 0}
              onClick={() => {
                go('previous');
              }}
            >
              {t('workOrders.pages.previous')}
            </Button>
            <Button
              variant="secondary"
              icon={ChevronRight}
              disabled={!online || !data?.nextCursor}
              onClick={() => {
                go('next');
              }}
            >
              {t('workOrders.pages.next')}
            </Button>
            {online ? null : <p className="text-body-sm text-text-tertiary">{t('workOrders.pages.offlineHint')}</p>}
          </nav>
        </>
      )}
    </div>
  );
}

/** Skeleton of the rows (styleguide § 4.12) with a text status; after 10 s it says the load takes longer than usual. */
function Loading() {
  const { t } = useTranslation();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setSlow(true);
    }, SLOW_MS);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, []);
  return (
    <div aria-busy="true" className="flex flex-col gap-stack-sm">
      <p role="status" className="text-body text-text-secondary">
        {slow ? t('workOrders.loading.slow') : t('shell.loading')}
      </p>
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} shape="field" />
      ))}
    </div>
  );
}

/** The name of a saved view in the announcement of its change ("Widok: Po terminie"); `all` (statuses chosen) is not announced. */
function viewLabel(t: TFunction, view: ViewId): string {
  switch (view) {
    case 'mine':
      return t('workOrders.filters.viewMine');
    case DSO_VIEW:
      return t('workOrders.filters.viewDso');
    case 'overdue_payments':
      return t('workOrders.filters.viewOverduePayments');
    case 'unpaid':
      return t('workOrders.filters.viewUnpaid');
    default:
      return t('workOrders.filters.viewAllOpen');
  }
}

/**
 * A saved view with nothing narrower: an empty list has its own words — "Czekamy na OSD > 14 dni" is good news (EVM-034 AC3),
 * "Po terminie" and "Nieopłacone" say what is missing (EVM-056 AC2).
 */
const onlyView = (filters: WorkOrderFilters, view: ViewId): boolean =>
  filters.view === view &&
  filters.statuses.length === 0 &&
  filters.coordinatorId === '' &&
  filters.waitingOn === '' &&
  filters.siteType === '' &&
  filters.templateId === '' &&
  filters.phrase === '';
