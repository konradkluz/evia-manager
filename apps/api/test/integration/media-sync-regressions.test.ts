/**
 * The flows of the panel and the jobs of the media after migration 0065 (EVM-131; SR-DATA-08, ASVS V15.2): the trigger of the state of a file updates the row of the medium, so the paths that
 * already wrote it must still work - the `If-Match` of the panel, the list, the export, the deletion, the sweeper, the new scan - and a medium of the phone that has no file must break none of them.
 * Synthetic data only.
 */
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AbandonedUploadsJob } from '../../src/modules/media/index.ts';
import { exportCandidates } from '../../src/modules/media/infrastructure/export-store.ts';
import { mediaTables } from '../../src/modules/media/infrastructure/tables.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createMobileSession, createSession, createUser, type Role, type UserFixture } from '../support/identity-fixtures.ts';
import { insertMedia } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-11-14T08:00:00.000Z';
const BASE = '/api/v1/work-orders';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(NOW);
  current.storage.unavailable = false;
  current.scanner.mode = 'working';
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;
const server = () => current.app.getHttpServer();

interface Web {
  readonly user: UserFixture;
  readonly panel: PanelClient;
}
async function web(role: Role = 'editor', user?: UserFixture): Promise<Web> {
  const owner = user ?? (await createUser(admin(), current.clock, { role }));
  const session = await createSession(admin(), current.clock, owner, { channel: 'web', passkeyAuthenticatedAt: current.clock.now() });
  const panel = new PanelClient(server(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { user: owner, panel };
}

let numbering = 0;
async function order(): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `regresja${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-8${String(numbering).padStart(3, '0')}-0001`, customerId, siteId }]);
  return [...ids.values()][0] ?? '';
}

const phoneMedium = async (orderId: string, userId: string): Promise<string> => {
  const id = uuidv7();
  await sql`insert into media.media_assets (id, work_order_id, media_type, category, origin, created_at, created_by, updated_at)
    values (${id}, ${orderId}, 'photo', 'before_work', 'mobile', now(), ${userId}, now())`.execute(admin());
  return id;
};
const asset = async (id: string) =>
  (
    await sql<{ version: number; file_state_revision: number; updated_at: Date; updated_by: string | null }>`
      select version, file_state_revision, updated_at, updated_by from media.media_assets where id = ${id}`.execute(admin())
  ).rows[0];
const setState = (id: string, state: string, reason: string | null = null) =>
  sql`update media.stored_files set state = ${state}, state_reason_code = ${reason}, state_changed_at = now(),
      quarantined_at = case when ${state} = 'quarantined' then coalesce(quarantined_at, now()) else quarantined_at end
      where media_asset_id = ${id}`.execute(admin());
const logVersions = async (id: string): Promise<number[]> =>
  (
    await sql<{
      v: number;
    }>`select entity_version as v from sync.change_log where entity_id = ${id} and entity_type = 'media_asset' order by seq`.execute(
      admin(),
    )
  ).rows.map((row) => row.v);

