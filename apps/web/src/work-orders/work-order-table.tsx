import type { WorkOrderListItem, WorkOrderSort, WorkOrderStatus } from '@evia/contracts';
import { DataTable, StatusBadge, type DataTableColumn, type DataTableRow, type LinkComponent, type OrderStatusKey } from '@evia/ui-web';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { WORK_ORDERS_PATH, workOrderPath } from '../paths.ts';
import { formatDate } from './format.ts';

/** Router link for the rows (typed paths of the panel; the details page W-06 arrives with EVM-018). */
const RowLink: LinkComponent = ({ href, children, ...rest }) => (
  <Link to={href as typeof WORK_ORDERS_PATH} {...rest}>
    {children}
  </Link>
);

const isKnown = (status: string): status is WorkOrderStatus => Object.hasOwn(workOrderStatusLabels, status);
/** The token key of a status: the model code in kebab-case (styleguide § 4.4). */
const keyOf = (status: WorkOrderStatus): OrderStatusKey => status.replaceAll('_', '-') as OrderStatusKey;

/**
 * The table of W-10 (EVM-017 AC1): "Zlecenie" (number and title), "Status" (badge; a value this panel does not know is
 * the "Nieznany status" badge — P-12, never the raw code), "Opiekun" and "Utworzono"; the whole row leads to the details
 * and carries the full description as its name. Texts are shown as React text only.
 */
export function WorkOrderTable({ items, sort }: { readonly items: readonly WorkOrderListItem[]; readonly sort: WorkOrderSort }) {
  const { t } = useTranslation();
  const direction = sort.startsWith('-') ? 'descending' : 'ascending';
  const byNumber = sort === 'number' || sort === '-number';
  const columns: DataTableColumn[] = [
    { id: 'order', header: t('workOrders.table.order'), ...(byNumber ? { sort: direction } : {}) },
    { id: 'status', header: t('workOrders.table.status') },
    { id: 'coordinator', header: t('workOrders.table.coordinator') },
    { id: 'created', header: t('workOrders.table.created'), numeric: true, ...(byNumber ? {} : { sort: direction }) },
  ];
  const rows: DataTableRow[] = items.map((item) => {
    const known = isKnown(item.status);
    const status = known ? workOrderStatusLabels[item.status] : t('workOrders.status.unknown');
    const created = formatDate(item.createdAt);
    const coordinator = item.coordinator?.displayName ?? t('workOrders.table.noCoordinator');
    return {
      id: item.id,
      href: workOrderPath(item.id),
      label: t('workOrders.table.row', {
        number: item.number,
        title: item.title,
        status: known ? status : t('workOrders.status.unknownName'),
        coordinator,
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
        <span key="coordinator" className={item.coordinator === null ? 'text-text-secondary' : undefined}>
          {coordinator}
        </span>,
        created,
      ],
    };
  });
  return <DataTable caption={t('workOrders.table.caption')} columns={columns} rows={rows} link={RowLink} />;
}
