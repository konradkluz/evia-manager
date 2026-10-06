/**
 * 0005 — outbox of security alerts (EVM-016 AC2; SR-LOG-07). The emergency command runs in its own process whose output
 * the log collector never sees, so it writes a durable alert record in the same transaction as the reset; the API
 * process emits pending alerts to its log (collected by Alloy) and marks them emitted. The table holds a code and
 * times only — no e-mail, no token, no free text.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create schema platform`.execute(db);
  await sql`revoke all on schema platform from public`.execute(db);
  await sql`
    create table platform.security_alert_outbox (
      id uuid primary key default uuidv7(),
      alert_code text not null check (alert_code in ('emergency_reset')),
      occurred_at timestamptz not null,
      trace_id text not null check (trace_id ~ '^[0-9a-f]{32}$'),
      emitted_at timestamptz
    )
  `.execute(db);
  await sql`
    create index security_alert_outbox_pending_idx on platform.security_alert_outbox (occurred_at) where emitted_at is null
  `.execute(db);
  await sql`grant usage on schema platform to evia_app`.execute(db);
  await sql`grant select, insert, update on platform.security_alert_outbox to evia_app`.execute(db);
}