describe('EVM-131 AC4 AC6 - the If-Match of the panel does not see a change of the state of the file (ASVS V15.2)', () => {
  it('EVM-131 AC6 the edit of the metadata in the panel after the scan changed the state of the file is 200, not 412: `version`, `updated_at` and `updated_by` are not touched by the state', async () => {
    const orderId = await order();
    const editor = await web('editor');
    const medium = await insertMedia(admin(), { workOrderId: orderId, createdBy: editor.user.id });
    const read = async () => {
      const list = await editor.panel.get(`${BASE}/${orderId}/media-assets`);
      return (list.body as { items: Array<{ id: string; version: number }> }).items.find((item) => item.id === medium.mediaAssetId);
    };
    const before = await read();
    expect(before?.version).toBe(1);
    for (const state of ['uploaded', 'scanning', 'clean', 'processing', 'ready']) await setState(medium.mediaAssetId, state);
    expect((await asset(medium.mediaAssetId))?.file_state_revision).toBeGreaterThanOrEqual(5);
    // the panel still holds version 1: the state of the file is not a change of the metadata
    expect((await read())?.version).toBe(1);
    const patch = await editor.panel.patch(
      `${BASE}/${orderId}/media-assets/${medium.mediaAssetId}`,
      { description: 'Skrzynka po remoncie' },
      { 'If-Match': '"1"' },
    );
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.headers['etag']).toBe('"2"');
    const after = await asset(medium.mediaAssetId);
    expect(after).toMatchObject({ version: 2, updated_by: editor.user.id });
    // the phone's version only grew: version + counter
    const versions = await logVersions(medium.mediaAssetId);
    expect(versions.at(-1)).toBe(2 + (after?.file_state_revision ?? 0));
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    // and a stale If-Match is still 412 (the lock of the panel works as before)
    const stale = await editor.panel.patch(
      `${BASE}/${orderId}/media-assets/${medium.mediaAssetId}`,
      { description: 'inny' },
      { 'If-Match': '"1"' },
    );
    expect(stale.status).toBe(412);
  });

  it('EVM-131 AC6 a parallel edit of the metadata and changes of the state of the file never deadlock and never lose a version: the counters only grow, the sum is the last version of the log', async () => {
    const orderId = await order();
    const user = await createUser(admin(), current.clock, { role: 'editor' });
    const medium = await insertMedia(admin(), { workOrderId: orderId, createdBy: user.id });
    const states = ['uploaded', 'scanning', 'clean', 'processing', 'ready'] as const;
    const work: Array<Promise<unknown>> = [];
    for (let round = 0; round < 15; round += 1) {
      work.push(
        sql`update media.media_assets set version = version + 1, updated_by = ${user.id}, description = ${`opis ${round}`} where id = ${medium.mediaAssetId}`.execute(
          admin(),
        ),
        setState(medium.mediaAssetId, states[round % states.length] ?? 'clean'),
      );
    }
    await Promise.all(work);
    const row = await asset(medium.mediaAssetId);
    expect(row?.version).toBe(16);
    // 1 (the insert of the file) + the changes of the state that really changed it
    expect(row?.file_state_revision).toBeGreaterThanOrEqual(2);
    const versions = await logVersions(medium.mediaAssetId);
    expect(Math.max(...versions)).toBe((row?.version ?? 0) + (row?.file_state_revision ?? 0));
  });
});

describe('EVM-131 AC3 - the batch of the panel and the command of the phone judge the description by ONE function', () => {
  it('EVM-131 AC3 the batch of the panel refuses a description with a control character at /items/N/description, keeps none for a blank one and the text normalised for a real one - nothing is written on a refusal', async () => {
    const orderId = await order();
    const editor = await web('editor');
    const item = (description: string | undefined) => ({
      id: uuidv7(),
      category: 'other',
      fileName: 'IMG_5.JPG',
      declaredSize: 2048,
      contentType: 'image/jpeg',
      sha256: 'a'.repeat(64),
      ...(description === undefined ? {} : { description }),
    });
    const post = (items: unknown[]) => editor.panel.post(`${BASE}/${orderId}/media-assets`, { items }, { 'Idempotency-Key': uuidv7() });
    const bad = await post([item('ok'), item('a\u0000b')]);
    expect(bad.status).toBe(400);
    expect((bad.body as { errors: Array<{ pointer: string }> }).errors.map((error) => error.pointer)).toEqual(['/items/1/description']);
    const written = await sql<{ n: string }>`select count(*)::text as n from media.media_assets where work_order_id = ${orderId}`.execute(
      admin(),
    );
    expect(written.rows[0]?.n).toBe('0');

    const blank = item('   ');
    const real = item('  Skrzynka  ' + String.fromCharCode(13, 10) + ' po remoncie ');
    expect((await post([blank, real])).status).toBe(201);
    const rows = await sql<{
      id: string;
      description: string | null;
    }>`select id, description from media.media_assets where work_order_id = ${orderId}`.execute(admin());
    const byId = new Map(rows.rows.map((row) => [row.id, row.description]));
    expect(byId.get(blank.id)).toBeNull();
    expect(byId.get(real.id)).toBe('Skrzynka  \n po remoncie');
  });
});

