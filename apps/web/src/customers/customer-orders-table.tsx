import type { WorkOrderListItem, WorkOrderStatus } from '@evia/contracts';
import { DataTable, StatusBadge, type DataTableColumn, type DataTableRow, type OrderStatusKey } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { workOrderPath } from '../paths.ts';
import { RouterLink } from '../shell/router-link.tsx';
import { formatDate } from '../work-orders/format.ts';

const isKnown = (status: string): status is WorkOrderStatus => Object.hasOwn(workOrderStatusLabels, status);
const keyOf = (status: WorkOrderStatus): OrderStatusKey => status.replaceAll('_', '-') as OrderStatusKey;

/**
 * "Historia zleceń" of a customer (EVM-039 AC2): the number and the title, the status badge (a status this panel does not know
 * is the "Nieznany status" badge, never the raw code — P-12) and the date of creation; the whole row leads to W-06.
 */
export function CustomerOrdersTable({ items }: { readonly items: readonly WorkOrderListItem[] }) {
  const { t } = useTranslation();
  const columns: DataTableColumn[] = [
    { id: 'order', card: 'primary', header: t('customerPage.history.order') },
    { id: 'status', card: 'badge', header: t('customerPage.history.status') },
    { id: 'created', card: 'meta', header: t('customerPage.history.created'), numeric: true, sort: 'descending' },
  ];
  const rows: DataTableRow[] = items.map((item) => {
    const known = isKnown(item.status);
    const status = known ? workOrderStatusLabels[item.status] : t('workOrders.status.unknown');
    const created = formatDate(item.createdAt);
    return {
      id: item.id,
      href: workOrderPath(item.id),
      label: t('customerPage.history.row', {
        number: item.number,
        title: item.title,
        status: known ? status : t('workOrders.status.unknownName'),
        created,
      }),
      cells: [
        <span key="order" className="flex flex-col">
          <span className="font-semibold tabular-nums whitespace-nowrap">{item.number}</span>
          <span className="break-words text-text-secondary">{item.title}</span>
        </span>,
        known ? (
          <StatusBadge key="status" status={keyOf(item.status)} label={status} />
        ) : (
          <StatusBadge key="status" status="unknown" label={status} hint={t('workOrders.status.unknownHint')} />
        ),
        <span key="created" className="whitespace-nowrap">
          {created}
        </span>,
      ],
    };
  });
  return <DataTable caption={t('customerPage.history.caption')} columns={columns} rows={rows} link={RouterLink} />;
}
