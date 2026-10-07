/**
 * 0015 — creation of a work order from a template (ADR-0003, ADR-0017; EVM-022). Expand only: columns are added nullable and a
 * table is new; nothing is dropped, renamed or rewritten. Rules:
 * - `work_orders` gets the customer, the site, the template it was copied from, the planned date and the description. The keys
 *   to `customers` and `sites` are `ON DELETE RESTRICT` (no cascade: a customer and a site are soft deleted, and a delete that
 *   would orphan an order fails — a purge has to deal with the orders first, E8). The key to the template is `RESTRICT` as well;
 *   the order holds a COPY of the template (D1), the key only says where the copy came from. The columns stay NULLABLE in the
 *   database (expand; an order created in the field is completed later — EVM-043), the API requires them;
 * - the CHECK of the number repeats the format `ZL-YYYY-NNNN` (at least four digits; the fixed width sorts correctly up to 9999 a
 *   year, see 0010), and the CHECK of the identifier says the client sends a UUIDv7 (the contract answers 400 first);
 * - `scope_items`: the copy of a template item (code, name, parameter set, parameters, quantity) with the catalogue item it came
 *   from. `parameters` is a JSON object of at most 16 KB and holds technical values only (never a person or a point of supply). The
 *   position is unique among the ACTIVE items of an order (soft delete frees it); the anchor `work_order_id` is NOT NULL (D10);
 * - `number_counters`: ONE row per year; the next number is `INSERT … ON CONFLICT (year) DO UPDATE … RETURNING` in the transaction
 *   of the creation — not a sequence, because a sequence is not rolled back and would leave gaps. The row lock serialises the
 *   creations; a rollback undoes the use of a number;
 * - the application role gets SELECT, INSERT and UPDATE on the two new tables and NO DELETE (soft delete only; the counter is
 *   never deleted); the read-only role has no access.
 * Times are written by the application (no `now()` defaults).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table work_orders.work_orders
      add column customer_id uuid references customers.customers (id) on delete restrict,
      add column site_id uuid references sites.sites (id) on delete restrict,
      add column source_template_id uuid references catalog.work_order_templates (id) on delete restrict,
      add column planned_date date,
      add column description text check (length(description) between 1 and 2000),
      add constraint work_orders_number_format check (number ~ '^ZL-[0-9]{4}-[0-9]{4,}$'),
      add constraint work_orders_id_is_uuidv7 check (uuid_extract_version(id) = 7)
  `.execute(db);

  await sql`
    create table work_orders.scope_items (
      id uuid primary key default uuidv7() check (uuid_extract_version(id) = 7),
      work_order_id uuid not null references work_orders.work_orders (id) on delete restrict,
      source_catalog_item_id uuid references catalog.service_catalog_items (id) on delete restrict,
      position integer not null check (position between 1 and 50),
      code text not null check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (length(name) between 1 and 200),
      parameter_set_code text check (parameter_set_code ~ '^[a-z][a-z0-9_]{1,63}$'),
      parameters jsonb not null default '{}'::jsonb check (
        jsonb_typeof(parameters) = 'object' and octet_length(parameters::text) <= 16384
      ),
      quantity integer not null default 1 check (quantity between 1 and 100),
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
    create unique index scope_items_position_idx on work_orders.scope_items (work_order_id, position) where deleted_at is null
  `.execute(db);

  await sql`
    create table work_orders.number_counters (
      year integer primary key check (year between 2000 and 2999),
      last_value integer not null check (last_value >= 1)
    )
  `.execute(db);

  await sql`grant select, insert, update on work_orders.scope_items to evia_app`.execute(db);
  await sql`grant select, insert, update on work_orders.number_counters to evia_app`.execute(db);
}
