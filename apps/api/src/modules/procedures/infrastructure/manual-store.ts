/**
 * Queries of the processes and stages added, deleted and restored by hand (EVM-042). Like the rest of the module: every value is a
 * bound parameter, every query names its columns, and the anchor `work_order_id` is in the condition of EVERY read and write — an
 * object is never found by its own identifier alone (SR-AUTHZ-02, CWE-639). The locks (`FOR UPDATE`) are taken under the lock of
 * the order, so the decisions of a command are taken on rows no other command can change (ASVS V2.3.3). Soft delete only: the
 * application role has no DELETE.
 */
import { sql } from 'kysely';
import type { PlannedProcedure } from '../domain/composition-plan.ts';
import type { Move } from '../domain/ordering.ts';
import { MAX_PROCEDURES_PER_ORDER, MAX_STAGES_PER_PROCEDURE } from '../domain/stage-rules.ts';
import { inActiveProcess, stageColumns } from './procedure-store.ts';
import type { ProceduresDb } from './tables.ts';

/** Which rows a lookup means: the live ones, or the deleted ones (the object of a restore). */
export type RowState = 'active' | 'deleted';

const deletedAtOf = (state: RowState) => (state === 'active' ? ('is' as const) : ('is not' as const));

/**
 * The process of THIS order in the given state, LOCKED (`FOR UPDATE`): `id` AND `work_order_id` in the one condition, so a process
 * of another order is as missing as one that does not exist (`undefined` → `404`, SR-AUTHZ-02).
 */
