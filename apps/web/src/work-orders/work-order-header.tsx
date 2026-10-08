import type { WorkOrderDetails, WorkOrderStatus } from '@evia/contracts';
import { Card, StatusBadge, type OrderStatusKey } from '@evia/ui-web';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { formatAddress, formatSpot } from '../sites/format.ts';
import { formatDate } from './format.ts';

const isKnown = (status: string): status is WorkOrderStatus => Object.hasOwn(workOrderStatusLabels, status);
const keyOf = (status: WorkOrderStatus): OrderStatusKey => status.replaceAll('_', '-') as OrderStatusKey;

/**
 * The header of W-06 (EVM-018 AC1): the number as the page heading (`h1`, focused when the page opens — WCAG 2.4.3), the title,
 * the static status badge (P-12 for a status this panel does not know), the customer, the address with the spot and the level,
 * the keeper and the date of creation. All of it is React text; a customer, a site or a keeper that is gone is "Brak danych".
 * The menu of transitions (EVM-030) and "Edytuj dane zlecenia" (EVM-071) are not shown: the UI shows only what the system does.
 */
export function WorkOrderHeader({ order, headingRef }: { readonly order: WorkOrderDetails; readonly headingRef: Ref<HTMLHeadingElement> }) {
  const { t } = useTranslation();
  const spot = order.site === null ? undefined : formatSpot(t, order.site);
  const address = order.site === null ? null : spot === undefined ? formatAddress(order.site) : `${formatAddress(order.site)} · ${spot}`;
  const missing = t('workOrder.header.missing');
  const rows: ReadonlyArray<readonly [string, string]> = [
    [t('workOrder.header.customer'), order.customer?.displayName ?? missing],
    [t('workOrder.header.site'), address ?? missing],
    [t('workOrder.header.coordinator'), order.coordinator?.displayName ?? missing],
    [t('workOrder.header.created'), formatDate(order.createdAt)],
  ];
  return (
    <header className="flex flex-col gap-stack-sm">
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-heading-1 text-text-primary focus-visible:focus-ring">
        {order.number}
      </h1>
      <p className="break-words text-heading-4 text-text-primary">{order.title}</p>
      <div>
        {isKnown(order.status) ? (
          <StatusBadge status={keyOf(order.status)} label={workOrderStatusLabels[order.status]} />
        ) : (
          <StatusBadge status="unknown" label={t('workOrders.status.unknown')} hint={t('workOrders.status.unknownHint')} />
        )}
      </div>
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
    </header>
  );
}
