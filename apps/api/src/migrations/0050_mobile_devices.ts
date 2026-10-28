/**
 * 0050 — the register of mobile devices (EVM-094; ADR-0005, ADR-0021). Expand only, compatible with the code that is still running (a new table, nullable
 * columns the old code never reads, a column with a default).
 *
 * - `identity.devices`: one row per installation of the app on a phone (not to be confused with `identity.browser_devices`, the register of browsers of the
 *   panel). The identifier is given by the server. The installation secret is never stored: only the SHA-256 of the newest ISSUED secret and, during the
 *   two-phase rotation, of the last PROVEN one (`previous_*`, valid at most 7 days) — at most two secrets are valid at any moment. `state` is `active`,
 *   `wipe_required` (an Administrator ordered the wipe; EVM-095) or `wiped` (the phone confirmed it). No IMEI, serial number or advertising id (MASVS-PRIVACY-1).
 * - `identity.sessions.device_id`: the mobile session belongs to one device (null for the sessions of the panel).
 * - `identity.login_attempts.channel`: the first step of a sign-in is bound to its channel — a token of the phone does not open a session of the panel.
 * - `identity.mobile_challenges`: what the first step of the phone knows (the description of the device, the device it recognised) and the stamp of the
 *   credentials at that moment (the password and the code factor), so that the second step refuses a challenge whose credentials changed in between.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table identity.devices (
      id uuid primary key default uuidv7(),
      user_id uuid not null references identity.users (id),
      state text not null default 'active' check (state in ('active', 'wipe_required', 'wiped')),
      secret_hash bytea not null check (length(secret_hash) = 32),
      secret_proven boolean not null default false,
      previous_secret_hash bytea check (previous_secret_hash is null or length(previous_secret_hash) = 32),
      previous_valid_until timestamptz,
      model text not null check (char_length(model) between 1 and 100),
      os_version text not null check (char_length(os_version) between 1 and 16),
      security_patch date not null,
      platform text not null check (platform in ('android', 'ios')),
      app_version text not null check (char_length(app_version) between 5 and 32),
      public_key text check (public_key is null or char_length(public_key) between 16 and 512),
      pending_items_reported integer not null default 0 check (pending_items_reported between 0 and 10000),
      last_contact_at timestamptz not null,
      created_at timestamptz not null,
      removed_at timestamptz,
      constraint devices_previous_secret_check check ((previous_secret_hash is null) = (previous_valid_until is null))
    )
  `.execute(db);
  await sql`create index devices_user_id_idx on identity.devices (user_id) where removed_at is null`.execute(db);
  await sql`create index devices_last_contact_at_idx on identity.devices (last_contact_at) where removed_at is null`.execute(db);
  await sql`grant select, insert, update, delete on identity.devices to evia_app`.execute(db);

  await sql`alter table identity.sessions add column device_id uuid references identity.devices (id)`.execute(db);
  await sql`create index sessions_device_id_idx on identity.sessions (device_id) where device_id is not null and revoked_at is null`.execute(
    db,
  );

  await sql`
    alter table identity.login_attempts add column channel text not null default 'web' check (channel in ('web', 'mobile'))
  `.execute(db);

  await sql`
    create table identity.mobile_challenges (
      attempt_id uuid primary key references identity.login_attempts (id) on delete cascade,
      model text not null check (char_length(model) between 1 and 100),
      os_version text not null check (char_length(os_version) between 1 and 16),
      security_patch date not null,
      platform text not null check (platform in ('android', 'ios')),
      app_version text not null check (char_length(app_version) between 5 and 32),
      public_key text check (public_key is null or char_length(public_key) between 16 and 512),
      matched_device_id uuid references identity.devices (id),
      matched_by text check (matched_by in ('current', 'previous')),
      secret_mismatch boolean not null default false,
      password_stamp timestamptz not null,
      totp_factor_id uuid not null,
      constraint mobile_challenges_match_check check ((matched_device_id is null) = (matched_by is null))
    )
  `.execute(db);
  await sql`grant select, insert, update, delete on identity.mobile_challenges to evia_app`.execute(db);
}
