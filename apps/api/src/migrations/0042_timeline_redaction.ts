/**
 * 0042 - the redaction of an entry of the journal (EVM-040; ADR-0003; domain-model.md D3, "Usuwanie danych"; SR-PRIV-03, SR-DATA-08, ASVS V8.2.3).
 * Expand only: a function is re-created with `create or replace` (the REVOKE and the trigger stay) and one CHECK is added; no column, table or
 * index is dropped, renamed or rewritten, and there is no backfill. Version N-1 keeps working on this schema: it never writes `redacted_*`,
 * never deletes an event and never soft deletes one.
 * - the trigger `reject_entry_change()` still refuses every change but the soft delete (`deleted_at`, `deleted_by`) and the `version`, and now
 *   allows ONE more: the redaction. It is allowed only when ALL of this holds at once: the entry was not redacted (`old.redacted_at is null`),
 *   it is redacted now (`new.redacted_at` and `new.redacted_by` are set), it is not an event (an event has no text and no personal data),
 *   the new text is EXACTLY the marker "Treść usunięta przez administratora DD.MM.RRRR." and every other column is unchanged (`id`,
 *   `work_order_id`, `kind`, `note_category`, `procedure_stage_id`, `supersedes_entry_id`, `origin`, `captured_at`, `created_*`, `event_*`).
 *   The pattern is anchored: without it the redaction would be a channel for editing a text. There is no way back (no un-redaction) and no
 *   second change of the text after a redaction. The pattern lives in the application too (`redaction-marker.ts`); a test keeps the two equal;
 * - the CHECK `timeline_entries_event_untouchable`: an event is never soft deleted and never redacted (EVM-040 AC5, defence in depth - the
 *   application refuses first). Safe for N-1: the journal does not take part in the deletion of an order, so an event never gets `deleted_at`.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create or replace function timeline.reject_entry_change() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if (new.id, new.work_order_id, new.kind, new.note_category, new.procedure_stage_id, new.supersedes_entry_id,
            new.origin, new.captured_at, new.created_at, new.created_by, new.event_code, new.event_payload)
           is distinct from
           (old.id, old.work_order_id, old.kind, old.note_category, old.procedure_stage_id, old.supersedes_entry_id,
            old.origin, old.captured_at, old.created_at, old.created_by, old.event_code, old.event_payload) then
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
    alter table timeline.timeline_entries
      add constraint timeline_entries_event_untouchable check (kind <> 'event' or (deleted_at is null and redacted_at is null))
  `.execute(db);
}
