import type { UnpaidSummary } from '@evia/contracts';
import { AlarmClock, Card, Skeleton } from '@evia/ui-web';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { workOrderPath } from '../paths.ts';
import { formatMoney } from '../work-orders/money.ts';
import { OrderLink, ORDER_LINK_CLASSES } from './order-link.tsx';
import { countText, daysText } from './unpaid-format.ts';

function Tile({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <Card labelledBy={id}>
      <h2 id={id} className="text-label text-text-secondary">
        {title}
      </h2>
      {children}
    </Card>
  );
}

/**
 * The tiles of sums of W-11 (EVM-055 AC3; Card § 3.8, `text.numeric-lg`): "Nieopłacone" (all the invoiced instalments), "Po terminie" and
 * "Najdłużej po terminie" (the days and the number of the order, a link to W-06). The server counts them under the same policy as the list
 * and independently of the filters (flows/08: the tiles do not change with the filters).
 */
export function UnpaidTiles({ summary }: { readonly summary: UnpaidSummary | undefined }) {
  const { t } = useTranslation();
  if (summary === undefined) {
    return (
      <div aria-busy="true" className="grid grid-cols-1 gap-inline-md medium:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Card key={index}>
            <Skeleton />
            <Skeleton shape="field" />
          </Card>
        ))}
      </div>
    );
  }
  const { unpaid, overdue, longestOverdue } = summary;
  return (
    <div className="grid grid-cols-1 gap-inline-md medium:grid-cols-3">
      <Tile title={t('payments.tiles.unpaid')}>
        <p className="text-numeric-lg tabular-nums text-text-primary">
          {t('payments.tiles.value', { counted: countText(t, unpaid.count), amount: formatMoney(unpaid.total.amountMinor) })}
        </p>
      </Tile>
      <Tile title={t('payments.tiles.overdue')}>
        <p className="flex items-center gap-inline-sm text-numeric-lg tabular-nums text-text-primary">
          <AlarmClock aria-hidden="true" className="size-icon-md shrink-0 text-icon-error" />
          {t('payments.tiles.value', { counted: String(overdue.count), amount: formatMoney(overdue.total.amountMinor) })}
        </p>
      </Tile>
      <Tile title={t('payments.tiles.longest')}>
        {longestOverdue === null ? (
          <p className="text-body text-text-secondary">{t('payments.tiles.longestNone')}</p>
        ) : (
          <p className="flex flex-wrap items-baseline gap-inline-xs text-numeric-lg tabular-nums text-text-primary">
            <span>{t('payments.tiles.longestValue', { days: daysText(t, longestOverdue.days) })}</span>
            <OrderLink href={workOrderPath(longestOverdue.workOrder.id)} className={ORDER_LINK_CLASSES}>
              {longestOverdue.workOrder.number}
            </OrderLink>
          </p>
        )}
      </Tile>
    </div>
  );
}
