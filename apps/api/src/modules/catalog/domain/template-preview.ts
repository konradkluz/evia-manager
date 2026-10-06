/**
 * The preview of a work order template (EVM-019 AC4): the processes its items bring. A process brought by several
 * items appears once ("Uzgodnienia z OSD" brought by two items becomes one process of the order — service-catalog.md,
 * "Jak czytać"), in the order of its first appearance (item position, then the position inside the item).
 */

export interface BroughtProcedure {
  readonly code: string;
  readonly name: string;
  readonly stageCount: number;
}

/** @param brought the procedures of the items already ordered by item position and then by position in the item */
export function distinctProcedures(brought: readonly BroughtProcedure[]): BroughtProcedure[] {
  const seen = new Set<string>();
  const result: BroughtProcedure[] = [];
  for (const procedure of brought) {
    if (seen.has(procedure.code)) continue;
    seen.add(procedure.code);
    result.push(procedure);
  }
  return result;
}
