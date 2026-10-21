/**
 * The limit of the sessions of the web channel (EVM-028 AC6; SR-SESS-04): an account keeps at most five open at once, and the sign-in that would make the
 * sixth ends the oldest. A pure function of the open sessions (alive, state `active`, web) in the order they began — the caller reads them under the lock of
 * the sign-ins of the account and ends what this function names, so that AFTER the insert of the new session there are at most `limit`.
 * @returns the ids to end, the oldest first
 */
export function sessionsToEnd(openOldestFirst: readonly string[], limit: number): string[] {
  const excess = openOldestFirst.length + 1 - limit;
  return excess > 0 ? openOldestFirst.slice(0, excess) : [];
}
