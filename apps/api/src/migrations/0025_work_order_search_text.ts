/**
 * 0025 — the search text of a work order (ADR-0003, ADR-0017 W1; EVM-072; domain-model.md → `WorkOrder.searchText`). Expand only: ONE
 * generated column and ONE index on a table the module `work-orders` owns; nothing is dropped, renamed or rewritten, and the code of
 * 0010–0024 runs on this schema unchanged (it never writes the column — a generated one cannot be written).
 * - `search_text` is `f_unaccent(lower(number || ' ' || title))`, GENERATED ALWAYS … STORED: the database keeps it in step with the
 *   title (an edit or a redaction of the title changes it in the same statement, SR-PRIV-03) — there is no copy that could go stale
 *   and no backfill job. The title is free text and may name a person (DO-K), so the column is classified like `title`: never returned,
 *   logged or audited. The same `f_unaccent(lower(…))` is applied to the phrase by `searchTextMatches`, so "Garaz" meets "Garaż";
 * - the index is GIN `gin_trgm_ops`, partial `deleted_at IS NULL` (what every read condition says), like the indexes of 0014 and
 *   0011, so a phrase of three characters or more is served by the trigram index;
 * - adding a STORED generated column rewrites the table once (a table lock for the duration of the rewrite; the orders of the
 *   company number in the thousands, so it is short — the same cost the customers and sites paid in 0011 and 0014).
 * The grants of 0010 cover the column (the table level).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table work_orders.work_orders
      add column search_text text generated always as (public.f_unaccent(lower(number || ' ' || title))) stored
  `.execute(db);
  await sql`
    create index work_orders_search_text_trgm_idx on work_orders.work_orders using gin (search_text public.gin_trgm_ops)
      where deleted_at is null
  `.execute(db);
}
