/**
 * 0003 — audit schema, append-only (ADR-0003; EVM-016 AC7; SR-LOG-03, SR-LOG-04). Two layers: `evia_app` holds only
 * INSERT and SELECT (no UPDATE, DELETE or TRUNCATE), and triggers reject UPDATE, DELETE and TRUNCATE for everybody
 * else (the table owner included; disabling a trigger needs ownership, which the application role never has).
 * The trigger function has a fixed search_path. The table holds no personal data: the IP is stored as a prefix
 * (/24 or /48, P9), the subject only as UUIDs, reasons only as codes from a closed list defined in code.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create schema audit`.execute(db);
  await sql`revoke all on schema audit from public`.execute(db);
  await sql`
    create table audit.events (
      id uuid primary key default uuidv7(),
      occurred_at timestamptz not null,
      actor_type text not null check (actor_type in ('user', 'system', 'anonymous')),
      actor_user_id uuid,
      session_id uuid,
      ip_prefix cidr,
      origin text not null check (origin in ('web', 'cli')),
      action text not null check (length(action) between 3 and 64),
      outcome text not null check (outcome in ('success', 'denied', 'failed')),
      reason_code text check (length(reason_code) <= 64),
      object_type text not null check (length(object_type) between 2 and 64),
      object_id uuid,
      trace_id text not null check (trace_id ~ '^[0-9a-f]{32}$')
    )
  `.execute(db);
  await sql`
    create function audit.reject_change() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        raise exception 'audit.events is append-only' using errcode = 'EV001';
      end
      $$
  `.execute(db);
  await sql`revoke all on function audit.reject_change() from public`.execute(db);
  await sql`
    create trigger events_reject_row_change before update or delete on audit.events
      for each row execute function audit.reject_change()
  `.execute(db);
  await sql`
    create trigger events_reject_truncate before truncate on audit.events
      for each statement execute function audit.reject_change()
  `.execute(db);
  await sql`grant usage on schema audit to evia_app`.execute(db);
  await sql`grant insert, select on audit.events to evia_app`.execute(db);
}
