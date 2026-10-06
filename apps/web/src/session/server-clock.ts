/**
 * The difference between the clock of the server and the clock of this computer (EVM-067 AC5, AC6; SR-WEB-05, TM-10).
 * The deadlines of the session are the server's, so the tab compares them with the server's time, not with a clock that
 * may run fast or slow. It is learned from the `Date` header of every read of the session (a resolution of 1 s is enough
 * for a warning counted in minutes) and lives only in memory.
 */
let offsetMs = 0;

/** Remembers the server time from the `Date` header of a response; a missing or unreadable header changes nothing. */
export function noteServerDate(header: string | null | undefined): void {
  if (header === null || header === undefined) return;
  const serverMs = Date.parse(header);
  if (Number.isNaN(serverMs)) return;
  offsetMs = serverMs - Date.now();
}

/** The time of the server now, estimated from the local clock and the last known difference. */
export function serverNow(localMs: number = Date.now()): number {
  return localMs + offsetMs;
}

/** For tests: forgets the learned difference. */
export function resetServerClock(): void {
  offsetMs = 0;
}
