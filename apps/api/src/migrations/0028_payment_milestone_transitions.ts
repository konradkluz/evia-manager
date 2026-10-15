/**
 * 0028 — the transitions of a payment milestone (EVM-054; ADR-0003; domain-model.md → "Etap płatności"). Expand only: ONE nullable
 * column is added (no default, no rewrite of the table) and the rules of the statuses become CHECKs — the defence in depth behind the
 * table of transitions of the application (SR-API-07): whatever a defect of the application does, the database refuses
 * - an `invoiced` or `paid` milestone without its amount, invoice number, day of the invoice or due date;
 * - a `planned` milestone with the data of an invoice or a payment (a milestone becomes planned again only by a correction that clears
 *   them — EVM-057);
 * - a day of payment on a milestone that is not `paid`, and a `paid` one without it;
 * - a due date before the day of the invoice;
 * - the reason of a cancellation (`status_reason`, free text that may name a person — never in the audit trail, the journal or a log)
 *   on a milestone that is not `cancelled`, or longer than 500 characters.
 * There is no rule "paid not before invoiced" (an advance paid on a pro forma — no decision says otherwise). The checks are added
 * `NOT VALID` and validated by separate statements (the lighter lock of the scan, as in 0027); the rows of EVM-053 are `planned` or
 * `cancelled` without the data of an invoice and pass. The grants of 0026 cover the new column (UPDATE on the table).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table payments.payment_milestones
      add column status_reason text check (length(status_reason) between 1 and 500),
      add constraint payment_milestones_invoice_data check (
        status not in ('invoiced', 'paid')
        or (amount_minor is not null and invoice_number is not null and invoiced_on is not null and due_date is not null)
      ) not valid,
      add constraint payment_milestones_planned_clean check (
        status <> 'planned' or (invoice_number is null and invoiced_on is null and due_date is null and paid_on is null)
      ) not valid,
      add constraint payment_milestones_paid_on check ((status = 'paid') = (paid_on is not null)) not valid,
      add constraint payment_milestones_due_date check (due_date is null or invoiced_on is null or due_date >= invoiced_on) not valid,
      add constraint payment_milestones_status_reason check (status_reason is null or status = 'cancelled') not valid
  `.execute(db);
  await sql`alter table payments.payment_milestones validate constraint payment_milestones_invoice_data`.execute(db);
  await sql`alter table payments.payment_milestones validate constraint payment_milestones_planned_clean`.execute(db);
  await sql`alter table payments.payment_milestones validate constraint payment_milestones_paid_on`.execute(db);
  await sql`alter table payments.payment_milestones validate constraint payment_milestones_due_date`.execute(db);
  await sql`alter table payments.payment_milestones validate constraint payment_milestones_status_reason`.execute(db);
}
