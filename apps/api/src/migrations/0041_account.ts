/**
 * 0041 — the account of the user: a name of a passkey, the mark of the full re-authentication, the limit of sessions and their retention (EVM-028). Expand
 * only, compatible with the code that is still running (two nullable columns the old code never reads, an index, and two vocabularies that only grow —
 * the earlier values still satisfy every CHECK).
 *
 * - `identity.passkeys.name`: the name the owner gave a key ("Telefon Jana" — a personal datum typed by a person, deleted with the key); null on the keys made
 *   before (the answer says "Klucz dostępu"). 1–60 characters, a CHECK.
 * - `identity.sessions.reauthenticated_at` and `reauth_purpose`: the ONE-TIME mark of the full re-authentication (password and a second step, or the second
 *   step alone) the operation of the account spends with a conditional UPDATE in its own transaction (SR-AUTH-10, ASVS V7.5.1). Both are set or both are null;
 *   the mark belongs to ONE session and ONE purpose and is never copied when a session is rotated.
 * - `identity.sessions.revoke_reason` knows `session_limit` (the sixth sign-in ended the oldest session, SR-SESS-04) and `ended_by_user`.
 * - Two indexes on `identity.sessions`: the open sessions of a user in the order they began (the limit of five), and the moment a session ended (the job of
 *   retention, P4: 30 days). The expression is the one the job writes — `least(revoked, idle deadline, absolute deadline)` — so the index serves it.
 * - `platform.email_outbox.kind` knows `session_limit` (e-mail 8).
 *
 * Each CHECK is dropped and added again in this one migration — the tables are small, and both versions of a constraint accept the earlier values.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table identity.passkeys add column name text check (name is null or char_length(name) between 1 and 60)`.execute(db);

  await sql`
    alter table identity.sessions
      add column reauthenticated_at timestamptz,
      add column reauth_purpose text check (reauth_purpose in ('second_step_change', 'password_change')),
      add constraint sessions_reauth_check check ((reauthenticated_at is null) = (reauth_purpose is null))
  `.execute(db);
  await sql`
    alter table identity.sessions
      drop constraint sessions_revoke_reason_check,
      add constraint sessions_revoke_reason_check
        check (revoke_reason in (
          'logout', 'rotated', 'emergency_reset', 'link_superseded', 'expired', 'password_reset', 'step_up_failed',
          'role_changed', 'account_deactivated', 'sessions_ended', 'second_step_reset', 'session_limit', 'ended_by_user'
        ))
  `.execute(db);
  await sql`
    create index sessions_user_id_created_at_idx on identity.sessions (user_id, created_at, id) where revoked_at is null
  `.execute(db);
  await sql`
    create index sessions_ended_at_idx on identity.sessions (
      (least(coalesce(revoked_at, 'infinity'::timestamptz), idle_expires_at, absolute_expires_at))
    )
  `.execute(db);

  await sql`
    alter table platform.email_outbox
      drop constraint email_outbox_kind_check,
      add constraint email_outbox_kind_check
        check (kind in (
          'user_invitation', 'administrator_alert', 'password_reset', 'password_changed', 'mfa_changed', 'recovery_code_used',
          'account_locked', 'new_browser', 'session_limit'
        ))
  `.execute(db);
}
