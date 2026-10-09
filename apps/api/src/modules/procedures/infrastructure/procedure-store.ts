/**
 * Queries of the `procedures` module (EVM-031). Every value reaches the database as a bound parameter; every query names its columns
 * (no `select *`, so a column outside the contract — `created_by`, `deleted_by`, the notes — cannot leak into a response, SR-DATA-03).
 * The anchor `work_order_id` is in the condition of every read and write of a stage (SR-AUTHZ-02, CWE-639): a stage is never
 * found by its own identifier alone. The order itself is resolved before, through the facade of `work-orders` and its read policy.
 */
import { sql, type ExpressionBuilder } from 'kysely';
import { MAX_PROCEDURES_PER_ORDER, MAX_STAGES_PER_PROCEDURE } from '../domain/stage-rules.ts';
import type { PlannedProcedure } from '../domain/composition-plan.ts';
import type { StageUpdate } from '../domain/stage-transitions.ts';
import type { Waiting } from '../domain/waiting.ts';
import type { ProcedureTables, ProceduresDb } from './tables.ts';

const dueDate = sql<string | null>`to_char(due_date, 'YYYY-MM-DD')`.as('due_date');
const waitingSince = sql<string | null>`to_char(waiting_since, 'YYYY-MM-DD')`.as('waiting_since');
const completedOn = sql<string | null>`to_char(completed_on, 'YYYY-MM-DD')`.as('completed_on');

/** The columns of a stage that the answers carry (named, never `select *`: a column outside the contract cannot leak, SR-DATA-03). */
const stageColumns = [
  'id',
  'procedure_id',
  'code',
  'name',
  'position',
  'status',
  dueDate,
  'responsible_user_id',
  'waiting_on',
  'waiting_on_party_id',
  waitingSince,
  'blocked_reason',
  'started_at',
  completedOn,
  'version',
] as const;

/** The stage belongs to a process that is not deleted (a stage of a deleted process is as gone as the process). */
const inActiveProcess = (eb: ExpressionBuilder<ProcedureTables, 'procedures.procedure_stages'>) =>
  eb.exists(
    eb
      .selectFrom('procedures.procedures as owner')
      .select('owner.id')
      .whereRef('owner.id', '=', 'procedures.procedure_stages.procedure_id')
      .whereRef('owner.work_order_id', '=', 'procedures.procedure_stages.work_order_id')
      .where('owner.deleted_at', 'is', null),
  );

/**
 * Inserts the processes of a new order (at least one: the caller has nothing to do for an empty plan). The partial unique index of the
 * code is the last line of defence against a repeat — a process whose code is already active in the order fails the insert, and with
 * it the whole creation (the plan makes each code once, so it cannot happen on a new order).
 */
export async function insertProcedures(
  db: ProceduresDb,
  workOrderId: string,
  procedures: readonly PlannedProcedure[],
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .insertInto('procedures.procedures')
    .values(
      procedures.map((procedure) => ({
        work_order_id: workOrderId,
        code: procedure.code,
        name: procedure.name,
        position: procedure.position,
        source_procedure_template_id: procedure.sourceProcedureTemplateId,
        source_scope_item_id: procedure.sourceScopeItemId,
        created_at: now,
        created_by: actorUserId,
        updated_at: now,
        updated_by: actorUserId,
        deleted_at: null,
        deleted_by: null,
      })),
    )
    .execute();
}

/**
 * Inserts the stages of the processes just made, every one in the status `todo` (the default of the column: the server decides it).
 * The process of a stage is found IN the insert by its order and code, so the key `(procedure_id, work_order_id)` is made from the
 * same order the caller named — no identifier is carried from one statement to the next.
 */
export async function insertStages(
  db: ProceduresDb,
  workOrderId: string,
  procedures: readonly PlannedProcedure[],
  actorUserId: string,
  now: Date,
): Promise<void> {
  const rows = procedures.flatMap((procedure) =>
    procedure.stages.map((stage) => ({
      procedure_id: sql<string>`(select id from procedures.procedures where work_order_id = ${workOrderId} and code = ${procedure.code} and deleted_at is null)`,
      work_order_id: workOrderId,
      code: stage.code,
      name: stage.name,
      position: stage.position,
      output_document_kind_codes: stage.outputDocumentKindCodes,
      source_stage_template_id: stage.sourceStageTemplateId,
      created_at: now,
      created_by: actorUserId,
      updated_at: now,
      updated_by: actorUserId,
      deleted_at: null,
      deleted_by: null,
    })),
  );
  if (rows.length === 0) return;
  await db.insertInto('procedures.procedure_stages').values(rows).execute();
}

