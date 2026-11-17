import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { ANONYMIZED_SITE_VALUES } from '../../src/modules/sites/domain/anonymized-site.ts';
import { SITE_SURVEY_TOMBSTONE_TITLE } from '../../src/modules/work-orders/domain/site-survey-purge.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { SYSTEM_ACTOR_ID } from '../../src/platform/system-actor.ts';
import { FixedClock } from '../support/clock.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { freshDatabaseUrl } from './database.ts';

/**
 * 0068 - the automatic purge of site surveys (EVM-139; ADR-0024 pt 9 and "Migracje"; expand only). It is applied on a database that already holds sites, an open survey and
 * an ordinary order: nothing is rewritten (no backfill), the code of N-1 (it names none of the new columns) keeps writing, the CHECKs refuse a location or a tombstone with
 * anything but the neutral values, the marks cannot be undone, and the logical undo (the runner keeps no `down`) runs at the end while no mark and no alert of the new code
 * exist. Synthetic data only.
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0068')) as typeof MIGRATIONS;
const clock = new FixedClock('2027-05-01T08:00:00.000Z');
const T = '2027-05-01T08:00:00Z';

let db: Kysely<Database>;
let siteId = '';
let surveyId = '';

const columnsOf = async (schema: string, table: string): Promise<string[]> =>
  (
    await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_schema = ${schema} and table_name = ${table}`.execute(db)
  ).rows.map((row) => row.column_name);
const snapshotOf = async (): Promise<string> =>
  (
    await sql<{ t: string }>`
      select (select coalesce(json_agg(s order by s.id), '[]') from sites.sites s)::text
        || (select coalesce(json_agg(w order by w.id), '[]') from work_orders.work_orders w)::text as t`.execute(db)
  ).rows[0]?.t ?? '';
const refused = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};

const neutral = ANONYMIZED_SITE_VALUES;
const anonymize = (id: string, over: Partial<Record<keyof typeof neutral, unknown>> = {}) => {
  const values = { ...neutral, ...over };
  return sql`
    update sites.sites set site_type = ${values.site_type}, street = ${values.street}, building_number = ${values.building_number},
      postal_code = ${values.postal_code}, city = ${values.city}, apartment_number = null, parking_spot_number = null, garage_level = null,
      connection_power_kw = null, metering_point_id = null, distribution_system_operator_party_id = null, manager_party_id = null,
      notes = ${values.notes ?? null}, anonymized_at = ${T}, anonymized_by = ${SYSTEM_ACTOR_ID}
    where id = ${id}`.execute(db);
};
const purge = (id: string, over: { title?: string; description?: string | null; phone?: string | null; reason?: string | null } = {}) =>
  sql`
    update work_orders.work_orders set title = ${over.title ?? SITE_SURVEY_TOMBSTONE_TITLE}, description = ${over.description ?? null},
      requester_phone = ${over.phone ?? null}, status_reason = ${over.reason ?? null}, deleted_at = ${T}, deleted_by = ${SYSTEM_ACTOR_ID},
      site_survey_purged_at = ${T}
    where id = ${id}`.execute(db);

beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  await createUser(db, clock, { role: 'editor' });
  siteId = await insertSite(db, { street: 'ul. Migracji-synt', city: 'Migrowo-synt', postalCode: '99-068', notes: 'Notatka-synt' });
  const ids = await insertWorkOrders(db, [
    { number: 'ZL-6800-0001', title: 'Wizja-synt', siteId, siteSurveyExpiresAt: new Date('2027-02-14T08:00:00Z') },
  ]);
  surveyId = [...ids.values()][0] ?? '';
  await sql`update work_orders.work_orders set description = 'Opis-synt', status_reason = 'Powod-synt', requester_phone = '+48600680001' where id = ${surveyId}`.execute(
    db,
  );
});
afterAll(async () => {
  await db.destroy();
});

describe('migration 0068 - the purge of site surveys (EVM-139; expand only)', () => {
  it('EVM-139 AC2 before 0068 the columns do not exist; 0068 applies alone, adds only nullable columns and rewrites nothing (no backfill)', async () => {
    expect(await columnsOf('sites', 'sites')).not.toContain('anonymized_at');
    expect((await migrateToLatest(db, MIGRATIONS)).applied).toEqual(['0068_site_survey_purge']);
    expect(await columnsOf('sites', 'sites')).toEqual(expect.arrayContaining(['anonymized_at', 'anonymized_by']));
    const nullable = await sql<{ column_name: string; is_nullable: string }>`
      select column_name, is_nullable from information_schema.columns
      where table_schema = 'sites' and table_name = 'sites' and column_name in ('anonymized_at', 'anonymized_by')`.execute(db);
    expect(nullable.rows.every((row) => row.is_nullable === 'YES')).toBe(true);
    expect(await snapshotOf()).toContain('ul. Migracji-synt'); // the rows are as they were, the two new columns are empty
    expect(await snapshotOf()).not.toContain('"anonymized_at":"');
  });

  it('EVM-139 AC2 the code of N-1 keeps writing: it names none of the new columns and every row it writes satisfies the new CHECKs', async () => {
    const other = await insertSite(db, { street: 'ul. Stara-wersja-synt' });
    await sql`update sites.sites set notes = 'zmiana' where id = ${other}`.execute(db);
    await sql`update work_orders.work_orders set description = 'nowy opis' where id = ${surveyId}`.execute(db);
    expect((await sql`select 1 from sites.sites where id = ${other} and anonymized_at is null`.execute(db)).rows).toHaveLength(1);
  });

  it('EVM-139 AC2 a location with the mark holds the neutral values only: the values of the code pass, any other fails (23514); both marks or none', async () => {
    const own = await insertSite(db, { street: 'ul. Do-anonimizacji-synt', notes: 'Notatka-synt' });
    await refused(anonymize(own, { street: 'ul. Prawdziwa' }), '23514');
    await refused(anonymize(own, { notes: 'Notatka-synt' }), '23514');
    await refused(sql`update sites.sites set anonymized_at = ${T} where id = ${own}`.execute(db), '23514');
    await anonymize(own);
    const row = (
      await sql<{ street: string; anonymized_by: string }>`select street, anonymized_by from sites.sites where id = ${own}`.execute(db)
    ).rows[0];
    expect(row).toMatchObject({ street: neutral.street, anonymized_by: SYSTEM_ACTOR_ID });
  });

  it('EVM-139 AC2 the anonymization cannot be changed or undone (EV001), while the soft delete and the version stay writable', async () => {
    const own = await insertSite(db);
    await anonymize(own);
    await refused(sql`update sites.sites set anonymized_at = null, anonymized_by = null where id = ${own}`.execute(db), 'EV001');
    await refused(sql`update sites.sites set anonymized_at = ${'2028-01-01T00:00:00Z'} where id = ${own}`.execute(db), 'EV001');
    await sql`update sites.sites set deleted_at = ${T}, version = version + 1 where id = ${own}`.execute(db);
  });

  it('EVM-139 AC2 AC3 a purged survey is a tombstone: neutral title, no description, phone or reason, soft deleted, no customer; anything else fails (23514)', async () => {
    await refused(purge(surveyId, { title: 'Wizja-synt' }), '23514');
    await refused(purge(surveyId, { description: 'Opis-synt' }), '23514');
    await refused(purge(surveyId, { phone: '+48600680001' }), '23514');
    await refused(purge(surveyId, { reason: 'Powod-synt' }), '23514');
    await refused(
      sql`update work_orders.work_orders set site_survey_purged_at = ${T}, title = ${SITE_SURVEY_TOMBSTONE_TITLE}, description = null, requester_phone = null,
        status_reason = null where id = ${surveyId}`.execute(db),
      '23514',
    ); // not soft deleted
    await purge(surveyId);
  });

  it('EVM-139 AC3 a customer can never be assigned to a purged survey (the CHECK), and the mark is written once (EV003)', async () => {
    const customer = (await sql<{ id: string }>`select id from customers.customers limit 1`.execute(db)).rows[0]?.id;
    if (customer !== undefined) {
      await refused(sql`update work_orders.work_orders set customer_id = ${customer} where id = ${surveyId}`.execute(db), '23514');
    }
    await refused(
      sql`update work_orders.work_orders set site_survey_purged_at = ${'2028-01-01T00:00:00Z'} where id = ${surveyId}`.execute(db),
      'EV003',
    );
    await refused(sql`update work_orders.work_orders set site_survey_purged_at = null where id = ${surveyId}`.execute(db), 'EV003');
  });

  it('EVM-139 AC2 the alert code of the purge is accepted and an unknown one is still refused (the list only grew)', async () => {
    const insertAlert = (code: string) =>
      sql`insert into platform.security_alert_outbox (alert_code, occurred_at, trace_id) values (${code}, ${T}, '0123456789abcdef0123456789abcdef')`.execute(
        db,
      );
    await insertAlert('site_survey_purge_failed');
    await insertAlert('media_export_started');
    await refused(insertAlert('made_up'), '23514');
  });

  it('EVM-139 AC2 the logical undo drops the CHECKs, the trigger, the function and the columns (the wider CHECK of the alerts stays: the outbox is a record)', async () => {
    await sql`alter table work_orders.work_orders disable trigger keep_site_survey_purged_at`.execute(db);
    await sql`update work_orders.work_orders set site_survey_purged_at = null where id = ${surveyId}`.execute(db);
    await sql`alter table work_orders.work_orders enable trigger keep_site_survey_purged_at`.execute(db);
    await sql`alter table work_orders.work_orders drop constraint work_orders_site_survey_purged_neutral`.execute(db);
    await sql`drop trigger sites_keep_anonymization on sites.sites`.execute(db);
    await sql`drop function sites.keep_anonymization()`.execute(db);
    await sql`alter table sites.sites drop constraint sites_anonymized_neutral`.execute(db);
    await sql`alter table sites.sites drop column anonymized_at, drop column anonymized_by`.execute(db);
    expect(await columnsOf('sites', 'sites')).not.toContain('anonymized_at');
    // N-1 runs on the schema as it was
    await sql`update sites.sites set notes = 'po wycofaniu' where id = ${siteId}`.execute(db);
  });
});
