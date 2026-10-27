import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let userId = '';
let orderId = '';
beforeAll(async () => {
  database = await migratedDatabase({ checkProjection: false });
  userId = (await createUser(database.admin, new FixedClock('2026-10-27T08:00:00.000Z'), { role: 'editor' })).id;
  const customerId = await insertCustomer(database.admin, { email: 'media@example.invalid' });
  const siteId = await insertSite(database.admin);
  orderId = [...(await insertWorkOrders(database.admin, [{ number: 'ZL-4400-0001', customerId, siteId }])).values()][0] ?? '';
});
afterAll(async () => {
  await database.close();
});

const admin = () => database.admin;
const T = '2026-10-27T08:00:00Z';
const fails = async (statement: Promise<unknown>, code: string): Promise<void> => {
  await expect(statement).rejects.toMatchObject({ code });
};

const insertAsset = (id: string = uuidv7(), spec: { category?: string; mediaType?: string; origin?: string } = {}) =>
  sql`insert into media.media_assets (id, work_order_id, media_type, category, origin, created_at, created_by, updated_at)
      values (${id}, ${orderId}, ${spec.mediaType ?? 'photo'}, ${spec.category ?? 'in_progress'}, ${spec.origin ?? 'web'}, ${T}, ${userId}, ${T})`.execute(
    admin(),
  );

interface FileSpec {
  readonly id?: string;
  readonly assetId?: string | null;
  readonly purpose?: string;
  readonly key?: string;
  readonly state?: string;
  readonly reason?: string | null;
  readonly size?: number;
  readonly sha?: string;
}
const insertFile = (spec: FileSpec = {}) => {
  const id = spec.id ?? uuidv7();
  return sql`insert into media.stored_files (id, purpose, media_asset_id, object_key, state, state_reason_code, state_changed_at,
        declared_size_bytes, declared_content_type, declared_sha256, created_at, created_by)
      values (${id}, ${spec.purpose ?? 'media_original'}, ${spec.assetId ?? null}, ${spec.key ?? `media/2026/10/${id}/original`},
        ${spec.state ?? 'pending_upload'}, ${spec.reason ?? null}, ${T}, ${spec.size ?? 1024}, 'image/jpeg', ${spec.sha ?? 'a'.repeat(64)}, ${T}, ${userId})`.execute(
    admin(),
  );
};

const insertSession = (fileId: string, state = 'active', id: string = uuidv7()) =>
  sql`insert into media.upload_sessions (id, stored_file_id, user_id, s3_upload_id, part_size_bytes, part_count, state, expires_at, created_at, updated_at)
      values (${id}, ${fileId}, ${userId}, 'upload-1', 16777216, 1, ${state}, '2026-11-03T08:00:00Z', ${T}, ${T})`.execute(admin());

async function newFile(spec: FileSpec = {}): Promise<{ assetId: string; fileId: string }> {
  const assetId = uuidv7();
  await insertAsset(assetId);
  const fileId = uuidv7();
  await insertFile({ ...spec, id: fileId, assetId });
  return { assetId, fileId };
}

