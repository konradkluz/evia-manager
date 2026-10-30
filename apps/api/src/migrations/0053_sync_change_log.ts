/**
 * 0053 — the change log of the synchronisation (EVM-096; ADR-0021 D2, D4). Expand only: a new schema `sync`, nothing existing changes except the three triggers.
 *
 * - `sync.change_log`: one row per change of a synchronised row (`seq` identity, `txid` of the writing transaction, type, identifier, `upsert`/`delete`, the anchor
 *   order, the version). NO personal data and no content of the row: the reader reads the CURRENT state of the entity the row names. The application role has
 *   `SELECT` and nothing else, so it can neither fabricate nor erase a row; the sequence is not granted either.
 * - `sync.record_change()`: the generic trigger function (SECURITY DEFINER, pinned `search_path`, every object qualified, no dynamic SQL — the name of the anchor
 *   column is a key of `to_jsonb(row)`). Per synchronised table two `AFTER … FOR EACH ROW` triggers: INSERT/DELETE, and UPDATE only when the row really changed.
 *   `evia_app` is not the owner of the tables, so it cannot disable them; `session_replication_role` is not available to it.
 * - `sync.device_sync_state`: the periodic resync (`last_full_sync_at`, the flag `resync_requested_reason`) per device.
 * - `sync.full_downloads`: one row per full download of a device (the rolling limit of 24 hours, AB-08) with the counts of the entities served by type, and the
 *   life of the download (`last_after`, `prev_after`, `completed_at`): a cursor of the snapshot is accepted only while the download is open, young and moves forward
 *   (a cursor replayed after the end, or from before the previous page, would hand out the snapshot again outside the limit - AB-08).
 * - `sync.device_sync_state.last_pulled_at`: the base measure of the alert "the device pulls for over 3 days and sends nothing" (the alert itself: EVM-098).
 * - `audit.events`: three NULLABLE counters (work orders, customers, sites) - only the event `sync.full_download_completed` fills them (AC8: the trail holds the
 *   counts by type); all three or none (CHECK, as in 0029). Append-only triggers and grants of 0003 stay as they are.
 * - `platform.security_alert_outbox.alert_code`: the COMPLETE list of 0048 plus `sync_full_downloads_excess` (the third full download of a device in 24 hours).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create schema sync`.execute(db);
  await sql`revoke all on schema sync from public`.execute(db);
  await sql`grant usage on schema sync to evia_app`.execute(db);

  await sql`
    create table sync.change_log (
      seq bigint generated always as identity primary key,
      txid xid8 not null default pg_catalog.pg_current_xact_id(),
      entity_type text not null check (length(entity_type) between 1 and 64),
      entity_id uuid not null,
      operation text not null check (operation in ('upsert', 'delete')),
      work_order_id uuid,
      entity_version integer not null check (entity_version >= 1),
      recorded_at timestamptz not null default pg_catalog.clock_timestamp()
    )
  `.execute(db);
  await sql`create index change_log_txid_seq_idx on sync.change_log (txid, seq)`.execute(db);
  await sql`create index change_log_entity_idx on sync.change_log (entity_id, txid, seq)`.execute(db);
  await sql`revoke all on sync.change_log from public`.execute(db);
  await sql`grant select on sync.change_log to evia_app`.execute(db);

  await sql`
    create function sync.record_change() returns trigger
    language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
    as $$
    declare
      subject jsonb;
      kind text;
      anchor text;
    begin
      if TG_OP = 'DELETE' then
        subject := pg_catalog.to_jsonb(OLD);
        kind := 'delete';
      else
        subject := pg_catalog.to_jsonb(NEW);
        kind := case
          when TG_OP = 'UPDATE' and (subject ->> 'deleted_at') is not null and (pg_catalog.to_jsonb(OLD) ->> 'deleted_at') is null then 'delete'
          else 'upsert'
        end;
      end if;
      anchor := case when TG_ARGV[1] = '' then null else subject ->> TG_ARGV[1] end;
      insert into sync.change_log (entity_type, entity_id, operation, work_order_id, entity_version)
      values (TG_ARGV[0], (subject ->> 'id')::uuid, kind, anchor::uuid, (subject ->> 'version')::integer);
      return null;
    end
    $$
  `.execute(db);
  await sql`revoke all on function sync.record_change() from public`.execute(db);

  await sql`
    create trigger record_change_insert_delete after insert or delete on work_orders.work_orders
      for each row execute function sync.record_change('work_order', 'id')
  `.execute(db);
  await sql`
    create trigger record_change_update after update on work_orders.work_orders
      for each row when (old.* is distinct from new.*) execute function sync.record_change('work_order', 'id')
  `.execute(db);
  await sql`
    create trigger record_change_insert_delete after insert or delete on customers.customers
      for each row execute function sync.record_change('customer', '')
  `.execute(db);
  await sql`
    create trigger record_change_update after update on customers.customers
      for each row when (old.* is distinct from new.*) execute function sync.record_change('customer', '')
  `.execute(db);
  await sql`
    create trigger record_change_insert_delete after insert or delete on sites.sites
      for each row execute function sync.record_change('site', '')
  `.execute(db);
  await sql`
    create trigger record_change_update after update on sites.sites
      for each row when (old.* is distinct from new.*) execute function sync.record_change('site', '')
  `.execute(db);

  await sql`
    create table sync.device_sync_state (
      device_id uuid primary key references identity.devices (id) on delete cascade,
      last_full_sync_at timestamptz,
      resync_requested_reason text check (resync_requested_reason in ('periodic', 'access_changed', 'scope_changed', 'cursor_expired', 'cursor_invalid')),
      last_pulled_at timestamptz,
      updated_at timestamptz not null
    )
  `.execute(db);
  await sql`grant select, insert, update on sync.device_sync_state to evia_app`.execute(db);

  await sql`
    create table sync.full_downloads (
      id uuid primary key default uuidv7(),
      device_id uuid not null references identity.devices (id) on delete cascade,
      user_id uuid not null,
      reason text not null check (reason in ('initial', 'periodic', 'access_changed', 'scope_changed', 'cursor_expired', 'cursor_invalid', 'requested')),
      started_at timestamptz not null,
      completed_at timestamptz,
      last_after uuid,
      prev_after uuid,
      work_order_count integer not null default 0 check (work_order_count >= 0),
      customer_count integer not null default 0 check (customer_count >= 0),
      site_count integer not null default 0 check (site_count >= 0)
    )
  `.execute(db);
  await sql`create index full_downloads_device_started_idx on sync.full_downloads (device_id, started_at)`.execute(db);
  await sql`grant select, insert, update on sync.full_downloads to evia_app`.execute(db);

  await sql`
    alter table audit.events
      add column work_order_count integer,
      add column customer_count integer,
      add column site_count integer,
      add constraint events_entity_counts check (
        (work_order_count is null and customer_count is null and site_count is null)
        or (work_order_count >= 0 and customer_count >= 0 and site_count >= 0)
      ) not valid
  `.execute(db);
  await sql`alter table audit.events validate constraint events_entity_counts`.execute(db);

  await sql`
    alter table platform.security_alert_outbox
      drop constraint security_alert_outbox_alert_code_check,
      add constraint security_alert_outbox_alert_code_check
        check (alert_code in (
          'emergency_reset', 'projection_authz_drift', 'login_failure_spike', 'second_step_failure_spike', 'account_locked',
          'media_quarantined', 'signature_stale', 'signature_stale_72h', 'sync_full_downloads_excess'
        ))
  `.execute(db);
}
