/**
 * 0066 - the site survey: a work order without a customer, in `quoting`, with an explicit deadline (EVM-135 AC7; ADR-0024 "Migracje"; SR-PRIV-01, SR-LOG-03).
 * Expand only: nullable or defaulted columns (the default of `site_survey_extensions` is a constant, so PostgreSQL does not rewrite the table), CHECKs added
 * `not valid` and validated, one trigger, two partial indexes and the closed list of the commands of the audit trail widened (the pattern of 0058). Nothing is
 * dropped, renamed or rewritten and there is NO backfill (there are no surveys yet). Version N-1 keeps working: it never names the new columns, it writes orders
 * WITH a customer only (every path of N-1 requires one), and the widened CHECK of the audit trail accepts everything it writes.
 *
 * - `work_orders.work_orders`: `site_survey_expires_at` (the marker AND the deadline: `IS NOT NULL` <=> an open survey), `site_survey_extensions` (0-2),
 *   `site_survey_reminded_at`, `site_survey_purged_at` (written once - trigger, errcode EV003) and `requester_phone` (E.164, DO-K: never in `search_text`, logs,
 *   audit, notifications or the change log - the generated `search_text` of 0025 is NOT touched).
 * - The invariants (ADR-0024 pt 1): no customer => a survey (`work_orders_customer_or_site_survey`); a survey => no customer and a status in
 *   {quoting, on_hold, cancelled} (`work_orders_site_survey_shape`); the phone, the extensions and the reminder only at a survey; the format of the phone.
 * - The order of the steps is the first point of the plan of EVM-135: every CHECK is added `not valid` (new writes are checked at once), THEN the control query
 *   "0 orders without a customer" runs, and only then the CHECKs are validated. A count above 0 throws: the whole transaction of the runner is rolled back, the
 *   deployment keeps the previous colour, and the story stops to ask the product owner (AC7). The message names the count only - no identifier, no content.
 * - `overview.work_order_summaries.site_survey_expires_at`: the column of the projection (filter, sort, read policy; ADR-0017) - filled by the recorder.
 * - `audit.events.command_type` may also be `CreateSiteSurvey`.
 *
 * Forward only (the runner keeps no `down`, `migrations.test.ts`). The logical undo, proved by `site-survey-migration.test.ts`, runs in the reverse order: restore the
 * CHECK of the commands of 0065 (only while no event `CreateSiteSurvey` exists - the trail is never deleted, so otherwise the wider CHECK stays), drop the two
 * indexes, the trigger and its function, the CHECKs, the column of the projection and the five columns. Precondition: no open survey (`site_survey_expires_at is not
 * null` = 0 rows) - dropping the marker of an open survey would leave an order without a customer that nothing explains. Without the undo, the code of N-1 runs on
 * this schema as it is (the CHECKs keep it from writing an order without a customer), so a rollback of the code never needs it.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  // the migration runs in a transaction: the lock is given up after 5 s instead of queueing every writer of the table behind it
  await sql`set local lock_timeout = '5s'`.execute(db);

  await sql`
    alter table work_orders.work_orders
      add column site_survey_expires_at timestamptz,
      add column site_survey_extensions smallint not null default 0,
      add column site_survey_reminded_at timestamptz,
      add column site_survey_purged_at timestamptz,
      add column requester_phone text
  `.execute(db);

  await sql`
    alter table work_orders.work_orders
      add constraint work_orders_requester_phone_format check (requester_phone is null or requester_phone ~ '^\\+[1-9][0-9]{7,14}$') not valid,
      add constraint work_orders_site_survey_extensions_range check (site_survey_extensions between 0 and 2) not valid,
      add constraint work_orders_site_survey_fields check (
        site_survey_expires_at is not null or (requester_phone is null and site_survey_extensions = 0 and site_survey_reminded_at is null)
      ) not valid,
      add constraint work_orders_site_survey_shape check (
        site_survey_expires_at is null or (customer_id is null and status in ('quoting', 'on_hold', 'cancelled'))
      ) not valid,
      add constraint work_orders_customer_or_site_survey check (customer_id is not null or site_survey_expires_at is not null) not valid
  `.execute(db);

  // the control query of AC7: every row, the soft deleted ones included; only the count leaves the database
  const control = await sql<{ n: number }>`select count(*)::int as n from work_orders.work_orders where customer_id is null`.execute(db);
  const found = control.rows[0]?.n ?? 0;
  if (found > 0) {
    throw new Error(`0066: ${found} work orders without a customer - stopped before validation; EVM-135 AC7 asks the product owner`);
  }

  await sql`alter table work_orders.work_orders validate constraint work_orders_requester_phone_format`.execute(db);
  await sql`alter table work_orders.work_orders validate constraint work_orders_site_survey_extensions_range`.execute(db);
  await sql`alter table work_orders.work_orders validate constraint work_orders_site_survey_fields`.execute(db);
  await sql`alter table work_orders.work_orders validate constraint work_orders_site_survey_shape`.execute(db);
  // the last: the invariant the control query has just made sure of
  await sql`alter table work_orders.work_orders validate constraint work_orders_customer_or_site_survey`.execute(db);

  await sql`
    create function work_orders.keep_site_survey_purged_at() returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $$
      begin
        if old.site_survey_purged_at is not null and new.site_survey_purged_at is distinct from old.site_survey_purged_at then
          raise exception 'work_orders.work_orders site_survey_purged_at is written once' using errcode = 'EV003';
        end if;
        return new;
      end
      $$
  `.execute(db);
  await sql`revoke all on function work_orders.keep_site_survey_purged_at() from public`.execute(db);
  await sql`
    create trigger keep_site_survey_purged_at before update of site_survey_purged_at on work_orders.work_orders
      for each row execute function work_orders.keep_site_survey_purged_at()
  `.execute(db);

  await sql`
    create index work_orders_site_survey_expiry_idx on work_orders.work_orders (site_survey_expires_at, created_by)
      where site_survey_expires_at is not null and deleted_at is null
  `.execute(db);

  await sql`alter table overview.work_order_summaries add column site_survey_expires_at timestamptz`.execute(db);
  await sql`
    create index work_order_summaries_site_survey_idx on overview.work_order_summaries (site_survey_expires_at, work_order_id)
      where site_survey_expires_at is not null and deleted_at is null
  `.execute(db);

  await sql`alter table audit.events drop constraint events_mutation_fields`.execute(db);
  await sql`
    alter table audit.events
      add constraint events_mutation_fields check (
        (device_id is null and work_order_id is null and command_type is null and quota_kind is null)
        or (device_id is not null and work_order_id is not null and quota_kind is null
            and coalesce(command_type in ('CreateNote', 'CreateComment', 'CreateQuickWorkOrder', 'CreateMediaAsset', 'CreateSiteSurvey'), false))
        or (device_id is not null and work_order_id is null and command_type is null and coalesce(quota_kind in ('customer', 'site'), false))
      ) not valid
  `.execute(db);
  await sql`alter table audit.events validate constraint events_mutation_fields`.execute(db);
}
