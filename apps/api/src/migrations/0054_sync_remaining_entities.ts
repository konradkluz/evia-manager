/**
 * 0054 — the remaining synchronised entities and the limit of the snapshots (EVM-097; ADR-0021 D3, D4). Expand only: triggers and two new objects, nothing
 * existing changes except the closed list of alert codes and one NULLABLE column of the audit trail.
 *
 * - Triggers `sync.record_change` (the function of 0053, unchanged) on `work_orders.scope_items`, `parties.parties`, `procedures.procedure_stages`,
 *   `timeline.timeline_entries` (anchored to the order, the parties without an anchor) and on `identity.users`. The users trigger on UPDATE fires ONLY when
 *   the display name or the deletion changed: `version` is bumped by a change of the role and by a reset of the second step (`access-queries.ts`), and a
 *   trigger that reacted to it would show a technician that an Administrator touched the account of a colleague (SR-SYNC-04).
 * - `sync.record_procedure_change()`: a process is not an entity of the phone - its code and name travel inside each stage - so a change of the code, the name
 *   or the deletion of a process writes one row `procedure_stage` for each of its stages. SECURITY DEFINER, pinned `search_path`, every object qualified, no
 *   dynamic SQL, like `sync.record_change()`; `evia_app` has no `INSERT` on the log.
 * - `sync.snapshot_requests`: one counter per device and hour for `GET /api/v1/sync/work-orders/{id}` (120 per hour, SR-API-02). It lives in the database,
 *   because the API runs in several processes; the increment is one atomic `INSERT … ON CONFLICT`. `alerted` keeps the alert of the window to once per device.
 * - `audit.events.entity_count`: the number of entities of a served snapshot (`sync.work_order_snapshot`), the only number the trail holds for it.
 * - `platform.security_alert_outbox.alert_code`: the COMPLETE list of 0053 plus `sync_snapshot_rate_exceeded`.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create trigger record_change_insert_delete after insert or delete on work_orders.scope_items
      for each row execute function sync.record_change('scope_item', 'work_order_id')
  `.execute(db);
  await sql`
    create trigger record_change_update after update on work_orders.scope_items
      for each row when (old.* is distinct from new.*) execute function sync.record_change('scope_item', 'work_order_id')
  `.execute(db);
  await sql`
    create trigger record_change_insert_delete after insert or delete on procedures.procedure_stages
      for each row execute function sync.record_change('procedure_stage', 'work_order_id')
  `.execute(db);
  await sql`
    create trigger record_change_update after update on procedures.procedure_stages
      for each row when (old.* is distinct from new.*) execute function sync.record_change('procedure_stage', 'work_order_id')
  `.execute(db);
  await sql`
    create trigger record_change_insert_delete after insert or delete on timeline.timeline_entries
      for each row execute function sync.record_change('timeline_entry', 'work_order_id')
  `.execute(db);
  await sql`
    create trigger record_change_update after update on timeline.timeline_entries
      for each row when (old.* is distinct from new.*) execute function sync.record_change('timeline_entry', 'work_order_id')
  `.execute(db);
  await sql`
    create trigger record_change_insert_delete after insert or delete on parties.parties
      for each row execute function sync.record_change('party', '')
  `.execute(db);
  await sql`
    create trigger record_change_update after update on parties.parties
      for each row when (old.* is distinct from new.*) execute function sync.record_change('party', '')
  `.execute(db);
  await sql`
    create trigger record_change_insert_delete after insert or delete on identity.users
      for each row execute function sync.record_change('user', '')
  `.execute(db);
  await sql`
    create trigger record_change_update after update on identity.users
      for each row when ((old.display_name, old.deleted_at) is distinct from (new.display_name, new.deleted_at))
      execute function sync.record_change('user', '')
  `.execute(db);

  await sql`
    create function sync.record_procedure_change() returns trigger
    language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
    as $$
    begin
      insert into sync.change_log (entity_type, entity_id, operation, work_order_id, entity_version)
      select 'procedure_stage', stage.id, case when new.deleted_at is not null then 'delete' else 'upsert' end, stage.work_order_id, stage.version
      from procedures.procedure_stages stage
      where stage.procedure_id = new.id and stage.deleted_at is null;
      return null;
    end
    $$
  `.execute(db);
  await sql`revoke all on function sync.record_procedure_change() from public`.execute(db);
  await sql`
    create trigger record_procedure_change after update on procedures.procedures
      for each row when ((old.code, old.name, old.deleted_at) is distinct from (new.code, new.name, new.deleted_at))
      execute function sync.record_procedure_change()
  `.execute(db);

  await sql`
    create table sync.snapshot_requests (
      device_id uuid not null references identity.devices (id) on delete cascade,
      window_start timestamptz not null,
      request_count integer not null check (request_count >= 1),
      alerted boolean not null default false,
      primary key (device_id, window_start)
    )
  `.execute(db);
  await sql`revoke all on sync.snapshot_requests from public`.execute(db);
  await sql`grant select, insert, update, delete on sync.snapshot_requests to evia_app`.execute(db);

  await sql`alter table audit.events add column entity_count integer, add constraint events_entity_count check (entity_count is null or entity_count >= 0)`.execute(
    db,
  );

  await sql`
    alter table platform.security_alert_outbox
      drop constraint security_alert_outbox_alert_code_check,
      add constraint security_alert_outbox_alert_code_check
        check (alert_code in (
          'emergency_reset', 'projection_authz_drift', 'login_failure_spike', 'second_step_failure_spike', 'account_locked',
          'media_quarantined', 'signature_stale', 'signature_stale_72h', 'sync_full_downloads_excess', 'sync_snapshot_rate_exceeded'
        ))
  `.execute(db);
}
