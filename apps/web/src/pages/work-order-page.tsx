import { Banner, Button, CircleAlert, EmptyState, SearchX, Skeleton, Tabs, WifiOff } from '@evia/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { MobileQuickBanner } from '../work-orders/mobile-quick-banner.tsx';
import { AnchoredDocumentsSection } from '../work-orders/anchored-documents-section.tsx';
import { DocumentsSection } from '../work-orders/documents-section.tsx';
import { MediaSection } from '../work-orders/media-section.tsx';
import { MediaUnfinishedBanner } from '../work-orders/media-unfinished-banner.tsx';
import { MediaUploadDialog } from '../work-orders/media-upload-dialog.tsx';
import { mediaText } from '../work-orders/media-labels.ts';
import { useDocumentUpload } from '../work-orders/use-documents.ts';
import { useMediaUpload } from '../work-orders/use-media.ts';
import { JournalSection } from '../work-orders/journal-section.tsx';
import { ClosedBanner } from '../work-orders/closed-banner.tsx';
import { CustomerCard } from '../work-orders/customer-card.tsx';
import { formatClock } from '../work-orders/format.ts';
import { WORK_ORDER_DOCUMENTS_KEY, WORK_ORDER_KEYS } from '../work-orders/query-keys.ts';
import { OrderSummary } from '../work-orders/order-summary.tsx';
import { canReadPayments } from '../payments/payment-access.ts';
import { useSession } from '../session/session.ts';
import { PAYMENTS_HEADING_ID, PaymentsSection } from '../work-orders/payments-section.tsx';
import { PROCEDURES_HEADING_ID, ProceduresSection } from '../work-orders/procedures-section.tsx';
import { ScopeSection } from '../work-orders/scope-section.tsx';
import { SiteCard } from '../work-orders/site-card.tsx';
import {
  isNotFound,
  useWorkOrderCustomer,
  useWorkOrderHeader,
  useWorkOrderPayments,
  useWorkOrderProcedures,
  useWorkOrderScope,
  useWorkOrderSite,
  useWorkOrderSiteOrders,
} from '../work-orders/use-work-order.ts';
import { WorkOrderHeader } from '../work-orders/work-order-header.tsx';

const OVERVIEW_TAB = 'overview';
const JOURNAL_TAB = 'journal';
const MEDIA_TAB = 'media';

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
  const [tab, setTab] = useState(OVERVIEW_TAB);
  const [siteEditSignal, setSiteEditSignal] = useState(0);
  const active = !gone && id !== '';
  const header = useWorkOrderHeader(id, active);
  const scope = useWorkOrderScope(id, active);
  const procedures = useWorkOrderProcedures(id, active);
  const payments = useWorkOrderPayments(id, active);
  const customer = useWorkOrderCustomer(id, active);
  const site = useWorkOrderSite(id, active);
  const siteOrders = useWorkOrderSiteOrders(id, active);
  const heading = useRef<HTMLHeadingElement>(null);
  // The tile "Płatności" of the summary exists for a role that reads payments (EVM-056 AC7; the server decides all the same).
  const role = useSession().data?.user.role;
  const readsPayments = canReadPayments(role);
  // The upload of photos (EVM-044) lives with the page, so it goes on while another tab is shown; only Administrator and Editor upload.
  const media = useMediaUpload(id, active && (role === 'administrator' || role === 'editor'));
  const documents = useDocumentUpload(id);

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
    for (const query of [header, scope, procedures, payments, customer, site, siteOrders])
      if (query.isError && !isNotFound(query.error)) void query.refetch();
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

  // "+ 6 procesów" and the tile "Płatności" of the summary: the tab "Przegląd" is opened and the focus goes to the section of the
  // processes or of the payments (WCAG 2.4.3).
  const [showing, setShowing] = useState<{ readonly target: string; readonly count: number }>({ target: '', count: 0 });
  const show = (target: string) => {
    setTab(OVERVIEW_TAB);
    setShowing(({ count }) => ({ target, count: count + 1 }));
  };
  const showProcesses = () => {
    show(PROCEDURES_HEADING_ID);
  };
  const showPayments = () => {
    show(PAYMENTS_HEADING_ID);
  };
  useEffect(() => {
    if (showing.count === 0) return;
    // Focusing the heading brings it into view.
    document.getElementById(showing.target)?.focus();
  }, [showing]);

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
      <ClosedBanner order={order} />
      <MobileQuickBanner
        order={order}
        onEditSite={() => {
          setSiteEditSignal((count) => count + 1);
        }}
        onShowPayments={showPayments}
      />
      <OrderSummary
        query={procedures}
        onShowProcesses={showProcesses}
        {...(readsPayments ? { payments, onShowPayments: showPayments } : {})}
      />
      <MediaUnfinishedBanner
        media={media}
        onChoose={() => {
          setTab(MEDIA_TAB);
          media.openDialog();
        }}
      />
      <MediaUploadDialog media={media} workOrderId={id} />
      <div className="grid grid-cols-1 gap-stack-lg expanded:grid-cols-3">
        <div className="expanded:col-span-2">
          <Tabs
            label={t('workOrder.tabs.label')}
            tabs={[
              { id: OVERVIEW_TAB, label: t('workOrder.tabs.overview') },
              { id: JOURNAL_TAB, label: t('workOrder.tabs.journal') },
              { id: MEDIA_TAB, label: mediaText.tab },
            ]}
            selectedId={tab}
            onSelect={setTab}
          >
            {tab === JOURNAL_TAB ? (
              <JournalSection order={order} procedures={procedures} />
            ) : tab === MEDIA_TAB ? (
              <div className="flex flex-col gap-stack-lg">
                <MediaSection order={order} media={media} />
                <DocumentsSection order={order} upload={documents} />
                {order.site === null ? null : (
                  <AnchoredDocumentsSection
                    owner={{ anchor: 'site', id: order.site.id }}
                    queryKey={[WORK_ORDER_DOCUMENTS_KEY, id, 'site', order.site.id]}
                    enabled
                    sending={documents.items.some((item) => item.status !== 'done' && item.status !== 'failed')}
                  />
                )}
                {order.customer === null ? null : (
                  <AnchoredDocumentsSection
                    owner={{ anchor: 'customer', id: order.customer.id }}
                    queryKey={[WORK_ORDER_DOCUMENTS_KEY, id, 'customer', order.customer.id]}
                    enabled
                    sending={documents.items.some((item) => item.status !== 'done' && item.status !== 'failed')}
                  />
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-stack-lg">
                <ProceduresSection order={order} query={procedures} />
                <PaymentsSection order={order} query={payments} />
                <ScopeSection order={order} query={scope} procedures={procedures} />
              </div>
            )}
          </Tabs>
        </div>
        <aside className="flex flex-col gap-stack-md" aria-label={t('workOrder.sideLabel')}>
          <CustomerCard query={customer} customerId={order.customer?.id} />
          <SiteCard query={site} orders={siteOrders} workOrderId={id} editSignal={siteEditSignal} />
        </aside>
      </div>
    </div>
  );
}

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
