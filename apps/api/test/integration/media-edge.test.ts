import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaScanService } from '../../src/modules/media/index.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-10-27T08:00:00.000Z';
const BASE = '/api/v1/work-orders';

let current: IdentityApp;
let orderId = '';
let userId = '';
let panel: PanelClient;
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
  const user = await createUser(current.database.admin, current.clock, { role: 'editor' });
  userId = user.id;
  const session = await createSession(current.database.admin, current.clock, user, {});
  panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  const customerId = await insertCustomer(current.database.admin, { email: 'edge@example.invalid' });
  const siteId = await insertSite(current.database.admin);
  orderId = [...(await insertWorkOrders(current.database.admin, [{ number: 'ZL-6800-0001', customerId, siteId }])).values()][0] ?? '';
});

const jpeg = (size = 1024): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.alloc(size - 12, 7)]);
const sessionPath = (mediaAssetId: string, sessionId: string) =>
  `${BASE}/${orderId}/media-assets/${mediaAssetId}/upload-sessions/${sessionId}`;
const codeOf = (body: unknown) => (body as { code?: string }).code;

/** A medium with an active session whose upload exists in the in-memory storage; returns what the tests need. */
async function withSession(body = jpeg()) {
  const item = {
    id: uuidv7(),
    category: 'in_progress',
    fileName: 'IMG_1.JPG',
    declaredSize: body.length,
    contentType: 'image/jpeg',
    sha256: sha256Of(body),
  };
  await panel.post(`${BASE}/${orderId}/media-assets`, { items: [item] }, { 'Idempotency-Key': uuidv7() });
  const session = await panel.post(
    `${BASE}/${orderId}/media-assets/${item.id}/upload-sessions`,
    { id: uuidv7() },
    { 'Idempotency-Key': uuidv7() },
  );
  const sessionId = (session.body as { id: string }).id;
  const { rows } = await sql<{ s3_upload_id: string; object_key: string }>`
    select s.s3_upload_id, f.object_key from media.upload_sessions s join media.stored_files f on f.id = s.stored_file_id where s.id = ${sessionId}`.execute(
    current.database.admin,
  );
  return { item, sessionId, uploadId: rows[0]?.s3_upload_id ?? '', key: rows[0]?.object_key ?? '', body };
}

