/**
 * 0058 — the quick work order of the phone (EVM-099; ADR-0008, ADR-0021; SR-SYNC-03, SR-API-07, SR-LOG-03). Expand only: nullable or defaulted columns, CHECKs
 * added `not valid` and validated, one new table, two partial indexes, and the closed lists of the audit trail and of the alert codes widened. Nothing is dropped,
 * renamed or rewritten (the default of `origin` is a constant, so PostgreSQL does not rewrite the table) and there is no backfill. Version N-1 keeps working: it
 * never names the new columns, `origin` defaults to `office`, and the widened CHECKs accept everything it writes.
 *
 * - `work_orders.work_orders.origin` (`office` | `mobile_quick`, default `office`) and `created_via_device_id`: the order created by `CreateQuickWorkOrder` carries the
 *   device of the session. CHECK: an order of the phone has a device, and only such an order has one. WITHOUT a foreign key on purpose (like 0056): a pseudonymous
 *   identifier of the worker's device kept as long as the order, so the register of devices stays free to remove a device after 90 days (the rule of
 *   `idempotency_expired` and the limit of new objects compare it).
 * - `customers.customers.created_via_device_id`, `sites.sites.created_via_device_id`: the same, nullable, no CHECK (the panel leaves it empty). The anonymization of a customer does
 *   not clear it: it is a datum of the worker, not of the customer. A partial index `(created_via_device_id, created_at)` serves the limit of 20 new customers or sites per
 *   device in 24 hours (AC7).
 * - `audit.events.quota_kind` and the CHECK of the mutation fields: `command_type` may also be `CreateQuickWorkOrder`, and the new event `sync.quota_exceeded` carries the
 *   device and the kind (`customer` | `site`) and nothing else.
 * - `sync.quota_alerts`: one row per device, kind and hour - the deduplication of the alert and of the audit event of an exceeded limit (a stolen phone could send
 *   thousands of refused commands a minute).
 * - `platform.security_alert_outbox.alert_code`: the COMPLETE list of 0055 plus `sync_quick_create_quota_exceeded`.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table work_orders.work_orders
      add column origin text not null default 'office',
      add column created_via_device_id uuid,
      add constraint work_orders_origin_check check (origin in ('office', 'mobile_quick'))
  `.execute(db);
  await sql`
    alter table work_orders.work_orders
      add constraint work_orders_device_of_mobile check ((origin = 'mobile_quick') = (created_via_device_id is not null)) not valid
  `.execute(db);
  await sql`alter table work_orders.work_orders validate constraint work_orders_device_of_mobile`.execute(db);

  await sql`alter table customers.customers add column created_via_device_id uuid`.execute(db);
  await sql`alter table sites.sites add column created_via_device_id uuid`.execute(db);
  await sql`
    create index customers_created_via_device_idx on customers.customers (created_via_device_id, created_at)
      where created_via_device_id is not null
  `.execute(db);
  await sql`
    create index sites_created_via_device_idx on sites.sites (created_via_device_id, created_at)
      where created_via_device_id is not null
  `.execute(db);

  await sql`alter table audit.events add column quota_kind text`.execute(db);
  await sql`alter table audit.events drop constraint events_mutation_fields`.execute(db);
  await sql`
    alter table audit.events
      add constraint events_mutation_fields check (
        (device_id is null and work_order_id is null and command_type is null and quota_kind is null)
        or (device_id is not null and work_order_id is not null and quota_kind is null
            and coalesce(command_type in ('CreateNote', 'CreateComment', 'CreateQuickWorkOrder'), false))
        or (device_id is not null and work_order_id is null and command_type is null and coalesce(quota_kind in ('customer', 'site'), false))
      ) not valid
  `.execute(db);
  await sql`alter table audit.events validate constraint events_mutation_fields`.execute(db);

  await sql`
    create table sync.quota_alerts (
      device_id uuid not null references identity.devices (id) on delete cascade,
      kind text not null check (kind in ('customer', 'site')),
      window_start timestamptz not null,
      primary key (device_id, kind, window_start)
    )
  `.execute(db);
  await sql`revoke all on sync.quota_alerts from public`.execute(db);
  await sql`grant select, insert, update, delete on sync.quota_alerts to evia_app`.execute(db);

  await sql`
    alter table platform.security_alert_outbox
      drop constraint security_alert_outbox_alert_code_check,
      add constraint security_alert_outbox_alert_code_check
        check (alert_code in (
          'emergency_reset', 'projection_authz_drift', 'login_failure_spike', 'second_step_failure_spike', 'account_locked',
          'media_quarantined', 'signature_stale', 'signature_stale_72h', 'sync_full_downloads_excess', 'sync_snapshot_rate_exceeded',
          'sync_quick_create_quota_exceeded'
        ))
  `.execute(db);
}
