/**
 * 0048 — the alerts of the quarantine and of the signatures (EVM-049 AC2, AC7; SR-LOG-07). Expand only: the CHECK of
 * `platform.security_alert_outbox.alert_code` is redefined with the COMPLETE list of 0040 plus `media_quarantined`, `signature_stale`
 * and `signature_stale_72h`; the index serves the deduplication of the alerts of the signatures (the newest alert of a code).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table platform.security_alert_outbox
      drop constraint security_alert_outbox_alert_code_check,
      add constraint security_alert_outbox_alert_code_check
        check (alert_code in (
          'emergency_reset', 'projection_authz_drift', 'login_failure_spike', 'second_step_failure_spike', 'account_locked',
          'media_quarantined', 'signature_stale', 'signature_stale_72h'
        ))
  `.execute(db);
  await sql`create index security_alert_outbox_code_idx on platform.security_alert_outbox (alert_code, occurred_at desc)`.execute(db);
}