/** The ACTIVE processes of an order in order — at most the limit of the API (a bound on the answer, SR-API-02). */
export function listProcedures(db: ProceduresDb, workOrderId: string) {
  return db
    .selectFrom('procedures.procedures')
    .select(['id', 'code', 'name', 'position'])
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .limit(MAX_PROCEDURES_PER_ORDER)
    .execute();
}

/** The ACTIVE stages of an order (all its processes) in order — at most the limits of the API multiplied. */
export function listStages(db: ProceduresDb, workOrderId: string) {
  return db
    .selectFrom('procedures.procedure_stages')
    .select(stageColumns)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .where(inActiveProcess)
    .orderBy('procedure_id')
    .orderBy('position')
    .limit(MAX_PROCEDURES_PER_ORDER * MAX_STAGES_PER_PROCEDURE)
    .execute();
}

export type ProcedureRow = Awaited<ReturnType<typeof listProcedures>>[number];
export type StageRow = Awaited<ReturnType<typeof listStages>>[number];

/**
 * The stage of THIS order, LOCKED (`SELECT … FOR UPDATE`): `id` AND `work_order_id` are in the one condition, so a stage of another
 * order is as missing as one that does not exist (`undefined` → `404`, SR-AUTHZ-02, SR-INPUT-02). Every decision of the change is
 * taken on this row, which no other transaction can change until this one ends (ASVS V2.3.3).
 */
export function lockStage(db: ProceduresDb, workOrderId: string, stageId: string) {
  return db
    .selectFrom('procedures.procedure_stages')
    .select(stageColumns)
    .where('id', '=', stageId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .where(inActiveProcess)
    .forUpdate()
    .executeTakeFirst();
}

/** The stage of THIS order as it is NOW (the answer of a change and of a repeat); the caller holds its lock, so it exists — a missing row is an error (500). */
export function findStage(db: ProceduresDb, workOrderId: string, stageId: string) {
  return db
    .selectFrom('procedures.procedure_stages')
    .select(stageColumns)
    .where('id', '=', stageId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .where(inActiveProcess)
    .executeTakeFirstOrThrow();
}

export interface StageChange {
  readonly responsibleUserId?: string | null;
  readonly dueDate?: string | null;
  /** The party waited for and the new "since" (a stage in `waiting`; the application checked the status under the lock). */
  readonly waiting?: Waiting;
}

/**
 * Writes the named fields and raises the version by one — only for the version the command decided on (the lock already guarantees
 * it; the condition is the second line of defence: a row that is not updated is an error, not a silent no-op). The status is not
 * among the columns: it can be changed only by the transition (`transitionStage`).
 */
export async function updateStage(
  db: ProceduresDb,
  workOrderId: string,
  stageId: string,
  expectedVersion: number,
  change: StageChange,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('procedures.procedure_stages')
    .set({
      ...(change.responsibleUserId === undefined ? {} : { responsible_user_id: change.responsibleUserId }),
      ...(change.dueDate === undefined ? {} : { due_date: change.dueDate }),
      ...(change.waiting === undefined
        ? {}
        : {
            waiting_on: change.waiting.waitingOn,
            waiting_on_party_id: change.waiting.waitingOnPartyId,
            waiting_since: change.waiting.waitingSince,
          }),
      updated_at: now,
      updated_by: actorUserId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', stageId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirstOrThrow();
}

/**
 * The transition: writes the status AND every field that belongs to a status (set where the target owns it, cleared elsewhere —
 * the CHECKs of the table agree), raises the version by one, only for the version the command decided on. `startedAt` is written
 * only where the row sets it. The reason of a block is free text: it goes into this column and nowhere else.
 */
export async function transitionStage(
  db: ProceduresDb,
  workOrderId: string,
  stageId: string,
  expectedVersion: number,
  update: StageUpdate,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('procedures.procedure_stages')
    .set({
      status: update.status,
      waiting_on: update.waitingOn,
      waiting_on_party_id: update.waitingOnPartyId,
      waiting_since: update.waitingSince,
      blocked_reason: update.blockedReason,
      completed_on: update.completedOn,
      ...(update.startedAt === undefined ? {} : { started_at: update.startedAt }),
      updated_at: now,
      updated_by: actorUserId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', stageId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirstOrThrow();
}
