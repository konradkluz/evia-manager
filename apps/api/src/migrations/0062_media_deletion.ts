/**
 * 0062 - deleting a medium or a document and erasing its file (EVM-051; SR-AUTHZ-02, SR-PRIV-03, SR-DATA-08, SR-FILE-11). Expand only: nullable columns,
 * so the code of the previous release keeps working.
 *
 * Numbering: 0058 belongs to track A (EVM-099), 0059-0061 to EVM-047, 048 and 050; this one takes 0062.
 *
 * - `media.media_assets`: `deleted_at` / `deleted_by` (the soft delete, as `media.documents` already has; both set or both NULL) and `file_purged_at`
 *   (the marker "Plik usuniety przez administratora": the file is erased, the record stays; the description is erased with it).
 * - `media.documents.file_purged_at`: the same marker for a document (all the versions of the file).
 * - `media.stored_files.erased_at`: when the objects of the file were erased on purpose. A worker that takes the file after this time drops the task, and the
 *   original name (personal data) is gone with it.
 * - `stored_files.objects_erased_at`: when the objects of an erased file are really gone from the storage; a file with `erased_at` and without it is
 *   finished by a job of the worker (the erasure in the request may fail after the commit).
 * - `file_purged_at` and `erased_at` are write-once (a trigger): an erasure cannot be undone by a later update.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table media.media_assets
      add column deleted_at timestamptz,
      add column deleted_by uuid references identity.users (id) on delete restrict,
      add column file_purged_at timestamptz,
      add constraint media_assets_deleted_pair check ((deleted_at is null) = (deleted_by is null)),
      add constraint media_assets_purged_without_description check (file_purged_at is null or description is null)
  `.execute(db);
  await sql`alter table media.documents add column file_purged_at timestamptz`.execute(db);
  await sql`
    alter table media.stored_files
      add column erased_at timestamptz,
      add column objects_erased_at timestamptz,
      add constraint stored_files_erased_without_name check (erased_at is null or original_filename is null),
      add constraint stored_files_objects_after_erasure check (objects_erased_at is null or erased_at is not null)
  `.execute(db);

  await sql`
    create function media.reject_erasure_undo() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if (to_jsonb(old) ->> tg_argv[0]) is not null and (to_jsonb(new) ->> tg_argv[0]) is distinct from (to_jsonb(old) ->> tg_argv[0]) then
          raise exception 'an erasure of a file cannot be undone' using errcode = 'EV002';
        end if;
        return new;
      end
      $$
  `.execute(db);
  await sql`revoke all on function media.reject_erasure_undo() from public`.execute(db);
  await sql`
    create trigger media_assets_file_purged_once before update on media.media_assets
      for each row execute function media.reject_erasure_undo('file_purged_at')
  `.execute(db);
  await sql`
    create trigger documents_file_purged_once before update on media.documents
      for each row execute function media.reject_erasure_undo('file_purged_at')
  `.execute(db);
  await sql`
    create trigger stored_files_erased_once before update on media.stored_files
      for each row execute function media.reject_erasure_undo('erased_at')
  `.execute(db);
}
