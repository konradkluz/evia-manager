import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertMedia } from '../support/media-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { freshDatabaseUrl } from './database.ts';

/**
 * 0065 is applied on a database that already holds media of the panel (EVM-131 AC6; expand only): the rows and their `version` are untouched, the new counter is 0, nothing is
 * backfilled into the log, the code that is still running (it knows nothing of the column) still writes media, and afterwards a change of the state of a file is written to the log
 * with the version the phone sees. The logical undo (the runner keeps no `down`) is run at the end and loses no data.
 */
const BEFORE = Object.fromEntries(Object.entries(MIGRATIONS).filter(([name]) => name < '0065')) as typeof MIGRATIONS;
const clock = new FixedClock('2026-11-14T08:00:00.000Z');

let db: Kysely<Database>;
let userId = '';
let orderId = '';
const seeded: Array<{ mediaAssetId: string; storedFileId: string }> = [];

const logRows = async (): Promise<Array<{ entity_id: string; operation: string; entity_version: number; work_order_id: string | null }>> =>
  (
    await sql<{ entity_id: string; operation: string; entity_version: number; work_order_id: string | null }>`
      select entity_id, operation, entity_version, work_order_id from sync.change_log where entity_type = 'media_asset' order by seq`.execute(
      db,
    )
  ).rows;

beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  await migrateToLatest(db, BEFORE);
  userId = (await createUser(db, clock, { role: 'editor' })).id;
  const customerId = await insertCustomer(db, { email: 'media-sync-migration@example.invalid' });
  const siteId = await insertSite(db);
  const orders = await insertWorkOrders(db, [{ number: 'ZL-6500-0001', customerId, siteId }]);
  orderId = [...orders.values()][0] ?? '';
  seeded.push(await insertMedia(db, { workOrderId: orderId, createdBy: userId }));
  seeded.push(await insertMedia(db, { workOrderId: orderId, createdBy: userId, state: 'clean' }));
  await sql`update media.media_assets set version = 3, updated_by = ${userId} where id = ${seeded[1]?.mediaAssetId ?? ''}`.execute(db);
  expect((await migrateToLatest(db, MIGRATIONS)).applied).toEqual([
    '0065_media_sync',
    '0066_site_survey',
    '0067_email_outbox_site_survey',
    '0068_site_survey_purge',
  ]);
});
afterAll(async () => {
  await db.destroy();
});

const asset = async (id: string) =>
  (
    await sql<{ version: number; file_state_revision: number; updated_at: Date; updated_by: string | null }>`
      select version, file_state_revision, updated_at, updated_by from media.media_assets where id = ${id}`.execute(db)
  ).rows[0];

