import type { WorkOrderListItem, WorkOrderSort, WorkOrderStatus } from '@evia/contracts';
import { DataTable, StatusBadge, type DataTableColumn, type DataTableRow, type LinkComponent, type OrderStatusKey } from '@evia/ui-web';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { WORK_ORDERS_PATH, workOrderPath } from '../paths.ts';
import { formatDate } from './format.ts';
import { DueCell, dueRowText, WaitingCell, waitingRowText } from './waiting-cells.tsx';

/** Router link for the rows (typed paths of the panel; the details page W-06 arrives with EVM-018). */
const RowLink: LinkComponent = ({ href, children, ...rest }) => (
  <Link to={href as typeof WORK_ORDERS_PATH} {...rest}>
    {children}
  </Link>
);

const isKnown = (status: string): status is WorkOrderStatus => Object.hasOwn(workOrderStatusLabels, status);
/** The token key of a status: the model code in kebab-case (styleguide § 4.4). */
const keyOf = (status: WorkOrderStatus): OrderStatusKey => status.replaceAll('_', '-') as OrderStatusKey;

type SortedColumn = 'order' | 'created' | 'waiting' | 'due';

/** The column a sort order belongs to (it carries `aria-sort`, § 3.6). */
function sortedColumn(sort: WorkOrderSort): SortedColumn {
  switch (sort) {
    case 'number':
    case '-number':
      return 'order';
    case 'longestWaitingSince':
      return 'waiting';
    case 'nextDueDate':
      return 'due';
    default:
      return 'created';
  }
}

/**
 * The table of W-10 (EVM-017 AC1; EVM-034 AC1, AC4): "Zlecenie" (number and title), "Status" (badge; a value this panel does not
 * know is the "Nieznany status" badge — P-12, never the raw code), "Czekamy na" (the longest wait and "+n"), "Termin" (the nearest
 * due date, with `alarm-clock` when it has passed), "Opiekun" and "Utworzono"; the whole row leads to the details and carries the
 * full description as its name. The column the list is sorted by carries `aria-sort`. Texts are shown as React text only.
 */
export function WorkOrderTable({ items, sort }: { readonly items: readonly WorkOrderListItem[]; readonly sort: WorkOrderSort }) {
  const { t } = useTranslation();
  const direction: 'ascending' | 'descending' = sort.startsWith('-') ? 'descending' : 'ascending';
  const sorted = sortedColumn(sort);
  const markSort = (column: SortedColumn) => (sorted === column ? { sort: direction } : {});
  const columns: DataTableColumn[] = [
    { id: 'order', card: 'primary' as const, header: t('workOrders.table.order'), ...markSort('order') },
    { id: 'status', card: 'badge' as const, header: t('workOrders.table.status') },
    { id: 'waiting', card: 'detail' as const, header: t('workOrders.table.waiting'), ...markSort('waiting') },
    { id: 'due', card: 'detail' as const, header: t('workOrders.table.due'), ...markSort('due') },
    { id: 'coordinator', card: 'meta' as const, header: t('workOrders.table.coordinator') },
    {
      id: 'created',
      card: 'meta' as const,
      header: t('workOrders.table.created'),
      numeric: true,
      expandedOnly: true,
      ...markSort('created'),
    },
  ];
  const rows: DataTableRow[] = items.map((item) => {
    const known = isKnown(item.status);
    const status = known ? workOrderStatusLabels[item.status] : t('workOrders.status.unknown');
    const created = formatDate(item.createdAt);
    const coordinator = item.coordinator?.displayName ?? t('workOrders.table.noCoordinator');
    const description = t('workOrders.table.row', {
      number: item.number,
      title: item.title,
      status: known ? status : t('workOrders.status.unknownName'),
      coordinator,
      created,
    });
    // What the order waits for and the due date join the name of the row only when there is something to say.
    const extra = [waitingRowText(t, item.waiting), dueRowText(t, item)].filter((part) => part !== undefined);
    return {
      id: item.id,
      href: workOrderPath(item.id),
      label: [description, ...extra].join(', '),
      cells: [
        <span key="order" className="flex flex-col">
          <span className="font-semibold tabular-nums whitespace-nowrap">{item.number}</span>
          <span className="break-words text-text-secondary">{item.title}</span>
          {/* The column "Utworzono" is shown from `expanded`; on a tablet the date is the third line here (EVM-034, 768 px). */}
          <span className="expanded:hidden text-text-secondary">{t('workOrders.table.createdLine', { date: created })}</span>
        </span>,
        known ? (
          <StatusBadge key="status" status={keyOf(item.status)} label={status} />
        ) : (
          <StatusBadge key="status" status="unknown" label={status} hint={t('workOrders.status.unknownHint')} />
        ),
        <WaitingCell key="waiting" waiting={item.waiting} />,
        <DueCell key="due" item={item} />,
        <span
          key="coordinator"
          className={item.coordinator === null ? 'expanded:whitespace-nowrap text-text-secondary' : 'expanded:whitespace-nowrap'}
        >
          {coordinator}
        </span>,
        <span key="created" className="expanded:whitespace-nowrap">
          {created}
        </span>,
      ],
    };
  });
  return <DataTable caption={t('workOrders.table.caption')} columns={columns} rows={rows} link={RowLink} />;
}
