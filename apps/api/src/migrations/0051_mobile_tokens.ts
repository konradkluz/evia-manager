/**
 * 0051 — the tokens of a mobile session (EVM-094; ADR-0005). Expand only (two new tables).
 *
 * - `identity.access_tokens`: the SHA-256 of an opaque token of 15 minutes. The validity of a token is NEVER decided by this row alone: the session, the
 *   account and the device are read with it on every request (SR-SESS-09), so a reset of the password or a deactivation ends it at once. A row is kept
 *   until it has been expired for a day, so a token of a device ordered to wipe is still recognised and answered with the signal of the wipe.
 * - `identity.refresh_tokens`: the family of one session. A token is used once (`used_at`); a successor names its predecessor (`parent_id`), so the server can
 *   tell the direct predecessor (accepted for 30 seconds when no successor was used yet) from an older token (a reuse ends the session). `superseded_at`
 *   marks the sibling that the first used successor invalidated.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table identity.access_tokens (
      token_hash bytea primary key check (length(token_hash) = 32),
      session_id uuid not null references identity.sessions (id) on delete cascade,
      created_at timestamptz not null,
      expires_at timestamptz not null
    )
  `.execute(db);
  await sql`create index access_tokens_session_id_idx on identity.access_tokens (session_id)`.execute(db);
  await sql`create index access_tokens_expires_at_idx on identity.access_tokens (expires_at)`.execute(db);
  await sql`grant select, insert, update, delete on identity.access_tokens to evia_app`.execute(db);

  await sql`
    create table identity.refresh_tokens (
      id uuid primary key default uuidv7(),
      session_id uuid not null references identity.sessions (id) on delete cascade,
      token_hash bytea not null unique check (length(token_hash) = 32),
      parent_id uuid references identity.refresh_tokens (id) on delete cascade,
      created_at timestamptz not null,
      expires_at timestamptz not null,
      used_at timestamptz,
      superseded_at timestamptz
    )
  `.execute(db);
  await sql`create index refresh_tokens_session_id_idx on identity.refresh_tokens (session_id)`.execute(db);
  await sql`create index refresh_tokens_parent_id_idx on identity.refresh_tokens (parent_id) where parent_id is not null`.execute(db);
  await sql`grant select, insert, update, delete on identity.refresh_tokens to evia_app`.execute(db);
}
