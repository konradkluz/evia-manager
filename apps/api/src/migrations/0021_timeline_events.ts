/**
 * 0021 — the events of the journal of a work order (EVM-038; ADR-0003, ADR-0008; domain-model.md D3). Expand only: two nullable
 * columns on `timeline.timeline_entries`, two CHECKs that tie them to `kind = event`, a relaxed CHECK of the author and the trigger
 * of append-only extended by the new columns. Nothing is dropped, renamed or rewritten and there is no backfill (an order created
 * before this story has no events — synthetic data). Code of 0020 runs on this schema unchanged: it never writes an event.
 * - `event_code` — the code of the event (`work_order_status_changed` …) and `event_payload` — a JSON object of codes, identifiers
 *   and names of fields (NEVER a value of personal data, a reason or an amount: SR-LOG-03, SR-DATA-01). Both exist exactly for
 *   `kind = event`. The list of the codes and the keys of every payload live in the application (strict schema at the write), not
 *   in a CHECK, so a later story (E6, E7) adds its events without a migration; the database keeps the SHAPE (a code of a fixed
 *   form, a JSON object);
 * - the author: an entry of a person (`origin` is `web` or `mobile`) has an author; an event may have the actor who caused it (it
 *   is shown in the header of the entry) or none (a later event of the system). The CHECK `(origin = 'system') = (kind = 'event')`
 *   of 0020 stays, so a client can never write `origin = 'system'` and an event is never written as a person's entry;
 * - append-only: `reject_entry_change()` compares the two new columns as well (`create or replace` keeps the REVOKE on the function).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table timeline.timeline_entries add column event_code text, add column event_payload jsonb`.execute(db);
  await sql`
    alter table timeline.timeline_entries
      add constraint timeline_entries_event_code check ((kind = 'event') = (event_code is not null)),
      add constraint timeline_entries_event_code_form check (event_code ~ '^[a-z][a-z_]{0,63}$'),
      add constraint timeline_entries_event_payload check ((kind = 'event') = (event_payload is not null)),
      add constraint timeline_entries_event_payload_object check (jsonb_typeof(event_payload) = 'object')
  `.execute(db);

  await sql`alter table timeline.timeline_entries drop constraint timeline_entries_author`.execute(db);
  await sql`
    alter table timeline.timeline_entries
      add constraint timeline_entries_author check (origin = 'system' or created_by is not null)
  `.execute(db);

  await sql`
    create or replace function timeline.reject_entry_change() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if (new.id, new.work_order_id, new.kind, new.note_category, new.body, new.procedure_stage_id, new.supersedes_entry_id,
            new.origin, new.captured_at, new.redacted_at, new.redacted_by, new.created_at, new.created_by,
            new.event_code, new.event_payload)
           is distinct from
           (old.id, old.work_order_id, old.kind, old.note_category, old.body, old.procedure_stage_id, old.supersedes_entry_id,
            old.origin, old.captured_at, old.redacted_at, old.redacted_by, old.created_at, old.created_by,
            old.event_code, old.event_payload) then
          raise exception 'timeline.timeline_entries is append-only' using errcode = 'EV001';
        end if;
        return new;
      end
      $$
  `.execute(db);
}
