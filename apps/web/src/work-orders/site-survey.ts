import type { SiteSurvey } from '@evia/contracts';
import { pluralForm } from './order-form.ts';
import { todayWarsaw } from './transition-actions.ts';

/**
 * Logic of the site survey ("Wizja lokalna", ADR-0024, EVM-138): an order without a customer with a deadline of expiry. A survey is
 * recognised by `siteSurvey !== null` (never by the missing customer alone). The marks "Wizja lokalna" and "Odrzucona" are computed,
 * not statuses of the model (styleguide § 4.4).
 */
export interface SurveyOrder {
  readonly status: string;
  readonly siteSurvey?: SiteSurvey | null | undefined;
}

/** From this many days or fewer the deadline is a warning (the same limit as "Wygasające wizje" and the reminder e-mail). */
export const SURVEY_WARNING_DAYS = 15;

/** The survey may be extended at most this many times (EVM-140 shows it; here only "Przedłużono N z 2 razy"). */
export const SURVEY_EXTENSIONS_MAX = 2;

/** One extension moves the deadline by this many days (EVM-140). */
export const SURVEY_EXTENSION_DAYS = 90;

/** An open survey (also a rejected one: `cancelled` keeps the marker until the deletion). */
export const isSurvey = (order: SurveyOrder): order is SurveyOrder & { readonly siteSurvey: SiteSurvey } =>
  order.siteSurvey !== null && order.siteSurvey !== undefined;

/** A survey the office rejected: the status "Anulowane" with the marker still set. */
export const isRejectedSurvey = (order: SurveyOrder): boolean => isSurvey(order) && order.status === 'cancelled';

const DAY_MS = 86_400_000;
const dayOf = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/**
 * Whole calendar days from today to the day of the deadline, both read in the business zone `Europe/Warsaw` (a deadline at 23:30 UTC
 * is already the next day in Warsaw). 0 — the deadline is today, negative — it has passed. `nowMs` is the server's time (`serverNow()`).
 */
export function daysLeft(expiresAt: string, nowMs: number): number {
  const instant = new Date(expiresAt);
  if (Number.isNaN(instant.getTime())) return 0;
  return Math.round((dayOf(todayWarsaw(instant.getTime())) - dayOf(todayWarsaw(nowMs))) / DAY_MS);
}

/** `14.02.2027` — the day of the deadline in the business zone (the same format as everywhere in the panel, styleguide § 6.3). */
export const expiryDate = (expiresAt: string): string => {
  const [year, month, day] = todayWarsaw(new Date(expiresAt).getTime()).split('-');
  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`;
};

/** The deadline after one more extension: 90 days from the present deadline (the server extends from it, not from today), as `DD.MM.RRRR`. */
export const extendedExpiryDate = (expiresAt: string): string => {
  const instant = new Date(expiresAt);
  instant.setUTCDate(instant.getUTCDate() + SURVEY_EXTENSION_DAYS);
  return expiryDate(instant.toISOString());
};

/** The days as a word: `za 1 dzień`, `za 5 dni`, `dziś` (Polish plural, styleguide § 6.3). */
export function inDays(days: number): string {
  if (days <= 0) return 'dziś';
  return `za ${String(days)} ${pluralForm(days) === 'one' ? 'dzień' : 'dni'}`;
}

export interface Expiry {
  /** `days` — still ahead, `today` — the deadline is today, `passed` — the deadline has passed (before the deletion). */
  readonly kind: 'days' | 'today' | 'passed';
  readonly days: number;
  /** ≤ 15 days (also today and passed): the deadline needs a decision — `triangle-alert`, `color.text.warning`. */
  readonly warning: boolean;
}

export function expiryOf(survey: Pick<SiteSurvey, 'expiresAt'>, nowMs: number): Expiry {
  const days = daysLeft(survey.expiresAt, nowMs);
  return { kind: days < 0 ? 'passed' : days === 0 ? 'today' : 'days', days, warning: days <= SURVEY_WARNING_DAYS };
}
