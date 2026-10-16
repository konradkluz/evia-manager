/**
 * 0033 — the index of the view "Usunięte" (EVM-060; ADR-0003, ADR-0017). Expand only: one partial index, no column, no constraint, no
 * backfill, nothing dropped or rewritten, no change of any privilege (the role `evia_app` keeps what 0023 gave it). The soft deleted
 * orders are few against the live ones, and every read condition of the application says `deleted_at IS NULL` — so the view of the
 * Administrator, whose condition is the opposite (`deleted_at IS NOT NULL`, the mode `deleted` of the read policy), gets an index of its
 * own that holds only the deleted rows and stays small whatever the history of the live ones is.
 * - `work_order_summaries_deleted_idx` on `(deleted_at DESC, work_order_id)` where `deleted_at IS NOT NULL`: serves the page of the
 *   deleted orders (the latest deletion first) and the count of how many there are.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create index work_order_summaries_deleted_idx on overview.work_order_summaries (deleted_at desc, work_order_id)
      where deleted_at is not null
  `.execute(db);
}
