/**
 * 0067 - the e-mail of a site survey that is about to expire (EVM-140 AC1; ADR-0024 pt 9). Expand only: ONE CHECK that only grows - `platform.email_outbox.kind`
 * accepts `site_survey_expiring` besides the ten kinds of 0052 (the pattern of 0052 and 0058: the constraint is rewritten with the FULL list of the newest
 * definition plus the new value). Nothing is dropped, renamed or rewritten, there is NO backfill, no column and no index; every row that exists satisfies the wider
 * CHECK. Version N-1 keeps working: it never writes the new kind and it reads the rows it knows (the new kind appears only after the worker of N runs the job).
 *
 * Forward only (the runner keeps no `down`, `migrations.test.ts`). The logical undo, proved by `email-outbox-kind-migration.test.ts`: while no row of the kind
 * `site_survey_expiring` exists the CHECK of 0052 can be restored as it was; a row of the kind that exists is a message of the outbox - the wider CHECK then
 * stays (the code of N-1 runs on it as it is, so a rollback of the code never needs the undo).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  // the migration runs in a transaction: the lock is given up after 5 s instead of queueing every writer of the table behind it
  await sql`set local lock_timeout = '5s'`.execute(db);
  await sql`
    alter table platform.email_outbox
      drop constraint email_outbox_kind_check,
      add constraint email_outbox_kind_check
        check (kind in (
          'user_invitation', 'administrator_alert', 'password_reset', 'password_changed', 'mfa_changed', 'recovery_code_used',
          'account_locked', 'new_browser', 'session_limit', 'new_device', 'site_survey_expiring'
        ))
  `.execute(db);
}