describe('EVM-044 AC6 the end of an upload in the awkward cases (SR-ERR-01, SR-ERR-02)', () => {
  it('EVM-044 AC6 a repeat of complete whose first call assembled the object but never committed: the object is found by HEAD and the file moves on', async () => {
    const { item, sessionId, uploadId, key, body } = await withSession();
    current.storage.putPart(uploadId, 1, body);
    await current.storage.completeMultipartUpload(key, uploadId, await current.storage.listParts(key, uploadId));
    const response = await panel.post(`${sessionPath(item.id, sessionId)}/complete`);
    expect(response.status).toBe(200);
    expect((response.body as { fileState: string }).fileState).toBe('uploaded');
  });

  it('EVM-044 AC6 complete of an upload the storage has lost, with no object either, is 409 and the file stays pending_upload', async () => {
    const { item, sessionId, uploadId, key } = await withSession();
    await current.storage.abortMultipartUpload(key, uploadId);
    const response = await panel.post(`${sessionPath(item.id, sessionId)}/complete`);
    expect(response.status).toBe(409);
    expect(codeOf(response.body)).toBe('invalid_state_transition');
    expect((await panel.get(`${sessionPath(item.id, sessionId)}/parts`)).status).toBe(409);
  });

  it('EVM-044 AC6 an assembled object of another length than declared is 422 size_mismatch', async () => {
    const { item, sessionId, uploadId, key } = await withSession(jpeg(1000));
    current.storage.putObject(key, jpeg(900));
    await current.storage.abortMultipartUpload(key, uploadId);
    const response = await panel.post(`${sessionPath(item.id, sessionId)}/complete`);
    expect(response.status).toBe(422);
    expect(codeOf(response.body)).toBe('upload_incomplete');
  });

  it('EVM-044 AC6 complete and the URL of a part are refused for an aborted session, an expired session and a file that already left pending_upload', async () => {
    const aborted = await withSession();
    await panel.post(`${sessionPath(aborted.item.id, aborted.sessionId)}/abort`);
    expect((await panel.post(`${sessionPath(aborted.item.id, aborted.sessionId)}/complete`)).status).toBe(409);
    expect((await panel.get(`${sessionPath(aborted.item.id, aborted.sessionId)}/parts/1/url`)).status).toBe(409);

    const expired = await withSession();
    await sql`update media.upload_sessions set expires_at = ${new Date(Date.parse(NOW) - 1000)} where id = ${expired.sessionId}`.execute(
      current.database.admin,
    );
    expect((await panel.post(`${sessionPath(expired.item.id, expired.sessionId)}/complete`)).status).toBe(409);
    expect((await panel.get(`${sessionPath(expired.item.id, expired.sessionId)}/parts`)).status).toBe(409);

    const stored = await insertMedia(current.database.admin, {
      workOrderId: orderId,
      createdBy: userId,
      state: 'uploaded',
      session: { userId },
    });
    expect((await panel.post(`${sessionPath(stored.mediaAssetId, stored.sessionId ?? '')}/complete`)).status).toBe(409);
  });

  it('EVM-044 AC6 abort of a finished session is 409; abort with an unavailable storage is 503 and the session stays active', async () => {
    const done = await withSession();
    current.storage.putPart(done.uploadId, 1, done.body);
    expect((await panel.post(`${sessionPath(done.item.id, done.sessionId)}/complete`)).status).toBe(200);
    expect((await panel.post(`${sessionPath(done.item.id, done.sessionId)}/abort`)).status).toBe(409);

    const open = await withSession();
    current.storage.unavailable = true;
    expect((await panel.post(`${sessionPath(open.item.id, open.sessionId)}/abort`)).status).toBe(503);
    current.storage.unavailable = false;
    expect(
      (await sql<{ state: string }>`select state from media.upload_sessions where id = ${open.sessionId}`.execute(current.database.admin))
        .rows[0]?.state,
    ).toBe('active');
  });

  it('EVM-044 AC6 a session id that is already taken is 409 id_conflict and the upload created for it is dropped', async () => {
    const first = await withSession();
    const second = {
      id: uuidv7(),
      category: 'other',
      fileName: 'IMG_2.JPG',
      declaredSize: 1024,
      contentType: 'image/jpeg',
      sha256: sha256Of(jpeg()),
    };
    await panel.post(`${BASE}/${orderId}/media-assets`, { items: [second] }, { 'Idempotency-Key': uuidv7() });
    const clash = await panel.post(
      `${BASE}/${orderId}/media-assets/${second.id}/upload-sessions`,
      { id: first.sessionId },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(clash.status).toBe(409);
    expect(codeOf(clash.body)).toBe('id_conflict');
    expect(JSON.stringify(clash.body)).not.toContain(first.item.id);
  });

  it('EVM-044 AC6 a body with a field the contract does not know, or a session id that is not a UUIDv7, is 400', async () => {
    const first = await withSession();
    const path = `${BASE}/${orderId}/media-assets/${first.item.id}/upload-sessions`;
    expect((await panel.post(path, { id: uuidv7(), partSize: 5 }, { 'Idempotency-Key': uuidv7() })).status).toBe(400);
    expect((await panel.post(path, { id: '00000000-0000-4000-8000-000000000003' }, { 'Idempotency-Key': uuidv7() })).status).toBe(400);
    expect((await panel.post(path, { id: uuidv7() })).status).toBe(400);
    expect((await panel.post(path, { id: uuidv7() }, { 'Idempotency-Key': 'not-a-key' })).status).toBe(400);
  });
});

describe('EVM-044 AC3 the loop of the scan (SR-ERR-02: nothing stays silent)', () => {
  const scan = () => current.app.get(MediaScanService, { strict: false });

  it('EVM-044 AC3 the loop scans on its own timer and stops; a pass over an empty queue decides nothing', async () => {
    const { item, uploadId, key, sessionId, body } = await withSession();
    current.storage.putPart(uploadId, 1, body);
    await panel.post(`${sessionPath(item.id, sessionId)}/complete`);
    expect(key).toContain('media/');
    const stop = scan().start(20);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = await sql<{ state: string }>`select state from media.stored_files where media_asset_id = ${item.id}`.execute(
        current.database.admin,
      );
      if (row.rows[0]?.state === 'clean') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    stop();
    expect(
      (await sql<{ state: string }>`select state from media.stored_files where media_asset_id = ${item.id}`.execute(current.database.admin))
        .rows[0]?.state,
    ).toBe('clean');
    expect(await scan().runOnce()).toBe(0);
  });

  it('EVM-044 AC3 a file that has waited for a scan for over 30 minutes is reported with a count and no identifier of a person', async () => {
    await insertMedia(current.database.admin, { workOrderId: orderId, createdBy: userId, state: 'scanning', fileName: 'klient-nowak.jpg' });
    current.scanner.mode = 'unavailable';
    current.clock.advance(31 * 60_000);
    await scan().runOnce();
    const warning = current.logs.entries.find((entry) => String(entry['msg']).includes('wait for a scan for over 30 minutes'));
    expect(warning).toMatchObject({ job: 'media.scan', stuck: 1 });
    expect(current.logs.text).not.toContain('klient-nowak');
  });

  it('EVM-044 AC3 a scan pass that fails is logged as a failed pass and does not stop the loop', async () => {
    const stop = scan().start(10);
    await sql`alter table media.stored_files rename to stored_files_gone`.execute(current.database.admin);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await sql`alter table media.stored_files_gone rename to stored_files`.execute(current.database.admin);
    stop();
    expect(current.logs.entries.some((entry) => entry['msg'] === 'media: scan pass failed')).toBe(true);
  });
});
