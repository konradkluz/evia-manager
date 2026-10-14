import type { WorkOrderListItem, WorkOrderSort, WorkOrderStatus } from '@evia/contracts';
import { DataTable, StatusBadge, type DataTableColumn, type DataTableRow, type LinkComponent, type OrderStatusKey } from '@evia/ui-web';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { WORK_ORDERS_PATH, workOrderPath } from '../paths.ts';
import { formatSiteLine } from '../sites/format.ts';
import { formatDate } from './format.ts';
import { PaymentCell, paymentRowText } from './payment-cell.tsx';
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

/** The column a sort order belongs to (it carries `aria-sort`, § 3.6); "Najpilniejsze" is a composite order of no column (§ 4.2). */
function sortedColumn(sort: WorkOrderSort): SortedColumn | null {
  switch (sort) {
    case 'urgency':
      return null;
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

/** A dash for what an order does not have; the name says what is missing (the dash alone says nothing to a screen reader). */
function Missing({ label }: { readonly label: string }) {
  const { t } = useTranslation();
  return (
    <span className="text-text-secondary">
      <span aria-hidden="true">{t('workOrders.waiting.dash')}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The table of W-10 (EVM-017 AC1; EVM-034 AC1, AC4; EVM-072 AC1): "Zlecenie" (number and title), "Klient" (the name and, under it, the
 * city and street of the location; from `expanded` — below it both are lines of the first cell; "Klient usunięty" without a link or
 * any data when the customer is gone), "Lokalizacja" (from `wide`: then "Klient" has one line), "Status" (badge; a value this panel does not
 * know is the "Nieznany status" badge — P-12, never the raw code), "Czekamy na" (the longest wait and "+n"), "Termin" (the nearest
 * due date, with `alarm-clock` when it has passed), "Opiekun" and "Utworzono"; the whole row leads to the details and carries the
 * full description as its name. The column the list is sorted by carries `aria-sort`. Texts are shown as React text only.
 *
 * EVM-056 AC1: "Płatność" (after "Termin", on the right — § 4.2; the last line of the card) for a role that reads payments
 * (`payments`); the payment closes the name of the row. With "Najpilniejsze" no column carries `aria-sort`.
 */
export function WorkOrderTable({
  items,
  sort,
  payments,
}: {
  readonly items: readonly WorkOrderListItem[];
  readonly sort: WorkOrderSort;
  readonly payments: boolean;
}) {
  const { t } = useTranslation();
  const direction: 'ascending' | 'descending' = sort.startsWith('-') ? 'descending' : 'ascending';
  const sorted = sortedColumn(sort);
  const markSort = (column: SortedColumn) => (sorted === column ? { sort: direction } : {});
  const columns: DataTableColumn[] = [
    { id: 'order', card: 'primary' as const, header: t('workOrders.table.order'), ...markSort('order') },
    // "Klient" (with the location as its second line) from `expanded`, "Lokalizacja" on its own from `wide`; below `expanded` both are
    // lines of the first cell (EVM-072 AC1; flows/07 "Responsywność").
    { id: 'customer', header: t('workOrders.table.customer'), expandedOnly: true },
    { id: 'site', header: t('workOrders.table.location'), wideOnly: true },
    { id: 'status', card: 'badge' as const, header: t('workOrders.table.status') },
    { id: 'waiting', card: 'detail' as const, header: t('workOrders.table.waiting'), ...markSort('waiting') },
    { id: 'due', card: 'detail' as const, header: t('workOrders.table.due'), ...markSort('due') },
    ...(payments ? [{ id: 'payment', card: 'detail' as const, header: t('workOrders.table.payment'), align: 'end' as const }] : []),
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
    const customer = item.customer;
    const site = item.site;
    // "Klient usunięty" carries nothing else: no identifier, no name (TM-18); a `null` customer is an order without one.
    const customerText =
      customer === undefined || customer === null
        ? undefined
        : 'deleted' in customer
          ? t('workOrders.table.customerDeleted')
          : customer.displayName;
    const siteText = site === undefined || site === null ? undefined : formatSiteLine(site);
    const head = t('workOrders.table.rowHead', { number: item.number, title: item.title });
    const tail = t('workOrders.table.rowTail', {
      status: known ? status : t('workOrders.status.unknownName'),
      coordinator,
      created,
    });
    // What the order waits for and the due date join the name of the row only when there is something to say.
    const extra = [waitingRowText(t, item.waiting), dueRowText(t, item), payments ? paymentRowText(t, item.payment) : undefined].filter(
      (part) => part !== undefined,
    );
    const deleted = customer !== undefined && customer !== null && 'deleted' in customer;
    const customerLine = (
      <span className={deleted ? 'break-words text-text-secondary' : 'break-words'}>
        {customerText ?? <Missing label={t('workOrders.table.noCustomer')} />}
      </span>
    );
    return {
      id: item.id,
      href: workOrderPath(item.id),
      label: [head, customerText, siteText, tail, ...extra].filter((part) => part !== undefined).join(', '),
      cells: [
        <span key="order" className="flex flex-col">
          <span className="font-semibold tabular-nums whitespace-nowrap">{item.number}</span>
          <span className="break-words text-text-secondary">{item.title}</span>
          {/* Below `expanded` the customer and the location are lines of this cell (and of the card). */}
          {customerText === undefined && siteText === undefined ? null : (
            <span className="expanded:hidden flex flex-col">
              {customerText === undefined ? null : (
                <span className={deleted ? 'break-words text-text-secondary' : 'break-words'}>{customerText}</span>
              )}
              {siteText === undefined ? null : <span className="break-words text-text-secondary">{siteText}</span>}
            </span>
          )}
          {/* The column "Utworzono" is shown from `expanded`; on a tablet the date is the third line here (EVM-034, 768 px). */}
          <span className="expanded:hidden text-text-secondary">{t('workOrders.table.createdLine', { date: created })}</span>
        </span>,
        <span key="customer" className="flex flex-col">
          {customerLine}
          {/* On `wide` the location has a column of its own: no repetition here. */}
          {siteText === undefined ? null : <span className="wide:hidden break-words text-text-secondary">{siteText}</span>}
        </span>,
        <span key="site" className="flex flex-col break-words">
          {site === undefined || site === null ? (
            <Missing label={t('workOrders.table.noLocation')} />
          ) : (
            <>
              <span className="whitespace-nowrap">{`${site.street} ${site.buildingNumber}`}</span>
              <span className="text-text-secondary">{site.city}</span>
            </>
          )}
        </span>,
        known ? (
          <StatusBadge key="status" status={keyOf(item.status)} label={status} />
        ) : (
          <StatusBadge key="status" status="unknown" label={status} hint={t('workOrders.status.unknownHint')} />
        ),
        <WaitingCell key="waiting" waiting={item.waiting} />,
        <DueCell key="due" item={item} />,
        ...(payments ? [<PaymentCell key="payment" payment={item.payment} />] : []),
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
