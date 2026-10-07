import { listAuditEvents } from '@evia/contracts';
import { Button, ChevronLeft, ChevronRight, CircleAlert, EmptyState, InlineAlert, Lock, Shield, Skeleton } from '@evia/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { AuditFilterBar } from '../audit/audit-filter-bar.tsx';
import { AuditTable } from '../audit/audit-table.tsx';
import { isFiltered, NO_FILTERS, PAGE_SIZE, toQuery, type AuditFilters } from '../audit/filters.ts';
import { checkPeriod } from '../audit/period.ts';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { serverNow } from '../session/server-clock.ts';
import { useSession } from '../session/session.ts';
import { lastStepUpAt, STEP_UP_WINDOW_MS, withRotationRetry } from '../session/step-up.ts';
import { useStepUp } from '../session/step-up-context.tsx';
import { retryMinutes } from './login-failure.tsx';
import { usePageTitle } from '../shell/use-page-title.ts';
import { useNow } from '../shell/use-now.ts';
import { useOnline } from '../shell/use-online.ts';

/** Query key root: everything of the log is dropped from the cache together (logout, end of the window). */
const AUDIT_KEY = 'audit' as const;
/** After this long a load is called slow (styleguide § 4.12; the story: "po 10 s"). */
const SLOW_MS = 10_000;

const isStepUpRequired = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403 && error.code === 'step_up_required';
const isForbidden = (error: unknown): boolean => error instanceof ApiError && error.status === 403 && error.code !== 'step_up_required';
/** The server did not accept the cursor (changed list, expired): `validation_failed` on `cursor` or `invalid_cursor`. */
const isBadCursor = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.status === 400 &&
  (error.code === 'invalid_cursor' || error.errors.some((entry) => entry.pointer.endsWith('cursor')));

/**
 * W-18 "Dziennik audytu" (EVM-029 AC1–AC8): events from newest, filters, cursor pages, read-only. The server decides
 * everything: `403 step_up_required` opens W-04 and, once the identity is confirmed, the same request is sent again —
 * once; `403 forbidden` (Edytor, Tylko odczyt) shows "Brak dostępu" without data; the panel does not even ask without the
 * Administrator role. After the 15 minutes of the confirmation made in this tab the loaded page is dropped (the server
 * checks every request anyway).
 */
export function AuditPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdministrator = session.data?.user.role === 'administrator';
  usePageTitle(isAdministrator ? t('audit.title') : t('audit.denied.pageTitle'));
  return isAdministrator ? <AuditLog /> : <AccessDenied />;
}

function AccessDenied() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={Lock}
      headingLevel={1}
      title={t('audit.denied.title')}
      description={t('audit.denied.description')}
      action={
        <Button
          onClick={() => {
            void navigate({ to: WORK_ORDERS_PATH });
          }}
        >
          {t('audit.denied.action')}
        </Button>
      }
    />
  );
}