export function lockProcedure(db: ProceduresDb, workOrderId: string, procedureId: string, state: RowState) {
  return db
    .selectFrom('procedures.procedures')
    .select(['id', 'code', 'name', 'position', 'version'])
    .where('id', '=', procedureId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', deletedAtOf(state), null)
    .forUpdate()
    .executeTakeFirst();
}

/**
 * The process (in any state) that owns a stage of THIS order, LOCKED — the restore of a stage asks whether it is deleted. The key
 * `(procedure_id, work_order_id)` of the stage guarantees it exists: a missing row is a defect (500), never a branch of the command.
 */
export function lockOwnerOf(db: ProceduresDb, workOrderId: string, procedureId: string) {
  return db
    .selectFrom('procedures.procedures')
    .select(['id', 'code', 'deleted_at'])
    .where('id', '=', procedureId)
    .where('work_order_id', '=', workOrderId)
    .forUpdate()
    .executeTakeFirstOrThrow();
}

/** The process of THIS order as it is NOW with its version (the answer of an addition, a restore and a repeat); `undefined` when it is not live. */
export function findLiveProcedure(db: ProceduresDb, workOrderId: string, procedureId: string) {
  return db
    .selectFrom('procedures.procedures')
    .select(['id', 'code', 'name', 'position', 'source_scope_item_id', 'version'])
    .where('id', '=', procedureId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
}

/** The ACTIVE stages of one process in order — at most the limit of the API. */
export function listStagesOfProcedure(db: ProceduresDb, workOrderId: string, procedureId: string) {
  return db
    .selectFrom('procedures.procedure_stages')
    .select(stageColumns)
    .where('work_order_id', '=', workOrderId)
    .where('procedure_id', '=', procedureId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .limit(MAX_STAGES_PER_PROCEDURE)
    .execute();
}

/**
 * The stage of THIS order in the given state, LOCKED (`FOR UPDATE`). A live stage must belong to a live process (a stage of a
 * deleted process is as gone as the process); a deleted stage may belong to any (the restore answers `parent_deleted` itself).
 */
export function lockStageInState(db: ProceduresDb, workOrderId: string, stageId: string, state: RowState) {
  const query = db
    .selectFrom('procedures.procedure_stages')
    .select(stageColumns)
    .where('id', '=', stageId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', deletedAtOf(state), null);
  return (state === 'active' ? query.where(inActiveProcess) : query).forUpdate().executeTakeFirst();
}

/** The ACTIVE processes of the order with their places — the input of the placing (at most the limit of the API). */
export function activeProcedurePlaces(db: ProceduresDb, workOrderId: string) {
  return db
    .selectFrom('procedures.procedures')
    .select(['id', 'code', 'position'])
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .limit(MAX_PROCEDURES_PER_ORDER)
    .execute();
}

/** The ACTIVE stages of the process with their places. */
export function activeStagePlaces(db: ProceduresDb, workOrderId: string, procedureId: string) {
  return db
    .selectFrom('procedures.procedure_stages')
    .select(['id', 'position'])
    .where('work_order_id', '=', workOrderId)
    .where('procedure_id', '=', procedureId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .limit(MAX_STAGES_PER_PROCEDURE)
    .execute();
}

/**
 * Moves active processes, one UPDATE per row in the order given (the index of the place cannot be deferred, so each row moves into
 * a place that is free). The version is NOT raised: a place is a place in the list, not the content of the process.
 */
export async function moveProcedures(db: ProceduresDb, workOrderId: string, moves: readonly Move[]): Promise<void> {
  for (const move of moves) {
    await db
      .updateTable('procedures.procedures')
      .set({ position: move.to })
      .where('id', '=', move.id)
      .where('work_order_id', '=', workOrderId)
      .where('deleted_at', 'is', null)
      .execute();
  }
}

/** The same for the active stages of one process. */
export async function moveStages(db: ProceduresDb, workOrderId: string, procedureId: string, moves: readonly Move[]): Promise<void> {
  for (const move of moves) {
    await db
      .updateTable('procedures.procedure_stages')
      .set({ position: move.to })
      .where('id', '=', move.id)
      .where('work_order_id', '=', workOrderId)
      .where('procedure_id', '=', procedureId)
      .where('deleted_at', 'is', null)
      .execute();
  }
}

/**
 * Inserts ONE process with the identifier the client chose; `false` when ANY unique rule refused it (the identifier — also one of
 * another order — or, in a race the lock of the order should have made impossible, a code or a place): the caller answers `409`
 * without the name of the rule (SR-API-01, CWE-209). The stages are inserted afterwards (`insertStages`).
 */
export async function insertProcedureWithId(
  db: ProceduresDb,
  id: string,
  workOrderId: string,
  procedure: PlannedProcedure,
  actorUserId: string,
  now: Date,
): Promise<boolean> {
  const inserted = await db
    .insertInto('procedures.procedures')
    .values({
      id,
      work_order_id: workOrderId,
      code: procedure.code,
      name: procedure.name,
      position: procedure.position,
      source_procedure_template_id: procedure.sourceProcedureTemplateId,
      source_scope_item_id: null,
      created_at: now,
      created_by: actorUserId,
      updated_at: now,
      updated_by: actorUserId,
      deleted_at: null,
      deleted_by: null,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning('id')
    .executeTakeFirst();
  return inserted !== undefined;
}

export interface NewManualStage {
  readonly id: string;
  readonly procedureId: string;
  readonly workOrderId: string;
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly dueDate: string | null;
  readonly responsibleUserId: string | null;
}

/** Inserts ONE stage added by hand (status `todo` by the default of the column); `false` when a unique rule refused it (see {@link insertProcedureWithId}). */
export async function insertManualStage(db: ProceduresDb, stage: NewManualStage, actorUserId: string, now: Date): Promise<boolean> {
  const inserted = await db
    .insertInto('procedures.procedure_stages')
    .values({
      id: stage.id,
      procedure_id: stage.procedureId,
      work_order_id: stage.workOrderId,
      code: stage.code,
      name: stage.name,
      position: stage.position,
      due_date: stage.dueDate,
      responsible_user_id: stage.responsibleUserId,
      output_document_kind_codes: [],
      source_stage_template_id: null,
      created_at: now,
      created_by: actorUserId,
      updated_at: now,
      updated_by: actorUserId,
      deleted_at: null,
      deleted_by: null,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning('id')
    .executeTakeFirst();
  return inserted !== undefined;
}

/** Soft delete of a live process, only for the version the command decided on (a row that is not updated is an error, not a no-op). */
export async function softDeleteProcedure(
  db: ProceduresDb,
  workOrderId: string,
  procedureId: string,
  expectedVersion: number,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('procedures.procedures')
    .set({ deleted_at: now, deleted_by: actorUserId, updated_at: now, updated_by: actorUserId, version: sql<number>`version + 1` })
    .where('id', '=', procedureId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirstOrThrow();
}

/** Brings a deleted process back at `position` (the others have made room), for the version the command decided on. */
export async function restoreProcedure(
  db: ProceduresDb,
  workOrderId: string,
  procedureId: string,
  position: number,
  expectedVersion: number,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('procedures.procedures')
    .set({ deleted_at: null, deleted_by: null, position, updated_at: now, updated_by: actorUserId, version: sql<number>`version + 1` })
    .where('id', '=', procedureId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is not', null)
    .returning('version')
    .executeTakeFirstOrThrow();
}

/** Soft delete of a live stage, only for the version the command decided on. */
export async function softDeleteStage(
  db: ProceduresDb,
  workOrderId: string,
  stageId: string,
  expectedVersion: number,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('procedures.procedure_stages')
    .set({ deleted_at: now, deleted_by: actorUserId, updated_at: now, updated_by: actorUserId, version: sql<number>`version + 1` })
    .where('id', '=', stageId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirstOrThrow();
}

/** Brings a deleted stage back at `position`, for the version the command decided on. */
export async function restoreStage(
  db: ProceduresDb,
  workOrderId: string,
  stageId: string,
  position: number,
  expectedVersion: number,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('procedures.procedure_stages')
    .set({ deleted_at: null, deleted_by: null, position, updated_at: now, updated_by: actorUserId, version: sql<number>`version + 1` })
    .where('id', '=', stageId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is not', null)
    .returning('version')
    .executeTakeFirstOrThrow();
}

/** The make-up of a process changed (a stage added, deleted or restored): its version rises, so a stale "Usuń proces" gets `412`. */
export async function bumpProcedureVersion(
  db: ProceduresDb,
  workOrderId: string,
  procedureId: string,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('procedures.procedures')
    .set({ updated_at: now, updated_by: actorUserId, version: sql<number>`version + 1` })
    .where('id', '=', procedureId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirstOrThrow();
}

/** The deleted processes of the order, newest first; `limit` rows (the caller asks one more than it shows to know that the list is cut). */
export function listDeletedProcedures(db: ProceduresDb, workOrderId: string, limit: number) {
  return db
    .selectFrom('procedures.procedures')
    .select([
      'id',
      'code',
      'name',
      'position',
      'version',
      'deleted_at',
      sql<number>`(select count(*)::int from procedures.procedure_stages as owned
        where owned.procedure_id = procedures.procedures.id and owned.work_order_id = procedures.procedures.work_order_id
          and owned.deleted_at is null)`.as('stage_count'),
    ])
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is not', null)
    .$narrowType<{ deleted_at: Date }>()
    .orderBy('deleted_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
}

/** The deleted stages of the order, newest first, with the name of their process and whether it is deleted too. */
export function listDeletedStages(db: ProceduresDb, workOrderId: string, limit: number) {
  return db
    .selectFrom('procedures.procedure_stages')
    .innerJoin('procedures.procedures as owner', (join) =>
      join
        .onRef('owner.id', '=', 'procedures.procedure_stages.procedure_id')
        .onRef('owner.work_order_id', '=', 'procedures.procedure_stages.work_order_id'),
    )
    .select([
      'procedures.procedure_stages.id as id',
      'procedures.procedure_stages.procedure_id as procedure_id',
      'owner.name as procedure_name',
      'procedures.procedure_stages.name as name',
      'procedures.procedure_stages.position as position',
      sql<boolean>`owner.deleted_at is not null`.as('procedure_deleted'),
      'procedures.procedure_stages.version as version',
      'procedures.procedure_stages.deleted_at as deleted_at',
    ])
    .where('procedures.procedure_stages.work_order_id', '=', workOrderId)
    .where('procedures.procedure_stages.deleted_at', 'is not', null)
    .$narrowType<{ deleted_at: Date }>()
    .orderBy('procedures.procedure_stages.deleted_at', 'desc')
    .orderBy('procedures.procedure_stages.id', 'desc')
    .limit(limit)
    .execute();
}
