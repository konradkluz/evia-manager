/**
 * Synthetic processes and stages written straight into the database (EVM-031) — a TEST helper: it lives outside `src`, so it is not
 * in the production image and no route reaches it; it refuses to run when `NODE_ENV=production` (SR-INFRA-08). Everything is
 * synthetic: names are made of a counter, people are the fixture users of the identity tests.
 */
import type { Kysely } from 'kysely';
import type { StageStatus } from '../../src/modules/procedures/domain/stage-rules.ts';
import { procedureTables } from '../../src/modules/procedures/infrastructure/tables.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { assertSyntheticDataAllowed } from './work-order-fixtures.ts';

export interface StageSpec {
  readonly code?: string;
  readonly name?: string;
  readonly status?: StageStatus;
  /** `YYYY-MM-DD` */
  readonly dueDate?: string;
  readonly responsibleUserId?: string;
  readonly deletedAt?: Date;
}

export interface ProcedureSpec {
  readonly code?: string;
  readonly name?: string;
  readonly position?: number;
  readonly stages?: readonly StageSpec[];
  readonly deletedAt?: Date;
}

export interface InsertedProcedure {
  readonly id: string;
  readonly stageIds: string[];
}

const AT = new Date('2026-10-09T08:00:00.000Z');
let counter = 0;

/** Inserts one process of an order with its stages (positions 1, 2, 3 …); returns the identifiers in the order given. */
export async function insertProcedure(db: Kysely<Database>, workOrderId: string, spec: ProcedureSpec = {}): Promise<InsertedProcedure> {
  assertSyntheticDataAllowed();
  counter += 1;
  const tables = procedureTables(db);
  const procedure = await tables
    .insertInto('procedures.procedures')
    .values({
      work_order_id: workOrderId,
      code: spec.code ?? `process_${counter}`,
      name: spec.name ?? `Proces syntetyczny ${counter}`,
      position: spec.position ?? 1,
      source_procedure_template_id: null,
      source_scope_item_id: null,
      created_at: AT,
      created_by: null,
      updated_at: AT,
      updated_by: null,
      deleted_at: spec.deletedAt ?? null,
      deleted_by: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const stages = spec.stages ?? [{}];
  const rows =
    stages.length === 0
      ? []
      : await tables
          .insertInto('procedures.procedure_stages')
          .values(
            stages.map((stage, index) => ({
              procedure_id: procedure.id,
              work_order_id: workOrderId,
              code: stage.code ?? `stage_${counter}_${index + 1}`,
              name: stage.name ?? `Etap syntetyczny ${counter}.${index + 1}`,
              position: index + 1,
              ...(stage.status === undefined ? {} : { status: stage.status }),
              ...(stage.dueDate === undefined ? {} : { due_date: stage.dueDate }),
              ...(stage.responsibleUserId === undefined ? {} : { responsible_user_id: stage.responsibleUserId }),
              output_document_kind_codes: [],
              source_stage_template_id: null,
              created_at: AT,
              created_by: null,
              updated_at: AT,
              updated_by: null,
              deleted_at: stage.deletedAt ?? null,
              deleted_by: null,
            })),
          )
          .returning('id')
          .execute();
  return { id: procedure.id, stageIds: rows.map((row) => row.id) };
}
