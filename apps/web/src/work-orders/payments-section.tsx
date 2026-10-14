import type { PaymentMilestone, PaymentMilestoneList, WorkOrderDetails } from '@evia/contracts';
import {
  ActionMenu,
  Button,
  DataTable,
  EllipsisVertical,
  IconButton,
  Plus,
  StatusBadge,
  type DataTableBadgeCell,
  type DataTableColumn,
  type DataTableRow,
} from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { paymentStatusLabels } from '../i18n/payment-labels.ts';
import { useSession } from '../session/session.ts';
import { useOnline } from '../shell/use-online.ts';
import { useStateWord } from './edit-failure.ts';
import { MilestoneAddDialog } from './milestone-add-dialog.tsx';
import { milestoneActions, type MilestoneAction } from './milestone-actions.ts';
import { MilestoneAmountDialog } from './milestone-amount-dialog.tsx';
import { MilestoneCancelDialog } from './milestone-cancel-dialog.tsx';
import { MilestoneDetailsDialog } from './milestone-details-dialog.tsx';
import { MILESTONES_MAX, paymentBadgeKey, useMilestoneName } from './milestone-form.ts';
import { menuItems, useMilestoneActionLabels } from './milestone-menu.ts';
import { MilestoneInvoiceDialog } from './milestone-invoice-dialog.tsx';
import { MilestonePaidOnDialog } from './milestone-paid-on-dialog.tsx';
import { MilestonePaymentDialog } from './milestone-payment-dialog.tsx';
import { formatMoney } from './money.ts';
import { formatDueDate } from './procedure-format.ts';
import { SectionError, SectionLoading } from './section-states.tsx';
import { isClosed } from './transition-actions.ts';

/** The heading of the section (`#platnosci`): the target of the link "kwoty transz" of the banner of an order from the field (E13). */
export const PAYMENTS_HEADING_ID = 'platnosci';

/** The dialogs a row opens (EVM-053: the amount; EVM-054: the invoice, the payment, the cancellation and the corrections of the data). */
type RowDialog = 'amount' | 'invoice' | 'pay' | 'cancel' | 'details' | 'paidOn';
// The instalment as the row showed it stays with the dialog: when a refresh drops it (gone, `404`), the dialog still says so.
type Dialog = { readonly kind: 'add' } | { readonly kind: RowDialog; readonly milestone: PaymentMilestone };

const ROW_DIALOGS: ReadonlySet<MilestoneAction> = new Set<MilestoneAction>(['amount', 'invoice', 'pay', 'cancel', 'details', 'paidOn']);
const isRowDialog = (action: MilestoneAction): action is RowDialog => ROW_DIALOGS.has(action);

/**
 * The section "Płatności" of W-06 (EVM-053 AC2–AC5, AC7, AC8; EVM-054 AC1–AC5, AC7, AC8; flows/03 and flows/08): the instalments of
 * the order in a DataTable (§ 3.6) — the name with the share of the plan, the amount (`text.numeric`, "3 600,00 zł"), the status
 * (StatusBadge § 3.9), the number of the invoice and the due date — and the totals "Nieopłacone … · Opłacone …" as the server
 * counted them (the same policy as the list, SR-AUTHZ-03). Administrator and Editor add an instalment ("Dodaj transzę") and run the
 * actions of the table of the mockup (`milestoneActions`): the button of the row ("Wystaw fakturę…", "Odnotuj wpłatę…") and the
 * menu `⋮`; the corrections of payments are disabled for the Editor and hidden for the Administrator until EVM-057; Tylko odczyt
 * sees everything without actions (P6). The actions are disabled with a reason for a closed order (PO-8), offline and at the limit
 * of 20 — the server decides all the same. Names are free text: React text only (SR-WEB-03).
 */
