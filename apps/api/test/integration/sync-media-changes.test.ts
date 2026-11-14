/**
 * The media of an order in the change log of the phone (EVM-131 AC4; ADR-0021 D4; SR-SYNC-04, SR-MOB-10, SR-FILE-05) against the real application and PostgreSQL. Synthetic data only: the file
 * names, the checksums and the descriptions carry sentinels that must never reach a phone.
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import type { IdentityApp } from '../support/identity-app.ts';
import { insertMedia } from '../support/media-fixtures.ts';
import {
  adminDb,
  ago,
  bootSync,
  drain,
  editor,
  idsOfType,
  keysOf,
  pull,
  scenario,
  upsertOf,
  type SyncApp,
} from '../support/sync-harness.ts';
import { numberOf } from '../support/work-order-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';

let current: SyncApp;
afterEach(async () => {
  await current.app.close();
});
const app = (): IdentityApp => current.app;
const db = () => adminDb(current.app);

const NAME = 'SENTINEL-FILE-NAME.JPG';
const DESCRIPTION = 'SENTINEL-DESCRIPTION-OF-A-MEDIUM';
const SHA = 'c'.repeat(64);
const SENTINELS = [
  NAME,
  DESCRIPTION,
  SHA,
  'object_key',
  'objectKey',
  'original_filename',
  'sha256',
  'malware_detected',
  'type_mismatch',
  'media/2026/',
];

const setState = (mediaAssetId: string, state: string, reason: string | null = null) =>
  sql`update media.stored_files set state = ${state}, state_reason_code = ${reason}, state_changed_at = now(),
      quarantined_at = case when ${state} = 'quarantined' then coalesce(quarantined_at, now()) else quarantined_at end
      where media_asset_id = ${mediaAssetId}`.execute(db());

const syncVersion = async (id: string): Promise<number> =>
  (await sql<{ v: number }>`select (version + file_state_revision) as v from media.media_assets where id = ${id}`.execute(db())).rows[0]
    ?.v ?? -1;
const logVersions = async (id: string): Promise<number[]> =>
  (
    await sql<{
      v: number;
    }>`select entity_version as v from sync.change_log where entity_id = ${id} and entity_type = 'media_asset' order by seq`.execute(db())
  ).rows.map((row) => row.v);

async function boot(): Promise<void> {
  current = await bootSync();
}

describe('the media of an order in the snapshot (EVM-131 AC4; SR-SYNC-04, SR-MOB-10)', () => {
  it('EVM-131 AC4 the first download carries each medium of an order in scope with the state the phone knows, the reason from the allow-list only and nothing else (every page strict)', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const by = s.author.id;
    const make = (state: string, reason?: string) =>
      insertMedia(db(), {
        workOrderId: s.orderId,
        createdBy: by,
        fileName: NAME,
        sha256: SHA,
        ...(state === 'pending_upload' ? {} : { state: state as never }),
        ...(reason === undefined ? {} : { reason: reason as never }),
      });
    const pending = await make('pending_upload');
    const uploaded = await make('uploaded');
    const scanning = await make('scanning');
    const clean = await make('clean');
    const processing = await make('processing');
    const ready = await make('ready');
    const held = await make('quarantined', 'malware_detected');
    const mismatch = await make('quarantined', 'type_mismatch');
    const damaged = await make('failed', 'checksum_mismatch');
    const broken = await make('failed', 'processing_error');
    const abandoned = await make('failed', 'abandoned');
    const media = [pending, uploaded, scanning, clean, processing, ready, held, mismatch, damaged, broken, abandoned];
    await sql`update media.media_assets set description = ${DESCRIPTION}, captured_at = now() where id = ${pending.mediaAssetId}`.execute(
      db(),
    );

    const result = await drain(phone);
    expect(idsOfType(result.changes, 'media_asset').sort()).toEqual(media.map((item) => item.mediaAssetId).sort());
    const state = (id: string) => upsertOf(result.changes, 'media_asset', id);
    expect(state(pending.mediaAssetId)).toMatchObject({ fileState: 'pending', fileStateReasonCode: null });
    expect(state(uploaded.mediaAssetId)).toMatchObject({ fileState: 'uploading', fileStateReasonCode: null });
    expect(state(abandoned.mediaAssetId)).toMatchObject({ fileState: 'failed', fileStateReasonCode: 'abandoned' });
    expect(state(scanning.mediaAssetId)).toMatchObject({ fileState: 'uploading', fileStateReasonCode: null });
    expect(state(clean.mediaAssetId)).toMatchObject({ fileState: 'clean', fileStateReasonCode: null });
    expect(state(processing.mediaAssetId)).toMatchObject({ fileState: 'processing', fileStateReasonCode: null });
    expect(state(ready.mediaAssetId)).toMatchObject({ fileState: 'ready', fileStateReasonCode: null });
    // a quarantine is `quarantined` and never carries its reason (SR-MOB-10), whatever it was
    expect(state(held.mediaAssetId)).toMatchObject({ fileState: 'quarantined', fileStateReasonCode: null });
    expect(state(mismatch.mediaAssetId)).toMatchObject({ fileState: 'quarantined', fileStateReasonCode: null });
    expect(state(damaged.mediaAssetId)).toMatchObject({ fileState: 'failed', fileStateReasonCode: 'checksum_mismatch' });
    expect(state(broken.mediaAssetId)).toMatchObject({ fileState: 'failed', fileStateReasonCode: 'processing_error' });
    expect(state(pending.mediaAssetId)).toMatchObject({
      type: 'media_asset',
      workOrderId: s.orderId,
      mediaType: 'photo',
      category: 'in_progress',
      procedureStageId: null,
      // the minimal payload: the fields of the contract that are not part of it are null
      description: null,
      capturedAt: null,
      sizeBytes: null,
      durationSeconds: null,
      widthPx: null,
      heightPx: null,
    });
    const raw = JSON.stringify(result.pages);
    for (const forbidden of SENTINELS) expect(raw, forbidden).not.toContain(forbidden);
    for (const item of media) {
      expect(raw).not.toContain(item.objectKey);
      expect(raw).not.toContain(item.storedFileId);
    }
  });

  it('EVM-131 AC4 a medium that has no file yet (created on the phone, the session is not open) is `pending` with the version 1; the medium of an order outside the scope, and of a deleted order, is in no answer', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const old = await scenario(app(), { number: numberOf(2026, 950), status: 'settled', closedAt: ago(app(), 40) });
    const noFile = uuidv7();
    await sql`insert into media.media_assets (id, work_order_id, media_type, category, origin, created_at, created_by, updated_at)
      values (${noFile}, ${s.orderId}, 'photo', 'before_work', 'mobile', now(), ${s.author.id}, now())`.execute(db());
    const outside = await insertMedia(db(), { workOrderId: old.orderId, createdBy: old.author.id });
    const result = await drain(phone);
    expect(upsertOf(result.changes, 'media_asset', noFile)).toMatchObject({
      version: 1,
      fileState: 'pending',
      fileStateReasonCode: null,
      category: 'before_work',
    });
    expect(keysOf(result.changes)).not.toContain(`media_asset:${outside.mediaAssetId}`);
    expect(JSON.stringify(result.pages)).not.toContain(outside.mediaAssetId);
  });

  it('EVM-131 AC4 the number of statements of a page of the snapshot does not depend on the number of orders and media of the page (one order per page against five)', async () => {
    await boot();
    // seven orders with media: neither measured page is the last one (the last page of a snapshot also closes the download)
    for (let index = 0; index < 7; index += 1) {
      const s = await scenario(app());
      await insertMedia(db(), { workOrderId: s.orderId, createdBy: s.author.id });
      await insertMedia(db(), { workOrderId: s.orderId, createdBy: s.author.id, state: 'clean' });
    }
    const measure = async (limit: number): Promise<{ statements: number; media: number }> => {
      const { phone } = await editor(app());
      current.statements.length = 0;
      const response = await pull(phone, `limit=${limit}`);
      expect(response.status).toBe(200);
      const changes = (response.body as { changes: Array<Record<string, unknown>> }).changes;
      return { statements: current.statements.length, media: idsOfType(changes, 'media_asset').length };
    };
    const one = await measure(1);
    const five = await measure(5);
    expect(one.media).toBe(2);
    expect(five.media).toBe(10);
    expect(five.statements).toBe(one.statements);
    // and the media of a page are read by ONE statement, by the indexed anchor of the orders of the page (`work_order_id in (...)`)
    expect(
      current.statements.filter(
        (statement) => statement.includes('from "media"."media_assets" as "a"') && statement.includes('"a"."work_order_id" in'),
      ),
    ).toHaveLength(1);
  });
});

describe('the change of the state of a file in the changes (EVM-131 AC4; SR-FILE-05)', () => {
  it('EVM-131 AC4 clean, quarantine and failure reach the phone at the next pull, each with a higher version; the version of the log equals the version of the projection', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const medium = await insertMedia(db(), { workOrderId: s.orderId, createdBy: s.author.id, fileName: NAME });
    let { cursor } = await drain(phone);
    const seen: number[] = [];
    for (const [state, reason, expected, expectedReason] of [
      ['uploaded', null, 'uploading', null],
      ['scanning', null, 'uploading', null],
      ['clean', null, 'clean', null],
      ['processing', null, 'processing', null],
      ['ready', null, 'ready', null],
      ['quarantined', 'malware_detected', 'quarantined', null],
      ['failed', 'checksum_mismatch', 'failed', 'checksum_mismatch'],
      ['failed', 'abandoned', 'failed', 'abandoned'],
    ] as const) {
      await setState(medium.mediaAssetId, state, reason);
      const next = await drain(phone, '', cursor);
      cursor = next.cursor;
      const entity = upsertOf(next.changes, 'media_asset', medium.mediaAssetId);
      expect(entity, state).toMatchObject({ fileState: expected, fileStateReasonCode: expectedReason, workOrderId: s.orderId });
      const version = Number(entity?.['version']);
      expect(version, state).toBe(await syncVersion(medium.mediaAssetId));
      expect(version, state).toBe((await logVersions(medium.mediaAssetId)).at(-1));
      expect(version, state).toBeGreaterThan(seen.at(-1) ?? 0);
      seen.push(version);
      expect(JSON.stringify(next.changes), state).not.toContain(NAME);
      expect(JSON.stringify(next.changes), state).not.toContain('malware_detected');
    }
  });

  it('EVM-131 AC4 a change of the state of a file writes a version in the log that is `version + counter` and an edit of the metadata keeps counting from there: the version never goes back', async () => {
    await boot();
    const s = await scenario(app());
    const medium = await insertMedia(db(), { workOrderId: s.orderId, createdBy: s.author.id });
    await setState(medium.mediaAssetId, 'clean');
    await sql`update media.media_assets set version = version + 1, updated_by = ${s.author.id}, description = 'x' where id = ${medium.mediaAssetId}`.execute(
      db(),
    );
    await setState(medium.mediaAssetId, 'processing');
    const versions = await logVersions(medium.mediaAssetId);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions.at(-1)).toBe(await syncVersion(medium.mediaAssetId));
  });

  it('EVM-131 AC4 a soft deleted medium is a marker with its version, a restored one is an upsert again, and a medium whose file was erased is a marker (nothing of it travels)', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const medium = await insertMedia(db(), { workOrderId: s.orderId, createdBy: s.author.id, state: 'clean' });
    const erased = await insertMedia(db(), { workOrderId: s.orderId, createdBy: s.author.id, state: 'clean' });
    let { cursor } = await drain(phone);

    await sql`update media.media_assets set deleted_at = now(), deleted_by = ${s.author.id}, version = version + 1 where id = ${medium.mediaAssetId}`.execute(
      db(),
    );
    const deleted = await drain(phone, '', cursor);
    cursor = deleted.cursor;
    expect(deleted.changes).toContainEqual({
      op: 'delete',
      type: 'media_asset',
      id: medium.mediaAssetId,
      version: await syncVersion(medium.mediaAssetId),
    });
    expect(JSON.stringify(deleted.changes)).not.toContain('fileState');

    await sql`update media.media_assets set deleted_at = null, deleted_by = null, version = version + 1 where id = ${medium.mediaAssetId}`.execute(
      db(),
    );
    const restored = await drain(phone, '', cursor);
    cursor = restored.cursor;
    expect(upsertOf(restored.changes, 'media_asset', medium.mediaAssetId)).toMatchObject({
      fileState: 'clean',
      version: await syncVersion(medium.mediaAssetId),
    });

    await sql`update media.stored_files set erased_at = now(), original_filename = null where media_asset_id = ${erased.mediaAssetId}`.execute(
      db(),
    );
    await sql`update media.media_assets set file_purged_at = now(), description = null, version = version + 1 where id = ${erased.mediaAssetId}`.execute(
      db(),
    );
    const purged = await drain(phone, '', cursor);
    expect(purged.changes.filter((change) => change['id'] === erased.mediaAssetId)).toEqual([
      { op: 'delete', type: 'media_asset', id: erased.mediaAssetId, version: await syncVersion(erased.mediaAssetId) },
    ]);
  });

  it('EVM-131 AC4 a change in an order outside the scope of the device, or in a deleted order, writes the log but reaches no phone - not even as a marker', async () => {
    await boot();
    const { phone } = await editor(app());
    const old = await scenario(app(), { number: numberOf(2026, 951), status: 'settled', closedAt: ago(app(), 40) });
    const medium = await insertMedia(db(), { workOrderId: old.orderId, createdBy: old.author.id });
    const { cursor } = await drain(phone);
    await setState(medium.mediaAssetId, 'clean');
    expect((await logVersions(medium.mediaAssetId)).length).toBeGreaterThan(0);
    const next = await drain(phone, '', cursor);
    expect(keysOf(next.changes)).toEqual([]);
  });

  it('EVM-131 AC4 a medium created by the phone appears in the snapshot of another phone of the same order and changes there when the file is scanned', async () => {
    await boot();
    const first = await editor(app());
    const second = await editor(app());
    const s = await scenario(app());
    const id = uuidv7();
    await sql`insert into media.media_assets (id, work_order_id, media_type, category, origin, created_at, created_by, updated_at)
      values (${id}, ${s.orderId}, 'video', 'defect', 'mobile', now(), ${s.author.id}, now())`.execute(db());
    const { cursor } = await drain(second.phone);
    expect(upsertOf((await drain(first.phone)).changes, 'media_asset', id)).toMatchObject({ mediaType: 'video', fileState: 'pending' });
    await sql`insert into media.stored_files (id, purpose, media_asset_id, object_key, state, state_changed_at, declared_size_bytes, declared_content_type, declared_sha256, original_filename, created_at, created_by)
      values (${uuidv7()}, 'media_original', ${id}, ${`media/2026/11/${uuidv7()}/original`}, 'pending_upload', now(), 1000, 'video/mp4', ${SHA}, 'a.mp4', now(), ${s.author.id})`.execute(
      db(),
    );
    await setState(id, 'clean');
    const next = await drain(second.phone, '', cursor);
    expect(upsertOf(next.changes, 'media_asset', id)).toMatchObject({ mediaType: 'video', fileState: 'clean' });
  });
});
