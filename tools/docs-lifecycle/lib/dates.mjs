// @ts-check

/** Business time zone of the project (CLAUDE.md → „Konwencje”). */
export const BUSINESS_TIME_ZONE = 'Europe/Warsaw';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * `YYYY-MM-DD` and a real calendar date (e.g. `2026-02-30` is invalid).
 * @param {string} value
 * @returns {boolean}
 */
export function isValidIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lastDay = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= lastDay;
}

/**
 * Calendar date (`YYYY-MM-DD`) of the given instant in a time zone — never `toISOString().slice(0, 10)`,
 * which gives the UTC date (finding I).
 * @param {Date} now
 * @param {string} [timeZone]
 * @returns {string}
 */
export function todayInZone(now, timeZone = BUSINESS_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
