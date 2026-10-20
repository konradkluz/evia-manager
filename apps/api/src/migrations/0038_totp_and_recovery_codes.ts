/**
 * 0038 — code from an authenticator app (TOTP) and recovery codes (EVM-023). Expand only, compatible with the code that is still running (every change
 * adds a table, adds a column with a default or null that the old code never reads, or widens a vocabulary that the earlier values still satisfy):
 * - `identity.totp_factors`: at most one TOTP factor per account (`user_id` unique). The secret exists only as `secret_ciphertext` — the sealed envelope of
 *   `platform/crypto/field-encryption` (a data key per value, wrapped by a master key; the account is authenticated data), never in the clear (SR-CRYPTO-02).
 *   `state` is `pending` until a correct code is confirmed, `active` after; a pending factor is never a method of the second step. `last_used_step` is the
 *   time step of the last accepted code (the replay guard of sign-in, step-up and confirmation alike; ASVS V6.5.5). A CHECK keeps the state and `confirmed_at`
 *   consistent.
 * - `identity.recovery_codes`: one row per code, only the Argon2id hash (PHC string) — the code itself is shown once and never stored (SR-AUTH-08). A generation
 *   is the ten codes of one request (`generation_id`); `session_id` is the session that asked for it (the rule that only that session may refresh them, B4);
 *   `used_at` spends a code, `superseded_at` retires a whole generation when a new one is made.
 * - `identity.sessions.totp_authenticated_at`: the last authentication WITH A TOTP CODE in this session (sign-in, step-up, confirmation); null for every other
 *   way a session came to be, a recovery code included — it does not open the window of step-up operations (SR-SESS-08). `step_up_failed_attempts` counts wrong
 *   codes of step-up in the session (the fifth ends it, ASVS V6.3.1).
 * - `identity.sessions.revoke_reason` knows `step_up_failed`; `platform.email_outbox.kind` knows `mfa_changed` and `recovery_code_used`.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table identity.totp_factors (
      id uuid primary key default uuidv7(),
      user_id uuid not null unique references identity.users (id),
      secret_ciphertext bytea not null check (length(secret_ciphertext) > 0),
      state text not null check (state in ('pending', 'active')),
      last_used_step bigint,
      created_at timestamptz not null,
      confirmed_at timestamptz,
      constraint totp_factors_state_confirmed_check check ((state = 'pending') = (confirmed_at is null))
    )
  `.execute(db);
  await sql`grant select, insert, update, delete on identity.totp_factors to evia_app`.execute(db);

  await sql`
    create table identity.recovery_codes (
      id uuid primary key default uuidv7(),
      user_id uuid not null references identity.users (id),
      generation_id uuid not null,
      session_id uuid not null,
      code_hash text not null check (code_hash like '$argon2id$%'),
      created_at timestamptz not null,
      used_at timestamptz,
      superseded_at timestamptz
    )
  `.execute(db);
  await sql`create index recovery_codes_user_id_idx on identity.recovery_codes (user_id)`.execute(db);
  await sql`
    create index recovery_codes_available_idx on identity.recovery_codes (user_id) where used_at is null and superseded_at is null
  `.execute(db);
  await sql`grant select, insert, update on identity.recovery_codes to evia_app`.execute(db);

  await sql`alter table identity.sessions add column totp_authenticated_at timestamptz`.execute(db);
  await sql`alter table identity.sessions add column step_up_failed_attempts smallint not null default 0 check (step_up_failed_attempts >= 0)`.execute(
    db,
  );
  await sql`
    alter table identity.sessions
      drop constraint sessions_revoke_reason_check,
      add constraint sessions_revoke_reason_check
        check (revoke_reason in ('logout', 'rotated', 'emergency_reset', 'link_superseded', 'expired', 'password_reset', 'step_up_failed'))
  `.execute(db);
  await sql`
    alter table platform.email_outbox
      drop constraint email_outbox_kind_check,
      add constraint email_outbox_kind_check
        check (kind in ('user_invitation', 'administrator_alert', 'password_reset', 'password_changed', 'mfa_changed', 'recovery_code_used'))
  `.execute(db);
}