export function PaymentsSection({
  order,
  query,
}: {
  readonly order: WorkOrderDetails;
  readonly query: UseQueryResult<PaymentMilestoneList>;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const role = useSession().data?.user.role;
  const stateWord = useStateWord();
  const table = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const items = query.data?.items;
  const canEdit = role === 'administrator' || role === 'editor';
  const closed = isClosed(order.status);
  const state = stateWord(order.status);
  // A reason, in the order of § 4.13: the closed order first, then the connection, then (for adding) the limit.
  const reason = closed
    ? role === 'editor'
      ? t('workOrder.payments.closedHintEditor', { state })
      : t('workOrder.payments.closedHint', { state })
    : online
      ? undefined
      : t('workOrder.payments.offlineHint');
  const atLimit = items !== undefined && items.length >= MILESTONES_MAX;
  const addReason = reason ?? (atLimit ? t('workOrder.payments.limit', { max: MILESTONES_MAX }) : undefined);

  // After a save the focus goes to the menu of the instalment (flows/08 → "Fokus"), once the table shows it.
  useEffect(() => {
    if (focusId === null || items?.some((entry) => entry.id === focusId) !== true) return;
    table.current?.querySelector<HTMLElement>(`[data-milestone="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId, items]);

  const edited =
    dialog === null || dialog.kind === 'add' ? undefined : (items?.find((entry) => entry.id === dialog.milestone.id) ?? dialog.milestone);
  const close = () => {
    setDialog(null);
  };
  const saved = (milestone: PaymentMilestone) => {
    setDialog(null);
    setFocusId(milestone.id);
  };
  const addButton = canEdit ? (
    <Button
      variant="tertiary"
      icon={Plus}
      disabled={addReason !== undefined}
      {...(addReason === undefined ? {} : { title: addReason })}
      onClick={() => {
        setDialog({ kind: 'add' });
      }}
    >
      {t('workOrder.payments.add')}
    </Button>
  ) : null;

  return (
    <section aria-labelledby={PAYMENTS_HEADING_ID} className="flex flex-col gap-stack-md">
      <div className="flex flex-wrap items-baseline justify-between gap-inline-md">
        <h2 id={PAYMENTS_HEADING_ID} tabIndex={-1} className="text-heading-3 text-text-primary focus-visible:focus-ring">
          {t('workOrder.payments.title')}
        </h2>
        {query.data === undefined || query.data.items.length === 0 ? null : (
          <p className="text-body-sm text-text-secondary tabular-nums">
            {t('workOrder.payments.totals', {
              unpaid: formatMoney(query.data.totals.unpaid.amountMinor),
              paid: formatMoney(query.data.totals.paid.amountMinor),
            })}
          </p>
        )}
      </div>
      {items !== undefined ? (
        items.length === 0 ? (
          <div className="flex flex-wrap items-center gap-inline-md">
            <p className="text-body text-text-secondary">{t('workOrder.payments.empty')}</p>
            {addButton}
          </div>
        ) : (
          <div ref={table} className="flex min-w-0 flex-col gap-stack-sm">
            <MilestoneTable
              items={items}
              role={role}
              reason={reason}
              onAction={(action, milestone) => {
                if (isRowDialog(action)) setDialog({ kind: action, milestone });
              }}
            />
            {addButton === null ? null : <div className="self-start">{addButton}</div>}
          </div>
        )
      ) : query.isError ? (
        <SectionError
          message={t('workOrder.payments.error')}
          retryLabel={t('workOrder.payments.retry')}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <SectionLoading lines={3} />
      )}
      {dialog?.kind === 'add' ? <MilestoneAddDialog order={order} onClose={close} onSaved={saved} /> : null}
      {edited === undefined || dialog === null || dialog.kind === 'add' ? null : (
        <RowDialogOf
          key={`${dialog.kind}-${edited.id}`}
          kind={dialog.kind}
          order={order}
          milestone={edited}
          onClose={close}
          onSaved={saved}
        />
      )}
    </section>
  );
}

function RowDialogOf({
  kind,
  order,
  milestone,
  onClose,
  onSaved,
}: {
  readonly kind: RowDialog;
  readonly order: WorkOrderDetails;
  readonly milestone: PaymentMilestone;
  readonly onClose: () => void;
  readonly onSaved: (saved: PaymentMilestone) => void;
}) {
  const props = { order, milestone, onClose, onSaved };
  switch (kind) {
    case 'amount':
      return <MilestoneAmountDialog {...props} />;
    case 'invoice':
      return <MilestoneInvoiceDialog {...props} />;
    case 'pay':
      return <MilestonePaymentDialog {...props} />;
    case 'cancel':
      return <MilestoneCancelDialog {...props} />;
    case 'details':
      return <MilestoneDetailsDialog {...props} />;
    case 'paidOn':
      return <MilestonePaidOnDialog {...props} />;
  }
}

/**
 * The number of an invoice ("FV/TEST/0021/2026") with a place for a line break after each "/" (`<wbr>`): it has no spaces, so
 * whole it would widen its column past the column of the content of W-06. The text stays whole for reading and copying.
 */
function breakableInvoice(number: string): ReactNode {
  const parts = number.split('/');
  return (
    <span>
      {parts.map((part, index) => (
        // The parts of one number never move: the index is a stable key.
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? (
            <>
              {'/'}
              <wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </span>
  );
}

function MilestoneTable({
  items,
  role,
  reason,
  onAction,
}: {
  readonly items: readonly PaymentMilestone[];
  readonly role: string | undefined;
  readonly reason: string | undefined;
  readonly onAction: (action: MilestoneAction, milestone: PaymentMilestone) => void;
}) {
  const { t } = useTranslation();
  const nameOf = useMilestoneName();
  const none = t('workOrder.payments.none');
  const canEdit = role === 'administrator' || role === 'editor';
  const labels = useMilestoneActionLabels();
  const adminOnly = t('workOrder.payments.adminOnly');
  const columns: DataTableColumn[] = [
    { id: 'name', header: t('workOrder.payments.columnName'), card: 'primary' },
    { id: 'amount', header: t('workOrder.payments.columnAmount'), numeric: true, card: 'meta', cardLabel: true },
    { id: 'status', header: t('workOrder.payments.columnStatus'), card: 'badge' },
    { id: 'invoice', header: t('workOrder.payments.columnInvoice'), card: 'detail', cardLabel: true },
    { id: 'due', header: t('workOrder.payments.columnDue'), numeric: true, card: 'detail', cardLabel: true },
    // EVM-054: the button of the row stands under the status (the mockup of W-06), so the last column holds only the menu `⋮`
    // and the table fits the column of the content; in the card the button takes a full-width line (flows/08 → "Responsywność").
    ...(canEdit ? [{ id: 'actions', header: t('workOrder.payments.columnActions'), card: 'action' as const }] : []),
  ];
  const rows: DataTableRow[] = items.map((milestone) => {
    const name = nameOf(milestone);
    const key = paymentBadgeKey(milestone);
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
          label={key === 'overdue' ? t('workOrders.status.paymentOverdue') : paymentStatusLabels[milestone.status]}
        />
      );
    const actions = canEdit ? milestoneActions(milestone.status, role) : { menu: [] };
    const primary = actions.primary;
    const select = (action: MilestoneAction) => {
      onAction(action, milestone);
    };
    const status: DataTableBadgeCell =
      primary === undefined
        ? { badge }
        : {
            badge,
            action: (
              <Button
                variant="secondary"
                className="whitespace-nowrap max-medium:flex-1"
                disabled={reason !== undefined}
                {...(reason === undefined ? {} : { title: reason })}
                onClick={() => {
                  select(primary);
                }}
              >
                {labels[primary]}
              </Button>
            ),
          };
    const cells: (ReactNode | DataTableBadgeCell)[] = [
      <span key="name" className="break-words">
        {name}
      </span>,
      milestone.amount === null ? none : formatMoney(milestone.amount.amountMinor),
      status,
      milestone.invoiceNumber === null ? none : breakableInvoice(milestone.invoiceNumber),
      milestone.dueDate === null ? none : formatDueDate(milestone.dueDate),
    ];
    if (canEdit) {
      cells.push(
        actions.menu.length === 0 ? null : (
          <ActionMenu
            key="actions"
            align="end"
            label={t('workOrder.payments.menuLabel', { name })}
            items={menuItems(actions, labels, reason, adminOnly, select)}
            trigger={(props) => (
              <IconButton
                {...props}
                data-milestone={milestone.id}
                icon={EllipsisVertical}
                label={t('workOrder.payments.menuLabel', { name })}
              />
            )}
          />
        ),
      );
    }
    return {
      id: milestone.id,
      ...(key === 'overdue' ? { label: t('workOrder.payments.overdueRow', { name }) } : {}),
      cells,
    };
  });
  return <DataTable caption={t('workOrder.payments.caption')} dense columns={columns} rows={rows} />;
}
