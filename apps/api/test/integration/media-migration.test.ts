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
  readonly quarantinedAt?: string | null;
}
const insertFile = (spec: FileSpec = {}) => {
  const id = spec.id ?? uuidv7();
  const defaultQuarantinedAt = spec.state === 'quarantined' ? T : null;
  const quarantinedAt = spec.quarantinedAt === undefined ? defaultQuarantinedAt : spec.quarantinedAt;
  return sql`insert into media.stored_files (id, purpose, media_asset_id, object_key, state, state_reason_code, state_changed_at,
        declared_size_bytes, declared_content_type, declared_sha256, created_at, created_by, quarantined_at)
      values (${id}, ${spec.purpose ?? 'media_original'}, ${spec.assetId ?? null}, ${spec.key ?? `media/2026/10/${id}/original`},
        ${spec.state ?? 'pending_upload'}, ${spec.reason ?? null}, ${T}, ${spec.size ?? 1024}, 'image/jpeg', ${spec.sha ?? 'a'.repeat(64)}, ${T}, ${userId},
        ${quarantinedAt})`.execute(admin());
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
    await fails(
      sql`update media.stored_files set declared_size_bytes = declared_size_bytes + 1 where id = ${fileId}`.execute(admin()),
      'EV002',
    );
    await fails(sql`update media.stored_files set declared_content_type = 'image/png' where id = ${fileId}`.execute(admin()), 'EV002');
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

describe('migration 0046 — the quarantine of a file (EVM-049 AC5; expand only; SR-DATA-07)', () => {
  it('EVM-049 AC5 a quarantined file has the time of its first entry, a purge needs the quarantine, and the reason `abandoned` belongs to a failed file', async () => {
    const { assetId } = await newFile();
    const other = uuidv7();
    await insertAsset(other);
    await fails(insertFile({ assetId: other, state: 'quarantined', reason: 'malware_detected', quarantinedAt: null }), '23514');
    await newFile({ state: 'failed', reason: 'abandoned' });
    await fails(sql`update media.stored_files set purged_at = ${T} where media_asset_id = ${assetId}`.execute(admin()), '23514');
  });

  it('EVM-049 AC5 quarantined_at and purged_at are write-once: set once, never moved or cleared (the clock of the retention cannot be reset)', async () => {
    const { fileId } = await newFile({ state: 'quarantined', reason: 'malware_detected' });
    await fails(sql`update media.stored_files set quarantined_at = '2026-10-28T08:00:00Z' where id = ${fileId}`.execute(admin()), 'EV002');
    await fails(
      sql`update media.stored_files set quarantined_at = null, state = 'scanning', state_reason_code = null where id = ${fileId}`.execute(
        admin(),
      ),
      'EV002',
    );
    await sql`update media.stored_files set purged_at = ${T} where id = ${fileId}`.execute(admin());
    await fails(sql`update media.stored_files set purged_at = '2026-10-28T08:00:00Z' where id = ${fileId}`.execute(admin()), 'EV002');
    await fails(sql`update media.stored_files set purged_at = null where id = ${fileId}`.execute(admin()), 'EV002');
    // a file never quarantined can get the time once (null to a value)
    const fresh = await newFile({ state: 'scanning' });
    await sql`update media.stored_files set state = 'quarantined', state_reason_code = 'type_mismatch', quarantined_at = ${T} where id = ${fresh.fileId}`.execute(
      admin(),
    );
  });

  it('EVM-049 AC5 the rows quarantined before the migration are backfilled with the time they entered the state; the partial indexes cover only what the sweepers read', async () => {
    const { rows } = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef from pg_indexes where schemaname = 'media' and tablename = 'stored_files' and indexname in ('stored_files_quarantine_idx', 'stored_files_pending_idx')
      order by indexname`.execute(admin());
    expect(rows.map((row) => row.indexname)).toEqual(['stored_files_pending_idx', 'stored_files_quarantine_idx']);
    expect(rows[1]?.indexdef).toContain('WHERE ((quarantined_at IS NOT NULL) AND (purged_at IS NULL))');
    expect(rows[0]?.indexdef).toContain("WHERE (state = 'pending_upload'::text)");
  });

  it('EVM-049 AC5 the deadline function counts calendar days in the business zone and the application role may call it', async () => {
    const app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 1 } });
    try {
      const { rows } = await sql<{ at: Date }>`select media.quarantine_expires_at('2026-09-01T10:00:00Z'::timestamptz, 30) as at`.execute(
        app,
      );
      expect(rows[0]?.at.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    } finally {
      await app.destroy();
    }
  });
});

describe('migration 0053 — the derivatives of a file (EVM-068; expand only)', () => {
  const insertDerivative = (
    fileId: string,
    spec: { variant?: string; key?: string; type?: string; width?: number; size?: number } = {},
  ) => {
    const variant = spec.variant ?? 'thumbnail';
    return sql`insert into media.file_derivatives (stored_file_id, variant, object_key, content_type, width, height, size_bytes, created_at)
      values (${fileId}, ${variant}, ${spec.key ?? `media/2026/10/${fileId}/${variant}.webp`}, ${spec.type ?? 'image/webp'},
        ${spec.width ?? 320}, 200, ${spec.size ?? 12_000}, ${T})`.execute(admin());
  };

  /** The trigger on the prefix runs before the CHECKs, so a bad key is refused by either (23514 or EV002) - never accepted. */
  const refusedKey = async (statement: Promise<unknown>): Promise<void> => {
    await expect(statement).rejects.toSatisfy((error: { code?: string }) => error.code === '23514' || error.code === 'EV002');
  };

  it('EVM-068 AC1 a file gets one thumbnail and one preview; a second row of the same variant is refused', async () => {
    const { fileId } = await newFile({ state: 'processing' });
    await insertDerivative(fileId);
    await insertDerivative(fileId, { variant: 'preview', width: 1600 });
    await fails(insertDerivative(fileId), '23505');
    await fails(insertDerivative(fileId, { variant: 'original' }), '23514');
  });

  it('EVM-068 AC6 the type is fixed, the sizes are bounded, the key has the shape and the identifier of the file and the name of the variant', async () => {
    const { fileId } = await newFile({ state: 'processing' });
    await fails(insertDerivative(fileId, { type: 'image/jpeg' }), '23514');
    await fails(insertDerivative(fileId, { width: 1601 }), '23514');
    await fails(insertDerivative(fileId, { width: 0 }), '23514');
    await fails(insertDerivative(fileId, { size: 5_242_881 }), '23514');
    await refusedKey(insertDerivative(fileId, { key: `media/2026/10/${fileId}/thumb.webp` }));
    await refusedKey(insertDerivative(fileId, { key: `media/2026/10/${fileId}/preview.webp` }));
    await refusedKey(insertDerivative(fileId, { key: `media/2026/10/${fileId}/original` }));
    await refusedKey(insertDerivative(fileId, { key: `media/2026/10/${fileId}/../thumbnail.webp` }));
  });

  it('EVM-068 AC2 a derivative under the prefix of ANOTHER file, or of another month, is refused (never overwrites a foreign object)', async () => {
    const mine = await newFile({ state: 'processing' });
    const other = await newFile({ state: 'processing' });
    await refusedKey(insertDerivative(mine.fileId, { key: `media/2026/10/${other.fileId}/thumbnail.webp` }));
    await fails(insertDerivative(mine.fileId, { key: `media/2026/09/${mine.fileId}/thumbnail.webp` }), 'EV002');
    await fails(insertDerivative(uuidv7()), 'EV002'); // no such file: the trigger refuses before the foreign key
    await insertDerivative(mine.fileId);
  });

  it('EVM-068 AC1 the application role reads and inserts a derivative but never updates or deletes it; the file cannot be deleted while it has one', async () => {
    const app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 1 } });
    try {
      const { fileId } = await newFile({ state: 'processing' });
      await insertDerivative(fileId);
      await sql`select count(*) from media.file_derivatives`.execute(app);
      await fails(sql`update media.file_derivatives set width = 100 where stored_file_id = ${fileId}`.execute(app), '42501');
      await fails(sql`delete from media.file_derivatives where stored_file_id = ${fileId}`.execute(app), '42501');
      await fails(sql`delete from media.stored_files where id = ${fileId}`.execute(admin()), '23001');
    } finally {
      await app.destroy();
    }
  });

  it('EVM-068 AC4 the counter of attempts is bounded and starts at zero; the loop index covers only the files waiting for processing', async () => {
    const { fileId } = await newFile({ state: 'clean' });
    const { rows } = await sql<{ process_attempts: number; process_claimed_at: Date | null }>`
      select process_attempts, process_claimed_at from media.stored_files where id = ${fileId}`.execute(admin());
    expect(rows[0]).toEqual({ process_attempts: 0, process_claimed_at: null });
    await fails(sql`update media.stored_files set process_attempts = 11 where id = ${fileId}`.execute(admin()), '23514');
    await fails(sql`update media.stored_files set process_attempts = -1 where id = ${fileId}`.execute(admin()), '23514');
    const index = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes where schemaname = 'media' and indexname = 'stored_files_unprocessed_idx'`.execute(admin());
    expect(index.rows[0]?.indexdef).toMatch(/where \(state = ANY \(ARRAY\['clean'::text, 'processing'::text\]\)\)/i);
  });
});
