/**
 * 0039 — roles, deactivation, sessions and reset of the second step by an Administrator (EVM-027). Expand only, compatible with the code that is
 * still running (a nullable column, and vocabularies that only grow — the earlier values still satisfy every new CHECK). The number 0034 stays unused.
 *
 * - `identity.users.activated_at`: the instant of the first activation (null = never activated). It decides whether a reactivated account returns to
 *   `active` or to `invited` (a deactivated account looks the same either way). Backfill, deterministic and from facts only: the earliest of the
 *   first passkey, the confirmation of a TOTP factor and the first sign-in; an account with none of them stays null. From now on the code that
 *   activates an account (a passkey registered, a TOTP code confirmed) sets it.
 * - `identity.one_time_links.purpose` gets `mfa_setup` and `issued_by` gets `mfa_reset`: the WINDOW to set up a second step that a reset by an
 *   Administrator opens (24 hours). The row holds a random hash that nobody is ever given — nothing is sent, nobody can open it with a token; a
 *   session `mfa_enrollment` started by the password is bound to it, so it ends with the window (EVM-027 D1; the activation and reset links keep
 *   their values and every query filters on the purpose).
 * - `identity.sessions.revoke_reason` gets `role_changed`, `account_deactivated`, `sessions_ended` and `second_step_reset`.
 *
 * Each CHECK is dropped and added again in this one migration — the tables are small, and both versions of a constraint accept the earlier values.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table identity.users add column activated_at timestamptz`.execute(db);
  // The earliest fact of an activation; `min` ignores the nulls, an account with no such fact stays null. An account that waits for activation again
  // (the emergency reset of the first Administrator) is not "activated" in this sense.
  await sql`
    update identity.users u
    set activated_at = (
      select min(moment) from (
        select min(p.created_at) as moment from identity.passkeys p where p.user_id = u.id
        union all
        select min(t.confirmed_at) from identity.totp_factors t where t.user_id = u.id and t.state = 'active'
        union all
        select u.last_login_at
      ) as moments
    )
    where u.status <> 'invited'
  `.execute(db);

  await sql`
    alter table identity.one_time_links
      drop constraint one_time_links_purpose_check,
      add constraint one_time_links_purpose_check check (purpose in ('account_activation', 'password_reset', 'mfa_setup')),
      drop constraint one_time_links_issued_by_check,
      add constraint one_time_links_issued_by_check check (issued_by in ('cli', 'invitation', 'password_reset', 'mfa_reset'))
  `.execute(db);
  await sql`
    alter table identity.sessions
      drop constraint sessions_revoke_reason_check,
      add constraint sessions_revoke_reason_check
        check (revoke_reason in (
          'logout', 'rotated', 'emergency_reset', 'link_superseded', 'expired', 'password_reset', 'step_up_failed',
          'role_changed', 'account_deactivated', 'sessions_ended', 'second_step_reset'
        ))
  `.execute(db);
}
