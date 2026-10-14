import type { WorkOrderPayment } from '@evia/contracts';
import { StatusBadge } from '@evia/ui-web';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatMoney } from './money.ts';

/**
 * The state of the column "Płatność" (EVM-056 AC1; ADR-0017 question 4 — the server chooses it: Po terminie > Nieopłacone >
 * Opłacone > none). `state` is an extensible list: a value this panel does not know — and an item without the field — is `unknown`
 * ("Nieznany status", P-12), never the raw value.
 */
type PaymentState = 'overdue' | 'unpaid' | 'paid' | 'none' | 'unknown';

function stateOf(payment: WorkOrderPayment | undefined): PaymentState {
  switch (payment?.state) {
    case 'overdue':
    case 'unpaid':
    case 'paid':
    case 'none':
      return payment.state;
    default:
      return 'unknown';
  }
}

/** The end of the name of the row (flows/07 → "Dostępność"): "płatność po terminie, 3 600,00 zł", "nieopłacone: 1, 4 500,00 zł"… */
export function paymentRowText(t: TFunction, payment: WorkOrderPayment | undefined): string {
  switch (stateOf(payment)) {
    case 'overdue':
      return t('workOrders.table.rowPaymentOverdue', { amount: formatMoney(payment?.overdueTotal.amountMinor ?? 0) });
    case 'unpaid':
      return t('workOrders.table.rowPaymentUnpaid', {
        count: payment?.invoicedCount ?? 0,
        amount: formatMoney(payment?.invoicedTotal.amountMinor ?? 0),
      });
    case 'paid':
      return t('workOrders.table.rowPaymentPaid');
    case 'none':
      return t('workOrders.table.rowPaymentNone');
    case 'unknown':
      return t('workOrders.table.rowPaymentUnknown');
  }
}

/**
 * The cell "Płatność" of W-10 (EVM-056 AC1; styleguide § 4.2, § 3.9): the strong badge "Po terminie" (`alarm-clock`) with the sum of
 * the instalments after their due date under it; the subtle "Nieopłacone (n)" with the sum of the invoiced ones; "Opłacone" without
 * an amount; "—" named "Brak wystawionych transz". The amounts are `text.numeric`; in the card (`compact`) the badge and the amount
 * stand side by side on the last line. The number of days after the due date is not here (W-06 only). Values are React text.
 */
export function PaymentCell({ payment }: { readonly payment: WorkOrderPayment | undefined }) {
  const { t } = useTranslation();
  const state = stateOf(payment);
  if (state === 'none') {
    // Like the other dashes of the list, the card (`compact`) leaves it out; the name of the row says "brak wystawionych transz".
    return (
      <span className="text-text-secondary max-medium:hidden">
        <span aria-hidden="true">{t('workOrders.waiting.dash')}</span>
        <span className="sr-only">{t('workOrders.payment.none')}</span>
      </span>
    );
  }
  const amount =
    state === 'overdue' ? payment?.overdueTotal.amountMinor : state === 'unpaid' ? payment?.invoicedTotal.amountMinor : undefined;
  const badge =
    state === 'overdue' ? (
      <StatusBadge status="overdue" group="payment" label={t('workOrders.status.paymentOverdue')} />
    ) : state === 'unpaid' ? (
      <StatusBadge status="invoiced" group="payment" label={t('workOrders.payment.unpaid', { count: payment?.invoicedCount ?? 0 })} />
    ) : state === 'paid' ? (
      <StatusBadge status="paid" group="payment" label={t('workOrders.payment.paid')} />
    ) : (
      <StatusBadge status="unknown" group="payment" label={t('workOrders.status.unknown')} hint={t('workOrders.status.unknownHint')} />
    );
  return (
    <span className="inline-flex flex-col items-end gap-stack-xs max-medium:flex-row max-medium:flex-wrap max-medium:items-center max-medium:gap-inline-sm">
      {badge}
      {amount === undefined ? null : <span className="tabular-nums whitespace-nowrap">{formatMoney(amount)}</span>}
    </span>
  );
}