describe('EVM-131 AC1 AC4 - a medium of the phone that has no file yet breaks nothing (ADR-0021 D4)', () => {
  it('EVM-131 AC4 the list of the panel does not show it, and the filter of unfinished uploads never shows a medium of the phone - with a file or without (the banner counts the batches of the panel)', async () => {
    const orderId = await order();
    const editor = await web('editor');
    const phone = await createMobileSession(admin(), current.clock, editor.user);
    const noFile = await phoneMedium(orderId, editor.user.id);
    const panelMedium = await insertMedia(admin(), { workOrderId: orderId, createdBy: editor.user.id });
    // a medium of the phone WITH a file in pending_upload (the session declared it)
    const withFile = await phoneMedium(orderId, editor.user.id);
    const declared = await request(server())
      .post(`${BASE}/${orderId}/media-assets/${withFile}/upload-sessions`)
      .set({
        'X-Client-Platform': 'android',
        'X-Client-Version': '1.2.0',
        Authorization: `Bearer ${phone.bearer}`,
        'Idempotency-Key': uuidv7(),
      })
      .send({ id: uuidv7(), file: { fileName: `${uuidv7()}.jpg`, declaredSize: 2048, contentType: 'image/jpeg', sha256: 'a'.repeat(64) } });
    expect(declared.status).toBe(201);

    const all = (await editor.panel.get(`${BASE}/${orderId}/media-assets`)).body as { items: Array<{ id: string }> };
    expect(all.items.map((item) => item.id).sort()).toEqual([panelMedium.mediaAssetId, withFile].sort());
    expect(all.items.map((item) => item.id)).not.toContain(noFile);
    const unfinished = (await editor.panel.get(`${BASE}/${orderId}/media-assets?uploadState=unfinished`)).body as {
      items: Array<{ id: string }>;
    };
    // regression: the medium of the PANEL in pending_upload is still listed; the media of the phone are not
    expect(unfinished.items.map((item) => item.id)).toEqual([panelMedium.mediaAssetId]);
  });

  it('EVM-131 AC4 the export, the deletion and the sweeper do not fail on a medium without a file: the export leaves it out, an Administrator deletes it (204) and the phone gets a marker, the sweeper only touches files', async () => {
    const orderId = await order();
    const boss = await web('administrator');
    const noFile = await phoneMedium(orderId, boss.user.id);
    // the export reads the media with their files: a medium without one is not a candidate
    expect(await exportCandidates(mediaTables(admin()), orderId)).toEqual([]);

    // the sweeper: a stale file of the panel is given up, the medium without a file is not a row of its table
    const old = await insertMedia(admin(), { workOrderId: orderId, createdBy: boss.user.id, createdAt: new Date('2026-10-01T08:00:00Z') });
    await sql`update media.stored_files set state_changed_at = ${new Date('2026-10-01T08:00:00Z')} where media_asset_id = ${old.mediaAssetId}`.execute(
      admin(),
    );
    const revision = (await asset(old.mediaAssetId))?.file_state_revision ?? 0;
    await current.app.get(AbandonedUploadsJob, { strict: false }).run();
    const given = await sql<{
      state: string;
      state_reason_code: string;
    }>`select state, state_reason_code from media.stored_files where media_asset_id = ${old.mediaAssetId}`.execute(admin());
    expect(given.rows[0]).toEqual({ state: 'failed', state_reason_code: 'abandoned' });
    // the sweeper's change of the state counted for the phone
    expect((await asset(old.mediaAssetId))?.file_state_revision).toBeGreaterThan(revision);
    const sum = (
      await sql<{ v: number }>`select version + file_state_revision as v from media.media_assets where id = ${old.mediaAssetId}`.execute(
        admin(),
      )
    ).rows[0]?.v;
    expect((await logVersions(old.mediaAssetId)).at(-1)).toBe(sum);

    const deleted = await boss.panel.delete(`${BASE}/${orderId}/media-assets/${noFile}`);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
    expect((await asset(noFile))?.version).toBe(2);
    expect((await logVersions(noFile)).at(-1)).toBe(2);
  });

  it('EVM-131 AC6 the new scan of a quarantined file (EVM-049) and its restoration still work through the trigger: the state moves, the version of the panel does not', async () => {
    const orderId = await order();
    const boss = await web('administrator');
    const held = await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: boss.user.id,
      state: 'quarantined',
      reason: 'malware_detected',
      quarantinedAt: new Date('2026-11-10T08:00:00Z'),
    });
    const before = await asset(held.mediaAssetId);
    const rescan = await boss.panel.post(`${BASE}/${orderId}/media-assets/${held.mediaAssetId}/rescan`, undefined, {
      'Idempotency-Key': uuidv7(),
    });
    expect(rescan.status, JSON.stringify(rescan.body)).toBe(202);
    const after = await asset(held.mediaAssetId);
    expect(after?.version).toBe(before?.version);
    expect(after?.file_state_revision).toBeGreaterThan(before?.file_state_revision ?? 0);
    const state = await sql<{ state: string }>`select state from media.stored_files where media_asset_id = ${held.mediaAssetId}`.execute(
      admin(),
    );
    expect(state.rows[0]?.state).toBe('scanning');
  });
});
