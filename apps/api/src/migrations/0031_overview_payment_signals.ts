/**
 * 0031 — the signals of payments in the read model of the list of work orders (ADR-0017 → "Model projekcji"; EVM-056). Expand only:
 * three columns with a default are added to `overview.work_order_summaries` (no rewrite of the table, nothing dropped or renamed, no
 * change of a privilege — the application role keeps the DML 0023 gave it, the read-only role still has nothing), and no backfill —
 * `rebuild` fills them after the deployment (CHANGELOG: `migrate` → `rebuild` at once; until then `verify` reports the group
 * `payments` for every order with an issued or paid milestone, and the payment views are empty).
 * Rules (W1, W3 of the ADR):
 * - counters and a date only — NO amount: the totals come from the facade of `payments` per page, under the policy of the caller;
 * - `invoiced_count`, `paid_count`: the live (not deleted) milestones `invoiced` and `paid`; never negative;
 * - `earliest_invoiced_due_date`: the earliest due date of the `invoiced` ones — a CHECK ties it to `invoiced_count` (an issued
 *   milestone always has a due date, 0028), so an error of the recomputation fails the transaction instead of drifting.
 * No index: the plans of the test of AC6 (10 000 orders) read the summaries in memory; a partial index would need a constant predicate.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table overview.work_order_summaries
      add column invoiced_count integer not null default 0 check (invoiced_count >= 0),
      add column paid_count integer not null default 0 check (paid_count >= 0),
      add column earliest_invoiced_due_date date,
      add constraint work_order_summaries_invoiced check ((invoiced_count = 0) = (earliest_invoiced_due_date is null))
  `.execute(db);
}
