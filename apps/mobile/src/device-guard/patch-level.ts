/**
 * Age of the system security patch (EVM-101 AC6; policy P7, ADR-0005): a calendar-month age in the business time zone
 * `Europe/Warsaw`. Over 6 months a dismissible notice, over 12 months a stronger one; the app is never blocked by it.
 * A missing or invalid date gives no banner (architect 11; the guard logs the fact without data). The security note asked for the
 * oldest variant instead - recorded in blockers.md as a recommendation to confirm. The thresholds are constants; the contract has none.
 */
export const PATCH_NOTICE_MONTHS = 6;
export const PATCH_STRONG_MONTHS = 12;

export type PatchBanner = 'none' | 'notice' | 'strong';

const WARSAW = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar date `{y, m, d}` of an instant in Europe/Warsaw. */
export function warsawDate(instant: number): { y: number; m: number; d: number } {
  const parts = WARSAW.formatToParts(new Date(instant));
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { y: part('year'), m: part('month'), d: part('day') };
}

/** `YYYY-MM-DD` of the system, or `null` when it is not a real calendar date. */
export function parsePatch(text: string | null): { y: number; m: number; d: number } | null {
  const match = text === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? { y, m, d } : null;
}

type CalendarDate = { y: number; m: number; d: number };

/** The date `months` calendar months later; the day of the month is clamped to the length of the target month. */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const total = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(date.d, new Date(Date.UTC(y, m, 0)).getUTCDate()) };
}

const isAfter = (a: CalendarDate, b: CalendarDate): boolean => (a.y !== b.y ? a.y > b.y : a.m !== b.m ? a.m > b.m : a.d > b.d);

/** "Older than N months": today is later than the patch date plus N calendar months. */
export function olderThanMonths(patch: CalendarDate, today: CalendarDate, months: number): boolean {
  return isAfter(today, addMonths(patch, months));
}

export function patchBanner(securityPatch: string | null, now: number): { banner: PatchBanner; readable: boolean } {
  const patch = parsePatch(securityPatch);
  if (patch === null) return { banner: 'none', readable: false };
  const today = warsawDate(now);
  if (olderThanMonths(patch, today, PATCH_STRONG_MONTHS)) return { banner: 'strong', readable: true };
  if (olderThanMonths(patch, today, PATCH_NOTICE_MONTHS)) return { banner: 'notice', readable: true };
  return { banner: 'none', readable: true };
}
