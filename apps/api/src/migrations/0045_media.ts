/**
 * 0045 — the media of a work order (ADR-0009, ADR-0003; EVM-044; domain-model.md D6): the new schema `media` with `media_assets`,
 * `stored_files` and `upload_sessions`. Expand only: the tables are new, nothing is dropped, renamed or rewritten. The lists of the CHECK
 * constraints are COMPLETE from the start (the stories EVM-045..068 add no value to them): the states of ADR-0009, the reasons
 * of a failure or a quarantine, the categories, the two origins, the states of a session. Rules:
 * - an identifier chosen by the client (media asset, upload session) is a UUIDv7 (CHECK, like every key here); the id of a file is the server's;
 * - `purpose = media_original` exactly when the file has a media asset (EVM-047 adds `document_version_id` as a plain expand); `object_key`
 *   is unique and assigned by the server (`media/{year}/{month}/{storedFileId}/original`, no personal data); a file in `failed` or
 *   `quarantined` has a reason code and no other state has one;
 * - `state_changed_at` is when the file entered its state (the age of an unscanned file), `scan_claimed_at` when a worker last took it (the backoff
 *   of a scan that could not be decided);
 * - the key, the declared checksum, the creator and the anchor never change (trigger); the application role has SELECT, INSERT and UPDATE
 *   (no DELETE — removal is EVM-051, and the retention of the sessions a job of EVM-049);
 * - at most ONE active session per file (a partial unique index); the indexes serve the list of the media of an order (keyset by
 *   `created_at, id`), the unfinished sessions of a user (AC4) and the sweeper of files waiting for a scan.
 * `identity.users` is referenced for the creator of a session; `device_id` has no key (web sessions have none: NULL).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create schema media`.execute(db);
  await sql`revoke all on schema media from public`.execute(db);

  await sql`
    create table media.media_assets (
      id uuid primary key check (uuid_extract_version(id) = 7),
      work_order_id uuid not null references work_orders.work_orders (id) on delete restrict,
      procedure_stage_id uuid references procedures.procedure_stages (id) on delete restrict,
      media_type text not null check (media_type in ('photo', 'video')),
      category text not null check (category in ('site_survey', 'before_work', 'in_progress', 'completed_work', 'defect', 'measurement', 'other')),
      description text check (length(description) between 1 and 1000),
      origin text not null check (origin in ('web', 'mobile')),
      captured_at timestamptz,
      created_at timestamptz not null,
      created_by uuid not null references identity.users (id) on delete restrict,
      updated_at timestamptz not null
    )
  `.execute(db);
  await sql`create index media_assets_order_idx on media.media_assets (work_order_id, created_at, id)`.execute(db);

  await sql`
    create table media.stored_files (
      id uuid primary key default uuidv7() check (uuid_extract_version(id) = 7),
      purpose text not null check (purpose in ('media_original', 'document')),
      media_asset_id uuid unique references media.media_assets (id) on delete restrict,
      object_key text not null unique check (object_key ~ '^media/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}/original$'),
      state text not null check (state in ('pending_upload', 'uploaded', 'scanning', 'clean', 'processing', 'ready', 'quarantined', 'failed')),
      state_reason_code text check (state_reason_code in ('checksum_mismatch', 'processing_error', 'type_mismatch', 'malware_detected')),
      state_changed_at timestamptz not null,
      scan_claimed_at timestamptz,
      declared_size_bytes bigint not null check (declared_size_bytes between 1 and 52428800),
      size_bytes bigint check (size_bytes between 1 and 52428800),
      declared_content_type text not null check (length(declared_content_type) between 1 and 100),
      content_type text check (length(content_type) between 1 and 100),
      declared_sha256 text not null check (declared_sha256 ~ '^[a-f0-9]{64}$'),
      sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
      original_filename text check (length(original_filename) between 1 and 255),
      storage_class text not null default 'standard' check (storage_class in ('standard', 'archive')),
      s3_version_id text check (length(s3_version_id) <= 1024),
      s3_etag text check (length(s3_etag) <= 256),
      created_at timestamptz not null,
      created_by uuid not null references identity.users (id) on delete restrict,
      constraint stored_files_owner check ((purpose = 'media_original') = (media_asset_id is not null)),
      constraint stored_files_reason check ((state in ('failed', 'quarantined')) = (state_reason_code is not null))
    )
  `.execute(db);
  await sql`
    create index stored_files_unscanned_idx on media.stored_files (state_changed_at) where state in ('uploaded', 'scanning')
  `.execute(db);

  await sql`
    create table media.upload_sessions (
      id uuid primary key check (uuid_extract_version(id) = 7),
      stored_file_id uuid not null references media.stored_files (id) on delete restrict,
      user_id uuid not null references identity.users (id) on delete restrict,
      device_id uuid,
      s3_upload_id text not null check (length(s3_upload_id) between 1 and 1024),
      part_size_bytes bigint not null check (part_size_bytes between 1 and 134217728),
      part_count integer not null check (part_count between 1 and 1000),
      state text not null check (state in ('active', 'completed', 'aborted', 'expired')),
      expires_at timestamptz not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `.execute(db);
  await sql`create unique index upload_sessions_active_file_idx on media.upload_sessions (stored_file_id) where state = 'active'`.execute(
    db,
  );
  await sql`create index upload_sessions_user_idx on media.upload_sessions (user_id, state, expires_at)`.execute(db);

  await sql`
    create function media.reject_media_asset_anchor_change() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if new.work_order_id is distinct from old.work_order_id or new.created_by is distinct from old.created_by then
          raise exception 'media.media_assets anchor is immutable' using errcode = 'EV002';
        end if;
        return new;
      end
      $$
  `.execute(db);
  await sql`
    create function media.reject_stored_file_identity_change() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if new.object_key is distinct from old.object_key
          or new.declared_sha256 is distinct from old.declared_sha256
          or new.created_by is distinct from old.created_by
          or new.media_asset_id is distinct from old.media_asset_id then
          raise exception 'media.stored_files identity is immutable' using errcode = 'EV002';
        end if;
        return new;
      end
      $$
  `.execute(db);
  await sql`revoke all on function media.reject_media_asset_anchor_change() from public`.execute(db);
  await sql`revoke all on function media.reject_stored_file_identity_change() from public`.execute(db);
  await sql`
    create trigger media_assets_anchor_immutable before update on media.media_assets
      for each row execute function media.reject_media_asset_anchor_change()
  `.execute(db);
  await sql`
    create trigger stored_files_identity_immutable before update on media.stored_files
      for each row execute function media.reject_stored_file_identity_change()
  `.execute(db);

  await sql`grant usage on schema media to evia_app`.execute(db);
  await sql`grant select, insert, update on media.media_assets, media.stored_files, media.upload_sessions to evia_app`.execute(db);
}
