/**
 * Assembly of one page of the phase of changes (EVM-096 AC4, AC7; ADR-0021 D3, D4), as a pure function. The log names WHAT changed and the reader gives the
 * CURRENT state, so several rows of one entity collapse into one change - emitted at its LAST row below the horizon (the earlier rows are `superseded`, whichever
 * page they fall on, so a change is neither doubled nor lost). The page closes before the serialised changes
 * exceed the byte budget; the cursor then points at the last row that was fully included (the rows after it come on the next page, nothing is lost or doubled).
 */
import { changeBytes, type SyncChange, type SyncEntityType } from './projection.ts';

export interface ChangeLogRow {
  readonly seq: string;
  readonly txid: string;
  readonly type: SyncEntityType;
  readonly id: string;
  /** A later row of the same entity is below the horizon already: this row emits nothing. */
  readonly superseded: boolean;
}

export const entityKey = (row: Pick<ChangeLogRow, 'type' | 'id'>): string => `${row.type}:${row.id}`;

export interface AssembledPage {
  readonly changes: readonly SyncChange[];
  /** How many rows (from the first) the page consumed: the cursor is the last of them. */
  readonly consumed: number;
}

/**
 * @param rows the rows after the cursor, in the order of the log
 * @param changes the change due for an entity (by {@link entityKey}); an entity without an entry has nothing due
 * @param budgetBytes the page closes before the changes would exceed this many bytes (a single change larger than the budget still goes alone)
 */
export function assemblePage(rows: readonly ChangeLogRow[], changes: ReadonlyMap<string, SyncChange>, budgetBytes: number): AssembledPage {
  const included: SyncChange[] = [];
  let bytes = 0;
  for (const [index, row] of rows.entries()) {
    const key = entityKey(row);
    const change = row.superseded ? undefined : changes.get(key);
    if (change === undefined) continue;
    const size = changeBytes(change);
    if (included.length > 0 && bytes + size > budgetBytes) return { changes: included, consumed: index };
    included.push(change);
    bytes += size;
  }
  return { changes: included, consumed: rows.length };
}
