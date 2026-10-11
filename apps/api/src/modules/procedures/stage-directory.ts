/**
 * The facade of `procedures` for the other modules (ADR-0001: a module reaches another one through its `index.ts` only). Its first
 * consumer is `timeline` (EVM-037): an entry of the journal may name a stage, and that stage must be a live stage of THE SAME
 * order. The caller passes ITS transaction. Nothing but the answer to the question comes back — never a status, a person or a
 * date (SR-DATA-03).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

export const PROCEDURE_STAGE_DIRECTORY = Symbol('PROCEDURE_STAGE_DIRECTORY');

export interface ProcedureStageDirectory {
  /**
   * Is `stageId` an ACTIVE stage of the order `workOrderId` — not deleted, in a process that is not deleted? One answer for a stage
   * that does not exist, one of ANOTHER order and a deleted one (SR-AUTHZ-02, CWE-639). With `lock` the row is read `FOR SHARE` and
   * the caller holds the lock until its transaction ends, so the stage cannot be deleted between the check and the write.
   */
  existsInOrder(tx: Kysely<Database>, workOrderId: string, stageId: string, options?: { readonly lock?: boolean }): Promise<boolean>;
  /**
   * The names of the stages of the order `workOrderId` among `stageIds` (ONE query; a stage of another order is not in the answer).
   * A stage deleted since an entry was written keeps its name here: the journal does not forget what an entry was about.
   */
  namesOf(tx: Kysely<Database>, workOrderId: string, stageIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
