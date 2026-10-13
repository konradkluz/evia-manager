import type { TFunction } from 'i18next';
import { LONG_WAIT_DAYS } from './stage-transitions.ts';

/**
 * "od dziś", "od wczoraj", "od 15 dni" (styleguide § 4.4): the days are counted by the server (full calendar days in
 * `Europe/Warsaw`); the panel only turns the number into words. One wording for the stage rows, the column "Czekamy na" of W-10
 * and the tile "Na kogo czekamy" of W-06.
 */
export function sinceText(t: TFunction, days: number | null): string {
  if (days === null || days <= 0) return t('workOrder.stage.sinceToday');
  if (days === 1) return t('workOrder.stage.sinceYesterday');
  return t('workOrder.stage.sinceDays', { count: days });
}

/** Longer than 14 days the wait is a warning (`triangle-alert` and the colour of a warning — never the colour alone). */
export const isLongWait = (days: number | null): boolean => days !== null && days > LONG_WAIT_DAYS;
