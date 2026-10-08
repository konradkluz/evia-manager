import { getCustomer, type CurrentSession, type Customer } from '@evia/contracts';
import {
  ActionMenu,
  Banner,
  Breadcrumbs,
  Button,
  CircleAlert,
  EllipsisVertical,
  EmptyState,
  IconButton,
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
import { CustomerDataCard } from '../customers/customer-data-card.tsx';
import { CustomerHistory } from '../customers/customer-history.tsx';
import { EditCustomerDialog } from '../customers/edit-customer-dialog.tsx';
import { CUSTOMER_KEY, CUSTOMER_LIST_KEY, CUSTOMER_ORDERS_KEY } from '../customers/query-keys.ts';
import { CUSTOMERS_PATH } from '../paths.ts';
import { SESSION_KEY } from '../session/session.ts';
import { RouterLink } from '../shell/router-link.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
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
  const canEdit = session?.user.role === 'administrator' || session?.user.role === 'editor';
  const [gone, setGone] = useState(false);
  const [editing, setEditing] = useState(false);
  const active = !gone && id !== '' && session?.state === 'active';
  const heading = useRef<HTMLHeadingElement>(null);

  const query = useQuery({
    queryKey: [CUSTOMER_KEY, id],
    queryFn: ({ signal }) => unwrap(getCustomer({ client, signal, path: { customerId: id } })),
    enabled: active,
    retry: false,
    // Personal data (DO-K) stays in the memory of the tab only while the page is open (SR-WEB-05).
    gcTime: 0,
  });
  const customer = query.data;
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
              items={[
                {
                  id: 'edit',
                  label: t('customerPage.menu.edit'),
                  onSelect: () => {
                    setEditing(true);
                  },
                  ...(online ? {} : { disabledHint: t('customerPage.menu.offline') }),
                },
              ]}
              trigger={(props) => (
                <IconButton {...props} icon={EllipsisVertical} label={t('customerPage.menu.label', { name: customer.displayName })} />
              )}
            />
          ) : null}
        </div>
      </header>
      <div className="grid grid-cols-1 gap-stack-lg expanded:grid-cols-3">
        <aside className="flex flex-col gap-stack-md expanded:order-2" aria-label={t('customerPage.data.heading')}>
          <CustomerDataCard customer={customer} />
        </aside>
        <div className="expanded:order-1 expanded:col-span-2">
          <CustomerHistory customerId={id} enabled={active} />
        </div>
      </div>
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
