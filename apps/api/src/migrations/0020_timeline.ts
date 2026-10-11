/**
 * 0020 — the journal of a work order (ADR-0003, ADR-0008; EVM-037; domain-model.md D3): the new schema `timeline` with ONE table,
 * `timeline_entries`. Expand only: the table is new, nothing is dropped, renamed or rewritten, there is no backfill (an order
 * created before this story has an empty journal); the one change to an existing table is a UNIQUE key on the stages that a
 * composite foreign key needs. Rules:
 * - the identifier is a UUIDv7 that the CLIENT makes (an entry created on a phone has it before it reaches the server); the order
 *   of the journal is the time of the SERVER (`created_at`, written by the application), never the identifier;
 * - `kind` is `note`, `comment` or `event` (the events of the journal are written by the server in EVM-038, which adds their
 *   columns — expand — and no kind); the category exists exactly for a note; the text exists exactly for a note and a comment
 *   (1..10 000 characters; after a redaction it is a marker, so it stays non-null); an event has no author and comes from the
 *   `system`, an entry of a person comes from `web` or `mobile` and has an author — the CHECKs say it, whatever the application does;
 * - the stage and the corrected entry are COMPOSITE keys `(…, work_order_id)`: an entry cannot point at a stage or an entry of
 *   ANOTHER order (SR-AUTHZ-02, CWE-639). The key of a correction carries the kind too, so a correction is of the kind of the
 *   entry it corrects, and as an event has no `supersedes_entry_id` an event is never corrected. Each entry is corrected at most
 *   once (UNIQUE `supersedes_entry_id`: the race of two corrections ends in a conflict, not in a fork of the chain);
 * - APPEND-ONLY in the database (D3, ASVS V8.2.3): the role of the application has SELECT, INSERT and UPDATE, no DELETE and no
 *   TRUNCATE, and a trigger refuses the change of every column but `deleted_at`, `deleted_by` (soft delete, EVM-040) and `version`.
 *   The text is immutable here without exception; the redaction of a text (RODO art. 17: the text becomes a marker together with
 *   `redacted_at` / `redacted_by`, the Administrator with a step-up) is designed and given its own relaxation by EVM-040;
 * - every key is `ON DELETE RESTRICT` (no cascade: rows are soft deleted); times are written by the application (no `now()`).
 * Indexes serve the journal of an order from the newest entry, with and without the filter of the kind, and the stage filter.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  // the target of the composite key (procedure_stage_id, work_order_id) of the journal
  await sql`
    alter table procedures.procedure_stages add constraint procedure_stages_id_work_order_key unique (id, work_order_id)
  `.execute(db);

  await sql`create schema timeline`.execute(db);
  await sql`revoke all on schema timeline from public`.execute(db);

  await sql`
    create table timeline.timeline_entries (
      id uuid primary key check (uuid_extract_version(id) = 7),
      work_order_id uuid not null references work_orders.work_orders (id) on delete restrict,
      kind text not null check (kind in ('note', 'comment', 'event')),
      note_category text check (note_category in ('phone_call', 'meeting', 'arrangement', 'site_visit', 'other')),
      body text check (char_length(body) between 1 and 10000),
      procedure_stage_id uuid,
      supersedes_entry_id uuid,
      origin text not null check (origin in ('web', 'mobile', 'system')),
      captured_at timestamptz,
      redacted_at timestamptz,
      redacted_by uuid,
      created_at timestamptz not null,
      created_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid,
      unique (id, work_order_id, kind),
      constraint timeline_entries_stage_fk foreign key (procedure_stage_id, work_order_id)
        references procedures.procedure_stages (id, work_order_id) on delete restrict,
      constraint timeline_entries_supersedes_fk foreign key (supersedes_entry_id, work_order_id, kind)
        references timeline.timeline_entries (id, work_order_id, kind) on delete restrict,
      constraint timeline_entries_supersedes_key unique (supersedes_entry_id),
      constraint timeline_entries_category check ((kind = 'note') = (note_category is not null)),
      constraint timeline_entries_body check ((kind = 'event') = (body is null)),
      constraint timeline_entries_origin check ((origin = 'system') = (kind = 'event')),
      constraint timeline_entries_author check ((origin = 'system') = (created_by is null)),
      constraint timeline_entries_supersedes check (supersedes_entry_id is null or kind <> 'event'),
      constraint timeline_entries_redaction check ((redacted_at is null) = (redacted_by is null))
    )
  `.execute(db);
  await sql`
    create index timeline_entries_order_idx on timeline.timeline_entries (work_order_id, created_at desc, id desc)
      where deleted_at is null
  `.execute(db);
  await sql`
    create index timeline_entries_order_kind_idx on timeline.timeline_entries (work_order_id, kind, created_at desc, id desc)
      where deleted_at is null
  `.execute(db);
  await sql`
    create index timeline_entries_stage_idx on timeline.timeline_entries (work_order_id, procedure_stage_id, created_at desc, id desc)
      where procedure_stage_id is not null and deleted_at is null
  `.execute(db);

  await sql`
    create function timeline.reject_entry_change() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if (new.id, new.work_order_id, new.kind, new.note_category, new.body, new.procedure_stage_id, new.supersedes_entry_id,
            new.origin, new.captured_at, new.redacted_at, new.redacted_by, new.created_at, new.created_by)
           is distinct from
           (old.id, old.work_order_id, old.kind, old.note_category, old.body, old.procedure_stage_id, old.supersedes_entry_id,
            old.origin, old.captured_at, old.redacted_at, old.redacted_by, old.created_at, old.created_by) then
          raise exception 'timeline.timeline_entries is append-only' using errcode = 'EV001';
        end if;
        return new;
      end
      $$
  `.execute(db);
  await sql`revoke all on function timeline.reject_entry_change() from public`.execute(db);
  await sql`
    create trigger timeline_entries_append_only before update on timeline.timeline_entries
      for each row execute function timeline.reject_entry_change()
  `.execute(db);

  await sql`grant usage on schema timeline to evia_app`.execute(db);
  await sql`grant select, insert, update on timeline.timeline_entries to evia_app`.execute(db);
}
