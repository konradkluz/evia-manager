/**
 * 0052 — the vocabularies of the mobile channel (EVM-094). Expand only: two CHECK constraints that only grow — every earlier value still satisfies them.
 * Each is rewritten with the FULL list of the newest definition (0041) plus the new values.
 *
 * - `identity.sessions.revoke_reason`: `refresh_reuse` (a used refresh token came back), `device_inactive` (30 days without contact), `device_wipe` and
 *   `device_removed` (the reasons EVM-095 gives when an Administrator orders a wipe or removes a device).
 * - `platform.email_outbox.kind`: `new_device` (a sign-in from a phone the account did not know; SR-AUTH-15).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table identity.sessions
      drop constraint sessions_revoke_reason_check,
      add constraint sessions_revoke_reason_check
        check (revoke_reason in (
          'logout', 'rotated', 'emergency_reset', 'link_superseded', 'expired', 'password_reset', 'step_up_failed',
          'role_changed', 'account_deactivated', 'sessions_ended', 'second_step_reset', 'session_limit', 'ended_by_user',
          'refresh_reuse', 'device_inactive', 'device_wipe', 'device_removed'
        ))
  `.execute(db);
  await sql`
    alter table platform.email_outbox
      drop constraint email_outbox_kind_check,
      add constraint email_outbox_kind_check
        check (kind in (
          'user_invitation', 'administrator_alert', 'password_reset', 'password_changed', 'mfa_changed', 'recovery_code_used',
          'account_locked', 'new_browser', 'session_limit', 'new_device'
        ))
  `.execute(db);
}
