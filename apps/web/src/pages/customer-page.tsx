import { getCustomer, type CurrentSession, type Customer } from '@evia/contracts';
import {
  ActionMenu,
  type ActionMenuItem,
  Banner,
  Breadcrumbs,
  Button,
  CircleAlert,
  EllipsisVertical,
  EmptyState,
  IconButton,
  InlineAlert,
  Info,
  SearchX,
  Skeleton,
  WifiOff,
} from '@evia/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { AnonymizeCustomerDialog } from '../customers/anonymize-customer-dialog.tsx';
import { eraseFailureText } from '../customers/customer-erase.ts';
import { CustomerDataCard } from '../customers/customer-data-card.tsx';
import { CustomerHistory } from '../customers/customer-history.tsx';
import { EditCustomerDialog } from '../customers/edit-customer-dialog.tsx';
import { CUSTOMER_KEY, CUSTOMER_LIST_KEY, CUSTOMER_ORDERS_KEY } from '../customers/query-keys.ts';
import { useCustomerErase } from '../customers/use-customer-erase.ts';
import { CUSTOMERS_PATH } from '../paths.ts';
import { SESSION_KEY } from '../session/session.ts';
import { RouterLink } from '../shell/router-link.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { AnchoredDocumentsSection } from '../work-orders/anchored-documents-section.tsx';
import { CUSTOMER_DOCUMENTS_KEY } from '../work-orders/query-keys.ts';
import { formatClock } from '../work-orders/format.ts';
import { isNotFound } from '../work-orders/use-work-order.ts';
import { retryMinutes } from './login-failure.tsx';

/**
 * W-14 "Klient", the details (EVM-039 AC2, AC3, AC6, AC7, AC8): the name and the kind, "Dane klienta", "Historia zleceń" and — for
 * the Administrator and the Editor — the menu "Akcje klienta" with "Edytuj dane klienta…" (Tylko odczyt has no trigger; the server
 * refuses a change anyway). `404 not_found` (a missing customer, a deleted one, one the person may not see — the API says the
 * same for all) is ONE screen "Nie znaleziono klienta" with no data of the customer, not even from the list: the entries are
 * removed from the memory of the tab. The title of the tab never carries the name (SR-WEB-05). Offline, the data of the tab
 * stays on screen under the banner "Dane mogą być nieaktualne (z 14:05)" — in the memory of this tab only.
 */
