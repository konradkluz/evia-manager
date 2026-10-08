import type { WorkOrder, WorkOrderStatus } from '@evia/contracts';
import { Card, EmptyState, StatusBadge, ClipboardList, Button, type OrderStatusKey } from '@evia/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { formatAddress } from '../sites/format.ts';
import { formatDate } from '../work-orders/format.ts';
import { WORK_ORDER_HEADER_KEY } from '../work-orders/query-keys.ts';

const isKnown = (status: string): status is WorkOrderStatus => Object.hasOwn(workOrderStatusLabels, status);
const keyOf = (status: WorkOrderStatus): OrderStatusKey => status.replaceAll('_', '-') as OrderStatusKey;

/**
 * W-06 "Szczegóły zlecenia", the header only (EVM-022 AC1): number, title, status, customer, address of the site, coordinator
 * and the date of creation of the order that was just created. The header comes from the answer of the creation, kept in
 * the memory of the tab; the cards and the scope of W-06 (and the read of an order by its address) come with EVM-018 — until
 * then an address opened without that answer says so, honestly, and leads back to the list. Texts are shown as React text only.
 */
export function WorkOrderPage() {
  const { workOrderId } = useParams({ strict: false });
  const header = useQuery<WorkOrder>({
    queryKey: [WORK_ORDER_HEADER_KEY, workOrderId],
    queryFn: (): Promise<WorkOrder> => Promise.reject(new Error('the header is only read from the memory of the tab')),
    enabled: false,
    staleTime: Infinity,
  });
  return header.data === undefined ? <Unavailable /> : <Header order={header.data} />;
}

function Unavailable() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('workOrder.unavailable.pageTitle'));
  return (
    <EmptyState
      icon={ClipboardList}
      headingLevel={1}
      title={t('workOrder.unavailable.title')}
      description={t('workOrder.unavailable.description')}
      action={
        <Button
          onClick={() => {
            void navigate({ to: WORK_ORDERS_PATH });
          }}
        >
          {t('workOrder.unavailable.action')}
        </Button>
      }
    />
  );
}

function Header({ order }: { readonly order: WorkOrder }) {
  const { t } = useTranslation();
  usePageTitle(t('workOrder.pageTitle', { number: order.number }));
  const known = isKnown(order.status);
  const rows: ReadonlyArray<readonly [string, string]> = [
    [t('workOrder.header.customer'), order.customer.displayName],
    [t('workOrder.header.site'), formatAddress(order.site)],
    [t('workOrder.header.coordinator'), order.coordinator.displayName],
    [t('workOrder.header.created'), formatDate(order.createdAt)],
  ];
  return (
    <div className="flex max-w-form-max-width flex-col gap-stack-lg">
      <header className="flex flex-col gap-stack-sm">
        <h1 className="font-display text-heading-1 text-text-primary">{order.number}</h1>
        <p className="break-words text-heading-4 text-text-primary">{order.title}</p>
        {known ? (
          <StatusBadge status={keyOf(order.status)} label={workOrderStatusLabels[order.status]} />
        ) : (
          <StatusBadge status="unknown" label={t('workOrders.status.unknown')} hint={t('workOrders.status.unknownHint')} />
        )}
      </header>
      <Card>
        <dl className="grid grid-cols-1 gap-x-inline-md gap-y-stack-sm medium:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-stack-xs">
              <dt className="text-label text-text-secondary">{label}</dt>
              <dd className="break-words text-body text-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
