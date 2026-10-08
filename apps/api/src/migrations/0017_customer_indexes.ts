/**
 * 0017 — indexes for the list of customers and for the history of a customer's orders (ADR-0003, ADR-0017; EVM-039). Expand only:
 * two partial indexes, no column, no constraint, no backfill, nothing dropped or rewritten, no change of any privilege (the role
 * `evia_app` keeps what 0010 and 0011 gave it). Both agree with the read policies (`deleted_at IS NULL`):
 * - `customers_sort_name_id_idx` on `(sort_name, id)` serves the keyset of the list and of the search — the order is the collation
 *   ICU of the database (`pl-PL`), the same expression in the WHERE and in the ORDER BY, so a page costs what the first one does;
 * - `work_orders_customer_created_idx` on `(customer_id, created_at desc, id desc)` serves the history of orders of one customer
 *   (`GET /work-orders?customerId=` with `sort=-createdAt`).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create index customers_sort_name_id_idx on customers.customers (sort_name, id) where deleted_at is null
  `.execute(db);
  await sql`
    create index work_orders_customer_created_idx on work_orders.work_orders (customer_id, created_at desc, id desc)
    where deleted_at is null
  `.execute(db);
}
