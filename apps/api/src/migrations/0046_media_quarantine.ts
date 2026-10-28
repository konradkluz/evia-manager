/**
 * 0046 — the quarantine of media files (EVM-049; ADR-0009, P4, P5; SR-DATA-07). Expand only: two nullable columns, two partial indexes,
 * checks and a function; nothing is dropped, renamed or rewritten.
 * - `quarantined_at` is when the file FIRST entered quarantine and `purged_at` when its object was removed after the retention. Both are
 *   write-once (trigger): a later rescan with a positive result never moves the clock of the 30 days. Existing quarantined rows are
 *   backfilled with `state_changed_at`.
 * - `media.quarantine_expires_at(quarantined_at, days)` is the ONE expression of the deadline for the sweeper and the API: the start of the
 *   business day (`Europe/Warsaw`) of `quarantined_at` plus whole calendar days, so a nightly job is deterministic (2026-09-01 gives
 *   2026-10-01T00:00 Warsaw time) and the change of the clock is handled by the database.
 * - `stored_files_state_reason_code_check` knows `abandoned` (a file whose upload was never finished, EVM-049 D9). 0045 declared its lists
 *   complete; this is a conscious widening, in the same spirit as the other expand-only changes of a CHECK.
 * - `stored_files_quarantined_at` (a quarantined file has the time of its quarantine) and `stored_files_purged` (a purge needs the
 *   quarantine) bind the columns to the state.
 * - the partial indexes serve the sweeper of the retention (`quarantined_at`, not purged) and the sweeper of the abandoned uploads and the
 *   counts of unfinished media per creator (EVM-049 D9: the limits).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table media.stored_files add column quarantined_at timestamptz, add column purged_at timestamptz`.execute(db);
  await sql`update media.stored_files set quarantined_at = state_changed_at where state = 'quarantined'`.execute(db);

  await sql`
    alter table media.stored_files
      drop constraint stored_files_state_reason_code_check,
      add constraint stored_files_state_reason_code_check
        check (state_reason_code in ('checksum_mismatch', 'processing_error', 'type_mismatch', 'malware_detected', 'abandoned')),
      add constraint stored_files_quarantined_at check (state <> 'quarantined' or quarantined_at is not null),
      add constraint stored_files_purged check (purged_at is null or (state = 'quarantined' and quarantined_at is not null))
  `.execute(db);

  await sql`
    create or replace function media.reject_stored_file_identity_change() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if new.object_key is distinct from old.object_key
          or new.declared_sha256 is distinct from old.declared_sha256
          or new.declared_size_bytes is distinct from old.declared_size_bytes
          or new.declared_content_type is distinct from old.declared_content_type
          or new.created_by is distinct from old.created_by
          or new.media_asset_id is distinct from old.media_asset_id
          or (old.quarantined_at is not null and new.quarantined_at is distinct from old.quarantined_at)
          or (old.purged_at is not null and new.purged_at is distinct from old.purged_at) then
          raise exception 'media.stored_files identity is immutable' using errcode = 'EV002';
        end if;
        return new;
      end
      $$
  `.execute(db);

  await sql`
    create function media.quarantine_expires_at(quarantined_at timestamptz, retention_days integer) returns timestamptz
      language sql
      stable
      set search_path = pg_catalog
      as $$
        select (date_trunc('day', quarantined_at at time zone 'Europe/Warsaw') + retention_days * interval '1 day') at time zone 'Europe/Warsaw'
      $$
  `.execute(db);
  await sql`revoke all on function media.quarantine_expires_at(timestamptz, integer) from public`.execute(db);
  await sql`grant execute on function media.quarantine_expires_at(timestamptz, integer) to evia_app`.execute(db);

  await sql`
    create index stored_files_quarantine_idx on media.stored_files (quarantined_at)
      where quarantined_at is not null and purged_at is null
  `.execute(db);
  await sql`
    create index stored_files_pending_idx on media.stored_files (created_by, state_changed_at) where state = 'pending_upload'
  `.execute(db);
}
