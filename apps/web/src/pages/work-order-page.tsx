import { Banner, Button, CircleAlert, EmptyState, SearchX, Skeleton, Tabs, WifiOff } from '@evia/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { CustomerCard } from '../work-orders/customer-card.tsx';
import { formatClock } from '../work-orders/format.ts';
import { WORK_ORDER_KEYS } from '../work-orders/query-keys.ts';
import { ScopeSection } from '../work-orders/scope-section.tsx';
import { SiteCard } from '../work-orders/site-card.tsx';
import {
  isNotFound,
  useWorkOrderCustomer,
  useWorkOrderHeader,
  useWorkOrderScope,
  useWorkOrderSite,
} from '../work-orders/use-work-order.ts';
import { WorkOrderHeader } from '../work-orders/work-order-header.tsx';

const OVERVIEW_TAB = 'overview';

/**
 * W-06 "Szczegóły zlecenia", the tab "Przegląd" (EVM-018 AC1–AC7): the header, the scope and the side cards "Klient" and
 * "Lokalizacja", put together from four reads anchored in the order (there is no collective endpoint). The header comes
 * first; the sections follow, each with its own skeleton and its own error, so one section failing leaves the others working.
 *
 * `404 not_found` (a missing order, a deleted one, one the person may not see — the API says the same for all) is ONE screen
 * "Nie znaleziono zlecenia" with no data of the order, not even from the answer of the creation or the previous screen: the
 * four entries of the order are removed from the memory of the tab (TM-10). The tab title is the number of the order and never
 * the name or the address of anybody (AC5). Offline, the data of the tab stays on screen under the banner "Dane mogą być
 * nieaktualne (z 14:05)" — in the memory of this tab only, never in a store of the browser (SR-WEB-05).
 */
export function WorkOrderPage() {
  const { t } = useTranslation();
  const { workOrderId } = useParams({ strict: false });
  const id = workOrderId ?? '';
  const queryClient = useQueryClient();
  const online = useOnline();
  const [gone, setGone] = useState(false);
  const active = !gone && id !== '';
  const header = useWorkOrderHeader(id, active);
  const scope = useWorkOrderScope(id, active);
  const customer = useWorkOrderCustomer(id, active);
  const site = useWorkOrderSite(id, active);
  const heading = useRef<HTMLHeadingElement>(null);

  // The order is gone when the header or the scope says so (a card may be 404 for a customer that was deleted — the order lives).
  const notFound = gone || isNotFound(header.error) || isNotFound(scope.error);
  useEffect(() => {
    if (!notFound) return;
    setGone(true);
    for (const key of WORK_ORDER_KEYS) queryClient.removeQueries({ queryKey: [key, id] });
  }, [notFound, id, queryClient]);

  // The connection is back: what failed meanwhile is read again.
  useEffect(() => {
    if (!online) return;
    for (const query of [header, scope, customer, site]) if (query.isError && !isNotFound(query.error)) void query.refetch();
    // Only the return of the connection matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const order = header.data;
  const failed = !notFound && order === undefined && header.isError;
  usePageTitle(
    notFound
      ? t('workOrder.notFound.pageTitle')
      : (order?.number ?? (failed ? t('workOrder.loadFailed.pageTitle') : t('workOrder.loading.pageTitle'))),
  );

  // After the page opens the focus goes to its heading (WCAG 2.4.3): the number, or the state that replaces it.
  const focusTarget = order !== undefined || notFound || failed;
  useEffect(() => {
    if (focusTarget) heading.current?.focus();
  }, [focusTarget, notFound]);

  if (notFound) return <NotFound titleRef={heading} />;
  if (order === undefined) {
    return failed ? (
      <LoadFailed
        titleRef={heading}
        onRetry={() => {
          void header.refetch();
        }}
      />
    ) : (
      <LoadingHeader />
    );
  }

  return (
    <div className="flex flex-col gap-stack-lg">
      {online ? null : <Banner icon={WifiOff}>{t('workOrders.offline.stale', { time: formatClock(header.dataUpdatedAt) })}</Banner>}
      <WorkOrderHeader order={order} headingRef={heading} />
      <div className="grid grid-cols-1 gap-stack-lg expanded:grid-cols-3">
        <div className="expanded:col-span-2">
          <Tabs
            label={t('workOrder.tabs.label')}
            tabs={[{ id: OVERVIEW_TAB, label: t('workOrder.tabs.overview') }]}
            selectedId={OVERVIEW_TAB}
            onSelect={noop}
          >
            <ScopeSection query={scope} />
          </Tabs>
        </div>
        <aside className="flex flex-col gap-stack-md" aria-label={t('workOrder.sideLabel')}>
          <CustomerCard query={customer} />
          <SiteCard query={site} />
        </aside>
      </div>
    </div>
  );
}

const noop = () => undefined;

/** The header is being read (styleguide § 4.12): a skeleton of the heading and of the card, with a status for assistive technology. */
function LoadingHeader() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-stack-md">
      <p role="status" className="sr-only">
        {t('workOrder.loading.header')}
      </p>
      <Skeleton />
      <Skeleton />
      <Skeleton shape="field" />
    </div>
  );
}

/** AC3: one screen for a missing, a deleted and a forbidden order; nothing of the order is shown (styleguide § 4.13). */
function NotFound({ titleRef }: { readonly titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={SearchX}
      headingLevel={1}
      titleRef={titleRef}
      title={t('workOrder.notFound.title')}
      description={t('workOrder.notFound.description')}
      action={
        <Button
          onClick={() => {
            void navigate({ to: WORK_ORDERS_PATH });
          }}
        >
          {t('workOrder.notFound.action')}
        </Button>
      }
    />
  );
}

/** AC7: the whole order could not be read — "Nie udało się wczytać zlecenia." with one way out, "Spróbuj ponownie". */
function LoadFailed({ titleRef, onRetry }: { readonly titleRef: RefObject<HTMLHeadingElement | null>; readonly onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={CircleAlert}
      headingLevel={1}
      titleRef={titleRef}
      title={t('workOrder.loadFailed.title')}
      description={t('workOrder.loadFailed.description')}
      action={<Button onClick={onRetry}>{t('workOrder.loadFailed.retry')}</Button>}
    />
  );
}
