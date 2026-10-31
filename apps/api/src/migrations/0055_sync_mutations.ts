/**
 * 0055 — the mutations of the phone: entries and comments (EVM-098; ADR-0008, ADR-0021 addendum; SR-SYNC-03, SR-LOG-03). Expand only: nullable columns
 * (one on the journal, three on the audit trail), two CHECKs added `not valid` and validated, and the trigger function of 0042 re-created with one more immutable column. Nothing is dropped, renamed or
 * rewritten and there is no backfill. Version N-1 keeps working: it never writes `origin = 'mobile'` (so the new CHECK holds for every row it writes) and
 * never names the new columns of the audit trail.
 *
 * - `timeline.timeline_entries.created_via_device_id`: the device of the session that wrote an entry from the phone (AC2, AC4: the rule of `idempotency_expired`
 *   compares it). WITHOUT a foreign key on purpose: it is a pseudonymous identifier kept as long as the entry, like `created_by`, and the register of devices
 *   must stay free to remove a device (identity) without touching the append-only journal. It is not part of any projection (the panel shows `origin`, the
 *   phone never gets it — SR-SYNC-04). CHECK: an entry from the phone has a device, and only such an entry has one.
 * - `timeline.reject_entry_change()`: the LATEST version (0042, with the branch of the redaction) plus `created_via_device_id` in the immutable tuple.
 * - `audit.events.device_id`, `work_order_id`, `command_type`: the applied mutation of the phone (`sync.mutation_applied`) is self-contained in the trail —
 *   the device, the order and the type of the command, never the text. All three or none; `command_type` is a closed list (EVM-099 extends it).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table timeline.timeline_entries add column created_via_device_id uuid`.execute(db);
  await sql`
    alter table timeline.timeline_entries
      add constraint timeline_entries_device_of_mobile check ((origin = 'mobile') = (created_via_device_id is not null)) not valid
  `.execute(db);
  await sql`alter table timeline.timeline_entries validate constraint timeline_entries_device_of_mobile`.execute(db);

  await sql`
    create or replace function timeline.reject_entry_change() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if (new.id, new.work_order_id, new.kind, new.note_category, new.procedure_stage_id, new.supersedes_entry_id,
            new.origin, new.captured_at, new.created_at, new.created_by, new.event_code, new.event_payload, new.created_via_device_id)
           is distinct from
           (old.id, old.work_order_id, old.kind, old.note_category, old.procedure_stage_id, old.supersedes_entry_id,
            old.origin, old.captured_at, old.created_at, old.created_by, old.event_code, old.event_payload, old.created_via_device_id) then
          raise exception 'timeline.timeline_entries is append-only' using errcode = 'EV001';
        end if;
        if (new.body, new.redacted_at, new.redacted_by) is distinct from (old.body, old.redacted_at, old.redacted_by) then
          if not (
            old.redacted_at is null
            and new.redacted_at is not null
            and new.redacted_by is not null
            and old.kind <> 'event'
            and coalesce(new.body ~ '^Treść usunięta przez administratora [0-9]{2}\\.[0-9]{2}\\.[0-9]{4}\\.$', false)
          ) then
            raise exception 'timeline.timeline_entries is append-only' using errcode = 'EV001';
          end if;
        end if;
        return new;
      end
      $$
  `.execute(db);

  await sql`
    alter table audit.events
      add column device_id uuid,
      add column work_order_id uuid,
      add column command_type text,
      add constraint events_mutation_fields check (
        (device_id is null and work_order_id is null and command_type is null)
        or (device_id is not null and work_order_id is not null and coalesce(command_type in ('CreateNote', 'CreateComment'), false))
      ) not valid
  `.execute(db);
  await sql`alter table audit.events validate constraint events_mutation_fields`.execute(db);
}
