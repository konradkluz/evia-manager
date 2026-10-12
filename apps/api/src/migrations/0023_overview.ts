/**
 * 0023 — the read model of the list of work orders and of the summary (ADR-0017, EVM-034): the new schema `overview` with the tables
 * `work_order_summaries` (one row per order, soft deleted ones too) and `work_order_waits` (one row per stage that waits).
 * Expand only: the tables are new, nothing is dropped, renamed or rewritten, and there is no backfill — `rebuild` fills the
 * projection after the deployment (the runbook of the operations), and from then on the transaction of every change keeps it current.
 * Rules (W1, W10, W11 of the ADR):
 * - the list of columns is CLOSED: keys, codes, dates and counters only — no title, name, description, reason, note, amount or search
 *   text, and no column of payments (they arrive with EVM-056 as an expand). Text appears only as a code under a CHECK;
 * - the chain of keys `work_orders` → `work_order_summaries` → `work_order_waits` is `ON DELETE CASCADE`, so a purge of an order takes
 *   its projection with it. The waits point at the PROJECTION row, not at the order (the lock cycle of ADR-0017 → "Współbieżność");
 *   there is no key to a site, a customer, a party or a stage — the projection holds identifiers, not references;
 * - `deleted_at` is the authorisation column (W2) — the read policy of the list is a condition on it;
 * - the application role has SELECT, INSERT and UPDATE on the summaries and DELETE only on the waits (they are replaced by the
 *   recomputation; the cascade of a purge runs with the rights of the owner); the read-only role has no access; no trigger.
 * - the outbox of security alerts accepts one more code, `projection_authz_drift` (W2: `verify` found a difference of the
 *   authorisation column) — the CHECK is widened, no row changes.
 * Times are written by the application (no `now()` defaults). Dates are `date` columns.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create schema overview`.execute(db);
  await sql`revoke all on schema overview from public`.execute(db);

  await sql`
    create table overview.work_order_summaries (
      work_order_id uuid primary key references work_orders.work_orders (id) on delete cascade,
      number text collate "C" not null check (length(number) between 1 and 32),
      status text not null check (
        status in ('new', 'quoting', 'accepted', 'in_progress', 'completed', 'settled', 'on_hold', 'cancelled')
      ),
      created_at timestamptz not null,
      deleted_at timestamptz,
      coordinator_user_id uuid,
      customer_id uuid,
      site_id uuid,
      site_type text check (site_type ~ '^[a-z][a-z0-9_]{1,63}$'),
      source_template_id uuid,
      waiting_count integer not null default 0 check (waiting_count >= 0),
      longest_waiting_since date,
      longest_waiting_on text check (longest_waiting_on in ('customer', 'party')),
      longest_waiting_party_id uuid,
      next_due_date date,
      recomputed_at timestamptz not null,
      constraint work_order_summaries_longest_waiting check (
        (longest_waiting_since is null) = (longest_waiting_on is null)
        and (longest_waiting_since is null) = (waiting_count = 0)
        and ((longest_waiting_on = 'party') = (longest_waiting_party_id is not null))
      )
    )
  `.execute(db);
  await sql`create index work_order_summaries_customer_idx on overview.work_order_summaries (customer_id)`.execute(db);
  await sql`create index work_order_summaries_site_idx on overview.work_order_summaries (site_id)`.execute(db);
  await sql`
    create index work_order_summaries_coordinator_idx on overview.work_order_summaries (coordinator_user_id)
  `.execute(db);

  await sql`
    create table overview.work_order_waits (
      stage_id uuid primary key,
      work_order_id uuid not null references overview.work_order_summaries (work_order_id) on delete cascade,
      waiting_on text not null check (waiting_on in ('customer', 'party')),
      party_id uuid,
      party_kind text check (party_kind ~ '^[a-z][a-z0-9_]{1,63}$'),
      waiting_since date not null,
      constraint work_order_waits_party check (
        (waiting_on = 'party') = (party_id is not null) and (waiting_on = 'party') = (party_kind is not null)
      )
    )
  `.execute(db);
  await sql`
    create index work_order_waits_kind_idx on overview.work_order_waits (waiting_on, party_kind, waiting_since)
  `.execute(db);
  await sql`create index work_order_waits_order_idx on overview.work_order_waits (work_order_id)`.execute(db);
  await sql`create index work_order_waits_party_idx on overview.work_order_waits (party_id)`.execute(db);

  await sql`
    alter table platform.security_alert_outbox drop constraint security_alert_outbox_alert_code_check,
      add constraint security_alert_outbox_alert_code_check check (alert_code in ('emergency_reset', 'projection_authz_drift'))
  `.execute(db);

  await sql`grant usage on schema overview to evia_app`.execute(db);
  await sql`grant select, insert, update on overview.work_order_summaries to evia_app`.execute(db);
  await sql`grant select, insert, update, delete on overview.work_order_waits to evia_app`.execute(db);
}
