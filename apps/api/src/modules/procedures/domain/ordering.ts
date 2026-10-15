/**
 * The places of the ACTIVE processes of an order and of the ACTIVE stages of a process (EVM-042 AC1–AC3; domain-model.md →
 * `Procedure`, `ProcedureStage`): the model keeps the positions of the active ones unique and numbered 1…n, and the database
 * refuses a second active row on a place (a partial unique index that cannot be deferred). So a row is never put on a taken place:
 * the callers move the others first, one by one, in the order these functions give — pure functions of data, no database.
 */
export interface Placed {
  readonly id: string;
  readonly position: number;
}

export interface Move {
  readonly id: string;
  /** The place the row moves to. */
  readonly to: number;
}

/**
 * The place a new (or restored) row takes among `activeCount` active ones: the wanted one, or the end when none is wanted; a place
 * past the end is cut to the end — a screen that was a moment behind the server must not get `400` for it.
 */
export function insertionPoint(requested: number | undefined, activeCount: number): number {
  const end = activeCount + 1;
  return requested === undefined ? end : Math.min(requested, end);
}

/**
 * The moves that make room at `at`: every active row at or after it moves one down. The LAST row moves first, so each one moves
 * into the place the previous one left and never onto a taken one.
 */
export function movesToOpen(active: readonly Placed[], at: number): Move[] {
  return active
    .filter((row) => row.position >= at)
    .sort((a, b) => b.position - a.position)
    .map((row) => ({ id: row.id, to: row.position + 1 }));
}

/**
 * The moves that close the gaps after a row left: the rows are numbered 1…n in their order. The FIRST row moves first, so each one
 * moves into a place that is already free.
 */
export function movesToClose(active: readonly Placed[]): Move[] {
  return [...active]
    .sort((a, b) => a.position - b.position)
    .flatMap((row, index) => (row.position === index + 1 ? [] : [{ id: row.id, to: index + 1 }]));
}
