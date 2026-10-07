/** Dates and times of W-10 in the business zone (styleguide § 6.3): `DD.MM.RRRR`, `14:05`; `Europe/Warsaw`. */
const ZONE = 'Europe/Warsaw';

const dayFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const clockFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** `04.10.2026` of an ISO instant; text that is not a date is returned as it came (it is not shown raw otherwise). */
export function formatDate(iso: string): string {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? iso : dayFormat.format(instant);
}

/** `14:05` of an instant in milliseconds. */
export function formatClock(instantMs: number): string {
  return clockFormat.format(new Date(instantMs));
}
