import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertMedia } from '../support/media-fixtures.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let userId = '';
let orderId = '';
let otherOrderId = '';
let ownStage = '';
let foreignStage = '';
beforeAll(async () => {
  database = await migratedDatabase({ checkProjection: false });
  userId = (await createUser(database.admin, new FixedClock('2026-11-01T08:00:00.000Z'), { role: 'editor' })).id;
  const customerId = await insertCustomer(database.admin, { email: 'metadane-migracja@example.invalid' });
  const siteId = await insertSite(database.admin);
  const orders = await insertWorkOrders(database.admin, [
    { number: 'ZL-4800-0001', customerId, siteId },
    { number: 'ZL-4800-0002', customerId, siteId },
  ]);
  [orderId = '', otherOrderId = ''] = [...orders.values()];
  ownStage = (await insertProcedure(database.admin, orderId)).stageIds[0] as string;
  foreignStage = (await insertProcedure(database.admin, otherOrderId)).stageIds[0] as string;
});
afterAll(async () => {
  await database.close();
});

const admin = () => database.admin;
const T = '2026-11-01T08:00:00Z';
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};
const insertDocument = (stage: string | null, order: string | null = orderId, customer: string | null = null) =>
  sql`insert into media.documents (id, kind_code, title, work_order_id, customer_id, procedure_stage_id, created_at, created_by, updated_at, updated_by)
      values (${uuidv7()}, 'connection_conditions', 'Title', ${order}, ${customer}, ${stage}, ${T}, ${userId}, ${T}, ${userId})`.execute(
    admin(),
  );

describe('migration 0060 - metadata of media and documents (EVM-048; expand only)', () => {
  it('EVM-048 AC2 a medium starts at version 1 with no editor; the version is at least 1 and the editor is a user', async () => {
    const medium = await insertMedia(admin(), { workOrderId: orderId, createdBy: userId });
    const row = (
      await sql<{
        version: number;
        updated_by: string | null;
      }>`select version, updated_by from media.media_assets where id = ${medium.mediaAssetId}`.execute(admin())
    ).rows[0];
    expect(row).toEqual({ version: 1, updated_by: null });
    await fails(sql`update media.media_assets set version = 0 where id = ${medium.mediaAssetId}`.execute(admin()), '23514');
    await fails(sql`update media.media_assets set updated_by = ${uuidv7()} where id = ${medium.mediaAssetId}`.execute(admin()), '23503');
    await sql`update media.media_assets set version = 2, updated_by = ${userId} where id = ${medium.mediaAssetId}`.execute(admin());
  });

  it('EVM-048 AC4 the composite key admits a stage of the same order and no stage, and refuses a stage of another order for a medium and for a document', async () => {
    const medium = await insertMedia(admin(), { workOrderId: orderId, createdBy: userId });
    await sql`update media.media_assets set procedure_stage_id = ${ownStage} where id = ${medium.mediaAssetId}`.execute(admin());
    await sql`update media.media_assets set procedure_stage_id = null where id = ${medium.mediaAssetId}`.execute(admin());
    await fails(
      sql`update media.media_assets set procedure_stage_id = ${foreignStage} where id = ${medium.mediaAssetId}`.execute(admin()),
      '23503',
    );
    await insertDocument(ownStage);
    await insertDocument(null);
    await fails(insertDocument(foreignStage), '23503');
  });

  it('EVM-048 AC3 a document without an order cannot have a stage (the check of 0059 stays)', async () => {
    const customerId = await insertCustomer(admin(), { email: 'metadane-klient@example.invalid' });
    await insertDocument(null, null, customerId);
    await fails(insertDocument(ownStage, null, customerId), '23514');
  });
});
