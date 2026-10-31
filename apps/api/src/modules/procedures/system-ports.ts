/**
 * The SYSTEM port of `procedures` for the read model (ADR-0017 W5; EVM-034): the unfinished stages of the live processes of the
 * orders, with the minimal columns (identifiers, positions, codes, dates). Not part of `index.ts` (see `work-orders/system-ports.ts`).
 * Deleted stages and the stages of deleted processes are never returned (W3).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { OrderChildSyncSource } from '../../platform/sync/sync-row-state.ts';

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

/**
 * The SYNC port of `procedures` (EVM-097; ADR-0021 D8): the stages of the orders for the phone, each with the code and the name of its process (the phone has no
 * separate process). The columns are listed, never `*`. The order of a stage is judged by `work-orders` (`ordersInScope`) before the content is read.
 */
export const PROCEDURE_STAGE_SYNC_SOURCE = Symbol('PROCEDURE_STAGE_SYNC_SOURCE');

/** The fields of `SyncProcedureStage` (contract) that come from the stage and its process; `type` is added by the serializer of `sync`. */
export interface SyncProcedureStageProjection {
  readonly id: string;
  readonly version: number;
  readonly workOrderId: string;
  readonly procedureId: string;
  readonly procedureCode: string;
  readonly procedureName: string;
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly status: string;
  readonly dueDate: string | null;
  readonly responsibleUserId: string | null;
  readonly waitingOn: string | null;
  readonly waitingPartyId: string | null;
  readonly waitingSince: string | null;
  readonly blockedReason: string | null;
  readonly startedAt: Date | null;
  readonly completedOn: string | null;
}

export interface ProcedureStageSyncSource extends OrderChildSyncSource<SyncProcedureStageProjection> {
  /** The live stages that wait for one of the parties among `ids`: the party and the order (ONE query). */
  waitingOnParties(
    tx: Kysely<Database>,
    ids: readonly string[],
  ): Promise<ReadonlyArray<{ readonly partyId: string; readonly workOrderId: string }>>;
  /** The live stages that name one of the users among `ids` as responsible: the user and the order (ONE query). */
  responsibleUsers(
    tx: Kysely<Database>,
    ids: readonly string[],
  ): Promise<ReadonlyArray<{ readonly userId: string; readonly workOrderId: string }>>;
}
