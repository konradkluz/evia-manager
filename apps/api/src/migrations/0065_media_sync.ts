/**
 * 0065 - the media of a work order on the phone (EVM-131; ADR-0021 D4; SR-SYNC-04, SR-MOB-10, SR-LOG-03). Expand only: one defaulted column, two triggers on `media_assets`
 * (the generic ones of the change log), one trigger on `stored_files`, the generic function of the log widened for the version and a CHECK widened `not valid` and
 * validated (the exact pattern of 0058). Nothing is dropped, renamed or rewritten (the default of the new column is a constant, so PostgreSQL does not rewrite the
 * table) and there is NO backfill: the media that already exist reach a phone at its next full resync, which the raised `scopeRuleVersion` (SCOPE_TYPES_REVISION 3)
 * orders. Version N-1 keeps working: it never names the column, and the widened CHECK accepts everything it writes.
 *
 * - `media.media_assets.file_state_revision` (`integer not null default 0`): counts the changes of the STATE of the file of the medium. The state lives in `stored_files`,
 *   so without it a change of the state would touch neither the row of the medium nor its `version`, and the guard of the phone (an upsert at a version not above the known
 *   one is dropped) would never let `clean` or a quarantine through. The version the phone sees is `version + file_state_revision` (one expression: here in
 *   `sync.record_change()` and in `media/infrastructure/sync-version.ts`); `version` itself - the `If-Match` of the panel - and `updated_at`/`updated_by` are NOT
 *   touched by a change of the state (an edit in the panel after a change of the state still gets 200, not 412).
 * - `sync.record_change()` (the function of 0054, `create or replace`): the version of the entry is `version + coalesce(file_state_revision, 0)`; for every table
 *   but `media_assets` the second term is 0, so nothing else changes. Still SECURITY DEFINER, pinned `search_path`, every object qualified, no dynamic SQL.
 * - triggers `record_change_insert_delete` and `record_change_update` on `media.media_assets` (`media_asset`, anchored to `work_order_id`).
 * - `media.record_file_state_revision()` and two triggers on `media.stored_files`: AFTER INSERT, and AFTER UPDATE OF `state`, `state_reason_code` only when the pair really
 *   changed, both ONLY for `purpose = 'media_original'` (a document file never reaches the phone). The function raises the counter of the medium by one UPDATE by
 *   primary key. SECURITY DEFINER, pinned `search_path = pg_catalog, pg_temp`, qualified names, no dynamic SQL, `revoke ... from public`. The order of the locks of the
 *   paths that change both rows is: the medium first, then the file (the erasure takes them in that order; the paths of the upload do too).
 * - `audit.events.command_type` may also be `CreateMediaAsset` (the CHECK of 0058 widened; `not valid`, then validated).
 *
 * Forward only (the runner keeps no `down`, `migrations.test.ts`). The logical undo, proved by `media-sync-migration.test.ts`, is: drop the three triggers and
 * `media.record_file_state_revision()`, restore `sync.record_change()` of 0054, restore the CHECK of 0058, drop the column - no business data is lost, the log rows
 * stay (a harmless excess for a type nobody serves).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  // the migration runs in a transaction: the lock is given up after 5 s instead of queueing every writer of the table behind it
  await sql`set local lock_timeout = '5s'`.execute(db);

  await sql`alter table media.media_assets add column file_state_revision integer not null default 0`.execute(db);
  await sql`alter table media.media_assets add constraint media_assets_file_state_revision_check check (file_state_revision >= 0) not valid`.execute(
    db,
  );
  await sql`alter table media.media_assets validate constraint media_assets_file_state_revision_check`.execute(db);

  await sql`
    create or replace function sync.record_change() returns trigger
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
      values (
        TG_ARGV[0], (subject ->> 'id')::uuid, kind, anchor::uuid,
        (subject ->> 'version')::integer + coalesce((subject ->> 'file_state_revision')::integer, 0)
      );
      return null;
    end
    $$
  `.execute(db);
  await sql`revoke all on function sync.record_change() from public`.execute(db);

  await sql`
    create trigger record_change_insert_delete after insert or delete on media.media_assets
      for each row execute function sync.record_change('media_asset', 'work_order_id')
  `.execute(db);
  await sql`
    create trigger record_change_update after update on media.media_assets
      for each row when (old.* is distinct from new.*) execute function sync.record_change('media_asset', 'work_order_id')
  `.execute(db);

  await sql`
    create function media.record_file_state_revision() returns trigger
    language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
    as $$
    begin
      update media.media_assets set file_state_revision = file_state_revision + 1 where id = new.media_asset_id;
      return null;
    end
    $$
  `.execute(db);
  await sql`revoke all on function media.record_file_state_revision() from public`.execute(db);
  await sql`
    create trigger stored_files_state_revision_insert after insert on media.stored_files
      for each row when (new.purpose = 'media_original') execute function media.record_file_state_revision()
  `.execute(db);
  await sql`
    create trigger stored_files_state_revision_update after update of state, state_reason_code on media.stored_files
      for each row when (new.purpose = 'media_original' and (old.state, old.state_reason_code) is distinct from (new.state, new.state_reason_code))
      execute function media.record_file_state_revision()
  `.execute(db);

  await sql`alter table audit.events drop constraint events_mutation_fields`.execute(db);
  await sql`
    alter table audit.events
      add constraint events_mutation_fields check (
        (device_id is null and work_order_id is null and command_type is null and quota_kind is null)
        or (device_id is not null and work_order_id is not null and quota_kind is null
            and coalesce(command_type in ('CreateNote', 'CreateComment', 'CreateQuickWorkOrder', 'CreateMediaAsset'), false))
        or (device_id is not null and work_order_id is null and command_type is null and coalesce(quota_kind in ('customer', 'site'), false))
      ) not valid
  `.execute(db);
  await sql`alter table audit.events validate constraint events_mutation_fields`.execute(db);
}
