import type { ActionMenuItem } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import type { MilestoneAction, MilestoneActions } from './milestone-actions.ts';

/** The labels of the actions of an instalment (flows/08 → "Akcje płatności"): the button of the row and the items of the menu `⋮`. */
export function useMilestoneActionLabels(): Readonly<Record<MilestoneAction, string>> {
  const { t } = useTranslation();
  return {
    invoice: t('workOrder.payments.invoice'),
    pay: t('workOrder.payments.pay'),
    amount: t('workOrder.payments.changeAmount'),
    cancel: t('workOrder.payments.cancel'),
    details: t('workOrder.payments.details'),
    paidOn: t('workOrder.payments.paidOn'),
    withdrawInvoice: t('workOrder.payments.withdrawInvoice'),
    cancelInvoice: t('workOrder.payments.cancelInvoice'),
    correctAmount: t('workOrder.payments.correctAmount'),
    undoPayment: t('workOrder.payments.undoPayment'),
    restore: t('workOrder.payments.restore'),
    delete: t('workOrder.payments.delete'),
  };
}

/** The items of the menu `⋮`: a separator before each new group, the cancellation as a destructive item, the reasons of § 4.13. */
export function menuItems(
  actions: MilestoneActions,
  labels: Readonly<Record<MilestoneAction, string>>,
  reason: string | undefined,
  adminOnly: string,
  onSelect: (action: MilestoneAction) => void,
): ActionMenuItem[] {
  return actions.menu.map((entry, index) => {
    const hint = reason ?? (entry.correction === true ? adminOnly : undefined);
    return {
      id: entry.action,
      label: labels[entry.action],
      onSelect: () => {
        onSelect(entry.action);
      },
      ...(index > 0 && entry.group !== actions.menu[index - 1]?.group ? { startsGroup: true } : {}),
      ...(entry.action === 'cancel' ? { tone: 'danger' as const } : {}),
      ...(hint === undefined ? {} : { disabledHint: hint }),
    };
  });
}
