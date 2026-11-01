/**
 * 0063 - the ZIP export of the photos of a work order (EVM-052; ADR-0009; P10; SR-FILE-07, SR-FILE-09, SR-DATA-07, SR-LOG-07). Expand only: one new table and the
 * closed list of the alert codes widened by one value. Nothing is dropped or rewritten, so the previous release keeps working.
 *
 * - `media.media_exports`: one row per export. The OBJECT KEY is chosen by the server at the request (`exports/{yyyy}/{mm}/{id}.zip`; no name, no customer), so a
 *   job that failed half way knows what to clean. `state`: `queued` -> `running` -> `ready` | `failed`, and `expired` (the end of life: 24 hours from the request
 *   or an earlier end - the erasure of a file of the order). `size_bytes` / `file_count` are written when the file is ready. `failure_code` is a closed code, never
 *   a message of the storage. `downloaded_at` is the single use of the link (a conditional UPDATE: two concurrent calls cannot both win). `object_removed_at`
 *   says the object is really gone from the bucket: `expired` is final only after it. The row holds no personal data; the rows are kept (the audit refers to
 *   them) and removed 30 days after the end of life by a later job.
 * - `platform.security_alert_outbox.alert_code`: the COMPLETE list of 0058 plus `media_export_started` (SR-LOG-07).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table media.media_exports (
      id uuid primary key check (uuid_extract_version(id) = 7),
      work_order_id uuid not null references work_orders.work_orders (id) on delete restrict,
      requested_by uuid not null references identity.users (id) on delete restrict,
      state text not null check (state in ('queued', 'running', 'ready', 'failed', 'expired')),
      object_key text not null check (object_key ~ '^exports/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.zip$'),
      size_bytes bigint check (size_bytes > 0),
      file_count integer check (file_count > 0),
      failure_code text check (failure_code in ('storage_unavailable', 'too_large', 'no_media', 'processing_error')),
      created_at timestamptz not null,
      started_at timestamptz,
      ready_at timestamptz,
      expires_at timestamptz not null,
      downloaded_at timestamptz,
      object_removed_at timestamptz,
      constraint media_exports_ready_has_file check (state <> 'ready' or (size_bytes is not null and file_count is not null and ready_at is not null)),
      constraint media_exports_failed_has_code check ((state = 'failed') = (failure_code is not null) or state = 'expired'),
      constraint media_exports_life check (expires_at > created_at)
    )
  `.execute(db);
  await sql`create index media_exports_user_idx on media.media_exports (requested_by, created_at)`.execute(db);
  await sql`create index media_exports_state_idx on media.media_exports (state, expires_at)`.execute(db);
  await sql`create index media_exports_order_idx on media.media_exports (work_order_id)`.execute(db);
  await sql`revoke all on media.media_exports from public`.execute(db);
  await sql`grant select, insert, update on media.media_exports to evia_app`.execute(db);

  await sql`
    alter table platform.security_alert_outbox
      drop constraint security_alert_outbox_alert_code_check,
      add constraint security_alert_outbox_alert_code_check
        check (alert_code in (
          'emergency_reset', 'projection_authz_drift', 'login_failure_spike', 'second_step_failure_spike', 'account_locked',
          'media_quarantined', 'signature_stale', 'signature_stale_72h', 'sync_full_downloads_excess', 'sync_snapshot_rate_exceeded',
          'sync_quick_create_quota_exceeded', 'media_export_started'
        ))
  `.execute(db);
}
