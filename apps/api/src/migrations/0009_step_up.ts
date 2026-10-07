/**
 * 0009 — step-up and the audit log view (EVM-029). Expand only, compatible with the code of EVM-067 (every change adds a
 * nullable column, widens a constraint or adds an index the old code never reads):
 * - `identity.sessions.passkey_authenticated_at`: the last authentication WITH A PASSKEY in this session (the sign-in
 *   with a key or a step-up); null for every other way a session came to be — password only, activation, enrolment, a
 *   recovery code (EVM-023). Existing sessions stay null, so the first protected operation asks for a step-up (fail
 *   closed). `last_authenticated_at` is unchanged: it does not say by which method.
 * - `identity.webauthn_challenges`: the purpose `passkey_step_up`, tied to the session of the request (never to a login
 *   attempt) — the challenge of a step-up can neither be a registration challenge nor a sign-in challenge (ASVS V7.5.3).
 * - `audit.events`: indexes for the newest-first keyset page and the filters of the Administrator's view (action, person).
 *   Plain `CREATE INDEX` (the table is small before M4; CONCURRENTLY is noted for the data volume of M4). Grants and the
 *   append-only triggers of 0003 are NOT touched: the application role keeps INSERT and SELECT only.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table identity.sessions add column passkey_authenticated_at timestamptz`.execute(db);

  await sql`alter table identity.webauthn_challenges drop constraint webauthn_challenges_purpose_owner_check`.execute(db);
  await sql`
    alter table identity.webauthn_challenges add constraint webauthn_challenges_purpose_owner_check check (
      (purpose = 'passkey_registration' and session_id is not null and login_attempt_id is null)
      or (purpose = 'passkey_authentication' and login_attempt_id is not null and session_id is null)
      or (purpose = 'passkey_step_up' and session_id is not null and login_attempt_id is null)
    )
  `.execute(db);

  await sql`create index events_occurred_at_id_idx on audit.events (occurred_at desc, id desc)`.execute(db);
  await sql`create index events_action_occurred_at_idx on audit.events (action, occurred_at desc)`.execute(db);
  await sql`create index events_actor_user_id_occurred_at_idx on audit.events (actor_user_id, occurred_at desc) where actor_user_id is not null`.execute(
    db,
  );
}
