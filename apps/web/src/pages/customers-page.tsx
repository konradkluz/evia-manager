import { listCustomers, searchCustomers, type CurrentSession, type CustomerSearchItem } from '@evia/contracts';
import {
  Banner,
  Button,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  EmptyState,
  InlineAlert,
  SearchField,
  SearchX,
  Skeleton,
  Users,
  WifiOff,
} from '@evia/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { CustomerTable } from '../customers/customer-table.tsx';
import { CUSTOMER_LIST_KEY } from '../customers/query-keys.ts';
import { phraseOf, phraseState } from '../search/use-phrase-search.ts';
import { SESSION_KEY } from '../session/session.ts';
import { useDebounced } from '../shell/use-debounced.ts';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { formatClock } from '../work-orders/format.ts';
import { retryMinutes } from './login-failure.tsx';

/** A page of the list (styleguide § 3.6; EVM-039 AC1: 25 on a page). */
const PAGE_SIZE = 25;
/** The search starts when typing pauses; the API allows 60 searches a minute per person. */
const SEARCH_DELAY_MS = 300;
/** After this long a load is called slow (styleguide § 4.12). */
const SLOW_MS = 10_000;

const isBadCursor = (error: unknown): boolean => error instanceof ApiError && error.status === 400 && error.code === 'invalid_cursor';

interface LoadedPage {
  readonly items: readonly CustomerSearchItem[];
  readonly at: number;
}

/**
 * W-14 "Klienci", the list (EVM-039 AC1, AC8): customers in the Polish alphabet (surname before the first name, "Ł" after "L"),
 * 25 on a page with a cursor, and a search from 3 characters that narrows the same list. The phrase lives in the memory of the
 * tab — it goes in the body of `POST /customers/search`, never in the address, the title of the tab or a store of the browser
 * (SR-API-04, SR-WEB-05). Pages are read one at a time and only on a click: nothing is fetched ahead (P10, RR-13). Offline, the
 * last page stays on screen under a banner; `429` says when to try again and keeps the phrase.
 */
