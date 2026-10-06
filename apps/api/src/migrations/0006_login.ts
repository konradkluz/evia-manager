/**
 * 0006 — login and session expiry (EVM-067). Expand only, compatible with the code of EVM-016 (every change widens a
 * constraint, drops a NOT NULL or adds a table / column the old code never reads):
 * - `identity.login_attempts`: the first step of the sign-in (password accepted) waiting for the second one. Only the
 *   SHA-256 of the 256-bit `loginToken` is stored; the row is single-use (`used_at`), lives 5 minutes and counts failed
 *   keys. It holds NO address and NO user agent (data minimisation, RODO art. 5(1)(c) and (e), P9): the session created
 *   at the second step stores the client data, the audit trail keeps the address prefix. Expired rows are deleted
 *   opportunistically at the next first step, at the latest 24 hours after they expired (the code, `LOGIN_ATTEMPT_RETENTION_MS`).
 * - `webauthn_challenges` also serves the sign-in ceremony: the purpose `passkey_authentication`, tied to a login attempt
 *   instead of a session (exactly one of the two, a CHECK — the key of a sign-in can never be mixed with an enrolment).
 * - `sessions.revoke_reason` knows `expired` (a session that ran out of idle time or of its absolute lifetime).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table identity.login_attempts (
      id uuid primary key default uuidv7(),
      user_id uuid not null references identity.users (id),
      token_hash bytea not null unique check (length(token_hash) = 32),
      created_at timestamptz not null,
      expires_at timestamptz not null check (expires_at > created_at),
      used_at timestamptz,
      failed_attempts smallint not null default 0 check (failed_attempts >= 0)
    )
  `.execute(db);
  await sql`create index login_attempts_user_id_idx on identity.login_attempts (user_id)`.execute(db);
  await sql`create index login_attempts_expires_at_idx on identity.login_attempts (expires_at)`.execute(db);
  await sql`grant select, insert, update, delete on identity.login_attempts to evia_app`.execute(db);

  await sql`alter table identity.webauthn_challenges alter column session_id drop not null`.execute(db);
  await sql`alter table identity.webauthn_challenges add column login_attempt_id uuid references identity.login_attempts (id) on delete cascade`.execute(
    db,
  );
  await sql`alter table identity.webauthn_challenges drop constraint webauthn_challenges_purpose_check`.execute(db);
  await sql`
    alter table identity.webauthn_challenges add constraint webauthn_challenges_purpose_owner_check check (
      (purpose = 'passkey_registration' and session_id is not null and login_attempt_id is null)
      or (purpose = 'passkey_authentication' and login_attempt_id is not null and session_id is null)
    )
  `.execute(db);
  await sql`
    create index webauthn_challenges_login_attempt_id_idx on identity.webauthn_challenges (login_attempt_id)
      where login_attempt_id is not null
  `.execute(db);

  await sql`alter table identity.sessions drop constraint sessions_revoke_reason_check`.execute(db);
  await sql`
    alter table identity.sessions add constraint sessions_revoke_reason_check
      check (revoke_reason in ('logout', 'rotated', 'emergency_reset', 'link_superseded', 'expired'))
  `.execute(db);
}
