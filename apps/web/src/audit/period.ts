/**
 * The period filter of the audit log (EVM-029 AC5; styleguide § 3.5, § 6.3): days are `Europe/Warsaw` calendar days, the
 * API takes instants — a "from" day starts at 00:00:00.000 and a "to" day ends at 23:59:59.999 of that day in Warsaw.
 * No library: `Intl` knows the zone and its daylight saving time.
 */
const ZONE = 'Europe/Warsaw';
const DAY_MS = 86_400_000;
/** The API refuses a period over 2 years (730 days). */
export const MAX_PERIOD_DAYS = 730;

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Offset of Warsaw from UTC (ms) at an instant. */
function offsetAt(instantMs: number): number {
  const values = Object.fromEntries(parts.formatToParts(new Date(instantMs)).map((part) => [part.type, Number(part.value)]));
  const local = Date.UTC(
    values['year'] ?? 0,
    (values['month'] ?? 1) - 1,
    values['day'] ?? 1,
    values['hour'],
    values['minute'],
    values['second'],
  );
  return local - Math.floor(instantMs / 1000) * 1000;
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayParts(day: string): [number, number, number] | null {
  const match = DAY_PATTERN.exec(day);
  if (match === null) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, date));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === date ? [year, month, date] : null;
}

/** The instant (ISO 8601, UTC) of a local Warsaw time on a `YYYY-MM-DD` day; `null` for text that is not a date. */
function instantOf(day: string, hours: number, minutes: number, seconds: number, ms: number): string | null {
  const dateParts = dayParts(day);
  if (dateParts === null) return null;
  const guess = Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], hours, minutes, seconds, ms);
  return new Date(guess - offsetAt(guess - offsetAt(guess))).toISOString();
}

export const startOfDay = (day: string): string | null => instantOf(day, 0, 0, 0, 0);
export const endOfDay = (day: string): string | null => instantOf(day, 23, 59, 59, 999);

/** Today in Warsaw as `YYYY-MM-DD` (the clock is the server's estimate — the caller passes it in). */
export function todayIn(instantMs: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(instantMs),
  );
}

/** `day` moved by `days` calendar days. */
export function addDays(day: string, days: number): string {
  const dateParts = dayParts(day);
  if (dateParts === null) return day;
  return new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]) + days * DAY_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → `DD.MM.YYYY` (styleguide § 6.3). */
export function formatDay(day: string): string {
  const dateParts = dayParts(day);
  return dateParts === null
    ? day
    : `${String(dateParts[2]).padStart(2, '0')}.${String(dateParts[1]).padStart(2, '0')}.${String(dateParts[0])}`;
}

export type PeriodProblem = 'order' | 'length' | null;

/** Both ends are optional; when both are there, the order and the length (at most 2 years) are checked before anything is sent. */
export function checkPeriod(from: string, to: string): PeriodProblem {
  const start = dayParts(from);
  const end = dayParts(to);
  if (start === null || end === null) return null;
  const days = (Date.UTC(end[0], end[1] - 1, end[2]) - Date.UTC(start[0], start[1] - 1, start[2])) / DAY_MS;
  if (days < 0) return 'order';
  return days + 1 > MAX_PERIOD_DAYS ? 'length' : null;
}

const timeFormat = new Intl.DateTimeFormat('pl-PL', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `04.10.2026, 14:05` — the time of an event in Warsaw (styleguide § 6.3). */
export function formatEventTime(iso: string): string {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? iso : timeFormat.format(instant);
}