export function CustomerPage() {
  const { t } = useTranslation();
  const { customerId } = useParams({ strict: false });
  const id = customerId ?? '';
  const client = useApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const toast = useToast();
  // The state and the role of the session are only read (no observer): logout clears the cache and an observer would read it again.
  const session = queryClient.getQueryData<CurrentSession>(SESSION_KEY);
  const isAdministrator = session?.user.role === 'administrator';
  const canEdit = isAdministrator || session?.user.role === 'editor';
  const [gone, setGone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  // The number of open work orders the server named in `409 has_active_dependents` (the menu then explains why it is off).
  const [openOrders, setOpenOrders] = useState<number | null>(null);
  const active = !gone && id !== '' && session?.state === 'active';
  const heading = useRef<HTMLHeadingElement>(null);
  const stateBanner = useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey: [CUSTOMER_KEY, id],
    queryFn: ({ signal }) => unwrap(getCustomer({ client, signal, path: { customerId: id } })),
    enabled: active,
    retry: false,
    // Personal data (DO-K) stays in the memory of the tab only while the page is open (SR-WEB-05).
    gcTime: 0,
  });
  const customer = query.data;
  const erase = useCustomerErase(id, {
    onGone: () => {
      setGone(true);
    },
    onDependents: (count) => {
      setOpenOrders(count ?? 0);
    },
  });
  const notFound = gone || isNotFound(query.error);
  useEffect(() => {
    if (!notFound) return;
    setGone(true);
    setEditing(false);
    queryClient.removeQueries({ queryKey: [CUSTOMER_KEY, id] });
    queryClient.removeQueries({ queryKey: [CUSTOMER_ORDERS_KEY, id] });
  }, [notFound, id, queryClient]);

  // The connection is back: a customer that failed meanwhile is read again.
  useEffect(() => {
    if (online && query.error instanceof ApiError && query.error.status === 0) void query.refetch();
    // Only the return of the connection matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const failed = !notFound && customer === undefined && query.isError;
  usePageTitle(notFound ? t('customerPage.notFound.pageTitle') : t('customerPage.pageTitle'));

  // After the page opens the focus goes to its heading (WCAG 2.4.3): the name, or the state that replaces it.
  const focusTarget = customer !== undefined || notFound || failed;
  useEffect(() => {
    if (focusTarget) heading.current?.focus();
  }, [focusTarget, notFound]);

  // A change of the state of the customer moves the focus to what replaces the view: the banner after a delete, the heading after a
  // restore or an anonymization (flow 13). The first view of the page is handled by the effect above.
  const deletedNow = typeof customer?.deletedAt === 'string';
  const anonymizedNow = typeof customer?.anonymizedAt === 'string';
  const seenState = useRef<{ readonly deleted: boolean; readonly anonymized: boolean } | null>(null);
  useEffect(() => {
    if (customer === undefined) return;
    const before = seenState.current;
    seenState.current = { deleted: deletedNow, anonymized: anonymizedNow };
    if (before === null) return;
    if (deletedNow && !before.deleted) stateBanner.current?.focus();
    else if (before.deleted !== deletedNow || before.anonymized !== anonymizedNow) heading.current?.focus();
    // Only the state flags matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletedNow, anonymizedNow, customer === undefined]);

  if (notFound) return <NotFound titleRef={heading} />;
  if (customer === undefined) {
    return failed ? (
      <LoadFailed
        titleRef={heading}
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    ) : (
      <Loading />
    );
  }

  const saved = (updated: Customer) => {
    queryClient.setQueryData([CUSTOMER_KEY, id], updated);
    // The names on the list may have changed: the next visit reads it again.
    queryClient.removeQueries({ queryKey: [CUSTOMER_LIST_KEY] });
    setEditing(false);
    toast(t('customerPage.saved'));
  };

  // A value the API did not send (an older answer) is "not set": only a timestamp marks the state.
  const deleted = typeof customer.deletedAt === 'string';
  const anonymized = typeof customer.anonymizedAt === 'string';
  // Hints, in the order of the table of flow 13: the state of the page, the role, then what the server has said about the orders.
  const offlineHint = online ? undefined : t('customerPage.menu.offline');
  const dependentsHint = (kind: 'delete' | 'anonymize') => {
    if (openOrders === null) return undefined;
    return kind === 'delete'
      ? t('customerErase.menu.dependentsDeleteHint', { count: openOrders })
      : t('customerErase.menu.dependentsAnonymizeHint', { count: openOrders });
  };
  const hint = (value: string | undefined) => (value === undefined ? {} : { disabledHint: value });
  const frozen = deleted && anonymized ? t('customerErase.menu.readOnlyHint') : undefined;
  const idle = () => !erase.busy;
  const menuItems: ActionMenuItem[] = [
    {
      id: 'edit',
      label: t('customerPage.menu.edit'),
      onSelect: () => {
        setEditing(true);
      },
      ...hint(
        offlineHint ??
          frozen ??
          (anonymized ? t('customerErase.menu.editAnonymizedHint') : deleted ? t('customerErase.menu.editDeletedHint') : undefined),
      ),
    },
    ...(deleted
      ? []
      : [
          {
            id: 'delete',
            label: t('customerErase.menu.delete'),
            startsGroup: true,
            tone: 'danger' as const,
            onSelect: () => {
              if (idle()) erase.remove(customer);
            },
            ...hint(offlineHint ?? (isAdministrator ? dependentsHint('delete') : t('customerErase.menu.deleteEditorHint'))),
          },
        ]),
    {
      id: 'anonymize',
      label: t('customerErase.menu.anonymize'),
      tone: 'danger',
      ...(deleted ? { startsGroup: true } : {}),
      onSelect: () => {
        setAnonymizing(true);
      },
      ...hint(
        offlineHint ??
          (isAdministrator
            ? (frozen ?? (anonymized ? t('customerErase.menu.anonymizeAnonymizedHint') : dependentsHint('anonymize')))
            : t('customerErase.menu.anonymizeEditorHint')),
      ),
    },
  ];

  const anonymizedDone = (updated: Customer) => {
    queryClient.setQueryData([CUSTOMER_KEY, id], updated);
    queryClient.removeQueries({ queryKey: [CUSTOMER_LIST_KEY] });
    queryClient.removeQueries({ queryKey: [CUSTOMER_ORDERS_KEY, id] });
    setAnonymizing(false);
    setOpenOrders(null);
    toast(t('customerErase.toast.anonymized'));
  };

  return (
    <div className="flex flex-col gap-stack-lg">
      {online ? null : <Banner icon={WifiOff}>{t('workOrders.offline.stale', { time: formatClock(query.dataUpdatedAt) })}</Banner>}
      <header className="flex flex-col gap-stack-sm">
        <Breadcrumbs
          label={t('customerPage.breadcrumbs')}
          items={[{ label: t('customerList.title'), href: CUSTOMERS_PATH }, { label: customer.displayName }]}
          link={RouterLink}
        />
        <div className="flex flex-wrap items-start justify-between gap-inline-md">
          <div className="flex flex-col gap-stack-xs">
            <h1 ref={heading} tabIndex={-1} className="break-words font-display text-heading-1 text-text-primary focus-visible:focus-ring">
              {customer.displayName}
            </h1>
            <p className="text-body-sm text-text-secondary">
              {customer.kind === 'company' ? t('customerList.table.company') : t('customerList.table.person')}
            </p>
          </div>
          {canEdit ? (
            <ActionMenu
              label={t('customerPage.menu.label', { name: customer.displayName })}
              items={menuItems}
              trigger={(props) => (
                <IconButton {...props} icon={EllipsisVertical} label={t('customerPage.menu.label', { name: customer.displayName })} />
              )}
            />
          ) : null}
        </div>
      </header>
      {erase.problem === null ? null : (
        <InlineAlert
          tone="error"
          {...(erase.problem.failure.kind === 'conflict'
            ? {
                action: (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      erase.dismissProblem();
                      void query.refetch();
                    }}
                  >
                    {t('customerErase.failure.refresh')}
                  </Button>
                ),
              }
            : {})}
        >
          {eraseFailureText(t, erase.problem.operation, erase.problem.failure)}
        </InlineAlert>
      )}
      {deleted ? (
        <div ref={stateBanner} tabIndex={-1} className="focus-visible:focus-ring">
          <Banner icon={Info} tone="info">
            <p>{anonymized ? t('customerErase.banner.deletedAnonymized') : t('customerErase.banner.deleted')}</p>
            <div>
              <Button
                variant="secondary"
                disabled={!online || erase.busy}
                {...(online ? {} : { title: t('customerPage.menu.offline') })}
                onClick={erase.restore}
              >
                {t('customerErase.banner.restore')}
              </Button>
            </div>
          </Banner>
        </div>
      ) : null}
      {anonymized && !deleted ? <InlineAlert tone="info">{t('customerErase.banner.anonymized')}</InlineAlert> : null}
      <div className="grid grid-cols-1 gap-stack-lg expanded:grid-cols-3">
        <aside className="flex flex-col gap-stack-md expanded:order-2" aria-label={t('customerPage.data.heading')}>
          <CustomerDataCard customer={customer} />
        </aside>
        <div className="expanded:order-1 expanded:col-span-2">
          <CustomerHistory customerId={id} enabled={active} />
          <AnchoredDocumentsSection owner={{ anchor: 'customer', id }} queryKey={[CUSTOMER_DOCUMENTS_KEY, id]} enabled={active} />
        </div>
      </div>
      {anonymizing ? (
        <AnonymizeCustomerDialog
          customer={customer}
          onDone={anonymizedDone}
          onClose={() => {
            setAnonymizing(false);
          }}
          onStale={(failure) => {
            if (failure.kind === 'gone') {
              setGone(true);
              return;
            }
            // A repeat after a lost answer (`already_anonymized`) is "already done": read the state and show it, not an error.
            if (failure.kind === 'alreadyAnonymized') {
              queryClient.removeQueries({ queryKey: [CUSTOMER_LIST_KEY] });
              queryClient.removeQueries({ queryKey: [CUSTOMER_ORDERS_KEY, id] });
              setAnonymizing(false);
            }
            void query.refetch();
          }}
          onDependents={(count) => {
            setOpenOrders(count ?? 0);
          }}
        />
      ) : null}
      {editing ? (
        <EditCustomerDialog
          customer={customer}
          refresh={async () => (await query.refetch()).data}
          onGone={() => {
            setGone(true);
          }}
          onClose={(updated) => {
            if (updated === undefined) setEditing(false);
            else saved(updated);
          }}
        />
      ) : null}
    </div>
  );
}

/** The customer is being read (styleguide § 4.12): a skeleton of the heading and the cards, with a status for assistive technology. */
function Loading() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-stack-md">
      <p role="status" className="sr-only">
        {t('customerPage.loading')}
      </p>
      <Skeleton />
      <Skeleton />
      <Skeleton shape="field" />
    </div>
  );
}

