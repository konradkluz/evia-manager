/**
 * 0053 — the derivatives of media files (EVM-068; ADR-0009; domain-model.md D6). Expand only: one new table and two new columns with
 * defaults that need no rewrite; nothing is dropped, renamed or retyped.
 * - `media.file_derivatives` holds the thumbnail (320 px) and the preview (1600 px) of a photo, one row per (file, variant). The primary key
 *   is (stored_file_id, variant); the foreign key is `on delete restrict`, so a future removal (EVM-051, art. 17 GDPR) has to remove the
 *   objects of the derivatives on purpose. The names of the variants are those of the contract (`thumbnail`, `preview`); the key of an object
 *   is `media/{year}/{month}/{storedFileId}/{variant}.webp` — the SAME prefix as the original (`.../{storedFileId}/original`), assigned only by the
 *   server (CHECK on the shape and the identifier, trigger on the equality of the prefix with the original's), so the removal by prefix covers
 *   the derivatives. The type is fixed (`image/webp`), the sizes are bounded (CHECK). The application role has SELECT and INSERT only
 *   (a derivative is written once; no UPDATE, no DELETE — EVM-051).
 * - `media.stored_files.process_attempts` counts the takes of the file by the processing loop (raised when a worker TAKES the file, so a worker
 *   that crashes still uses an attempt), `process_claimed_at` is when it was last taken (the backoff). A partial index serves the loop.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table media.stored_files
      add column process_attempts integer not null default 0 check (process_attempts between 0 and 10),
      add column process_claimed_at timestamptz
  `.execute(db);
  await sql`
    create index stored_files_unprocessed_idx on media.stored_files (state_changed_at) where state in ('clean', 'processing')
  `.execute(db);

  await sql`
    create table media.file_derivatives (
      stored_file_id uuid not null references media.stored_files (id) on delete restrict,
      variant text not null check (variant in ('thumbnail', 'preview')),
      object_key text not null unique check (object_key ~ '^media/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}/(thumbnail|preview)\.webp$'),
      content_type text not null check (content_type = 'image/webp'),
      width integer not null check (width between 1 and 1600),
      height integer not null check (height between 1 and 1600),
      size_bytes integer not null check (size_bytes between 1 and 5242880),
      created_at timestamptz not null,
      primary key (stored_file_id, variant),
      constraint file_derivatives_key_of_file check (split_part(object_key, '/', 4) = stored_file_id::text),
      constraint file_derivatives_key_of_variant check (split_part(object_key, '/', 5) = variant || '.webp')
    )
  `.execute(db);

  await sql`
    create function media.require_derivative_prefix_of_original() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      declare
        original_key text;
      begin
        select object_key into original_key from media.stored_files where id = new.stored_file_id;
        if original_key is null
          or substr(new.object_key, 1, length(new.object_key) - length(new.variant || '.webp'))
             is distinct from substr(original_key, 1, length(original_key) - length('original')) then
          raise exception 'media.file_derivatives key must share the prefix of the original' using errcode = 'EV002';
        end if;
        return new;
      end
      $$
  `.execute(db);
  await sql`revoke all on function media.require_derivative_prefix_of_original() from public`.execute(db);
  await sql`
    create trigger file_derivatives_prefix before insert on media.file_derivatives
      for each row execute function media.require_derivative_prefix_of_original()
  `.execute(db);

  await sql`grant select, insert on media.file_derivatives to evia_app`.execute(db);
}
