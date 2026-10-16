import {
  listPaymentMilestones,
  listUnpaidPaymentMilestones,
  type CurrentSession,
  type PaymentMilestone,
  type PlannedPaymentMilestone,
  type UnpaidPaymentMilestone,
  type UnpaidPaymentMilestoneList,
  type UnpaidView,
} from '@evia/contracts';
import {
  Banner,
  Button,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  EmptyState,
  InlineAlert,
  SearchX,
  Skeleton,
  WifiOff,
} from '@evia/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { PAYMENTS_PATH } from '../paths.ts';
import { UnpaidFilterBar, type PickedFilterCustomer } from '../payments/unpaid-filter-bar.tsx';
import {
  DEFAULT_PAGE_SIZE,
  isNarrowed,
  NO_FILTERS,
  rangeProblem,
  searchOf,
  toQuery,
  viewOf,
  type UnpaidFilters,
  type UnpaidSearch,
} from '../payments/unpaid-filters.ts';
import { countText } from '../payments/unpaid-format.ts';
import { PlannedTable } from '../payments/planned-table.tsx';
import { UnpaidTable } from '../payments/unpaid-table.tsx';
import { UnpaidTiles } from '../payments/unpaid-tiles.tsx';
import { SESSION_KEY } from '../session/session.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { useOnline } from '../shell/use-online.ts';
import { formatClock } from '../work-orders/format.ts';
import type { MilestoneAction } from '../work-orders/milestone-actions.ts';
import { MilestoneCorrectAmountDialog } from '../work-orders/milestone-correct-amount-dialog.tsx';
import { MilestoneCorrectionDialog, type CorrectionKind } from '../work-orders/milestone-correction-dialog.tsx';
import { MilestoneDetailsDialog } from '../work-orders/milestone-details-dialog.tsx';
import { MilestoneInvoiceDialog } from '../work-orders/milestone-invoice-dialog.tsx';
import { MilestonePaymentDialog } from '../work-orders/milestone-payment-dialog.tsx';
import { formatMoney } from '../work-orders/money.ts';
import { UNPAID_PAYMENTS_KEY, WORK_ORDER_PAYMENTS_KEY } from '../work-orders/query-keys.ts';
import { retryMinutes } from './login-failure.tsx';

/** The server did not accept the cursor (changed list, expired, other filters): `invalid_cursor`. */
// the items of the list are the issued instalments (views "Wszystkie wystawione", "Po terminie") or the planned ones ("Do wystawienia", EVM-059)
const isIssued = (item: UnpaidPaymentMilestoneList['items'][number]): item is UnpaidPaymentMilestone => item.status !== 'planned';
const isPlanned = (item: UnpaidPaymentMilestoneList['items'][number]): item is PlannedPaymentMilestone => item.status === 'planned';
const isBadCursor = (error: unknown): boolean => error instanceof ApiError && error.status === 400 && error.code === 'invalid_cursor';

interface LoadedPage {
  readonly data: UnpaidPaymentMilestoneList;
  readonly at: number;
}

/**
 * The dialog of the page: the payment of a row, the correction of the data of an invoice (read in full first — the row has not all of
 * it), or a correction of a payment of the Administrator (EVM-057: K1, K2, K4, K6 — what an invoiced instalment allows).
 */
type Dialog =
  | { readonly kind: 'pay'; readonly item: UnpaidPaymentMilestone }
  | { readonly kind: 'correction'; readonly action: CorrectionKind; readonly item: UnpaidPaymentMilestone }
  | { readonly kind: 'correctAmount'; readonly item: UnpaidPaymentMilestone }
  // EVM-059 AC2: the dialog of EVM-054 for a planned instalment (read in full first — the row has not the days of the term of the plan)
  | { readonly kind: 'invoice'; readonly order: PlannedPaymentMilestone['workOrder']; readonly milestone: PaymentMilestone }
  | {
      readonly kind: 'details';
      readonly order: UnpaidPaymentMilestone['workOrder'];
      readonly milestone: PaymentMilestone;
    };

type Notice = 'reset' | 'rowGone' | 'detailsError';

