/**
 * 0044 - the index of the view "Usunięci" of the customers (EVM-041; ADR-0003). Expand only: one partial index, nothing dropped, rewritten or
 * backfilled, no change of any privilege. `customers_sort_name_id_idx` (0017) serves the keyset of the list of live customers
 * (`deleted_at IS NULL`); the view of the deleted ones (`deleted_at IS NOT NULL`, the Administrator's) has the same order and the same
 * keyset, so it gets the same index. There is no trigram index for the deleted customers (YAGNI): they are a handful of rows, a
 * sequential scan after the filter is cheap; if it ever is not, a later expand migration adds it.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create index customers_deleted_sort_name_id_idx on customers.customers (sort_name, id) where deleted_at is not null
  `.execute(db);
}
