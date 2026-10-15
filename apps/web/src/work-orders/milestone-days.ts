/** The range of the days the API accepts for the invoice, the due date and the payment (Q3a; `out_of_range` otherwise). */
export const DAY_MIN = '2000-01-01';
export const DAY_MAX = '2100-12-31';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const DAY_MS = 86_400_000;

/** A calendar day `YYYY-MM-DD` within 2000–2100. */
export const isDayInRange = (day: string): boolean => DAY.test(day) && day >= DAY_MIN && day <= DAY_MAX;

/** The UTC midnight of a calendar day, never through a time zone. */
export const dayMs = (day: string): number => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** Whole days from `from` to `to` (both calendar days). */
export const daysBetween = (from: string, to: string): number => Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
