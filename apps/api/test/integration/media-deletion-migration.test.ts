import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../support/clock.ts';
import { insertDocumentRow } from '../support/document-fixtures.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertMedia } from '../support/media-fixtures.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let userId = '';
let workOrderId = '';
beforeAll(async () => {
  database = await migratedDatabase({ checkProjection: false });
  userId = (await createUser(database.admin, new FixedClock('2026-11-01T08:00:00.000Z'), { role: 'administrator' })).id;
  const customerId = await insertCustomer(database.admin, { email: 'usuniecie-migracja@example.invalid' });
  const siteId = await insertSite(database.admin);
  const ids = await insertWorkOrders(database.admin, [{ number: 'ZL-7900-0001', customerId, siteId }]);
  workOrderId = [...ids.values()][0] ?? '';
});
afterAll(async () => {
  await database.close();
});

const T = '2026-11-01T09:00:00Z';

describe('migration 0062 - deleting media and erasing files (EVM-051; expand only)', () => {
  it('EVM-051 AC1 the new columns are nullable: a row written the old way is valid and not deleted', async () => {
    const media = await insertMedia(database.admin, { workOrderId, createdBy: userId });
    const row = await sql<{ deleted_at: Date | null; file_purged_at: Date | null }>`
      select deleted_at, file_purged_at from media.media_assets where id = ${media.mediaAssetId}`.execute(database.admin);
    expect(row.rows[0]).toEqual({ deleted_at: null, file_purged_at: null });
  });

  it('EVM-051 AC1 deleted_at and deleted_by are set together', async () => {
    const media = await insertMedia(database.admin, { workOrderId, createdBy: userId });
    await expect(
      sql`update media.media_assets set deleted_at = ${T} where id = ${media.mediaAssetId}`.execute(database.admin),
    ).rejects.toMatchObject({ code: '23514' });
    await sql`update media.media_assets set deleted_at = ${T}, deleted_by = ${userId} where id = ${media.mediaAssetId}`.execute(
      database.admin,
    );
  });

  it('EVM-051 AC2 the erasure is write-once on the medium, the document and the file, and the erased file keeps no name and no description', async () => {
    const media = await insertMedia(database.admin, { workOrderId, createdBy: userId });
    await expect(
      sql`update media.stored_files set erased_at = ${T} where id = ${media.storedFileId}`.execute(database.admin),
    ).rejects.toMatchObject({ code: '23514' });
    await sql`update media.stored_files set erased_at = ${T}, original_filename = null where id = ${media.storedFileId}`.execute(
      database.admin,
    );
    await expect(
      sql`update media.stored_files set erased_at = null where id = ${media.storedFileId}`.execute(database.admin),
    ).rejects.toMatchObject({ code: 'EV002' });

    await sql`update media.media_assets set description = 'x' where id = ${media.mediaAssetId}`.execute(database.admin);
    await expect(
      sql`update media.media_assets set file_purged_at = ${T} where id = ${media.mediaAssetId}`.execute(database.admin),
    ).rejects.toMatchObject({ code: '23514' });
    await sql`update media.media_assets set file_purged_at = ${T}, description = null where id = ${media.mediaAssetId}`.execute(
      database.admin,
    );
    await expect(
      sql`update media.media_assets set file_purged_at = null where id = ${media.mediaAssetId}`.execute(database.admin),
    ).rejects.toMatchObject({ code: 'EV002' });

    const document = await insertDocumentRow(database.admin, { workOrderId, createdBy: userId });
    await sql`update media.documents set file_purged_at = ${T} where id = ${document.documentId}`.execute(database.admin);
    await expect(
      sql`update media.documents set file_purged_at = ${'2026-11-02T09:00:00Z'} where id = ${document.documentId}`.execute(database.admin),
    ).rejects.toMatchObject({ code: 'EV002' });
  });
});