/** AC6: one screen for a missing, a deleted and a forbidden customer; nothing of the customer is shown (styleguide § 4.13). */
function NotFound({ titleRef }: { readonly titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={SearchX}
      headingLevel={1}
      titleRef={titleRef}
      title={t('customerPage.notFound.title')}
      description={t('customerPage.notFound.description')}
      action={
        <Button
          onClick={() => {
            void navigate({ to: CUSTOMERS_PATH });
          }}
        >
          {t('customerPage.notFound.action')}
        </Button>
      }
    />
  );
}

/** The customer could not be read: "Nie udało się wczytać klienta." with one way out, "Spróbuj ponownie"; `429` says when. */
function LoadFailed({
  titleRef,
  error,
  onRetry,
}: {
  readonly titleRef: RefObject<HTMLHeadingElement | null>;
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const { t } = useTranslation();
  const limited = error instanceof ApiError && error.status === 429;
  return (
    <EmptyState
      icon={CircleAlert}
      headingLevel={1}
      titleRef={titleRef}
      title={t('customerPage.loadFailed.title')}
      description={
        limited ? t('customerPage.loadFailed.rateLimited', { minutes: retryMinutes(error) }) : t('customerPage.loadFailed.description')
      }
      action={<Button onClick={onRetry}>{t('customerPage.loadFailed.retry')}</Button>}
    />
  );
}
