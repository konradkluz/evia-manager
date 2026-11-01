/**
 * 0060 — metadata of media and documents (EVM-048; SR-AUTHZ-02, SR-INPUT-02, SR-AUTHZ-04). Expand only.
 *
 * Numbering: 0058 belongs to track A (EVM-099), 0059 to EVM-047; this one takes 0060 (the Kysely migrator runs without `allowUnorderedMigrations`).
 *
 * - `media.media_assets`: `version` (optimistic lock of `If-Match`, 1 for every existing row) and `updated_by` (the last editor of the metadata;
 *   NULL = never edited; it is kept for accountability and is NOT part of the API).
 * - The single-column keys of `procedure_stage_id` in `media.media_assets` and `media.documents` are replaced by a COMPOSITE key
 *   `(procedure_stage_id, work_order_id)` to `procedures.procedure_stages (id, work_order_id)` (precedent: `timeline_entries_stage_fk`, 0020): the
 *   database itself refuses a stage of ANOTHER order, as a second line behind the check of the application. MATCH SIMPLE skips a row without a stage;
 *   a document without an order cannot have a stage (`documents_stage_needs_order` stays). Every existing row has either no stage or none that
 *   could be written by an API (the stage columns had no writer before EVM-048), so the new keys are valid.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table media.media_assets
      add column version integer not null default 1 check (version >= 1),
      add column updated_by uuid references identity.users (id) on delete restrict
  `.execute(db);

  await sql`alter table media.media_assets drop constraint media_assets_procedure_stage_id_fkey`.execute(db);
  await sql`
    alter table media.media_assets
      add constraint media_assets_stage_fk foreign key (procedure_stage_id, work_order_id)
        references procedures.procedure_stages (id, work_order_id) on delete restrict
  `.execute(db);

  await sql`alter table media.documents drop constraint documents_procedure_stage_id_fkey`.execute(db);
  await sql`
    alter table media.documents
      add constraint documents_stage_fk foreign key (procedure_stage_id, work_order_id)
        references procedures.procedure_stages (id, work_order_id) on delete restrict
  `.execute(db);
}
