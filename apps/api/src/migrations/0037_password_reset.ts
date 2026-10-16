/**
 * 0037 — password reset by a one-time link (EVM-025). Expand only: three vocabularies grow by new values, nothing is removed, no GRANT changes.
 *
 * - `identity.one_time_links.purpose` and `issued_by` get `password_reset` (a link the worker issues when it sends the e-mail of a reset;
 *   the activation links keep their values — a reset link and an activation link are never interchangeable: every query filters on the purpose);
 * - `identity.sessions.revoke_reason` gets `password_reset` (every session of the account ends when the password is reset, SR-AUTH-15);
 * - `platform.email_outbox.kind` gets `password_reset` (the link) and `password_changed` (the notice after the reset).
 *
 * Each CHECK is dropped and added again in this one migration: the tables are small and the code that is still running only writes the earlier
 * values, which both versions of a constraint accept. No data changes.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table identity.one_time_links
      drop constraint one_time_links_purpose_check,
      add constraint one_time_links_purpose_check check (purpose in ('account_activation', 'password_reset')),
      drop constraint one_time_links_issued_by_check,
      add constraint one_time_links_issued_by_check check (issued_by in ('cli', 'invitation', 'password_reset'))
  `.execute(db);
  await sql`
    alter table identity.sessions
      drop constraint sessions_revoke_reason_check,
      add constraint sessions_revoke_reason_check
        check (revoke_reason in ('logout', 'rotated', 'emergency_reset', 'link_superseded', 'expired', 'password_reset'))
  `.execute(db);
  await sql`
    alter table platform.email_outbox
      drop constraint email_outbox_kind_check,
      add constraint email_outbox_kind_check
        check (kind in ('user_invitation', 'administrator_alert', 'password_reset', 'password_changed'))
  `.execute(db);
}
