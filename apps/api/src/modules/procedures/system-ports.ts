/**
 * The SYSTEM port of `procedures` for the read model (ADR-0017 W5; EVM-034): the unfinished stages of the live processes of the
 * orders, with the minimal columns (identifiers, positions, codes, dates). Not part of `index.ts` (see `work-orders/system-ports.ts`).
 * Deleted stages and the stages of deleted processes are never returned (W3).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

export const PROCEDURE_PROJECTION_SOURCE = Symbol('PROCEDURE_PROJECTION_SOURCE');

export interface UnfinishedStageRow {
  readonly stageId: string;
  readonly workOrderId: string;
  readonly procedurePosition: number;
  readonly stagePosition: number;
  readonly status: 'todo' | 'in_progress' | 'waiting' | 'blocked';
  readonly waitingOn: 'customer' | 'party' | null;
  readonly waitingOnPartyId: string | null;
  /** `YYYY-MM-DD` */
  readonly waitingSince: string | null;
  /** `YYYY-MM-DD` */
  readonly dueDate: string | null;
}

export interface ProcedureProjectionSource {
  /** The unfinished stages (`todo`, `in_progress`, `waiting`, `blocked`) of the orders among `workOrderIds` (ONE query). */
  unfinishedStagesOf(tx: Kysely<Database>, workOrderIds: readonly string[]): Promise<readonly UnfinishedStageRow[]>;
  /** The order of every stage among `stageIds` that exists (ONE query); the others are absent. */
  workOrderIdsOfStages(tx: Kysely<Database>, stageIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
