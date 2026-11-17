/**
 * 0068 - the automatic purge of site surveys (EVM-139; ADR-0024 pt 9 and "Migracje"; SR-PRIV-11, SR-PRIV-01, SR-LOG-07). Expand only: two nullable columns, three
 * CHECKs added `not valid` and validated (the pattern of 0066), one trigger and the closed list of security alerts widened (the pattern of 0063). Nothing is dropped,
 * renamed or rewritten and there is NO backfill: no row can violate the new CHECKs (no site is anonymized, no survey is purged - the job runs in the mode `report`
 * until Konrad decides otherwise). The code of version N-1 keeps working on this schema: it never names the new columns, never writes `site_survey_purged_at`, and
 * every row it writes satisfies the CHECKs.
 *
 * - `sites.sites.anonymized_at` / `anonymized_by`: the mark of an anonymized location (the pattern of 0043): both or neither; a location that carries the mark holds
 *   NEUTRAL values only (the address is "Adres usunięty", the building number "0", the postal code "00-000", every optional column empty, the type `other`).
 *   `search_text` is generated from those columns, so the database recomputes it. The application writes the same values (`anonymized-site.ts`; a test keeps the two
 *   equal). The trigger `sites.keep_anonymization()` makes the mark irreversible; the other columns stay writable on purpose (the CHECK pins them).
 * - `work_orders_site_survey_purged_neutral`: a purged survey (`site_survey_purged_at is not null`) is a TOMBSTONE - no customer (a customer is never assigned to a
 *   purged survey, EVM-139 AC3), soft deleted, the neutral title "Wizja lokalna", no description, no phone of the requester, no free text of the reason.
 * - `platform.security_alert_outbox.alert_code`: the COMPLETE list of 0063 plus `site_survey_purge_failed` (the purge could not write the register or a survey failed).
 *
 * Forward only (the runner keeps no `down`, `migrations.test.ts`). The logical undo, proved by `site-survey-purge-migration.test.ts`: restore the CHECK of the alerts of
 * 0063 (only while no alert `site_survey_purge_failed` exists - the outbox is a record, so otherwise the wider CHECK stays), drop the CHECK of the tombstone, the trigger
 * and its function, the CHECK of the locations and the two columns. Precondition: no anonymized location and no purged survey - dropping the marks would lose the
 * information that an erasure happened (the register of deletions holds it, the database must too). Without the undo, the code of N-1 runs on this schema as it is.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  // the migration runs in a transaction: the lock is given up after 5 s instead of queueing every writer of the table behind it
  await sql`set local lock_timeout = '5s'`.execute(db);

  await sql`alter table sites.sites add column anonymized_at timestamptz, add column anonymized_by uuid`.execute(db);
  await sql`
    alter table sites.sites
      add constraint sites_anonymized_neutral check (
        (anonymized_at is null) = (anonymized_by is null)
        and (
          anonymized_at is null
          or (
            street = 'Adres usunięty' and building_number = '0' and postal_code = '00-000' and city = 'Adres usunięty' and site_type = 'other'
            and apartment_number is null and parking_spot_number is null and garage_level is null and connection_power_kw is null
            and metering_point_id is null and distribution_system_operator_party_id is null and manager_party_id is null and notes is null
          )
        )
      ) not valid
  `.execute(db);
  await sql`alter table sites.sites validate constraint sites_anonymized_neutral`.execute(db);

  await sql`
    create function sites.keep_anonymization() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if old.anonymized_at is not null
           and (new.anonymized_at, new.anonymized_by) is distinct from (old.anonymized_at, old.anonymized_by) then
          raise exception 'sites.sites: the anonymization cannot be changed or undone' using errcode = 'EV001';
        end if;
        return new;
      end
      $$
  `.execute(db);
  await sql`revoke all on function sites.keep_anonymization() from public`.execute(db);
  await sql`
    create trigger sites_keep_anonymization before update on sites.sites
      for each row execute function sites.keep_anonymization()
  `.execute(db);

  await sql`
    alter table work_orders.work_orders
      add constraint work_orders_site_survey_purged_neutral check (
        site_survey_purged_at is null
        or (
          customer_id is null and deleted_at is not null and title = 'Wizja lokalna'
          and description is null and requester_phone is null and status_reason is null
        )
      ) not valid
  `.execute(db);
  await sql`alter table work_orders.work_orders validate constraint work_orders_site_survey_purged_neutral`.execute(db);

  await sql`
    alter table platform.security_alert_outbox
      drop constraint security_alert_outbox_alert_code_check,
      add constraint security_alert_outbox_alert_code_check
        check (alert_code in (
          'emergency_reset', 'projection_authz_drift', 'login_failure_spike', 'second_step_failure_spike', 'account_locked',
          'media_quarantined', 'signature_stale', 'signature_stale_72h', 'sync_full_downloads_excess', 'sync_snapshot_rate_exceeded',
          'sync_quick_create_quota_exceeded', 'media_export_started', 'site_survey_purge_failed'
        ))
  `.execute(db);
}