/**
 * W-11 "Płatności — nieopłacone" (EVM-055 AC1–AC8): the tiles of sums, the filters, the table of the invoiced instalments sorted by
 * "Najdłużej po terminie" with the sum under it, and the states empty / filtered-empty / loading / error / `429` / offline.
 * - the address carries only `view=overdue`; the range of the due dates, the customer, the size of the page and the cursors live in the
 *   memory of this tab and the title of the tab stays "Płatności · EVia Manager" (AC4; SR-WEB-05) — nothing is kept in a store of the
 *   browser; the answer does not stay in the cache once it is not shown (`gcTime: 0`);
 * - offline the last loaded page stays with a banner and the actions are disabled (AC8);
 * - Administrator and Editor run "Odnotuj wpłatę" (the dialog of EVM-054) and the menu `⋮`; the corrections of payments (EVM-057) are
 *   the Administrator's (disabled for the Editor); Tylko odczyt sees the amounts, the numbers and the terms without actions (AC5) — the
 *   server decides all the same (`403`).
 */
export function PaymentsPage() {
  const { t } = useTranslation();
  usePageTitle(t('payments.title'));
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  // The state of the session is only read (no observer): logout clears the cache and an observer here would read it again.
  const session = queryClient.getQueryData<CurrentSession>(SESSION_KEY);
  const role = session?.user.role;
  const navigate = useNavigate();
  const search: UnpaidSearch = useSearch({ strict: false });
  const view = viewOf(search);
  const [range, setRange] = useState({ dueFrom: '', dueTo: '' });
  const [customer, setCustomer] = useState<PickedFilterCustomer | null>(null);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // Cursors of the pages passed through (empty = the first page, the last = the current one) with the filters they belong to.
  const [paging, setPaging] = useState<{ readonly key: string; readonly cursors: readonly string[] }>({ key: '', cursors: [] });
  const [lastPage, setLastPage] = useState<LoadedPage | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const title = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const moved = useRef<'next' | 'previous' | 'filter' | null>(null);

  const filters: UnpaidFilters = { view, ...range, customerId: customer?.id ?? NO_FILTERS.customerId };
  const problem = rangeProblem(filters);
  const filterKey = JSON.stringify([filters, pageSize]);
  const cursors = paging.key === filterKey ? paging.cursors : [];
  const cursor = cursors.at(-1);

  const query = useQuery({
    queryKey: [UNPAID_PAYMENTS_KEY, filters, pageSize, cursor ?? null],
    queryFn: ({ signal }) => unwrap(listUnpaidPaymentMilestones({ client, signal, query: toQuery(filters, cursor, pageSize) })),
    // Only an active session reads the list; a range the API would refuse is not sent (the message stands under the field).
    enabled: session?.state === 'active' && problem === undefined,
    retry: false,
    // Amounts, numbers of invoices and names of customers: the page does not stay in the cache once it is not shown (SR-WEB-05).
    gcTime: 0,
  });
  const data = query.data;
  const error = query.error;

  // The last loaded page stays in the memory of this tab only — the offline view shows it (AC8).
  useEffect(() => {
    if (data !== undefined) setLastPage({ data, at: query.dataUpdatedAt });
  }, [data, query.dataUpdatedAt]);

  // After a change of the page or of a filter the change is announced; after a change of the page the focus goes to the heading (WCAG 2.4.3, 4.1.3).
  useEffect(() => {
    if (data === undefined || moved.current === null) return;
    if (moved.current === 'filter') {
      setAnnouncement(
        t('payments.list.announce', {
          counted: countText(t, data.summary.filtered.count),
          amount: formatMoney(data.summary.filtered.total.amountMinor),
        }),
      );
    } else {
      setAnnouncement(moved.current === 'next' ? t('payments.list.loadedNext') : t('payments.list.loadedPrevious'));
      heading.current?.focus();
    }
    moved.current = null;
  }, [data, t]);

  // A cursor the server no longer accepts: back to the first page with a message (the filters stay).
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

  const items = data?.items;
  // After a correction of the data the focus returns to the menu of the instalment, once the table shows it (flows/08 → "Fokus").
  useEffect(() => {
    if (focusId === null || items?.some((entry) => entry.id === focusId) !== true) return;
    table.current?.querySelector<HTMLElement>(`[data-milestone="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId, items]);

  const changed = () => {
    moved.current = 'filter';
    setNotice(null);
  };
  const setView = (next: UnpaidView) => {
    if (next === view) return;
    changed();
    void navigate({ to: PAYMENTS_PATH, search: searchOf(next) });
  };
  const clearFilters = () => {
    changed();
    setRange({ dueFrom: '', dueTo: '' });
    setCustomer(null);
    if (view !== 'unpaid') void navigate({ to: PAYMENTS_PATH, search: searchOf('unpaid') });
  };
  const go = (direction: 'next' | 'previous') => {
    moved.current = direction;
    setNotice(null);
    if (direction === 'next') {
      if (data?.nextCursor) setPaging({ key: filterKey, cursors: [...cursors, data.nextCursor] });
    } else setPaging({ key: filterKey, cursors: cursors.slice(0, -1) });
  };

  const act = (action: MilestoneAction, item: UnpaidPaymentMilestone) => {
    setNotice(null);
    if (action === 'pay') {
      setDialog({ kind: 'pay', item });
      return;
    }
    if (action === 'correctAmount') {
      setDialog({ kind: 'correctAmount', item });
      return;
    }
    if (
      action === 'withdrawInvoice' ||
      action === 'cancelInvoice' ||
      action === 'undoPayment' ||
      action === 'restore' ||
      action === 'delete'
    ) {
      setDialog({ kind: 'correction', action, item });
      return;
    }
    if (action !== 'details') return;
    // The row has no date of the invoice: the instalments of the order are read (one request) and the dialog opens with the whole one.
    void queryClient
      .query({
        queryKey: [WORK_ORDER_PAYMENTS_KEY, item.workOrder.id],
        queryFn: ({ signal }) => unwrap(listPaymentMilestones({ client, signal, path: { workOrderId: item.workOrder.id } })),
        staleTime: 0,
        gcTime: 0,
      })
      .then((list) => {
        const found = list.items.find((entry) => entry.id === item.id);
        if (found?.status === 'invoiced') setDialog({ kind: 'details', order: item.workOrder, milestone: found });
        else {
          setNotice('rowGone');
          void queryClient.invalidateQueries({ queryKey: [UNPAID_PAYMENTS_KEY] });
        }
      })
      .catch(() => {
        setNotice('detailsError');
      });
  };

  // EVM-059 AC2: the instalments of the order are read (one request) and the dialog of the invoice opens with the whole planned one.
  const invoice = (item: PlannedPaymentMilestone) => {
    setNotice(null);
    void queryClient
      .query({
        queryKey: [WORK_ORDER_PAYMENTS_KEY, item.workOrder.id],
        queryFn: ({ signal }) => unwrap(listPaymentMilestones({ client, signal, path: { workOrderId: item.workOrder.id } })),
        staleTime: 0,
        gcTime: 0,
      })
      .then((list) => {
        const found = list.items.find((entry) => entry.id === item.id);
        if (found?.status === 'planned') setDialog({ kind: 'invoice', order: item.workOrder, milestone: found });
        else {
          setNotice('rowGone');
          void queryClient.invalidateQueries({ queryKey: [UNPAID_PAYMENTS_KEY] });
        }
      })
      .catch(() => {
        setNotice('detailsError');
      });
  };

  const offlineCopy = !online && lastPage !== null ? lastPage : null;
  const shown = offlineCopy?.data ?? data;
  const summary = shown?.summary ?? lastPage?.data.summary;
  const amount = formatMoney(shown?.summary.filtered.total.amountMinor ?? 0);
  const rateLimited = error instanceof ApiError && error.status === 429;
  const failed = error !== null && !badCursor && offlineCopy === null;
  const filtered = isNarrowed(filters) || view === 'overdue';

  const refocusTitle = () => {
    setDialog(null);
    title.current?.focus();
  };

  return (
    <div className="flex flex-col gap-stack-md">
      <h1 ref={title} tabIndex={-1} className="font-display text-heading-1 text-text-primary focus-visible:focus-ring">
        {view === 'planned' ? t('payments.headingPlanned') : t('payments.heading')}
      </h1>
      {offlineCopy === null ? null : (
        <Banner icon={WifiOff}>{t('payments.states.offlineStale', { time: formatClock(offlineCopy.at) })}</Banner>
      )}
      <UnpaidTiles summary={summary} />
      <UnpaidFilterBar
        filters={filters}
        customer={customer}
        pageSize={pageSize}
        disabled={!online}
        onView={setView}
        onRange={(next) => {
          changed();
          setRange(next);
        }}
        onCustomer={(next) => {
          changed();
          setCustomer(next);
        }}
        onPageSize={(size) => {
          changed();
          setPageSize(size);
        }}
        onClear={clearFilters}
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {notice === null ? null : (
        <InlineAlert tone={notice === 'detailsError' ? 'error' : 'info'}>
          {notice === 'reset'
            ? t('payments.states.cursorReset')
            : notice === 'rowGone'
              ? t('payments.states.rowGone')
              : t('payments.states.detailsError')}
        </InlineAlert>
      )}
      {failed ? (
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
                {t('payments.states.retry')}
              </Button>
            }
          >
            {t('payments.states.rateLimited', { minutes: retryMinutes(error) })}
          </InlineAlert>
        ) : (
          <EmptyState
            icon={CircleAlert}
            title={t('payments.states.errorTitle')}
            description={t('payments.states.errorDescription')}
            action={
              <Button
                onClick={() => {
                  void query.refetch();
                }}
              >
                {t('payments.states.retry')}
              </Button>
            }
          />
        )
      ) : problem !== undefined ? null : shown === undefined ? (
        <Loading />
      ) : shown.items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title={t('payments.states.filteredTitle')}
            description={t('payments.states.filteredDescription')}
            action={
              <Button variant="secondary" onClick={clearFilters}>
                {t('payments.filters.clear')}
              </Button>
            }
          />
        ) : view === 'planned' ? (
          <EmptyState icon={CircleCheck} title={t('payments.states.plannedTitle')} description={t('payments.states.plannedDescription')} />
        ) : (
          <EmptyState icon={CircleCheck} title={t('payments.states.paidTitle')} description={t('payments.states.paidDescription')} />
        )
      ) : (
        <div ref={table} className="flex min-w-0 flex-col gap-stack-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-inline-md">
            <h2 ref={heading} tabIndex={-1} className="text-heading-3 text-text-primary focus-visible:focus-ring">
              {view === 'planned' ? t('payments.list.headingPlanned') : t('payments.list.heading')}
            </h2>
            <p className="text-body-sm text-text-secondary">
              {view === 'planned'
                ? t('payments.list.counterPlanned', { counted: countText(t, shown.summary.filtered.count) })
                : t('payments.list.counterSort', { counted: countText(t, shown.summary.filtered.count) })}
            </p>
          </div>
          {view === 'planned' ? (
            <PlannedTable
              items={shown.items.filter(isPlanned)}
              canEdit={role === 'administrator' || role === 'editor'}
              online={online}
              onInvoice={invoice}
            />
          ) : (
            <UnpaidTable items={shown.items.filter(isIssued)} role={role} online={online} onAction={act} />
          )}
          <p className="text-end text-body-sm font-semibold text-text-primary tabular-nums">
            {view === 'planned'
              ? t('payments.list.totalPlanned', { counted: countText(t, shown.summary.filtered.count), amount })
              : t('payments.list.total', { counted: countText(t, shown.summary.filtered.count), amount })}
          </p>
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
              disabled={!online || !shown.nextCursor}
              onClick={() => {
                go('next');
              }}
            >
              {t('workOrders.pages.next')}
            </Button>
            {online ? null : <p className="text-body-sm text-text-tertiary">{t('workOrders.pages.offlineHint')}</p>}
          </nav>
        </div>
      )}
      {dialog?.kind === 'pay' ? (
        <MilestonePaymentDialog
          key={dialog.item.id}
          order={dialog.item.workOrder}
          milestone={dialog.item}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={refocusTitle}
        />
      ) : null}
      {dialog?.kind === 'correction' ? (
        // EVM-057: a correction takes the row out of the list (no longer invoiced, or deleted) — the focus goes to the title of the page
        <MilestoneCorrectionDialog
          key={dialog.item.id}
          kind={dialog.action}
          order={dialog.item.workOrder}
          milestone={dialog.item}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={refocusTitle}
          onDeleted={refocusTitle}
        />
      ) : null}
      {dialog?.kind === 'correctAmount' ? (
        <MilestoneCorrectAmountDialog
          key={dialog.item.id}
          order={dialog.item.workOrder}
          milestone={dialog.item}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={(saved) => {
            setDialog(null);
            setFocusId(saved.id);
          }}
        />
      ) : null}
      {dialog?.kind === 'invoice' ? (
        // EVM-059 AC2: the instalment leaves the view once invoiced — the focus goes to the title of the page
        <MilestoneInvoiceDialog
          key={dialog.milestone.id}
          order={dialog.order}
          milestone={dialog.milestone}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={refocusTitle}
        />
      ) : null}
      {dialog?.kind === 'details' ? (
        <MilestoneDetailsDialog
          key={dialog.milestone.id}
          order={dialog.order}
          milestone={dialog.milestone}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={(saved) => {
            setDialog(null);
            setFocusId(saved.id);
          }}
        />
      ) : null}
    </div>
  );
}

/** Skeleton of the rows (styleguide § 4.12) with a text status. */
function Loading() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-stack-sm">
      <p role="status" className="text-body text-text-secondary">
        {t('shell.loading')}
      </p>
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} shape="field" />
      ))}
    </div>
  );
}
