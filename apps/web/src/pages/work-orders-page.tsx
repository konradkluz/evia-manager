import { listWorkOrders, type CurrentSession, type WorkOrderListItem, type WorkOrderSort } from '@evia/contracts';
import {
  Banner,
  Button,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  EmptyState,
  InlineAlert,
  Skeleton,
  WifiOff,
} from '@evia/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { SESSION_KEY } from '../session/session.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { useOnline } from '../shell/use-online.ts';
import {
  DEFAULT_SORT,
  isFiltered,
  NO_FILTERS,
  searchOf,
  statusesOf,
  toQuery,
  viewOf,
  type WorkOrderFilters,
  type WorkOrderSearch,
} from '../work-orders/filters.ts';
import { formatClock } from '../work-orders/format.ts';
import { WorkOrderFilterBar } from '../work-orders/work-order-filter-bar.tsx';
import { WorkOrderTable } from '../work-orders/work-order-table.tsx';
import { retryMinutes } from './login-failure.tsx';

/** Query key root: the loaded pages are dropped from the cache together (logout, a `401`). */
const WORK_ORDERS_KEY = 'work-orders' as const;
/** After this long a load is called slow (styleguide § 4.12; the story: "po 10 s"). */
const SLOW_MS = 10_000;

/** The server did not accept the cursor (changed list, expired, other filters): `invalid_cursor`. */
const isBadCursor = (error: unknown): boolean => error instanceof ApiError && error.status === 400 && error.code === 'invalid_cursor';

/** The filters that live only in the memory of the tab. */
interface LocalFilters {
  readonly coordinatorId: string;
  readonly sort: WorkOrderSort;
}

interface LoadedPage {
  readonly items: readonly WorkOrderListItem[];
  readonly at: number;
}

/**
 * W-10 "Zlecenia" (EVM-017 AC1–AC8): the list of work orders with views, statuses, coordinator and sorting, cursor pages
 * (25 on a page), and the states empty / filtered-empty / loading / error / `429` / offline. The address carries only
 * `status` and `view`; the coordinator, the sort order, the cursors and the last loaded page live in the memory of the tab
 * (titles are free text — SR-WEB-05); the tab title stays "Zlecenia · EVia Manager". The server decides who sees what.
 */
export function WorkOrdersPage() {
  const { t } = useTranslation();
  usePageTitle(t('workOrders.title'));
  const client = useApi();
  const online = useOnline();
  // The state of the session is only read (no observer): logout clears the cache and an observer here would read it again.
  const sessionState = useQueryClient().getQueryData<CurrentSession>(SESSION_KEY)?.state;
  const navigate = useNavigate();
  const search: WorkOrderSearch = useSearch({ strict: false });
  // What the address does not carry (coordinator, sort order). A change that also changes the address waits in `pending`
  // until the address has changed, so that the list is never asked for a mix of the old and the new filters (one request).
  const [local, setLocal] = useState<LocalFilters>({ coordinatorId: '', sort: DEFAULT_SORT });
  const [pending, setPending] = useState<{ readonly key: string; readonly values: LocalFilters } | null>(null);
  // Cursors of the pages passed through (empty = the first page, the last = the current one) with the filters they belong to.
  const [paging, setPaging] = useState<{ readonly key: string; readonly cursors: readonly string[] }>({ key: '', cursors: [] });
  const [people, setPeople] = useState<ReadonlyMap<string, string>>(new Map());
  const [lastPage, setLastPage] = useState<LoadedPage | null>(null);
  const [notice, setNotice] = useState<'reset' | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef<'next' | 'previous' | null>(null);

  const view = viewOf(search);
  const statuses = statusesOf(search);
  const addressKey = JSON.stringify([view, statuses]);
  const { coordinatorId, sort } = pending !== null && pending.key === addressKey ? pending.values : local;
  const filters: WorkOrderFilters = { view, statuses, coordinatorId, sort };
  const filterKey = JSON.stringify([filters.view, filters.statuses, filters.coordinatorId, filters.sort]);
  const cursors = paging.key === filterKey ? paging.cursors : [];
  const cursor = cursors.at(-1);

  const query = useQuery({
    queryKey: [WORK_ORDERS_KEY, filters, cursor ?? null],
    queryFn: ({ signal }) => unwrap(listWorkOrders({ client, signal, query: toQuery(filters, cursor) })),
    // Only an active session reads the list: during the hand-over to W-03 (`mfa_enrollment`) the page may still be mounted for a moment.
    enabled: view !== 'unknown' && sessionState === 'active',
    retry: false,
    // Titles are free text: the page does not stay in the cache after it is left (SR-WEB-05); logout and `401` clear it as well.
    gcTime: 0,
  });
  const data = query.data;
  const error = query.error;

  // The last loaded page stays in the memory of this tab only — the offline view shows it (AC8); never in a store of the browser.
  useEffect(() => {
    if (data !== undefined) setLastPage({ items: data.items, at: query.dataUpdatedAt });
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
    setAnnouncement(moved.current === 'next' ? t('workOrders.pages.loadedNext') : t('workOrders.pages.loadedPrevious'));
    moved.current = null;
    heading.current?.focus();
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

  const change = (next: WorkOrderFilters) => {
    moved.current = null;
    setNotice(null);
    const values = { coordinatorId: next.coordinatorId, sort: next.sort };
    const nextKey = JSON.stringify([next.view, next.statuses]);
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

  const title = <h1 className="font-display text-heading-1 text-text-primary">{t('workOrders.title')}</h1>;

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
                change(NO_FILTERS);
              }}
            >
              {t('workOrders.viewNotFound.action')}
            </Button>
          }
        />
      </div>
    );
  }

  const offlineCopy = !online && lastPage !== null ? lastPage : null;
  const rateLimited = error instanceof ApiError && error.status === 429;
  const items = offlineCopy?.items ?? data?.items;
  const failed = error !== null && !badCursor && offlineCopy === null;

  return (
    <div className="flex flex-col gap-stack-md">
      {title}
      <WorkOrderFilterBar filters={filters} people={people} disabled={!online} onChange={change} />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {notice === 'reset' ? <InlineAlert tone="info">{t('workOrders.error.cursorReset')}</InlineAlert> : null}
      {offlineCopy === null ? null : <Banner icon={WifiOff}>{t('workOrders.offline.stale', { time: formatClock(offlineCopy.at) })}</Banner>}
      {failed ? (
        rateLimited ? (
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
        isFiltered(filters) ? (
          <EmptyState
            icon={ClipboardList}
            title={t('workOrders.filteredEmpty.title')}
            description={t('workOrders.filteredEmpty.description')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  change({ ...NO_FILTERS, sort });
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
          <WorkOrderTable items={items} sort={sort} />
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
