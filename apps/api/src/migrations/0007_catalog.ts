/**
 * 0007 — catalog schema (ADR-0003; EVM-019): the service catalogue, process templates with stages, document kinds, work
 * order templates with items and payment plans. Expand only. Rules:
 * - the application role can only READ the configuration (SELECT, nothing else — EVM-019 AC6, SR-AUTHZ-01, least
 *   privilege): the starting data is written by the migration role (data migration `0008`), a later change is a new
 *   migration, the editor is M4. Grants are explicit, per table, with no default privileges;
 * - every domain table has the common columns of the data conventions (`id`, `created_*`, `updated_*`, `version`,
 *   `deleted_*`); times are written by the application or by a migration literal — there are no `now()` defaults;
 * - every `code` column has the CHECK `^[a-z][a-z0-9_]{1,63}$` (stable configuration codes); the small vocabularies are
 *   CHECK constraints (no ENUM types); shares are 1..100;
 * - `default_parameters` is a JSON object of at most 16 KB measured as UTF-8 bytes of its text form (`octet_length`, not
 *   `pg_column_size`, which measures the compressed TOAST value and would let larger data through);
 * - the output document kinds of a stage are an array column (domain-model.md) and cannot be a foreign key: the
 *   consistency check of the configuration (`validateCatalogConfig`) and the test of the data guard them.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create schema catalog`.execute(db);
  await sql`revoke all on schema catalog from public`.execute(db);

  await sql`
    create table catalog.document_kinds (
      id uuid primary key default uuidv7(),
      code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (length(name) between 1 and 200),
      confidentiality text not null check (confidentiality in ('identity_data', 'building_security', 'standard')),
      position integer not null unique check (position between 1 and 100),
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid
    )
  `.execute(db);

  await sql`
    create table catalog.procedure_templates (
      id uuid primary key default uuidv7(),
      code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (length(name) between 1 and 200),
      is_active boolean not null default true,
      position integer not null unique check (position between 1 and 100),
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid
    )
  `.execute(db);

  await sql`
    create table catalog.procedure_stage_templates (
      id uuid primary key default uuidv7(),
      procedure_template_id uuid not null references catalog.procedure_templates (id),
      code text not null check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (length(name) between 1 and 200),
      position integer not null check (position between 1 and 50),
      default_waiting_on text check (default_waiting_on in ('customer', 'party')),
      default_waiting_on_party_kind text check (
        default_waiting_on_party_kind in (
          'building_administration', 'property_manager', 'housing_community', 'designer', 'fire_safety_expert',
          'technical_expert', 'distribution_system_operator', 'subcontractor', 'supplier', 'other'
        )
      ),
      output_document_kind_codes text[] not null default '{}' check (
        cardinality(output_document_kind_codes) = 0
        or array_to_string(output_document_kind_codes, ',') ~ '^[a-z][a-z0-9_]{1,63}(,[a-z][a-z0-9_]{1,63})*$'
      ),
      check (coalesce(default_waiting_on = 'party', false) = (default_waiting_on_party_kind is not null)),
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid,
      unique (procedure_template_id, code),
      unique (procedure_template_id, position)
    )
  `.execute(db);

  await sql`
    create table catalog.service_catalog_items (
      id uuid primary key default uuidv7(),
      code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (length(name) between 1 and 200),
      category text not null check (category in ('equipment', 'installation', 'formal', 'engineering', 'acceptance', 'other')),
      parameter_set_code text check (
        parameter_set_code in ('charger_spec', 'charger_installation', 'supply_circuit', 'connection_power', 'dso_request')
      ),
      is_active boolean not null default true,
      position integer not null unique check (position between 1 and 100),
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid
    )
  `.execute(db);

  await sql`
    create table catalog.service_catalog_item_procedures (
      catalog_item_id uuid not null references catalog.service_catalog_items (id),
      procedure_template_id uuid not null references catalog.procedure_templates (id),
      position integer not null check (position between 1 and 20),
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid,
      primary key (catalog_item_id, procedure_template_id),
      unique (catalog_item_id, position)
    )
  `.execute(db);
  await sql`
    create index service_catalog_item_procedures_procedure_template_id_idx
      on catalog.service_catalog_item_procedures (procedure_template_id)
  `.execute(db);

  await sql`
    create table catalog.work_order_templates (
      id uuid primary key default uuidv7(),
      code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (length(name) between 1 and 200),
      site_type_hint text check (site_type_hint in ('single_family_house', 'multi_family_garage', 'commercial', 'other')),
      is_active boolean not null default true,
      position integer not null unique check (position between 1 and 100),
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid
    )
  `.execute(db);

  await sql`
    create table catalog.work_order_template_items (
      id uuid primary key default uuidv7(),
      work_order_template_id uuid not null references catalog.work_order_templates (id),
      catalog_item_id uuid not null references catalog.service_catalog_items (id),
      position integer not null check (position between 1 and 50),
      default_quantity integer not null default 1 check (default_quantity between 1 and 100),
      default_parameters jsonb not null default '{}'::jsonb check (
        jsonb_typeof(default_parameters) = 'object' and octet_length(default_parameters::text) <= 16384
      ),
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid,
      unique (work_order_template_id, position),
      unique (work_order_template_id, catalog_item_id)
    )
  `.execute(db);
  await sql`create index work_order_template_items_catalog_item_id_idx on catalog.work_order_template_items (catalog_item_id)`.execute(db);

  await sql`
    create table catalog.payment_milestone_templates (
      id uuid primary key default uuidv7(),
      work_order_template_id uuid not null references catalog.work_order_templates (id),
      code text not null check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (length(name) between 1 and 200),
      position integer not null check (position between 1 and 20),
      share_percent integer not null check (share_percent between 1 and 100),
      invoice_hint text not null check (length(invoice_hint) between 1 and 200),
      payment_term_days integer not null check (payment_term_days between 0 and 365),
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid,
      unique (work_order_template_id, code),
      unique (work_order_template_id, position)
    )
  `.execute(db);

  await sql`grant usage on schema catalog to evia_app`.execute(db);
  await sql`grant select on catalog.document_kinds to evia_app`.execute(db);
  await sql`grant select on catalog.procedure_templates to evia_app`.execute(db);
  await sql`grant select on catalog.procedure_stage_templates to evia_app`.execute(db);
  await sql`grant select on catalog.service_catalog_items to evia_app`.execute(db);
  await sql`grant select on catalog.service_catalog_item_procedures to evia_app`.execute(db);
  await sql`grant select on catalog.work_order_templates to evia_app`.execute(db);
  await sql`grant select on catalog.work_order_template_items to evia_app`.execute(db);
  await sql`grant select on catalog.payment_milestone_templates to evia_app`.execute(db);
}
