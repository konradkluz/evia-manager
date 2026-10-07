/**
 * 0010 — work orders schema (ADR-0003, ADR-0017; EVM-017): the minimum the list of work orders reads. Expand only. Rules:
 * - `work_orders` holds the identifier, the number, the title, the status and the common columns of the data conventions;
 *   the other columns of the model (customer, site, resume status, planned date, search text …) arrive with the stories that
 *   use them. `customer_id` and `site_id` are NOT created empty here: EVM-022 adds them with their foreign keys (the data on
 *   staging is synthetic, there is no backfill);
 * - `number` is `COLLATE "C"`: sorting and the keyset comparison are bytewise, whatever the ICU collation of the database
 *   (pl-PL). The format `ZL-YYYY-NNNN` sorts correctly only up to 9999 orders a year (fixed width) — EVM-022 adds the CHECK
 *   of the pattern and the yearly counter;
 * - the status is `text` + CHECK of the eight values of `WorkOrderStatus` (no ENUM type; a new value widens the constraint);
 * - `work_order_assignments`: the role is `coordinator` or `technician`; "active" means `deleted_at IS NULL` (common
 *   columns — there is no column outside the model), at most ONE active coordinator per order (partial unique index);
 * - indexes: the unique index on `number` serves the sort by number (the key is unique, no tie-break needed), the partial
 *   index `(created_at, id)` the sort by creation time; both are partial or unique and agree with the read policy
 *   (`deleted_at IS NULL`). No index on `status` (low cardinality) — the plan is confirmed by the EXPLAIN test of EVM-017;
 * - the application role gets SELECT, INSERT and UPDATE (soft delete only: no DELETE); the read-only role has no access.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create schema work_orders`.execute(db);
  await sql`revoke all on schema work_orders from public`.execute(db);

  await sql`
    create table work_orders.work_orders (
      id uuid primary key default uuidv7(),
      number text collate "C" not null unique check (length(number) between 1 and 32),
      title text not null check (length(title) between 1 and 200),
      status text not null check (
        status in ('new', 'quoting', 'accepted', 'in_progress', 'completed', 'settled', 'on_hold', 'cancelled')
      ),
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
    create index work_orders_created_at_id_idx on work_orders.work_orders (created_at, id) where deleted_at is null
  `.execute(db);

  await sql`
    create table work_orders.work_order_assignments (
      id uuid primary key default uuidv7(),
      work_order_id uuid not null references work_orders.work_orders (id),
      user_id uuid not null references identity.users (id),
      role text not null check (role in ('coordinator', 'technician')),
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
    create unique index work_order_assignments_one_coordinator_idx
      on work_orders.work_order_assignments (work_order_id) where role = 'coordinator' and deleted_at is null
  `.execute(db);
  await sql`
    create index work_order_assignments_coordinator_user_idx
      on work_orders.work_order_assignments (user_id) where role = 'coordinator' and deleted_at is null
  `.execute(db);

  await sql`grant usage on schema work_orders to evia_app`.execute(db);
  await sql`grant select, insert, update on work_orders.work_orders to evia_app`.execute(db);
  await sql`grant select, insert, update on work_orders.work_order_assignments to evia_app`.execute(db);
}
