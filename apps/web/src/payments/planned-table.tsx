import type { PlannedPaymentMilestone } from '@evia/contracts';
import { Button, DataTable, StatusBadge, type DataTableBadgeCell, type DataTableColumn, type DataTableRow } from '@evia/ui-web';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { paymentStatusLabels } from '../i18n/payment-labels.ts';
import { workOrderPath } from '../paths.ts';
import { formatMoney } from '../work-orders/money.ts';
import { OrderLink, ORDER_LINK_CLASSES } from './order-link.tsx';

/** A dash for what the row does not have; the name says what is missing (a dash alone says nothing to a screen reader). */
function Missing({ label }: { readonly label: string }) {
  const { t } = useTranslation();
  return (
    <span className="text-text-secondary">
      <span aria-hidden="true">{t('payments.row.dash')}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The table of the view "Do wystawienia" of W-11 (EVM-059 AC1, AC2, AC4; DataTable § 3.6): the order (the number is the link to W-06),
 * "Klient", "Transza", "Udział" (of the plan, "—" for an instalment added by hand), "Kwota" ("—" while none is set) and the status
 * "Planowana" with "Wystaw fakturę…" (the dialog of EVM-054) for Administrator and Editor; Tylko odczyt sees the rows without it.
 * The rows keep the order of the server (by the order, then by the instalment). Names and titles are free text: React text only.
 */
export function PlannedTable({
  items,
  canEdit,
  online,
  onInvoice,
}: {
  readonly items: readonly PlannedPaymentMilestone[];
  readonly canEdit: boolean;
  readonly online: boolean;
  readonly onInvoice: (item: PlannedPaymentMilestone) => void;
}) {
  const { t } = useTranslation();
  const reason = online ? undefined : t('workOrder.payments.offlineHint');
  const columns: DataTableColumn[] = [
    { id: 'order', header: t('payments.columns.order'), card: 'primary' },
    { id: 'customer', header: t('payments.columns.customer'), expandedOnly: true },
    { id: 'milestone', header: t('payments.columns.milestone'), card: 'detail', cardLabel: true },
    { id: 'share', header: t('payments.columns.share'), numeric: true, card: 'detail', cardLabel: true },
    { id: 'amount', header: t('payments.columns.amount'), numeric: true, card: 'meta' },
    { id: 'status', header: t('payments.columns.status'), card: 'badge' },
  ];
  const rows: DataTableRow[] = items.map((item) => {
    // "Klient usunięty" carries nothing else (TM-18); no customer on the order is a plain "Brak klienta".
    const deleted = item.customer !== null && 'deleted' in item.customer;
    const customerText =
      item.customer === null ? undefined : 'deleted' in item.customer ? t('payments.row.customerDeleted') : item.customer.displayName;
    const badge = <StatusBadge key="status" status="planned" group="payment" label={paymentStatusLabels.planned} />;
    const status: DataTableBadgeCell = canEdit
      ? {
          badge,
          action: (
            <Button
              variant="secondary"
              className="whitespace-nowrap max-medium:flex-1"
              aria-label={t('payments.row.invoiceLabel', { name: item.name, number: item.workOrder.number })}
              disabled={!online}
              {...(reason === undefined ? {} : { title: reason })}
              onClick={() => {
                onInvoice(item);
              }}
            >
              {t('payments.row.invoice')}
            </Button>
          ),
        }
      : { badge };
    const cells: (ReactNode | DataTableBadgeCell)[] = [
      <span key="order" className="flex flex-col">
        <OrderLink href={workOrderPath(item.workOrder.id)} className={`${ORDER_LINK_CLASSES} font-semibold tabular-nums whitespace-nowrap`}>
          {item.workOrder.number}
        </OrderLink>
        <span className="break-words text-text-secondary">{item.workOrder.title}</span>
        {/* Below `expanded` the customer is a line of this cell (and of the card). */}
        <span className="expanded:hidden break-words text-text-secondary">{customerText ?? t('payments.row.noCustomer')}</span>
      </span>,
      <span key="customer" className={deleted ? 'break-words text-text-secondary' : 'break-words'}>
        {customerText ?? <Missing label={t('payments.row.noCustomer')} />}
      </span>,
      <span key="milestone" className="break-words">
        {item.name}
      </span>,
      item.sharePercent === null ? (
        <Missing key="share" label={t('payments.row.noShare')} />
      ) : (
        t('payments.row.share', { share: item.sharePercent })
      ),
      item.amount === null ? <Missing key="amount" label={t('payments.row.noAmount')} /> : formatMoney(item.amount.amountMinor),
      status,
    ];
    return {
      id: item.id,
      label: t('payments.row.plannedLabel', { number: item.workOrder.number, title: item.workOrder.title, milestone: item.name }),
      cells,
    };
  });
  return <DataTable caption={t('payments.list.captionPlanned')} dense columns={columns} rows={rows} />;
}
