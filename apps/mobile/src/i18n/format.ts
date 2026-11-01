/** Times shown to the technician: the business zone `Europe/Warsaw` (conventions.md), Polish order of the date. */
const ZONE = 'Europe/Warsaw';

function parts(at: number, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const part of new Intl.DateTimeFormat('pl-PL', { timeZone: ZONE, hourCycle: 'h23', ...options }).formatToParts(new Date(at))) {
      out[part.type] = part.value;
    }
  } catch {
    // an engine without the zone data: UTC is better than no time
    for (const part of new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', hourCycle: 'h23', ...options }).formatToParts(new Date(at))) {
      out[part.type] = part.value;
    }
  }
  return out;
}

/** "14:05" */
export function formatClock(at: number): string {
  const p = parts(at, { hour: 'numeric', minute: '2-digit' });
  return `${String(Number(p['hour']))}:${p['minute'] ?? '00'}`;
}

/** "02.11.2026, 9:12" */
export function formatDateTime(at: number): string {
  const p = parts(at, { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${p['day'] ?? ''}.${p['month'] ?? ''}.${p['year'] ?? ''}, ${String(Number(p['hour']))}:${p['minute'] ?? '00'}`;
}