describe('migration 0045 — media (EVM-044 AC1, AC6; ADR-0009; expand only)', () => {
  it('EVM-044 AC1 a media asset needs a UUIDv7, a known type, category and origin; the full list of categories is accepted', async () => {
    await insertAsset();
    await fails(insertAsset('00000000-0000-4000-8000-000000000001'), '23514');
    await fails(insertAsset(uuidv7(), { mediaType: 'audio' }), '23514');
    await fails(insertAsset(uuidv7(), { origin: 'api' }), '23514');
    for (const category of ['site_survey', 'before_work', 'in_progress', 'completed_work', 'defect', 'measurement', 'other']) {
      await insertAsset(uuidv7(), { category });
    }
    await fails(insertAsset(uuidv7(), { category: 'selfie' }), '23514');
  });

  it('EVM-044 AC6 a file has a purpose that matches its owner, a server key without a name, and a reason exactly in failed or quarantined', async () => {
    const assetId = uuidv7();
    await insertAsset(assetId);
    await fails(insertFile({ assetId: null }), '23514');
    await fails(insertFile({ purpose: 'document', assetId }), '23514');
    await fails(insertFile({ assetId, key: 'media/2026/10/holiday-photo.jpg' }), '23514');
    await fails(insertFile({ assetId, state: 'failed' }), '23514');
    await fails(insertFile({ assetId, state: 'clean', reason: 'checksum_mismatch' }), '23514');
    await fails(insertFile({ assetId, state: 'quarantined', reason: 'unknown_reason' }), '23514');
    await fails(insertFile({ assetId, state: 'archived' }), '23514');
    await fails(insertFile({ assetId, size: 52_428_801 }), '23514');
    await fails(insertFile({ assetId, sha: 'NOT-HEX' }), '23514');
    await insertFile({ assetId, state: 'quarantined', reason: 'malware_detected' });
    await fails(insertFile({ assetId }), '23505');
  });

  it('EVM-044 AC3 every state of ADR-0009 and every reason is accepted', async () => {
    for (const state of ['pending_upload', 'uploaded', 'scanning', 'clean', 'processing', 'ready']) await newFile({ state });
    for (const state of ['failed', 'quarantined']) {
      for (const reason of ['checksum_mismatch', 'processing_error', 'type_mismatch', 'malware_detected']) await newFile({ state, reason });
    }
  });

  it('EVM-044 AC6 at most one active session per file; ended sessions do not block a new one', async () => {
    const { fileId } = await newFile();
    await insertSession(fileId);
    await fails(insertSession(fileId), '23505');
    await insertSession(fileId, 'aborted');
    await insertSession(fileId, 'expired');
    await sql`update media.upload_sessions set state = 'completed' where stored_file_id = ${fileId} and state = 'active'`.execute(admin());
    await insertSession(fileId);
    await fails(insertSession(fileId, 'paused'), '23514');
    await fails(insertSession(fileId, 'aborted', '00000000-0000-4000-8000-000000000002'), '23514');
  });

  it('EVM-044 AC6 the key, the declared checksum, the creator and the anchor never change', async () => {
    const { assetId, fileId } = await newFile();
    await fails(
      sql`update media.stored_files set object_key = 'media/2026/10/other/original' where id = ${fileId}`.execute(admin()),
      'EV002',
    );
    await fails(sql`update media.stored_files set declared_sha256 = ${'b'.repeat(64)} where id = ${fileId}`.execute(admin()), 'EV002');
    await fails(sql`update media.stored_files set created_by = ${uuidv7()} where id = ${fileId}`.execute(admin()), 'EV002');
    await fails(sql`update media.media_assets set work_order_id = ${uuidv7()} where id = ${assetId}`.execute(admin()), 'EV002');
    await sql`update media.stored_files set state = 'uploaded', state_changed_at = ${T} where id = ${fileId}`.execute(admin());
    await sql`update media.media_assets set description = 'opis', updated_at = ${T} where id = ${assetId}`.execute(admin());
  });

  it('EVM-044 AC6 the application role reads, inserts and updates but never deletes', async () => {
    const app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 1 } });
    try {
      const { fileId } = await newFile();
      await sql`select count(*) from media.stored_files`.execute(app);
      await sql`update media.stored_files set state = 'uploaded', state_changed_at = ${T} where id = ${fileId}`.execute(app);
      await fails(sql`delete from media.stored_files where id = ${fileId}`.execute(app), '42501');
      await fails(sql`delete from media.upload_sessions`.execute(app), '42501');
      await fails(sql`delete from media.media_assets`.execute(app), '42501');
    } finally {
      await app.destroy();
    }
  });

  it('EVM-044 AC3 the sweeper index covers only the files waiting for a scan', async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes where schemaname = 'media' and indexname = 'stored_files_unscanned_idx'`.execute(admin());
    expect(rows[0]?.indexdef).toMatch(/where \(state = ANY \(ARRAY\['uploaded'::text, 'scanning'::text\]\)\)/i);
  });
});
