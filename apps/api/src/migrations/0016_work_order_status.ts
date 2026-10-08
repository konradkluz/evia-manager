/**
 * 0016 — the life cycle of a work order (ADR-0003, ADR-0017; EVM-030). Expand only: columns are added nullable; nothing is dropped,
 * renamed or rewritten and there is no backfill (the data on staging is synthetic). Rules:
 * - `resume_status`: the active status an order returns to after a hold, and the status a cancelled order is restored from; only the
 *   four active values (`new`, `quoting`, `accepted`, `in_progress`) are allowed;
 * - `status_reason`: the free-text reason of a hold or a cancellation (SR-DATA-01: it may name a person, so it is never audited,
 *   logged or returned by the API; it waits here for the journal of the order, EVM-038). 1..500 characters, the same bound as the
 *   contract;
 * - `status_changed_at`: when the status last changed (the application writes it with millisecond precision, like every time);
 * - `closed_at`: set when an order is settled or cancelled, cleared by a restoration; `completed_on`: the day (Europe/Warsaw) the
 *   work was completed, cleared by reopening. The coherence of these columns with the status is the rule of the transition table in
 *   the domain, not a CHECK: an order inserted by a test or by the field synchronisation later (EVM-043) is not forced through it.
 * The application role keeps SELECT, INSERT and UPDATE on the table (granted in 0010).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table work_orders.work_orders
      add column resume_status text check (resume_status in ('new', 'quoting', 'accepted', 'in_progress')),
      add column status_reason text check (length(status_reason) between 1 and 500),
      add column status_changed_at timestamptz,
      add column closed_at timestamptz,
      add column completed_on date
  `.execute(db);
}
