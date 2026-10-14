import type { PaymentMilestone } from '@evia/contracts';
import { AlertDialog, Banner, Button, DateField, WifiOff } from '@evia/ui-web';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { serverNow } from '../session/server-clock.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import {
  CommandAlert,
  DAY_MIN,
  daysBetween,
  isDayInRange,
  useFieldMessage,
  useMilestoneCommand,
  type MilestoneOrder,
  type OpenedMilestone,
} from './milestone-command.tsx';
import { formatMoney } from './money.ts';
import { formatDueDate } from './procedure-format.ts';
import { todayWarsaw } from './transition-actions.ts';

/**
 * "Odnotować wpłatę za transzę „…”?" (EVM-054 AC2; the mockup of W-11, dialog 2 of "UX / UI"): a dialog with a summary (§ 4.11) —
 * the order, the invoice with its amount, the due date (with the days after it) and the day of the payment (today by default, "Nie
 * później niż dziś."). The only field has a default, so the focus starts on "Anuluj" (§ 4.11). A day in the future is refused before
 * sending and by the server (`422 transition_condition_not_met`, `/paidOn`) with the same message under the field (Q3e). The toast
 * has no "Cofnij": only the Administrator undoes a payment (EVM-057).
 */
export function MilestonePaymentDialog({
  order,
  milestone,
  onClose,
  onSaved,
}: {
  readonly order: MilestoneOrder;
  readonly milestone: OpenedMilestone;
  readonly onClose: () => void;
  readonly onSaved: (saved: PaymentMilestone) => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const showToast = useToast();
  const message = useFieldMessage();
  const [opened] = useState(milestone);
  const [today] = useState(() => todayWarsaw(serverNow()));
  const [paidOn, setPaidOn] = useState(today);
  const command = useMilestoneCommand(order, opened);
  const error = command.fieldErrors.paidOn;

  const submit = () => {
    if (!online) return;
    let problem: string | undefined;
    if (!isDayInRange(paidOn)) problem = message('paidOn', 'out_of_range');
    else if (paidOn > today) problem = message('paidOn', 'in_future');
    command.setFieldErrors(problem === undefined ? {} : { paidOn: problem });
    if (problem !== undefined) return;
    command.run({ kind: 'transition', body: { to: 'paid', paidOn } }, (saved) => {
      showToast(
        t('workOrder.milestoneDialog.paid', {
          amount: saved.amount === null ? '' : formatMoney(saved.amount.amountMinor),
          number: saved.invoiceNumber ?? '',
        }),
      );
      onSaved(saved);
    });
  };

  const due = opened.dueDate;
  const overdue = due !== null && due < today ? daysBetween(due, today) : 0;
  const dueText =
    due === null
      ? undefined
      : overdue > 0
        ? t('workOrder.milestoneDialog.paymentDueOverdue', {
            date: formatDueDate(due),
            days:
              overdue === 1
                ? t('workOrder.milestoneDialog.overdueOne', { count: overdue })
                : t('workOrder.milestoneDialog.overdueMany', { count: overdue }),
          })
        : t('workOrder.milestoneDialog.paymentDue', { date: formatDueDate(due) });

  return (
    <AlertDialog
      open
      title={t('workOrder.milestoneDialog.paymentTitle', { name: opened.name })}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus onClick={onClose}>
            {t('workOrder.milestoneDialog.cancel')}
          </Button>
          <Button
            loading={command.pending}
            disabled={!online}
            {...(online ? {} : { title: t('workOrder.milestoneDialog.offline') })}
            onClick={submit}
          >
            {t('workOrder.milestoneDialog.paymentSubmit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-stack-xs text-body-sm text-text-secondary tabular-nums">
        <p>{t('workOrder.milestoneDialog.subtitle', { number: order.number, title: order.title })}</p>
        <p>
          {t('workOrder.milestoneDialog.paymentInvoice', {
            number: opened.invoiceNumber ?? t('workOrder.milestoneDialog.summaryNone'),
            amount: opened.amount === null ? t('workOrder.milestoneDialog.summaryNone') : formatMoney(opened.amount.amountMinor),
          })}
        </p>
        {dueText === undefined ? null : <p>{dueText}</p>}
      </div>
      {online ? null : <Banner icon={WifiOff}>{t('workOrder.milestoneDialog.offline')}</Banner>}
      <CommandAlert
        failure={command.failure}
        orderStatus={order.status}
        onRefresh={() => {
          if (!command.adopt()) onClose();
        }}
      />
      <DateField
        label={t('workOrder.milestoneDialog.paidOn')}
        value={paidOn}
        min={DAY_MIN}
        max={today}
        hint={t('workOrder.milestoneDialog.paidOnHint')}
        {...(error === undefined ? {} : { error })}
        onChange={(value) => {
          setPaidOn(value);
          command.setFieldErrors({});
        }}
      />
      <p>{t('workOrder.milestoneDialog.paymentEffect')}</p>
    </AlertDialog>
  );
}
