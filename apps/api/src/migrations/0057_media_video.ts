/**
 * 0057 — videos in a work order (EVM-046; ADR-0009; P5; domain-model.md D6). Expand only: nothing is dropped, renamed or retyped; the constraints
 * that change are replaced under their own names with ones that admit a superset of the old values.
 *
 * Numbering: 0053 is `media_derivatives` on main; track A (EVM-096–098) owns 0054–0056, so this one takes 0057 (renumbered from 0055).
 *
 * - `media.stored_files`: the limit of the size grows to 4 GiB (`bigint` already); the limit PER TYPE (photo 50 MB, video 4 GiB) is kept in
 *   the database by a trigger that reads `media_assets.media_type`, not left to the application alone.
 *   `duration_seconds` (1..1800) is written by the worker after the structural check (ffprobe) and BEFORE the transcoding: its presence is the proof that a video
 *   was probed, and the original of a video is handed out only with it. `av_scanned` is NULLABLE with no default (null = not scanned yet; a default of `true`
 *   would let any path that forgets the column pass an unscanned file); the backfill sets `true` for every file that has been through the scan.
 *   CHECK: a file may be marked unscanned only above the scan limit (2 000 000 000 B: the ceiling of the ClamAV stream is about 2^31 B).
 * - `media.file_derivatives`: a video has `thumbnail.webp` (a frame) and `preview.mp4` (720p). The type admits `video/mp4`; the key admits `preview.mp4`;
 *   the size stays `integer` (the preview is bounded to 1 GiB by the bitrate of the transcoding and by the CHECK). A trigger lets `.mp4` in only for a video
 *   and requires `.webp` for a photo and for the thumbnail of a video.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table media.stored_files drop constraint stored_files_declared_size_bytes_check`.execute(db);
  await sql`alter table media.stored_files drop constraint stored_files_size_bytes_check`.execute(db);
  await sql`
    alter table media.stored_files
      add constraint stored_files_declared_size_bytes_check check (declared_size_bytes between 1 and 4294967296),
      add constraint stored_files_size_bytes_check check (size_bytes between 1 and 4294967296),
      add column duration_seconds integer check (duration_seconds between 1 and 1800),
      add column av_scanned boolean,
      add constraint stored_files_unscanned_only_large check (av_scanned is distinct from false or size_bytes > 2000000000)
  `.execute(db);
  await sql`
    update media.stored_files set av_scanned = true where state not in ('pending_upload', 'uploaded', 'scanning')
  `.execute(db);

  await sql`
    create function media.require_size_of_media_type() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if new.media_asset_id is not null
          and (new.declared_size_bytes > 52428800 or coalesce(new.size_bytes, 0) > 52428800)
          and (select media_type from media.media_assets where id = new.media_asset_id) = 'photo' then
          raise exception 'media.stored_files size of a photo is at most 50 MB' using errcode = 'EV002';
        end if;
        return new;
      end
      $$
  `.execute(db);
  await sql`revoke all on function media.require_size_of_media_type() from public`.execute(db);
  await sql`
    create trigger stored_files_size_of_type before insert or update of declared_size_bytes, size_bytes on media.stored_files
      for each row execute function media.require_size_of_media_type()
  `.execute(db);

  await sql`alter table media.file_derivatives drop constraint file_derivatives_content_type_check`.execute(db);
  await sql`alter table media.file_derivatives drop constraint file_derivatives_object_key_check`.execute(db);
  await sql`alter table media.file_derivatives drop constraint file_derivatives_size_bytes_check`.execute(db);
  await sql`alter table media.file_derivatives drop constraint file_derivatives_key_of_variant`.execute(db);
  await sql`
    alter table media.file_derivatives
      add constraint file_derivatives_content_type_check check (content_type in ('image/webp', 'video/mp4')),
      add constraint file_derivatives_object_key_check
        check (object_key ~ '^media/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}/(thumbnail\.webp|preview\.(webp|mp4))$'),
      add constraint file_derivatives_size_bytes_check
        check (size_bytes between 1 and 5242880 or (content_type = 'video/mp4' and size_bytes between 1 and 1073741824)),
      add constraint file_derivatives_key_of_variant check (split_part(object_key, '/', 5) in (variant || '.webp', variant || '.mp4')),
      add constraint file_derivatives_type_of_key
        check ((content_type = 'video/mp4') = (object_key like '%.mp4'))
  `.execute(db);

  await sql`
    create or replace function media.require_derivative_prefix_of_original() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      declare
        original_key text;
        kind text;
        suffix text := substr(new.object_key, length(new.object_key) - strpos(reverse(new.object_key), '/') + 2);
      begin
        select f.object_key, a.media_type into original_key, kind
          from media.stored_files f left join media.media_assets a on a.id = f.media_asset_id where f.id = new.stored_file_id;
        if original_key is null
          or substr(new.object_key, 1, length(new.object_key) - length(suffix))
             is distinct from substr(original_key, 1, length(original_key) - length('original')) then
          raise exception 'media.file_derivatives key must share the prefix of the original' using errcode = 'EV002';
        end if;
        if suffix = 'preview.mp4' and kind is distinct from 'video' then
          raise exception 'media.file_derivatives preview.mp4 belongs to a video' using errcode = 'EV002';
        end if;
        if kind = 'video' and suffix not in ('thumbnail.webp', 'preview.mp4') then
          raise exception 'media.file_derivatives a video has thumbnail.webp and preview.mp4' using errcode = 'EV002';
        end if;
        return new;
      end
      $$
  `.execute(db);
}
