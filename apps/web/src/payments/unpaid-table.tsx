import type { UnpaidPaymentMilestone } from '@evia/contracts';
import {
  ActionMenu,
  AlarmClock,
  Button,
  DataTable,
  EllipsisVertical,
  IconButton,
  StatusBadge,
  type DataTableBadgeCell,
  type DataTableColumn,
  type DataTableRow,
} from '@evia/ui-web';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { paymentStatusLabels } from '../i18n/payment-labels.ts';
import { workOrderPath } from '../paths.ts';
import { milestoneActions, type MilestoneAction } from '../work-orders/milestone-actions.ts';
import { paymentBadgeKey } from '../work-orders/milestone-form.ts';
import { menuItems, useMilestoneActionLabels } from '../work-orders/milestone-menu.ts';
import { formatMoney } from '../work-orders/money.ts';
import { formatDueDate } from '../work-orders/procedure-format.ts';
import { OrderLink, ORDER_LINK_CLASSES } from './order-link.tsx';
import { daysText, overdueName } from './unpaid-format.ts';

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
 * The table of W-11 (EVM-055 AC1, AC2, AC5; flows/08; DataTable § 3.6): "Termin", "Dni po terminie" (the number of days with
 * `alarm-clock` in `color.text.error`, "—" for an instalment not yet overdue), "Zlecenie" (the number is the link to W-06, the title
 * under it; from below `expanded` the customer and the invoice are lines of this cell), "Klient", "Transza", "Nr faktury", "Kwota"
 * (`text.numeric`, to the right) and "Status" (StatusBadge: "Po terminie" with the icon, or "Wystawiona" without a mark; the full
 * name "Wystawiona, po terminie od N dni" is in the name of the row). Administrator and Editor get "Odnotuj wpłatę" under the status
 * and the menu `⋮` (the same items as in W-06: "Popraw dane faktury…", the corrections disabled for the Editor and not shown to the
 * Administrator until EVM-057); Tylko odczyt sees neither (P6). Names, titles and numbers are free text: React text only (SR-WEB-03).
 */
