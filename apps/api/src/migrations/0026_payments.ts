/**
 * 0026 — the payment milestones of a work order (ADR-0003, ADR-0017; EVM-053): the new schema `payments` with the table
 * `payment_milestones`. Expand only: the table is new, nothing is dropped, renamed or rewritten, and there is no backfill (an order
 * created before this story has no milestones; the office adds them by hand). Rules:
 * - a milestone is a COPY of a milestone of the payment plan of the template (D1): `code`, `name`, `share_percent` and
 *   `payment_term_days` are the copy and `source_template_id` says where it came from; a milestone added by hand has them `null`
 *   (but the name). The name is 1–200 characters like the template (the API limits the input to 120 code points — a copy from a
 *   template never breaks the creation of an order);
 * - the amount is gross, in grosze (`bigint`, never a float — D5) with its currency: both or neither, `PLN` only, 1 ..
 *   99 999 999 999. It may be empty only in `planned` or `cancelled` (a milestone that was never priced and is cancelled with its order);
 * - the status is `text` + CHECK of the four values of `PaymentMilestoneStatus` (no ENUM type), `planned` by default: the server
 *   decides it. The invoice, the due date and the payment (EVM-054) are here already and stay empty until then, so that story adds
 *   no column;
 * - the anchor `work_order_id` (D10) is a key to the order, `ON DELETE RESTRICT` like every key here (rows are soft deleted). At most
 *   ONE active milestone per `position` in an order (a partial unique index: soft delete frees it); `position` is bounded by the CHECK
 *   to the limit of the API (20 milestones per order, enforced by the application under the lock of the order);
 * - the application role gets SELECT, INSERT and UPDATE (soft delete only: NO DELETE); the read-only role has no access.
 * Times are written by the application (no `now()` defaults).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create schema payments`.execute(db);
  await sql`revoke all on schema payments from public`.execute(db);

  await sql`
    create table payments.payment_milestones (
      id uuid primary key default uuidv7() check (uuid_extract_version(id) = 7),
      work_order_id uuid not null references work_orders.work_orders (id) on delete restrict,
      code text check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (length(name) between 1 and 200),
      position integer not null check (position between 1 and 20),
      share_percent integer check (share_percent between 1 and 100),
      payment_term_days integer check (payment_term_days between 0 and 365),
      amount_minor bigint check (amount_minor between 1 and 99999999999),
      currency text check (currency = 'PLN'),
      status text not null default 'planned' check (status in ('planned', 'invoiced', 'paid', 'cancelled')),
      invoice_number text check (length(invoice_number) between 1 and 60),
      invoiced_on date,
      due_date date,
      paid_on date,
      source_template_id uuid references catalog.payment_milestone_templates (id) on delete restrict,
      notes text check (length(notes) between 1 and 2000),
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid,
      constraint payment_milestones_currency check ((amount_minor is null) = (currency is null)),
      constraint payment_milestones_amount check (amount_minor is not null or status in ('planned', 'cancelled'))
    )
  `.execute(db);
  await sql`
    create unique index payment_milestones_position_idx on payments.payment_milestones (work_order_id, position) where deleted_at is null
  `.execute(db);

  await sql`grant usage on schema payments to evia_app`.execute(db);
  await sql`grant select, insert, update on payments.payment_milestones to evia_app`.execute(db);
}
