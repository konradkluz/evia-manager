/**
 * Kysely types of the tables the `procedures` module owns (EVM-031). `platform` does not know module tables: the module narrows a
 * handle with `db.$extendTables<ProcedureTables>()`. Only the columns EVM-031 reads or writes are declared — the others of the model
 * (waiting for, the reason of a block, the notes, the start and the end) arrive in the type with the story that uses them (EVM-032).
 * The application role has SELECT, INSERT and UPDATE (no DELETE: soft delete only). Dates (`date`) are written as `YYYY-MM-DD` and
 * read through `to_char` (the driver would turn a `date` into a local midnight); times are written by the application.
 */
import type { Generated, Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { StageStatus } from '../domain/stage-rules.ts';

export interface ProceduresTable {
  id: Generated<string>;
  work_order_id: string;
  code: string;
  name: string;
  position: number;
  source_procedure_template_id: string | null;
  source_scope_item_id: string | null;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  updated_by: string | null;
  version: Generated<number>;
  deleted_at: Date | null;
  deleted_by: string | null;
}

export interface ProcedureStagesTable {
  id: Generated<string>;
  procedure_id: string;
  /** The anchor (D10): the key `(procedure_id, work_order_id)` makes a stage of another order's process impossible. */
  work_order_id: string;
  code: string;
  name: string;
  position: number;
  status: Generated<StageStatus>;
  responsible_user_id: Generated<string | null>;
  due_date: Generated<string | null>;
  output_document_kind_codes: readonly string[];
  source_stage_template_id: string | null;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  updated_by: string | null;
  version: Generated<number>;
  deleted_at: Date | null;
  deleted_by: string | null;
}

export type ProcedureTables = {
  'procedures.procedures': ProceduresTable;
  'procedures.procedure_stages': ProcedureStagesTable;
};

export type ProceduresDb = Kysely<ProcedureTables>;

export const procedureTables = (db: Kysely<Database>): ProceduresDb => db.$extendTables<ProcedureTables>();