export function UnpaidTable({
  items,
  role,
  online,
  onAction,
}: {
  readonly items: readonly UnpaidPaymentMilestone[];
  readonly role: string | undefined;
  readonly online: boolean;
  readonly onAction: (action: MilestoneAction, item: UnpaidPaymentMilestone) => void;
}) {
  const { t } = useTranslation();
  const labels = useMilestoneActionLabels();
  const canEdit = role === 'administrator' || role === 'editor';
  const reason = online ? undefined : t('workOrder.payments.offlineHint');
  const adminOnly = t('workOrder.payments.adminOnly');
  const columns: DataTableColumn[] = [
    { id: 'due', header: t('payments.columns.due'), numeric: true, sort: 'ascending', card: 'detail', cardLabel: true },
    { id: 'days', header: t('payments.columns.days'), numeric: true, card: 'detail', cardLabel: true },
    { id: 'order', header: t('payments.columns.order'), card: 'primary' },
    { id: 'customer', header: t('payments.columns.customer'), expandedOnly: true },
    { id: 'milestone', header: t('payments.columns.milestone'), card: 'detail', cardLabel: true },
    { id: 'invoice', header: t('payments.columns.invoice'), expandedOnly: true },
    { id: 'amount', header: t('payments.columns.amount'), numeric: true, card: 'meta' },
    { id: 'status', header: t('payments.columns.status'), card: 'badge' },
  ];
  const rows: DataTableRow[] = items.map((item) => {
    // "Klient usunięty" carries nothing else (no identifier, no name — TM-18); no customer on the order is a plain "Brak klienta".
    const deleted = item.customer !== null && 'deleted' in item.customer;
    const customerText =
      item.customer === null ? undefined : 'deleted' in item.customer ? t('payments.row.customerDeleted') : item.customer.displayName;
    const days = item.overdueDays;
    const key = paymentBadgeKey(item);
    const statusName = days === null ? paymentStatusLabels[item.status] : overdueName(t, days);
    const badge =
      key === undefined ? (
        <StatusBadge
          key="status"
          status="unknown"
          group="payment"
          label={t('workOrders.status.unknown')}
          hint={t('workOrders.status.unknownHint')}
        />
      ) : (
        <StatusBadge
          key="status"
          status={key}
          group="payment"
          label={key === 'overdue' ? t('workOrders.status.paymentOverdue') : paymentStatusLabels[item.status]}
        />
      );
    const actions = canEdit ? milestoneActions(item.status, role) : { menu: [] };
    const select = (action: MilestoneAction) => {
      onAction(action, item);
    };
    const menuLabel = t('payments.row.menuLabel', { name: item.name, number: item.workOrder.number });
    // The button and the menu `⋮` stand together under the status: the table keeps its width down to `breakpoint.medium`, and in the
    // card they are one full-width line (the button stretches, the menu stays at its side).
    const menu =
      actions.menu.length === 0 ? null : (
        <ActionMenu
          align="end"
          label={menuLabel}
          items={menuItems(actions, labels, reason, adminOnly, select)}
          trigger={(props) => <IconButton {...props} data-milestone={item.id} icon={EllipsisVertical} label={menuLabel} />}
        />
      );
    const status: DataTableBadgeCell =
      actions.primary === undefined
        ? { badge }
        : {
            badge,
            action: (
              <div className="flex w-full items-center gap-inline-xs">
                <Button
                  variant="secondary"
                  className="whitespace-nowrap max-medium:flex-1"
                  aria-label={t('payments.row.payLabel', { name: item.name, number: item.workOrder.number })}
                  disabled={!online}
                  {...(reason === undefined ? {} : { title: reason })}
                  onClick={() => {
                    select('pay');
                  }}
                >
                  {t('payments.row.pay')}
                </Button>
                {menu}
              </div>
            ),
          };
    const cells: (ReactNode | DataTableBadgeCell)[] = [
      formatDueDate(item.dueDate),
      days === null ? (
        <Missing key="days" label={t('payments.row.notOverdue')} />
      ) : (
        <span key="days" className="inline-flex items-center gap-inline-xs text-text-error">
          <AlarmClock aria-hidden="true" className="size-icon-sm shrink-0" />
          {daysText(t, days)}
        </span>
      ),
      <span key="order" className="flex flex-col">
        <OrderLink href={workOrderPath(item.workOrder.id)} className={`${ORDER_LINK_CLASSES} font-semibold tabular-nums whitespace-nowrap`}>
          {item.workOrder.number}
        </OrderLink>
        <span className="break-words text-text-secondary">{item.workOrder.title}</span>
        {/* Below `expanded` the customer and the invoice are lines of this cell (and of the card). */}
        <span className="expanded:hidden flex flex-col text-text-secondary">
          <span className="break-words">{customerText ?? t('payments.row.noCustomer')}</span>
          <span className="break-words tabular-nums">{t('payments.row.invoiceLine', { number: item.invoiceNumber })}</span>
        </span>
      </span>,
      <span key="customer" className={deleted ? 'break-words text-text-secondary' : 'break-words'}>
        {customerText ?? <Missing label={t('payments.row.noCustomer')} />}
      </span>,
      <span key="milestone" className="break-words">
        {item.name}
      </span>,
      <span key="invoice" className="break-words tabular-nums">
        {item.invoiceNumber}
      </span>,
      formatMoney(item.amount.amountMinor),
      status,
    ];
    return {
      id: item.id,
      label: t('payments.row.label', {
        number: item.workOrder.number,
        title: item.workOrder.title,
        milestone: item.name,
        status: statusName,
      }),
      cells,
    };
  });
  return <DataTable caption={t('payments.list.caption')} dense columns={columns} rows={rows} />;
}
