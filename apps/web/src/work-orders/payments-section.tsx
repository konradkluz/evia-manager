import type { PaymentMilestone, PaymentMilestoneList, WorkOrderDetails } from '@evia/contracts';
import {
  ActionMenu,
  Button,
  DataTable,
  EllipsisVertical,
  IconButton,
  Plus,
  StatusBadge,
  type DataTableColumn,
  type DataTableRow,
} from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { paymentStatusLabels } from '../i18n/payment-labels.ts';
import { useSession } from '../session/session.ts';
import { useOnline } from '../shell/use-online.ts';
import { useStateWord } from './edit-failure.ts';
import { MilestoneAddDialog } from './milestone-add-dialog.tsx';
import { MilestoneAmountDialog } from './milestone-amount-dialog.tsx';
import { MILESTONES_MAX, paymentBadgeKey, useMilestoneName } from './milestone-form.ts';
import { formatMoney } from './money.ts';
import { formatDueDate } from './procedure-format.ts';
import { SectionError, SectionLoading } from './section-states.tsx';
import { isClosed } from './transition-actions.ts';

/** The heading of the section (`#platnosci`): the target of the link "kwoty transz" of the banner of an order from the field (E13). */
export const PAYMENTS_HEADING_ID = 'platnosci';

type Dialog = { readonly kind: 'add' } | { readonly kind: 'amount'; readonly milestoneId: string };

/**
 * The section "Płatności" of W-06 (EVM-053 AC2–AC5, AC7, AC8; flows/03 and flows/08): the instalments of the order in a DataTable
 * (§ 3.6) — the name with the share of the plan, the amount (`text.numeric`, "3 600,00 zł"), the status (StatusBadge § 3.9), the
 * number of the invoice and the due date — and the totals "Nieopłacone … · Opłacone …" as the server counted them (the same policy
 * as the list, SR-AUTHZ-03). Administrator and Editor add an instalment ("Dodaj transzę") and change the amount of a planned one
 * (menu `⋮`); Tylko odczyt sees everything without actions (P6). The actions are disabled with a reason for a closed order (PO-8),
 * offline and at the limit of 20 — the server decides all the same. Names are free text: React text only (SR-WEB-03).
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

  const edited = dialog?.kind === 'amount' ? items?.find((entry) => entry.id === dialog.milestoneId) : undefined;
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
          <div ref={table} className="flex flex-col items-start gap-stack-sm">
            <MilestoneTable
              items={items}
              canEdit={canEdit}
              reason={reason}
              onChangeAmount={(milestoneId) => {
                setDialog({ kind: 'amount', milestoneId });
              }}
            />
            {addButton}
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
      {dialog?.kind === 'add' ? (
        <MilestoneAddDialog
          order={order}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={(saved) => {
            setDialog(null);
            setFocusId(saved.id);
          }}
        />
      ) : null}
      {edited === undefined ? null : (
        <MilestoneAmountDialog
          key={edited.id}
          order={order}
          milestone={edited}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={(saved) => {
            setDialog(null);
            setFocusId(saved.id);
          }}
        />
      )}
    </section>
  );
}

function MilestoneTable({
  items,
  canEdit,
  reason,
  onChangeAmount,
}: {
  readonly items: readonly PaymentMilestone[];
  readonly canEdit: boolean;
  readonly reason: string | undefined;
  readonly onChangeAmount: (milestoneId: string) => void;
}) {
  const { t } = useTranslation();
  const nameOf = useMilestoneName();
  const none = t('workOrder.payments.none');
  const columns: DataTableColumn[] = [
    { id: 'name', header: t('workOrder.payments.columnName'), card: 'primary' },
    { id: 'amount', header: t('workOrder.payments.columnAmount'), numeric: true, card: 'meta' },
    { id: 'status', header: t('workOrder.payments.columnStatus'), card: 'badge' },
    { id: 'invoice', header: t('workOrder.payments.columnInvoice'), card: 'detail' },
    { id: 'due', header: t('workOrder.payments.columnDue'), numeric: true, card: 'detail' },
    ...(canEdit ? [{ id: 'actions', header: t('workOrder.payments.columnActions'), card: 'detail' as const }] : []),
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
          label={key === 'overdue' ? t('workOrder.payments.overdueLabel') : paymentStatusLabels[milestone.status]}
        />
      );
    const cells: ReactNode[] = [
      <span key="name" className="break-words">
        {name}
      </span>,
      milestone.amount === null ? none : formatMoney(milestone.amount.amountMinor),
      badge,
      milestone.invoiceNumber ?? none,
      milestone.dueDate === null ? none : formatDueDate(milestone.dueDate),
    ];
    if (canEdit) {
      cells.push(
        // Only "Zmień kwotę…" of a planned instalment exists in this version; the other actions arrive with EVM-054 and EVM-057.
        milestone.status === 'planned' ? (
          <ActionMenu
            key="actions"
            label={t('workOrder.payments.menuLabel', { name })}
            items={[
              {
                id: 'amount',
                label: t('workOrder.payments.changeAmount'),
                onSelect: () => {
                  onChangeAmount(milestone.id);
                },
                ...(reason === undefined ? {} : { disabledHint: reason }),
              },
            ]}
            trigger={(props) => (
              <IconButton
                {...props}
                data-milestone={milestone.id}
                icon={EllipsisVertical}
                label={t('workOrder.payments.menuLabel', { name })}
              />
            )}
          />
        ) : null,
      );
    }
    return { id: milestone.id, cells };
  });
  return <DataTable caption={t('workOrder.payments.caption')} columns={columns} rows={rows} />;
}
