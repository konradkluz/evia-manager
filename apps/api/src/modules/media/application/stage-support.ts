/**
 * What the services of `media` share about the stage of a procedure (EVM-048; SR-AUTHZ-02, SR-INPUT-02, CWE-639): the check that a stage belongs to the order
 * of the URL, and the names of the stages for a representation. Both go through the facade of `procedures`; the caller passes ITS transaction.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { ProcedureStageDirectory } from '../../procedures/index.ts';

/**
 * The stage must be a live stage of THIS order, read `FOR SHARE` so it cannot be deleted before the transaction ends. A missing stage, one of another order and
 * a deleted one (also through a deleted process) are ONE answer: `400 validation_failed` at `pointer` - the client learns nothing about other orders.
 */
export async function assertStageInOrder(
  tx: Kysely<Database>,
  stages: ProcedureStageDirectory,
  workOrderId: string,
  stageId: string,
  pointer: string,
): Promise<void> {
  if (!(await stages.existsInOrder(tx, workOrderId, stageId, { lock: true }))) {
    throw new ProblemException('validation_failed', { errors: [{ pointer, code: 'unknown_stage' }] });
  }
}

/** The names of the stages (a deleted stage keeps its name, like in the journal) by the id of the stage; ONE query per order of the page. */
export async function stageNames(
  tx: Kysely<Database>,
  stages: ProcedureStageDirectory,
  entries: ReadonlyArray<{ readonly workOrderId: string | null; readonly stageId: string | null }>,
): Promise<ReadonlyMap<string, string>> {
  const byOrder = new Map<string, Set<string>>();
  for (const { workOrderId, stageId } of entries) {
    if (workOrderId === null || stageId === null) continue;
    byOrder.set(workOrderId, (byOrder.get(workOrderId) ?? new Set<string>()).add(stageId));
  }
  const names = new Map<string, string>();
  for (const [workOrderId, ids] of byOrder) {
    for (const [id, name] of await stages.namesOf(tx, workOrderId, [...ids])) names.set(id, name);
  }
  return names;
}
