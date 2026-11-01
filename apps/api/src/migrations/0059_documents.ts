/**
 * 0059 — documents of a work order (EVM-047; ADR-0009; domain-model.md D6; P5, P6; SR-AUTHZ-07, SR-FILE-02). Expand only: the new tables are
 * added, the constraints that change are replaced under their own names with ones that admit a SUPERSET of the old values.
 *
 * Numbering: 0058 belongs to track A (EVM-099); this one takes 0059. The Kysely migrator runs without `allowUnorderedMigrations`, so the pull
 * request that owns 0058 has to be merged before this one.
 *
 * - `media.documents`: the kind (FK to the catalog, RESTRICT), a title (1..200) and a description (<= 2000), exactly ONE anchor of the three
 *   (work order, customer, site; the API of EVM-047 uses the order only), a stage only together with an order, `confidentiality_override`
 *   (`building_security` | `identity_data` | NULL). A trigger keeps the anchor and the kind immutable (moving a document to another order is an IDOR
 *   vector; changing the kind to `other` would lower the class) and lets the override only RISE: never lowered, never cleared. `version` is the
 *   optimistic lock (`If-Match`). The application role has SELECT, INSERT and UPDATE (no DELETE - removal is EVM-051).
 * - `media.document_versions`: append-only (SELECT and INSERT only); `UNIQUE (document_id, version_number)`; version 1 is made by the server.
 * - `media.stored_files`: `document_version_id` (unique, RESTRICT). The owner CHECK is replaced: a `media_original` file has exactly a media asset, a
 *   `document` file exactly a document version. The key CHECK is tied to the purpose: `media/{yyyy}/{mm}/{id}/original` only for `media_original`,
 *   `documents/{yyyy}/{mm}/{id}/original` only for `document` (the worker may only read it: its bucket policy allows writes of the derivatives of `media/*`).
 *   The trigger of immutability now covers `document_version_id` too (and keeps the write-once clauses of `quarantined_at` and `purged_at` from 0046). The size trigger of 0057 is replaced: a document is at most 100 MB (104 857 600 B).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table media.documents (
      id uuid primary key check (uuid_extract_version(id) = 7),
      kind_code text not null references catalog.document_kinds (code) on delete restrict,
      title text not null check (length(title) between 1 and 200),
      description text check (length(description) between 1 and 2000),
      work_order_id uuid references work_orders.work_orders (id) on delete restrict,
      customer_id uuid references customers.customers (id) on delete restrict,
      site_id uuid references sites.sites (id) on delete restrict,
      procedure_stage_id uuid references procedures.procedure_stages (id) on delete restrict,
      confidentiality_override text check (confidentiality_override in ('building_security', 'identity_data')),
      created_at timestamptz not null,
      created_by uuid not null references identity.users (id) on delete restrict,
      updated_at timestamptz not null,
      updated_by uuid not null references identity.users (id) on delete restrict,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid references identity.users (id) on delete restrict,
      constraint documents_one_anchor check (num_nonnulls(work_order_id, customer_id, site_id) = 1),
      constraint documents_stage_needs_order check (procedure_stage_id is null or work_order_id is not null),
      constraint documents_deleted_pair check ((deleted_at is null) = (deleted_by is null))
    )
  `.execute(db);
  await sql`
    create index documents_order_list_idx on media.documents (work_order_id, created_at desc, id) where deleted_at is null
  `.execute(db);

  await sql`
    create table media.document_versions (
      id uuid primary key check (uuid_extract_version(id) = 7),
      document_id uuid not null references media.documents (id) on delete restrict,
      version_number integer not null check (version_number >= 1),
      change_note text check (length(change_note) between 1 and 1000),
      created_at timestamptz not null,
      created_by uuid not null references identity.users (id) on delete restrict,
      constraint document_versions_number unique (document_id, version_number)
    )
  `.execute(db);

  await sql`
    create function media.reject_document_identity_change() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      declare
        rank constant text[] := array['building_security', 'identity_data'];
      begin
        if new.kind_code is distinct from old.kind_code
          or new.work_order_id is distinct from old.work_order_id
          or new.customer_id is distinct from old.customer_id
          or new.site_id is distinct from old.site_id
          or new.created_by is distinct from old.created_by then
          raise exception 'media.documents kind and anchor are immutable' using errcode = 'EV002';
        end if;
        if old.confidentiality_override is not null
          and (new.confidentiality_override is null
            or array_position(rank, new.confidentiality_override) < array_position(rank, old.confidentiality_override)) then
          raise exception 'media.documents confidentiality_override can only rise' using errcode = 'EV002';
        end if;
        return new;
      end
      $$
  `.execute(db);
  await sql`revoke all on function media.reject_document_identity_change() from public`.execute(db);
  await sql`
    create trigger documents_identity_immutable before update on media.documents
      for each row execute function media.reject_document_identity_change()
  `.execute(db);

  await sql`
    alter table media.stored_files
      add column document_version_id uuid unique references media.document_versions (id) on delete restrict
  `.execute(db);
  await sql`alter table media.stored_files drop constraint stored_files_owner`.execute(db);
  await sql`alter table media.stored_files drop constraint stored_files_object_key_check`.execute(db);
  await sql`
    alter table media.stored_files
      add constraint stored_files_owner check (
        (purpose = 'media_original' and media_asset_id is not null and document_version_id is null)
        or (purpose = 'document' and document_version_id is not null and media_asset_id is null)
      ),
      add constraint stored_files_object_key_check check (
        (purpose = 'media_original' and object_key ~ '^media/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}/original$')
        or (purpose = 'document' and object_key ~ '^documents/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}/original$')
      )
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
          or new.document_version_id is distinct from old.document_version_id
          or (old.quarantined_at is not null and new.quarantined_at is distinct from old.quarantined_at)
          or (old.purged_at is not null and new.purged_at is distinct from old.purged_at) then
          raise exception 'media.stored_files identity is immutable' using errcode = 'EV002';
        end if;
        return new;
      end
      $$
  `.execute(db);

  await sql`
    create or replace function media.require_size_of_media_type() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if new.media_asset_id is not null
          and (new.declared_size_bytes > 52428800 or coalesce(new.size_bytes, 0) > 52428800)
          and (select media_type from media.media_assets where id = new.media_asset_id) = 'photo' then
          raise exception 'media.stored_files size of a photo is at most 50 MB' using errcode = 'EV002';
        end if;
        if new.document_version_id is not null and (new.declared_size_bytes > 104857600 or coalesce(new.size_bytes, 0) > 104857600) then
          raise exception 'media.stored_files size of a document is at most 100 MB' using errcode = 'EV002';
        end if;
        return new;
      end
      $$
  `.execute(db);

  await sql`grant select, insert, update on media.documents to evia_app`.execute(db);
  await sql`grant select, insert on media.document_versions to evia_app`.execute(db);
}
