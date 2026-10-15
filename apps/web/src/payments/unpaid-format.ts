import type { TFunction } from 'i18next';
import { pluralForm } from '../work-orders/order-form.ts';

/** "12 transz", "1 transza", "3 transze" — the Polish form of the count (styleguide § 6.3). */
export function countText(t: TFunction, count: number): string {
  switch (pluralForm(count)) {
    case 'one':
      return t('payments.count.one', { count });
    case 'few':
      return t('payments.count.few', { count });
    case 'many':
      return t('payments.count.many', { count });
  }
}

/** "1 dzień", "5 dni". */
export const daysText = (t: TFunction, days: number): string =>
  days === 1 ? t('payments.days.one', { count: days }) : t('payments.days.many', { count: days });

/** The accessible name of "Po terminie": "Wystawiona, po terminie od 5 dni" (the visible label stays "Po terminie", styleguide § 4.4). */
export const overdueName = (t: TFunction, days: number): string =>
  days === 1 ? t('payments.overdueName.one', { count: days }) : t('payments.overdueName.many', { count: days });
