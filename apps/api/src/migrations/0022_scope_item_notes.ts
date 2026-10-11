/**
 * 0022 — the notes of a scope item (ADR-0003; EVM-035; domain-model.md → `ScopeItem.notes`). Expand only: ONE nullable column, nothing
 * is dropped, renamed or rewritten and there is no backfill (the items of an order created before this story have no notes —
 * synthetic data; the column is NULL exactly where there is nothing to say). Code of 0015–0021 runs on this schema unchanged: it
 * never writes the column.
 * - `notes` is a TYPED column, not a key of `parameters` (JSONB holds technical values only — SR-DATA-02): the notes of an item and
 *   the description of a "Inna usługa" (`custom_service`) are free text that may name a person, so they stay out of the JSONB, out
 *   of the audit trail and out of the journal. 1–1000 characters (the CHECK repeats the limit of the contract; an empty text is NULL).
 * The grants of 0015 cover the column (the table level).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table work_orders.scope_items
      add column notes text check (char_length(notes) between 1 and 1000)
  `.execute(db);
}
