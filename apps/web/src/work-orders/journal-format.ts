/**
 * Days and times of the journal in the business zone (styleguide § 6.3; EVM-037 AC6): the entries are grouped by the calendar
 * day of `Europe/Warsaw` — the server gives UTC instants — and a time reads "dziś, 14:10", "wczoraj, 9:30" or "02.10.2026, 10:00".
 */
const ZONE = 'Europe/Warsaw';

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: ZONE, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });

/** `2026-10-11` — the calendar day of an instant in the business zone; text that is not a date gives the text itself. */
export function dayKeyOf(iso: string | number): string {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? String(iso) : dayKeyFormat.format(instant);
}

/** The calendar day before a day key (`2026-10-01` → `2026-09-30`); the arithmetic is on calendar days, not on instants. */
export function previousDayKey(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (match === null) return key;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1));
  return day.toISOString().slice(0, 10);
}

export type DayRelation = 'today' | 'yesterday' | 'other';

/** How a day relates to "now": the journal says "Dziś" and "Wczoraj" and spells out older days. */
export function relationOf(dayKey: string, nowMs: number): DayRelation {
  const today = dayKeyOf(nowMs);
  if (dayKey === today) return 'today';
  return dayKey === previousDayKey(today) ? 'yesterday' : 'other';
}

/** `11.10.2026` of an instant. */
export function formatEntryDate(iso: string | number): string {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? String(iso) : dateFormat.format(instant);
}

/** `9:41` / `14:10` of an instant. */
export function formatTimeOfDay(iso: string | number): string {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? String(iso) : timeFormat.format(instant);
}

/** `11.10.2026 14:10` — the full date of an entry, for the name and the tooltip (§ 6.3). */
export const formatFullDateTime = (iso: string): string => `${formatEntryDate(iso)} ${formatTimeOfDay(iso)}`;

export interface DayGroup<T> {
  readonly day: string;
  readonly items: T[];
}

/** Groups entries that are already newest first by the day of `createdAt`, keeping the order (the server orders, the panel does not). */
export function groupByDay<T extends { readonly createdAt: string }>(items: readonly T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const day = dayKeyOf(item.createdAt);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
