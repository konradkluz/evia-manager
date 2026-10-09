/**
 * 0018 — the index of the other orders of a site (ADR-0003, ADR-0017; EVM-036). Expand only: one partial index, no column, no
 * constraint, no backfill, nothing dropped or rewritten, no change of any privilege (the role `evia_app` keeps what 0010 and 0015
 * gave it). It agrees with the read policy of work orders (`deleted_at IS NULL`):
 * - `work_orders_site_number_idx` on `(site_id, number desc, id desc)` serves the section "Inne zlecenia w tej lokalizacji" — the
 *   orders of one site, newest number first, the first 20 and their count.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create index work_orders_site_number_idx on work_orders.work_orders (site_id, number desc, id desc) where deleted_at is null
  `.execute(db);
}