export function CustomersPage() {
  const { t } = useTranslation();
  usePageTitle(t('customerList.title'));
  const client = useApi();
  const online = useOnline();
  // The state of the session is only read (no observer): logout clears the cache and an observer here would read it again.
  const session = useQueryClient().getQueryData<CurrentSession>(SESSION_KEY);
  const sessionState = session?.state;
  const readOnly = session?.user.role === 'read_only';
  const [phrase, setPhrase] = useState('');
  // Cursors of the pages passed through (empty = the first page, the last = the current one) with the phrase they belong to.
  const [paging, setPaging] = useState<{ readonly key: string; readonly cursors: readonly string[] }>({ key: '', cursors: [] });
  const [lastPage, setLastPage] = useState<LoadedPage | null>(null);
  const [notice, setNotice] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef<'next' | 'previous' | 'search' | null>(null);

  const state = phraseState(phrase);
  const typed = phraseOf(phrase);
  const settled = useDebounced(typed, SEARCH_DELAY_MS);
  const searching = state === 'ok';
  // The phrase the query is made for: a phrase that is too short or too long is never sent (the full list stays).
  const active = searching ? settled : '';
  const waiting = searching && settled !== typed;
  const cursors = paging.key === active ? paging.cursors : [];
  const cursor = cursors.at(-1);

  const query = useQuery({
    queryKey: [CUSTOMER_LIST_KEY, active, cursor ?? null],
    queryFn: ({ signal }) =>
      active === ''
        ? unwrap(listCustomers({ client, signal, query: { limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) } }))
        : unwrap(
            searchCustomers({ client, signal, body: { query: active, limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) } }),
          ),
    enabled: sessionState === 'active' && !waiting,
    retry: false,
    // Names and phones are personal data: the page does not stay in the cache once it is left (SR-WEB-05).
    gcTime: 0,
  });
  const data = query.data;
  const error = query.error;

  // The last loaded page stays in the memory of this tab only — the offline view shows it (AC8); never in a store of the browser.
  useEffect(() => {
    if (data !== undefined) setLastPage({ items: data.items, at: query.dataUpdatedAt });
  }, [data, query.dataUpdatedAt]);

  // After a change of page the focus goes to the heading of the table and the change is announced (WCAG 2.4.3, 4.1.3).
  useEffect(() => {
    if (data === undefined || moved.current === null) return;
    if (moved.current === 'search') setAnnouncement(t('customerList.search.loaded'));
    else {
      setAnnouncement(moved.current === 'next' ? t('customerList.pages.loadedNext') : t('customerList.pages.loadedPrevious'));
      heading.current?.focus();
    }
    moved.current = null;
  }, [data, t]);

  // A cursor the server no longer accepts: back to the first page with a message.
  const badCursor = cursors.length > 0 && isBadCursor(error);
  useEffect(() => {
    if (!badCursor) return;
    setPaging({ key: active, cursors: [] });
    setNotice(true);
  }, [badCursor, active]);

  // The connection is back: a list that failed meanwhile is read again.
  useEffect(() => {
    if (online && query.error instanceof ApiError && query.error.status === 0) void query.refetch();
    // Only the return of the connection matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const go = (direction: 'next' | 'previous') => {
    moved.current = direction;
    setNotice(false);
    if (direction === 'next') {
      if (data?.nextCursor) setPaging({ key: active, cursors: [...cursors, data.nextCursor] });
    } else setPaging({ key: active, cursors: cursors.slice(0, -1) });
  };
  const change = (next: string) => {
    moved.current = phraseState(next) === 'ok' ? 'search' : null;
    setNotice(false);
    setPhrase(next);
  };
  const retry = () => {
    void query.refetch();
  };

  const offlineCopy = !online && lastPage !== null ? lastPage : null;
  const rateLimited = error instanceof ApiError && error.status === 429;
  const items = offlineCopy?.items ?? (waiting ? undefined : data?.items);
  const failed = error !== null && !badCursor && offlineCopy === null && !waiting;
  const hint = !online
    ? t('customerList.search.offlineHint')
    : state === 'long'
      ? t('customerList.search.hintLong')
      : t('customerList.search.hint');

  return (
    <div className="flex flex-col gap-stack-md">
      <h1 className="font-display text-heading-1 text-text-primary">{t('customerList.title')}</h1>
      <SearchField
        label={t('customerList.search.label')}
        value={phrase}
        hint={hint}
        clearLabel={t('customerList.search.clear')}
        disabled={!online}
        onChange={change}
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {notice ? <InlineAlert tone="info">{t('customerList.error.cursorReset')}</InlineAlert> : null}
      {offlineCopy === null ? null : <Banner icon={WifiOff}>{t('workOrders.offline.stale', { time: formatClock(offlineCopy.at) })}</Banner>}
      {failed ? (
        rateLimited ? (
          <InlineAlert
            tone="error"
            action={
              <Button variant="secondary" onClick={retry}>
                {t('customerList.error.retry')}
              </Button>
            }
          >
            {t('customerList.error.rateLimited', { minutes: retryMinutes(error) })}
          </InlineAlert>
        ) : (
          <EmptyState
            icon={CircleAlert}
            title={t('customerList.error.title')}
            description={t('customerList.error.description')}
            action={<Button onClick={retry}>{t('customerList.error.retry')}</Button>}
          />
        )
      ) : items === undefined ? (
        <Loading />
      ) : items.length === 0 ? (
        active === '' ? (
          <EmptyState
            icon={Users}
            title={readOnly ? t('customerList.empty.readOnlyTitle') : t('customerList.empty.title')}
            description={readOnly ? t('customerList.empty.readOnlyDescription') : t('customerList.empty.description')}
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title={t('customerList.noResults.title')}
            description={t('customerList.noResults.description')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  change('');
                }}
              >
                {t('customerList.noResults.action')}
              </Button>
            }
          />
        )
      ) : (
        <>
          <h2 ref={heading} tabIndex={-1} className="text-heading-3 text-text-primary focus-visible:focus-ring">
            {t('customerList.table.heading')}
          </h2>
          <CustomerTable items={items} />
          <nav aria-label={t('customerList.pages.label')} className="flex flex-wrap items-center justify-center gap-inline-md">
            <Button
              variant="secondary"
              icon={ChevronLeft}
              disabled={!online || cursors.length === 0}
              onClick={() => {
                go('previous');
              }}
            >
              {t('customerList.pages.previous')}
            </Button>
            <Button
              variant="secondary"
              icon={ChevronRight}
              disabled={!online || !data?.nextCursor}
              onClick={() => {
                go('next');
              }}
            >
              {t('customerList.pages.next')}
            </Button>
            {online ? null : <p className="text-body-sm text-text-tertiary">{t('customerList.pages.offlineHint')}</p>}
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
