import type { PaymentMilestoneList } from '@evia/contracts';
import { StatusBadge } from '@evia/ui-web';
import type { TFunction } from 'i18next';
import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { retryMinutes } from '../pages/login-failure.tsx';
import { formatMoney } from './money.ts';
import { PAYMENTS_HEADING_ID } from './payments-section.tsx';

/** "1 dzień" / "5 dni" (§ 6.3: only one is singular in Polish, every other number is "dni"). */
const daysText = (t: TFunction, count: number): string =>
  count === 1 ? t('workOrder.summary.paymentsDaysOne', { count }) : t('workOrder.summary.paymentsDaysMany', { count });

/** "1 transza", "2 transze", "5 transz" — the declension of § 6.3 (12–14 are "transz"). */
function instalmentsText(t: TFunction, count: number): string {
  const last = count % 10;
  const tens = count % 100;
  if (count === 1) return t('workOrder.summary.paymentsNameOne', { count });
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return t('workOrder.summary.paymentsNameFew', { count });
  return t('workOrder.summary.paymentsNameMany', { count });
}

/** The message of a failed read of the tile: `429` says how long to wait (README of the mockups); anything else is the tile's own. */
export function paymentsTileError(t: TFunction, error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return t('workOrders.error.rateLimited', { minutes: retryMinutes(error) });
  return t('workOrder.summary.paymentsError');
}

/**
 * The tile "Płatności" of the card "Podsumowanie" (EVM-056 AC4; flows/03 W-06 → "Karta podsumowania"): "Nieopłacone: 3 600,00 zł (1)"
 * (the server's sum of the invoiced instalments), the strong badge "Po terminie" with the days of the longest overdue instalment
 * (only when there is one — the days are the server's `overdueDays`, the panel never compares dates), "Planowane: n" and
 * "Opłacone: x z y" (y without the cancelled instalments — P3). An order without instalments: "Brak transz.". The whole tile is a
 * link to the section `#platnosci` with the full sentence as its name; following it opens the tab "Przegląd" (`onShow`).
 */
export function PaymentsTile({ list, onShow }: { readonly list: PaymentMilestoneList; readonly onShow: () => void }) {
  const { t } = useTranslation();
  const items = list.items;
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onShow();
  };
  const link = (name: string, content: ReactNode) => (
    <a
      href={`#${PAYMENTS_HEADING_ID}`}
      aria-label={name}
      onClick={follow}
      className="flex flex-col gap-stack-xs text-body text-text-primary after:absolute after:inset-0 focus-visible:outline-none"
    >
      {content}
    </a>
  );
  if (items.length === 0) {
    return link(
      t('workOrder.summary.paymentsNameEmpty'),
      <span className="text-text-secondary">{t('workOrder.summary.paymentsEmpty')}</span>,
    );
  }
  const invoiced = items.filter((entry) => entry.status === 'invoiced');
  const overdue = invoiced.filter((entry) => entry.isOverdue);
  const days = Math.max(0, ...overdue.map((entry) => entry.overdueDays ?? 0));
  const planned = items.filter((entry) => entry.status === 'planned').length;
  const counted = items.filter((entry) => entry.status !== 'cancelled').length;
  const paid = items.filter((entry) => entry.status === 'paid').length;
  const amount = formatMoney(list.totals.unpaid.amountMinor);
  const parts = [
    t('workOrder.summary.paymentsNameUnpaid', { amount }),
    invoiced.length === 0 ? undefined : instalmentsText(t, invoiced.length),
    overdue.length === 0
      ? undefined
      : days > 0
        ? t('workOrder.summary.paymentsNameOverdue', { days: daysText(t, days) })
        : t('workOrder.summary.paymentsNameOverdueNoDays'),
    t('workOrder.summary.paymentsNamePlanned', { count: planned }),
    t('workOrder.summary.paymentsNamePaid', { paid, total: counted }),
  ].filter((part) => part !== undefined);
  return link(
    t('workOrder.summary.paymentsName', { parts: parts.join(', ') }),
    <>
      <span className="tabular-nums">
        {invoiced.length === 0
          ? t('workOrder.summary.paymentsUnpaidNone', { amount })
          : t('workOrder.summary.paymentsUnpaid', { amount, count: invoiced.length })}
      </span>
      {overdue.length === 0 ? null : (
        <span className="flex flex-wrap items-center gap-inline-sm">
          <StatusBadge status="overdue" group="payment" label={t('workOrders.status.paymentOverdue')} />
          {days > 0 ? <span className="tabular-nums">{daysText(t, days)}</span> : null}
        </span>
      )}
      <span className="tabular-nums">{t('workOrder.summary.paymentsPlanned', { count: planned })}</span>
      <span className="tabular-nums">{t('workOrder.summary.paymentsPaid', { paid, total: counted })}</span>
    </>,
  );
}