function AuditLog() {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const requestStepUp = useStepUp();
  const online = useOnline();
  const now = serverNow(useNow(30_000));
  const [filters, setFilters] = useState<AuditFilters>(NO_FILTERS);
  /** Cursors of the pages passed through: empty = the first page, the last = the current one. */
  const [cursors, setCursors] = useState<readonly string[]>([]);
  const [people, setPeople] = useState<ReadonlyMap<string, string>>(new Map());
  const [notice, setNotice] = useState<'reset' | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef<'next' | 'previous' | null>(null);
  const cursor = cursors.at(-1);

  const confirmedAt = lastStepUpAt();
  const windowEnded = confirmedAt !== null && now - confirmedAt >= STEP_UP_WINDOW_MS;
  const periodProblem = checkPeriod(filters.from, filters.to) !== null;

  const query = useQuery({
    queryKey: [AUDIT_KEY, filters, cursor ?? null],
    queryFn: ({ signal }) => withRotationRetry(() => unwrap(listAuditEvents({ client, signal, query: toQuery(filters, cursor) }))),
    enabled: !windowEnded && !periodProblem,
    retry: false,
    // The log does not stay in memory after the page is left (SR-WEB-05); logout clears the cache as well.
    gcTime: 0,
  });
  const stepUpNeeded = windowEnded || isStepUpRequired(query.error);
  const data = windowEnded ? undefined : query.data;

  // The window of the confirmation ended: the loaded page leaves the tab (the status is announced below).
  useEffect(() => {
    if (windowEnded) queryClient.removeQueries({ queryKey: [AUDIT_KEY] });
  }, [windowEnded, queryClient]);

  // The persons seen so far feed the person filter (the list of accounts, W-16, does not exist yet).
  useEffect(() => {
    if (data === undefined) return;
    setPeople((known) => {
      const next = new Map(known);
      for (const { actor } of data.items) if (actor?.displayName) next.set(actor.userId, actor.displayName);
      return next.size === known.size ? known : next;
    });
  }, [data]);

  // After a change of page the focus goes to the heading of the table and the change is announced (WCAG 2.4.3, 4.1.3).
  useEffect(() => {
    if (data === undefined || moved.current === null) return;
    setAnnouncement(moved.current === 'next' ? t('audit.pages.loadedNext') : t('audit.pages.loadedPrevious'));
    moved.current = null;
    heading.current?.focus();
  }, [data, t]);

  // A cursor the server no longer accepts: back to the first page with a message ("Lista została zaktualizowana…").
  const badCursor = cursors.length > 0 && isBadCursor(query.error);
  useEffect(() => {
    if (!badCursor) return;
    setCursors([]);
    setNotice('reset');
  }, [badCursor]);

  /** W-04 once per failed request: after the confirmation the same request is repeated (once — no loop, K9). */
  const attempted = useRef<unknown>(null);
  const [, reread] = useState(0);
  const confirm = useCallback(async () => {
    const wasHidden = windowEnded;
    if (!(await requestStepUp(t('stepUp.title.audit')))) return;
    attempted.current = 'retried';
    // The window is read again (the query is enabled once the data was hidden); an error state asks the server again.
    reread((count) => count + 1);
    if (!wasHidden) await query.refetch();
  }, [requestStepUp, t, query, windowEnded]);
  useEffect(() => {
    if (!isStepUpRequired(query.error) || attempted.current === 'retried' || attempted.current === query.error) return;
    attempted.current = query.error;
    void confirm();
  }, [query.error, confirm]);
  useEffect(() => {
    if (data !== undefined) attempted.current = null;
  }, [data]);

  const change = (next: AuditFilters) => {
    attempted.current = null;
    moved.current = null;
    setNotice(null);
    setCursors([]);
    setFilters(next);
  };
  const go = (direction: 'next' | 'previous') => {
    attempted.current = null;
    moved.current = direction;
    setNotice(null);
    if (direction === 'next') {
      if (data?.nextCursor) setCursors([...cursors, data.nextCursor]);
    } else setCursors(cursors.slice(0, -1));
  };

  const error = query.error;
  const rateLimited = error instanceof ApiError && error.status === 429;
  const forbidden = isForbidden(error);

  if (forbidden) return <AccessDenied />;

  return (
    <div className="flex flex-col gap-stack-md">
      <h1 className="font-display text-heading-1 text-text-primary">{t('audit.title')}</h1>
      <AuditFilterBar filters={filters} people={people} disabled={!online} now={now} onChange={change} />
      <p role="status" className="sr-only">
        {windowEnded ? t('audit.confirm.hidden') : announcement}
      </p>
      {notice === 'reset' ? <InlineAlert tone="info">{t('audit.error.cursorReset')}</InlineAlert> : null}
      {stepUpNeeded ? (
        <EmptyState
          icon={Shield}
          title={t('audit.confirm.title')}
          description={windowEnded ? t('audit.confirm.hidden') : t('audit.confirm.description')}
          action={
            <Button
              onClick={() => {
                void confirm();
              }}
            >
              {t('audit.confirm.action')}
            </Button>
          }
        />
      ) : periodProblem ? null : error !== null && !badCursor ? (
        rateLimited ? (
          <InlineAlert
            tone="error"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  void query.refetch();
                }}
              >
                {t('audit.error.retry')}
              </Button>
            }
          >
            {t('audit.error.rateLimited', { minutes: retryMinutes(error) })}
          </InlineAlert>
        ) : (
          <EmptyState
            icon={CircleAlert}
            title={t('audit.error.title')}
            description={t('audit.error.description')}
            action={
              <Button
                onClick={() => {
                  void query.refetch();
                }}
              >
                {t('audit.error.retry')}
              </Button>
            }
          />
        )
      ) : data === undefined ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={Shield}
          title={t('audit.empty.title')}
          description={t('audit.empty.description')}
          action={
            isFiltered(filters) ? (
              <Button
                variant="secondary"
                onClick={() => {
                  change(NO_FILTERS);
                }}
              >
                {t('audit.filters.clear')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <h2 ref={heading} tabIndex={-1} className="text-heading-3 text-text-primary focus-visible:focus-ring">
            {t('audit.table.heading', { count: PAGE_SIZE })}
          </h2>
          <AuditTable items={data.items} />
          <nav aria-label={t('audit.pages.label')} className="flex flex-wrap items-center justify-center gap-inline-md">
            <Button
              variant="secondary"
              icon={ChevronLeft}
              disabled={!online || cursors.length === 0}
              onClick={() => {
                go('previous');
              }}
            >
              {t('audit.pages.previous')}
            </Button>
            <Button
              variant="secondary"
              icon={ChevronRight}
              disabled={!online || !data.nextCursor}
              onClick={() => {
                go('next');
              }}
            >
              {t('audit.pages.next')}
            </Button>
            {online ? null : <p className="text-body-sm text-text-tertiary">{t('audit.pages.offlineHint')}</p>}
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
        {slow ? t('audit.loading.slow') : t('shell.loading')}
      </p>
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} shape="field" />
      ))}
    </div>
  );
}
