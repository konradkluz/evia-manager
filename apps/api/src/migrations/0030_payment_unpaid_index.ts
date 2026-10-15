/**
 * 0030 — the index of the summary of unpaid invoices (ADR-0003; EVM-055). Expand only: one partial index, no column, no constraint, no
 * backfill, nothing dropped or rewritten, no change of any privilege (the role `evia_app` keeps what 0026 gave it). It agrees with the
 * base predicate of the summary (`status = 'invoiced' AND deleted_at IS NULL`):
 * - `payment_milestones_unpaid_idx` on `(due_date, id)` serves "Najdłużej po terminie" — the milestones `invoiced` of every order, the
 *   earliest due date first, the page by a keyset on `(due_date, id)` and the set of orders with an unpaid invoice. The table holds the
 *   milestones of all orders, the index only the issued ones, so it stays small whatever the history of paid milestones is.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create index payment_milestones_unpaid_idx on payments.payment_milestones (due_date, id)
      where status = 'invoiced' and deleted_at is null
  `.execute(db);
}
