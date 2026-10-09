/**
 * 0019 — the processes of a work order and their stages (ADR-0003, ADR-0017; EVM-031): the new schema `procedures` with the tables
 * `procedures` and `procedure_stages`. Expand only: the tables are new, nothing is dropped, renamed or rewritten, and there is no
 * backfill (an order created before this story has no processes). Rules:
 * - a process is a COPY of a process template (D1): `code` and `name` are the copy, `source_procedure_template_id` says where it came
 *   from and `source_scope_item_id` which scope item of the order brought it (both optional: a process may be added by hand, EVM-042).
 *   At most ONE active process per `code` in an order and one per `position` (partial unique indexes: soft delete frees them);
 * - a stage carries the anchor `work_order_id` (D10) AND the key to its process `(procedure_id, work_order_id)` that points at
 *   `procedures (id, work_order_id)`: a stage cannot belong to a process of ANOTHER order, whatever the application does (SR-AUTHZ-02,
 *   CWE-639). The unique `(id, work_order_id)` of the process is the target of that composite key. At most one active stage per `code`
 *   and per `position` in a process;
 * - the status is `text` + CHECK of the six values of `StageStatus` (no ENUM type), `todo` by default: the server decides it (the
 *   story EVM-032 adds the command). "Waiting for" is required exactly in the status `waiting` (a party — with its identifier), as
 *   the domain model says; the other columns of the model (the reason of a block, the notes, the documents of the result) are here
 *   already and stay empty until EVM-032, so that story adds no column;
 * - the person responsible is a key to `identity.users` and the due date a `date` in the range of a business day (2000-01-01 ..
 *   2100-12-31); every key is `ON DELETE RESTRICT` (no cascade: rows are soft deleted, a delete that would orphan one fails);
 * - the limits of the API (30 processes per order, 30 stages per process) are enforced by the application in the transaction of the
 *   creation; `position` is bounded by the CHECK to the same range;
 * - indexes: the stages of an order (`work_order_id`, the read of the section), the person responsible (partial, for the later
 *   "mine" views) and the due date (partial, for the later "by deadline" views);
 * - the application role gets SELECT, INSERT and UPDATE (soft delete only: NO DELETE); the read-only role has no access.
 * Times are written by the application (no `now()` defaults).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create schema procedures`.execute(db);
  await sql`revoke all on schema procedures from public`.execute(db);

  await sql`
    create table procedures.procedures (
      id uuid primary key default uuidv7() check (uuid_extract_version(id) = 7),
      work_order_id uuid not null references work_orders.work_orders (id) on delete restrict,
      code text not null check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (length(name) between 1 and 200),
      position integer not null check (position between 1 and 30),
      source_procedure_template_id uuid references catalog.procedure_templates (id) on delete restrict,
      source_scope_item_id uuid references work_orders.scope_items (id) on delete restrict,
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid,
      unique (id, work_order_id)
    )
  `.execute(db);
  await sql`
    create unique index procedures_code_idx on procedures.procedures (work_order_id, code) where deleted_at is null
  `.execute(db);
  await sql`
    create unique index procedures_position_idx on procedures.procedures (work_order_id, position) where deleted_at is null
  `.execute(db);

  await sql`
    create table procedures.procedure_stages (
      id uuid primary key default uuidv7() check (uuid_extract_version(id) = 7),
      procedure_id uuid not null,
      work_order_id uuid not null references work_orders.work_orders (id) on delete restrict,
      code text not null check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (length(name) between 1 and 200),
      position integer not null check (position between 1 and 30),
      status text not null default 'todo' check (
        status in ('todo', 'in_progress', 'waiting', 'blocked', 'done', 'not_applicable')
      ),
      waiting_on text check (waiting_on in ('customer', 'party')),
      waiting_on_party_id uuid references parties.parties (id) on delete restrict,
      waiting_since date,
      blocked_reason text check (length(blocked_reason) between 1 and 500),
      responsible_user_id uuid references identity.users (id) on delete restrict,
      due_date date check (due_date between date '2000-01-01' and date '2100-12-31'),
      started_at timestamptz,
      completed_on date,
      output_document_kind_codes text[] not null default '{}' check (
        cardinality(output_document_kind_codes) = 0
        or array_to_string(output_document_kind_codes, ',') ~ '^[a-z][a-z0-9_]{1,63}(,[a-z][a-z0-9_]{1,63})*$'
      ),
      source_stage_template_id uuid references catalog.procedure_stage_templates (id) on delete restrict,
      notes text check (length(notes) between 1 and 2000),
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid,
      constraint procedure_stages_procedure_fk foreign key (procedure_id, work_order_id)
        references procedures.procedures (id, work_order_id) on delete restrict,
      constraint procedure_stages_waiting_on check ((status = 'waiting') = (waiting_on is not null)),
      constraint procedure_stages_waiting_party check ((waiting_on = 'party') = (waiting_on_party_id is not null))
    )
  `.execute(db);
  await sql`
    create unique index procedure_stages_code_idx on procedures.procedure_stages (procedure_id, code) where deleted_at is null
  `.execute(db);
  await sql`
    create unique index procedure_stages_position_idx on procedures.procedure_stages (procedure_id, position) where deleted_at is null
  `.execute(db);
  await sql`
    create index procedure_stages_work_order_idx on procedures.procedure_stages (work_order_id) where deleted_at is null
  `.execute(db);
  await sql`
    create index procedure_stages_responsible_user_idx on procedures.procedure_stages (responsible_user_id)
      where responsible_user_id is not null and deleted_at is null
  `.execute(db);
  await sql`
    create index procedure_stages_due_date_idx on procedures.procedure_stages (due_date) where due_date is not null and deleted_at is null
  `.execute(db);

  await sql`grant usage on schema procedures to evia_app`.execute(db);
  await sql`grant select, insert, update on procedures.procedures to evia_app`.execute(db);
  await sql`grant select, insert, update on procedures.procedure_stages to evia_app`.execute(db);
}
