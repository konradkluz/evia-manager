/**
 * 0004 — identity schema (ADR-0003, ADR-0005; EVM-016): accounts, password credentials, passkeys, one-time links,
 * sessions and WebAuthn challenges. Expand only. Rules:
 * - the technical tables (credentials, links, sessions, challenges) have no common domain columns and no soft delete;
 *   credentials are deleted for real (emergency reset) — they are secrets, not business data;
 * - only hashes of secrets are stored (SHA-256 of 256-bit random tokens: session token, link token, challenge);
 * - times come from the application clock — there are no `now()` defaults and no TTL comparison with the database clock;
 * - `users.email` is stored normalised (NFC, trimmed, lower case) and is unique; the WebAuthn user handle is random
 *   (32 bytes), not derived from the e-mail, and never changes (changing it breaks sign-in with passkeys);
 * - values of the small vocabularies are CHECK constraints (no ENUM types); a new value widens the constraint (expand);
 * - explicit GRANTs for `evia_app` on every table (no default privileges) — the catalogue test fails on a table
 *   without one, so a missing grant cannot first show up on staging.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create schema identity`.execute(db);
  await sql`revoke all on schema identity from public`.execute(db);

  await sql`
    create table identity.users (
      id uuid primary key default uuidv7(),
      email text not null unique check (email = lower(email) and length(email) between 3 and 254),
      display_name text not null check (length(display_name) between 1 and 200),
      role text not null check (role in ('administrator', 'editor', 'read_only')),
      status text not null check (status in ('invited', 'active', 'deactivated')),
      webauthn_user_handle bytea not null unique check (length(webauthn_user_handle) = 32),
      last_login_at timestamptz,
      deactivated_at timestamptz,
      created_at timestamptz not null,
      created_by uuid,
      updated_at timestamptz not null,
      updated_by uuid,
      version integer not null default 1 check (version >= 1),
      deleted_at timestamptz,
      deleted_by uuid
    )
  `.execute(db);

  await sql`
    create table identity.password_credentials (
      user_id uuid primary key references identity.users (id),
      password_hash text not null check (length(password_hash) between 20 and 512),
      updated_at timestamptz not null
    )
  `.execute(db);

  await sql`
    create table identity.passkeys (
      id uuid primary key default uuidv7(),
      user_id uuid not null references identity.users (id),
      credential_id text not null unique check (length(credential_id) between 1 and 1024),
      public_key bytea not null,
      counter bigint not null check (counter >= 0),
      transports text[] not null default '{}',
      device_type text not null check (device_type in ('single_device', 'multi_device')),
      backed_up boolean not null,
      created_at timestamptz not null,
      last_used_at timestamptz
    )
  `.execute(db);
  await sql`create index passkeys_user_id_idx on identity.passkeys (user_id)`.execute(db);

  await sql`
    create table identity.one_time_links (
      id uuid primary key default uuidv7(),
      user_id uuid not null references identity.users (id),
      purpose text not null check (purpose in ('account_activation')),
      token_hash bytea not null unique check (length(token_hash) = 32),
      issued_by text not null check (issued_by in ('cli')),
      issued_at timestamptz not null,
      expires_at timestamptz not null check (expires_at > issued_at),
      used_at timestamptz,
      superseded_at timestamptz
    )
  `.execute(db);
  await sql`create index one_time_links_user_id_idx on identity.one_time_links (user_id)`.execute(db);

  await sql`
    create table identity.sessions (
      id uuid primary key default uuidv7(),
      user_id uuid not null references identity.users (id),
      channel text not null check (channel in ('web', 'mobile')),
      state text not null check (state in ('mfa_enrollment', 'active')),
      token_hash bytea not null unique check (length(token_hash) = 32),
      one_time_link_id uuid references identity.one_time_links (id),
      created_at timestamptz not null,
      last_seen_at timestamptz not null,
      last_authenticated_at timestamptz not null,
      idle_expires_at timestamptz not null,
      absolute_expires_at timestamptz not null,
      revoked_at timestamptz,
      revoke_reason text check (revoke_reason in ('logout', 'rotated', 'emergency_reset', 'link_superseded')),
      ip_address inet,
      user_agent text check (length(user_agent) <= 512),
      check ((revoked_at is null) = (revoke_reason is null))
    )
  `.execute(db);
  await sql`create index sessions_user_id_idx on identity.sessions (user_id) where revoked_at is null`.execute(db);
  await sql`create index sessions_one_time_link_id_idx on identity.sessions (one_time_link_id) where one_time_link_id is not null`.execute(
    db,
  );

  await sql`
    create table identity.webauthn_challenges (
      id uuid primary key default uuidv7(),
      user_id uuid not null references identity.users (id),
      session_id uuid not null references identity.sessions (id),
      purpose text not null check (purpose in ('passkey_registration')),
      challenge_hash bytea not null unique check (length(challenge_hash) = 32),
      created_at timestamptz not null,
      expires_at timestamptz not null check (expires_at > created_at),
      used_at timestamptz
    )
  `.execute(db);
  await sql`create index webauthn_challenges_session_id_idx on identity.webauthn_challenges (session_id)`.execute(db);

  await sql`grant usage on schema identity to evia_app`.execute(db);
  await sql`grant select, insert, update, delete on identity.users to evia_app`.execute(db);
  await sql`grant select, insert, update, delete on identity.password_credentials to evia_app`.execute(db);
  await sql`grant select, insert, update, delete on identity.passkeys to evia_app`.execute(db);
  await sql`grant select, insert, update, delete on identity.one_time_links to evia_app`.execute(db);
  await sql`grant select, insert, update, delete on identity.sessions to evia_app`.execute(db);
  await sql`grant select, insert, update, delete on identity.webauthn_challenges to evia_app`.execute(db);
}
