/**
 * The deadlines of a site survey that is rejected and of one that is restored (EVM-136 AC5; ADR-0024 pt 9; SR-PRIV-01). Pure functions of data - no database, no
 * framework, no clock of its own. The deadline is the marker and the date of the permanent deletion of an unclaimed survey (EVM-139), so it moves ONLY here and
 * in the creation, the extension and the assignment:
 *   - the REJECTION ("Anulowane" with a code of the reason) shortens it: the smaller of the current deadline and now + 14 days - a deadline that is nearer, or has
 *     passed already, stays (the rejection never gives an unclaimed survey more time);
 *   - the RESTORATION (the Administrator, with a step-up) gives it back: the greater of creation + 90 days x (1 + the extensions) and now + 14 days - the survey
 *     has the time it had earned, and at least a fortnight to be looked at again.
 * Days are 24 hours of an instant of UTC (like the first deadline of the survey), so the change of the clock of Europe/Warsaw moves nothing.
 */
import type { ResolvedTransition } from './work-order-transitions.ts';

const DAY_MS = 86_400_000;
/**
 * The period of a survey: the first deadline and each extension (ADR-0024 pt 9). One place, so that the constant of the creation (EVM-135, `site-survey.ts`) can
 * replace it by an import after the two branches meet - TODO(EVM-136): import it from `site-survey.ts` instead of repeating it.
 */
export const SITE_SURVEY_PERIOD_DAYS = 90;
/** What a rejected survey has left at most, and a restored one at least. */
export const SITE_SURVEY_REJECTED_DAYS = 14;

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

export const deadlineAfterRejection = (current: Date, now: Date): Date => {
  const limit = addDays(now, SITE_SURVEY_REJECTED_DAYS);
  return current.getTime() < limit.getTime() ? current : limit;
};

export const deadlineAfterRestoration = (createdAt: Date, extensions: number, now: Date): Date => {
  const earned = addDays(createdAt, SITE_SURVEY_PERIOD_DAYS * (1 + extensions));
  const floor = addDays(now, SITE_SURVEY_REJECTED_DAYS);
  return earned.getTime() > floor.getTime() ? earned : floor;
};

/** What the deadline decision needs of a survey: the three columns of the locked row. */
export interface SurveyTiming {
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly extensions: number;
}

/**
 * The new deadline for a row of the table, or `undefined` when the row leaves it alone. Only the rows that cancel and the row that restores a cancelled order
 * move it, and only for a survey (`survey` is `null` for an ordinary order).
 */
export function deadlineAfterTransition(transition: ResolvedTransition, survey: SurveyTiming | null, now: Date): Date | undefined {
  if (survey === null) return undefined;
  if (transition.rule.audit === 'work_order.cancelled') return deadlineAfterRejection(survey.expiresAt, now);
  if (transition.rule.audit === 'work_order.restored' && transition.rule.from === 'cancelled') {
    return deadlineAfterRestoration(survey.createdAt, survey.extensions, now);
  }
  return undefined;
}