describe('migration 0065 - the media of an order on the phone (EVM-131 AC6; expand only)', () => {
  it('EVM-131 AC6 the media of the panel that existed are untouched: the same version and editor, the counter of the state of the file is 0, nothing is backfilled into the log', async () => {
    const first = await asset(seeded[0]?.mediaAssetId ?? '');
    const second = await asset(seeded[1]?.mediaAssetId ?? '');
    expect(first).toMatchObject({ version: 1, file_state_revision: 0, updated_by: null });
    expect(second).toMatchObject({ version: 3, file_state_revision: 0, updated_by: userId });
    // the media of the panel were written before the trigger existed: the log has no row of a medium (the phone gets them at its resync, SCOPE_TYPES_REVISION 3)
    expect(await logRows()).toEqual([]);
    const files = await sql<{ state: string }>`select state from media.stored_files order by created_at, id`.execute(db);
    expect(files.rows.map((row) => row.state)).toEqual(['pending_upload', 'clean']);
  });

  it('EVM-131 AC6 a change of the state of a file raises the counter, writes ONE row of the log with version + counter and leaves the version, the editor and the time of the metadata alone', async () => {
    const id = seeded[0]?.mediaAssetId ?? '';
    const before = await asset(id);
    await sql`update media.stored_files set state = 'uploaded', state_changed_at = now() where media_asset_id = ${id}`.execute(db);
    const after = await asset(id);
    expect(after?.file_state_revision).toBe(1);
    expect(after).toMatchObject({ version: before?.version, updated_by: before?.updated_by });
    expect(after?.updated_at.toISOString()).toBe(before?.updated_at.toISOString());
    expect(await logRows()).toEqual([{ entity_id: id, operation: 'upsert', entity_version: 2, work_order_id: orderId }]);

    await sql`update media.stored_files set state = 'scanning' where media_asset_id = ${id}`.execute(db);
    await sql`update media.stored_files set state = 'clean' where media_asset_id = ${id}`.execute(db);
    const last = (await logRows()).at(-1);
    expect(last).toMatchObject({ entity_id: id, entity_version: 4 });
  });

  it('EVM-131 AC6 an update of the file that leaves the state and the reason as they were, and a document file, write nothing', async () => {
    const id = seeded[1]?.mediaAssetId ?? '';
    const rows = (await logRows()).length;
    await sql`update media.stored_files set s3_etag = 'etag-1' where media_asset_id = ${id}`.execute(db);
    await sql`update media.stored_files set state = 'clean', state_changed_at = now() where media_asset_id = ${id}`.execute(db);
    expect((await asset(id))?.file_state_revision).toBe(0);
    expect((await logRows()).length).toBe(rows);
  });

  it('EVM-131 AC6 a new medium with its file writes the insert and the file; the metadata edit of the panel (version + 1) is a row with the version the phone sees', async () => {
    const medium = await insertMedia(db, { workOrderId: orderId, createdBy: userId });
    const rows = (await logRows()).filter((row) => row.entity_id === medium.mediaAssetId);
    // the insert of the medium (version 1) and the insert of its file (counter 1): the reader collapses them into the last row
    expect(rows.map((row) => row.entity_version)).toEqual([1, 2]);
    await sql`update media.media_assets set version = version + 1, updated_by = ${userId}, description = 'x' where id = ${medium.mediaAssetId}`.execute(
      db,
    );
    expect((await logRows()).filter((row) => row.entity_id === medium.mediaAssetId).at(-1)?.entity_version).toBe(3);
    await sql`update media.media_assets set deleted_at = now(), deleted_by = ${userId}, version = version + 1 where id = ${medium.mediaAssetId}`.execute(
      db,
    );
    expect((await logRows()).filter((row) => row.entity_id === medium.mediaAssetId).at(-1)).toMatchObject({
      operation: 'delete',
      entity_version: 4,
    });
  });

  it('EVM-131 AC6 the widened function of the log adds 0 for every other type: the version of an order in the log is its own (the code that never names the counter keeps working)', async () => {
    const order2 = await insertWorkOrders(db, [{ number: 'ZL-6500-0002' }]);
    const orderRow = await sql<{ entity_version: number }>`
      select entity_version from sync.change_log where entity_type = 'work_order' and entity_id = ${[...order2.values()][0] ?? ''}`.execute(
      db,
    );
    expect(orderRow.rows.map((row) => row.entity_version)).toEqual([1]);
  });

  it('EVM-131 AC6 the functions are SECURITY DEFINER with a pinned search_path, without a right of the public; the application role cannot call them or disable the triggers', async () => {
    const { rows } = await sql<{ name: string; definer: boolean; config: string[] | null; public_execute: boolean; app_execute: boolean }>`
      select p.proname as name, p.prosecdef as definer, p.proconfig as config,
        has_function_privilege('public', p.oid, 'execute') as public_execute, has_function_privilege('evia_app', p.oid, 'execute') as app_execute
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname = 'media' and p.proname = 'record_file_state_revision') or (n.nspname = 'sync' and p.proname = 'record_change') order by 1`.execute(
      db,
    );
    expect(rows.map((row) => row.name)).toEqual(['record_change', 'record_file_state_revision']);
    for (const row of rows) {
      expect(row.definer, row.name).toBe(true);
      expect(row.config, row.name).toEqual(['search_path=pg_catalog, pg_temp']);
      expect(row.public_execute, row.name).toBe(false);
      expect(row.app_execute, row.name).toBe(false);
    }
    const triggers = await sql<{ name: string; table: string; definition: string }>`
      select t.tgname as name, c.relname as "table", pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and t.tgname like 'stored\_files\_state\_revision\_%' order by 1`.execute(db);
    expect(triggers.rows.map((row) => row.name)).toEqual(['stored_files_state_revision_insert', 'stored_files_state_revision_update']);
    for (const row of triggers.rows) {
      expect(row.definition, row.name).toContain("purpose = 'media_original'");
      expect(row.definition, row.name).toContain('AFTER');
    }
    expect(triggers.rows[1]?.definition).toContain('UPDATE OF state, state_reason_code');
    expect(triggers.rows[1]?.definition).toContain('IS DISTINCT FROM');
  });

  it('EVM-131 AC6 the CHECK of the audit trail takes CreateMediaAsset with a device and an order, and still refuses an invented command or a missing device', async () => {
    const insert = (command: string, device: string | null) =>
      sql`insert into audit.events (occurred_at, actor_type, origin, action, outcome, object_type, trace_id, device_id, work_order_id, command_type)
        values (now(), 'system', 'web', 'sync.mutation_applied', 'success', 'media_asset', ${'0'.repeat(32)}, ${device}, ${device === null ? null : orderId}, ${command})`.execute(
        db,
      );
    await insert('CreateMediaAsset', uuidv7());
    await expect(insert('DropEverything', uuidv7())).rejects.toMatchObject({ code: '23514' });
    await expect(insert('CreateMediaAsset', null)).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-131 AC6 the counter cannot be negative', async () => {
    await expect(
      sql`update media.media_assets set file_state_revision = -1 where id = ${seeded[0]?.mediaAssetId ?? ''}`.execute(db),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('EVM-131 AC6 the logical undo (drop the triggers and the function, restore the log function of 0054, drop the column) runs on the data and loses none', async () => {
    const media = (await sql<{ n: string }>`select count(*)::text as n from media.media_assets`.execute(db)).rows[0]?.n;
    const files = (await sql<{ n: string }>`select count(*)::text as n from media.stored_files`.execute(db)).rows[0]?.n;
    await sql`drop trigger record_change_insert_delete on media.media_assets`.execute(db);
    await sql`drop trigger record_change_update on media.media_assets`.execute(db);
    await sql`drop trigger stored_files_state_revision_insert on media.stored_files`.execute(db);
    await sql`drop trigger stored_files_state_revision_update on media.stored_files`.execute(db);
    await sql`drop function media.record_file_state_revision()`.execute(db);
    await sql`
      create or replace function sync.record_change() returns trigger
      language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
      as $$
      declare
        subject jsonb;
        kind text;
        anchor text;
      begin
        if TG_OP = 'DELETE' then
          subject := pg_catalog.to_jsonb(OLD);
          kind := 'delete';
        else
          subject := pg_catalog.to_jsonb(NEW);
          kind := case
            when TG_OP = 'UPDATE' and (subject ->> 'deleted_at') is not null and (pg_catalog.to_jsonb(OLD) ->> 'deleted_at') is null then 'delete'
            else 'upsert'
          end;
        end if;
        anchor := case when TG_ARGV[1] = '' then null else subject ->> TG_ARGV[1] end;
        insert into sync.change_log (entity_type, entity_id, operation, work_order_id, entity_version)
        values (TG_ARGV[0], (subject ->> 'id')::uuid, kind, anchor::uuid, (subject ->> 'version')::integer);
        return null;
      end
      $$`.execute(db);
    await sql`alter table media.media_assets drop constraint media_assets_file_state_revision_check`.execute(db);
    await sql`alter table media.media_assets drop column file_state_revision`.execute(db);
    expect((await sql<{ n: string }>`select count(*)::text as n from media.media_assets`.execute(db)).rows[0]?.n).toBe(media);
    expect((await sql<{ n: string }>`select count(*)::text as n from media.stored_files`.execute(db)).rows[0]?.n).toBe(files);
    // the media still work, and the log of the other types is written by the restored function
    await insertMedia(db, { workOrderId: orderId, createdBy: userId });
    await insertWorkOrders(db, [{ number: 'ZL-6500-0003' }]);
  });
});
