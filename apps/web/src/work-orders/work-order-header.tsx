import type { WorkOrderDetails } from '@evia/contracts';
import { Card } from '@evia/ui-web';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAddress, formatSpot } from '../sites/format.ts';
import { formatDate } from './format.ts';
import { StatusTransitions } from './status-transitions.tsx';

/**
 * The header of W-06 (EVM-018 AC1): the number as the page heading (`h1`, focused when the page opens — WCAG 2.4.3), the title,
 * the status badge (a button with the menu of transitions for the Administrator and the Editor — EVM-030; static for Tylko
 * odczyt and P-12 for a status this panel does not know), the customer, the address with the spot and the level, the keeper
 * and the date of creation. All of it is React text; a customer, a site or a keeper that is gone is "Brak danych".
 * "Edytuj dane zlecenia" (EVM-071) is not shown: the UI shows only what the system does.
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
      <h1 ref={headingRef} tabIndex={-1} className="self-start font-display text-heading-1 text-text-primary focus-visible:focus-ring">
        {order.number}
      </h1>
      <p className="break-words text-heading-4 text-text-primary">{order.title}</p>
      <StatusTransitions order={order} />
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
