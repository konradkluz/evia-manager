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

/** True when both instants fall on the same calendar day of the business zone. */
export function sameDay(a: number, b: number): boolean {
  const pa = parts(a, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const pb = parts(b, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return pa['day'] === pb['day'] && pa['month'] === pb['month'] && pa['year'] === pb['year'];
}

/** The calendar day of the business zone as a number of days since the epoch (the difference of two is the number of days between them). */
export function calendarDay(at: number): number {
  const p = parts(at, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return Math.round(Date.UTC(Number(p['year']), Number(p['month']) - 1, Number(p['day'])) / 86_400_000);
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * Free space for the camera warning (EVM-108 AC4): "1,2 GB" from the real value (Polish decimal comma, rounded DOWN to one place so the text
 * never claims more than there is), below a gigabyte whole megabytes ("640 MB").
 */
export function formatFreeSpace(bytes: number): string {
  if (bytes < GB) return `${String(Math.max(0, Math.floor(bytes / MB)))} MB`;
  return `${(Math.floor((bytes / GB) * 10) / 10).toFixed(1).replace('.', ',')} GB`;
}

/** "2:13" - the length of a film (minutes and two-digit seconds, rounded down to a whole second; EVM-110). */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
}

/** "78 MB" / "1,2 GB" - the size of a file in the list (rounded to the nearest unit shown, Polish decimal comma). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 MB';
  if (bytes < GB) return `${String(Math.max(1, Math.round(bytes / MB)))} MB`;
  return `${(Math.round((bytes / GB) * 10) / 10).toFixed(1).replace('.', ',')} GB`;
}
