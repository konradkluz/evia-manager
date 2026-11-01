import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mediaTables } from '../../src/modules/media/infrastructure/tables.ts';
import { insertDocumentFile, insertDocumentVersion } from '../../src/modules/media/infrastructure/document-store.ts';
import { claimForProcessing, claimForScan } from '../../src/modules/media/infrastructure/media-store.ts';
import { DELETION_REGISTER } from '../../src/platform/deletion-register/deletion-register.ts';
import { InMemoryDeletionRegister } from '../../src/platform/deletion-register/in-memory-deletion-register.ts';
import { CLOCK } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertDocumentRow } from '../support/document-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertMedia } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

// 2026-10-03 12:00 Europe/Warsaw (CEST): the day of the marker is 03.10.2026
const NOW = '2026-10-03T10:00:00.000Z';
const BASE = '/api/v1/work-orders';
/** Synthetic canaries: they exist in the record before the erasure and must appear NOWHERE else afterwards (audit, register, logs, errors). */
const NAME_CANARY = 'CANARY-DOWOD-OSOBISTY-ABC123456.jpg';
const TEXT_CANARY = 'CANARY-OPIS-DANE-OSOBOWE-Zxq7';
const MARKER = 'Plik usunięty przez administratora 03.10.2026.';

let current: IdentityApp;
let register: InMemoryDeletionRegister;
beforeAll(async () => {
  current = await createIdentityApp({
    now: NOW,
    configure: (builder) =>
      builder.overrideProvider(DELETION_REGISTER).useFactory({
        inject: [CLOCK],
        factory: (clock: IdentityApp['clock']) => {
          register = new InMemoryDeletionRegister(clock);
          return register;
        },
      }),
  });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(NOW);
  current.storage.unavailable = false;
  register.recover();
  register.calls.length = 0;
  register.objects.length = 0;
  register.onRecord = undefined;
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;

async function signIn(role: Role, options: { fresh?: boolean; channel?: 'web' | 'mobile' } = {}) {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, {
    ...(options.channel === undefined ? {} : { channel: options.channel }),
    ...(options.fresh === true ? { passkeyAuthenticatedAt: current.clock.now() } : {}),
  });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function setup() {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `usuwanie${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    { number: `ZL-78${String(numbering).padStart(2, '0')}-0001`, customerId, siteId },
    { number: `ZL-78${String(numbering).padStart(2, '0')}-0002`, customerId, siteId },
  ]);
  const [orderA = '', orderB = ''] = [...ids.values()];
  const administrator = await signIn('administrator', { fresh: true });
  return { customerId, siteId, orderA, orderB, administrator };
}

/** A `ready` photo with its objects (original, thumbnail, preview) in the storage and its rows. */
async function readyPhoto(orderId: string, createdBy: string) {
  const media = await insertMedia(admin(), { workOrderId: orderId, createdBy, state: 'ready', fileName: NAME_CANARY });
  const prefix = media.objectKey.slice(0, -'original'.length);
  const keys = [media.objectKey, `${prefix}thumbnail.webp`, `${prefix}preview.webp`];
  for (const key of keys) current.storage.putObject(key, Buffer.from('synthetic bytes'));
  await sql`update media.media_assets set description = ${TEXT_CANARY} where id = ${media.mediaAssetId}`.execute(admin());
  await sql`insert into media.file_derivatives (stored_file_id, variant, object_key, content_type, width, height, size_bytes, created_at) values
    (${media.storedFileId}, 'thumbnail', ${keys[1] ?? ''}, 'image/webp', 320, 180, 9000, ${NOW}),
    (${media.storedFileId}, 'preview', ${keys[2] ?? ''}, 'image/webp', 1600, 900, 90000, ${NOW})`.execute(admin());
  return { ...media, keys };
}

async function readyDocument(spec: { workOrderId?: string; siteId?: string; customerId?: string }, createdBy: string) {
  const document = await insertDocumentRow(admin(), {
    ...spec,
    createdBy,
    state: 'ready',
    fileName: NAME_CANARY,
    title: 'Warunki przylaczenia - tytul testowy',
    description: TEXT_CANARY,
  });
  current.storage.putObject(document.objectKey, Buffer.from('synthetic pdf'));
  return document;
}

const mediaUrl = (orderId: string, id: string, suffix = '') => `${BASE}/${orderId}/media-assets/${id}${suffix}`;
const documentUrl = (orderId: string, id: string, suffix = '') => `${BASE}/${orderId}/documents/${id}${suffix}`;
const tag = (version: number) => `"${version}"`;
const codeOf = (body: unknown) => (body as { code?: string }).code;
const versionOf = async (table: 'media_assets' | 'documents', id: string) =>
  table === 'media_assets'
    ? ((await sql<{ version: number }>`select version from media.media_assets where id = ${id}`.execute(admin())).rows[0]?.version ?? 0)
    : ((await sql<{ version: number }>`select version from media.documents where id = ${id}`.execute(admin())).rows[0]?.version ?? 0);

interface MediaBody {
  id: string;
  description: string | null;
  fileErasedAt: string | null;
  originalFilename: string | null;
}
interface DocumentBody {
  id: string;
  title: string;
  description: string | null;
  fileErasedAt: string | null;
  originalFilename: string | null;
  canDownload: boolean;
}
const mediaList = async (browser: Browser, orderId: string) =>
  ((await browser.panel.get(`${BASE}/${orderId}/media-assets`)).body as { items: MediaBody[] }).items;
const documentList = async (browser: Browser, orderId: string) =>
  ((await browser.panel.get(`${BASE}/${orderId}/documents`)).body as { items: DocumentBody[] }).items;

const auditOf = async (objectId: string) =>
  (
    await sql<{ action: string; outcome: string; reason_code: string | null; actor_user_id: string | null }>`
      select action, outcome, reason_code, actor_user_id from audit.events where object_id = ${objectId} order by occurred_at, id`.execute(
      admin(),
    )
  ).rows;
const everythingWritten = async () =>
  [
    (await sql<{ t: string }>`select coalesce(string_agg(to_jsonb(e)::text, ' '), '') as t from audit.events e`.execute(admin())).rows[0]
      ?.t ?? '',
    register.objects.map((object) => object.body).join(' '),
    current.logs.lines.join('\n'),
  ].join('\n');

describe('EVM-051 AC1 - the deletion and the restore of a medium and of a document (SR-AUTHZ-02)', () => {
  it('EVM-051 AC1 AC4 the Administrator deletes a photo: the Editor and Read-only no longer see it (list, download 404), "Cofnij" brings it back; both are audited without a name or a description', async () => {
    const { orderA, administrator } = await setup();
    const editor = await signIn('editor');
    const readOnly = await signIn('read_only');
    const photo = await readyPhoto(orderA, administrator.userId);

    expect((await administrator.panel.delete(mediaUrl(orderA, photo.mediaAssetId))).status).toBe(204);
    for (const browser of [editor, readOnly, administrator]) {
      expect((await mediaList(browser, orderA)).map((item) => item.id)).not.toContain(photo.mediaAssetId);
      const download = await browser.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/download-url'), { variant: 'thumbnail' });
      expect(download.status).toBe(404);
    }
    expect(
      (await editor.panel.patch(mediaUrl(orderA, photo.mediaAssetId), { category: 'completed_work' }, { 'If-Match': '"1"' })).status,
    ).toBe(404);
    expect((await administrator.panel.delete(mediaUrl(orderA, photo.mediaAssetId))).status).toBe(404);

    expect((await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/restore'))).status).toBe(204);
    expect((await mediaList(editor, orderA)).map((item) => item.id)).toContain(photo.mediaAssetId);
    expect((await editor.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/download-url'), { variant: 'thumbnail' })).status).toBe(200);
    // restore of a live one is a conflict
    const again = await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/restore'));
    expect([again.status, codeOf(again.body)]).toEqual([409, 'invalid_state_transition']);

    const trail = await auditOf(photo.mediaAssetId);
    expect(trail.map((row) => [row.action, row.outcome])).toEqual([
      ['media_asset.deleted', 'success'],
      ['media_asset.restored', 'success'],
    ]);
    expect(trail.every((row) => row.actor_user_id === administrator.userId)).toBe(true);
    expect(await everythingWritten()).not.toContain(NAME_CANARY);
    expect(await everythingWritten()).not.toContain(TEXT_CANARY);
  });

  it('EVM-051 AC1 a document of the order, of its site and of its customer is deleted and restored through the path of the order; the lists of the site and the customer lose and regain it', async () => {
    const { orderA, siteId, customerId, administrator } = await setup();
    const editor = await signIn('editor');
    const own = await readyDocument({ workOrderId: orderA }, administrator.userId);
    const onSite = await readyDocument({ siteId }, administrator.userId);
    const onCustomer = await readyDocument({ customerId }, administrator.userId);

    for (const document of [own, onSite, onCustomer]) {
      expect((await administrator.panel.delete(documentUrl(orderA, document.documentId))).status).toBe(204);
    }
    expect((await documentList(editor, orderA)).map((item) => item.id)).not.toContain(own.documentId);
    const siteList = (await editor.panel.get(`/api/v1/sites/${siteId}/documents`)).body as { items: DocumentBody[] };
    expect(siteList.items.map((item) => item.id)).not.toContain(onSite.documentId);
    const customerList = (await editor.panel.get(`/api/v1/customers/${customerId}/documents`)).body as { items: DocumentBody[] };
    expect(customerList.items.map((item) => item.id)).not.toContain(onCustomer.documentId);
    expect((await editor.panel.post(documentUrl(orderA, own.documentId, '/download-url'))).status).toBe(404);
    expect((await editor.panel.post(`/api/v1/sites/${siteId}/documents/${onSite.documentId}/download-url`)).status).toBe(404);
    expect((await editor.panel.post(`/api/v1/customers/${customerId}/documents/${onCustomer.documentId}/download-url`)).status).toBe(404);
    expect((await editor.panel.patch(documentUrl(orderA, own.documentId), { title: 'x' }, { 'If-Match': '"2"' })).status).toBe(404);

    for (const document of [own, onSite, onCustomer]) {
      expect((await administrator.panel.post(documentUrl(orderA, document.documentId, '/restore'))).status).toBe(204);
    }
    expect((await documentList(editor, orderA)).map((item) => item.id)).toContain(own.documentId);
    expect(
      ((await editor.panel.get(`/api/v1/sites/${siteId}/documents`)).body as { items: DocumentBody[] }).items.map((item) => item.id),
    ).toContain(onSite.documentId);
    expect((await auditOf(own.documentId)).map((row) => row.action)).toEqual(['document.deleted', 'document.restored']);
  });
});

describe('EVM-051 AC6 - the permissions (SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-10)', () => {
  it('EVM-051 AC6 the Editor and Read-only get 403 forbidden (before the object is read), the anonymous 401, a mobile Administrator 403; a stale step-up is 403 step_up_required for the purge only', async () => {
    const { orderA, administrator } = await setup();
    const photo = await readyPhoto(orderA, administrator.userId);
    const document = await readyDocument({ workOrderId: orderA }, administrator.userId);
    const editor = await signIn('editor');
    const readOnly = await signIn('read_only');
    const mobileAdministrator = await signIn('administrator', { channel: 'mobile', fresh: true });
    const stale = await signIn('administrator');
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);

    const operations: Array<
      [string, (browser: PanelClient, headers?: Record<string, string>) => Promise<{ status: number; body: unknown }>]
    > = [
      ['deleteMedia', (b) => b.delete(mediaUrl(orderA, photo.mediaAssetId))],
      ['restoreMedia', (b) => b.post(mediaUrl(orderA, photo.mediaAssetId, '/restore'))],
      ['purgeMedia', (b, h) => b.post(mediaUrl(orderA, photo.mediaAssetId, '/purge-file'), undefined, h)],
      ['deleteDocument', (b) => b.delete(documentUrl(orderA, document.documentId))],
      ['restoreDocument', (b) => b.post(documentUrl(orderA, document.documentId, '/restore'))],
      ['purgeDocument', (b, h) => b.post(documentUrl(orderA, document.documentId, '/purge-file'), undefined, h)],
    ];
    for (const [name, call] of operations) {
      const headers = { 'If-Match': '"1"' };
      for (const [who, browser] of [
        ['editor', editor],
        ['read_only', readOnly],
        ['mobile administrator', mobileAdministrator],
      ] as const) {
        const answer = await call(browser.panel, headers);
        expect([name, who, answer.status, codeOf(answer.body)]).toEqual([name, who, 403, 'forbidden']);
      }
      expect([name, (await call(anonymous, headers)).status]).toEqual([name, 401]);
    }
    for (const [name, call] of operations.filter(([name]) => name.startsWith('purge'))) {
      const answer = await call(stale.panel, { 'If-Match': '"1"' });
      expect([name, answer.status, codeOf(answer.body)]).toEqual([name, 403, 'step_up_required']);
    }
    // nothing happened to either subject
    expect(await versionOf('media_assets', photo.mediaAssetId)).toBe(1);
    expect(register.calls).toEqual([]);
    expect(current.storage.currentKeys()).toEqual(expect.arrayContaining(photo.keys));
  });

  it("EVM-051 AC6 a medium of order B through the path of order A is 404 for delete, restore and purge; so is a document of another site's anchor and a document of another order", async () => {
    const { orderA, orderB, administrator } = await setup();
    const strangerSite = await insertSite(admin());
    const photoB = await readyPhoto(orderB, administrator.userId);
    const documentB = await readyDocument({ workOrderId: orderB }, administrator.userId);
    const foreignSiteDocument = await readyDocument({ siteId: strangerSite }, administrator.userId);

    for (const answer of [
      await administrator.panel.delete(mediaUrl(orderA, photoB.mediaAssetId)),
      await administrator.panel.post(mediaUrl(orderA, photoB.mediaAssetId, '/restore')),
      await administrator.panel.post(mediaUrl(orderA, photoB.mediaAssetId, '/purge-file'), undefined, { 'If-Match': '"1"' }),
      await administrator.panel.delete(documentUrl(orderA, documentB.documentId)),
      await administrator.panel.post(documentUrl(orderA, documentB.documentId, '/restore')),
      await administrator.panel.post(documentUrl(orderA, documentB.documentId, '/purge-file'), undefined, { 'If-Match': '"1"' }),
      await administrator.panel.delete(documentUrl(orderA, foreignSiteDocument.documentId)),
      await administrator.panel.post(documentUrl(orderA, foreignSiteDocument.documentId, '/purge-file'), undefined, { 'If-Match': '"1"' }),
      // a medium used as a document and the other way round
      await administrator.panel.delete(documentUrl(orderB, photoB.mediaAssetId)),
      await administrator.panel.delete(mediaUrl(orderB, documentB.documentId)),
    ]) {
      expect([answer.status, codeOf(answer.body)]).toEqual([404, 'not_found']);
    }
    expect(register.calls).toEqual([]);
    expect(current.storage.currentKeys()).toEqual(expect.arrayContaining(photoB.keys));
  });

  it('EVM-051 AC6 (R4) the documents of a deleted site are out of reach of the path of the order: the purge needs the anchor restored first', async () => {
    const { orderA, siteId, administrator } = await setup();
    const onSite = await readyDocument({ siteId }, administrator.userId);
    await sql`update sites.sites set deleted_at = ${NOW} where id = ${siteId}`.execute(admin());
    const answer = await administrator.panel.post(documentUrl(orderA, onSite.documentId, '/purge-file'), undefined, { 'If-Match': '"1"' });
    expect([answer.status, codeOf(answer.body)]).toEqual([404, 'not_found']);
  });
});

describe('EVM-051 AC2 AC3 AC4 - the erasure of the file of a medium (SR-PRIV-03, SR-PRIV-04, SR-DATA-08)', () => {
  it('EVM-051 AC2 the Administrator erases a photo: the original and the derivatives are gone from the storage, the record stays with the marker date, the description and the name are erased', async () => {
    const { orderA, administrator } = await setup();
    const editor = await signIn('editor');
    const photo = await readyPhoto(orderA, administrator.userId);

    const answer = await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/purge-file'), undefined, { 'If-Match': tag(1) });
    expect(answer.status).toBe(204);

    for (const key of photo.keys) expect(current.storage.isDeleted(key)).toBe(true);
    expect(current.storage.currentKeys().filter((key) => photo.keys.includes(key))).toEqual([]);
    // a signed address issued before the erasure carried no version (derivatives): a plain read now finds nothing
    await expect(current.storage.getObjectStream(photo.keys[1] ?? '', {})).rejects.toMatchObject({ code: 'no_such_object' });

    const item = (await mediaList(editor, orderA)).find((candidate) => candidate.id === photo.mediaAssetId);
    expect(item).toMatchObject({ description: null, originalFilename: null, fileErasedAt: NOW });
    const file = (
      await sql<{ erased_at: Date | null; objects_erased_at: Date | null; original_filename: string | null }>`
        select erased_at, objects_erased_at, original_filename from media.stored_files where id = ${photo.storedFileId}`.execute(admin())
    ).rows[0];
    expect(file?.original_filename).toBeNull();
    expect(file?.erased_at).toEqual(new Date(NOW));
    expect(file?.objects_erased_at).toEqual(new Date(NOW));
    expect(await versionOf('media_assets', photo.mediaAssetId)).toBe(2);

    // after the erasure: no address, no new session, no new scan, no restore (D3)
    expect((await editor.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/download-url'), { variant: 'thumbnail' })).status).toBe(404);
    expect((await editor.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/download-url'), { variant: 'original' })).status).toBe(404);
    const session = await administrator.panel.post(
      mediaUrl(orderA, photo.mediaAssetId, '/upload-sessions'),
      { id: uuidv7() },
      { 'Idempotency-Key': uuidv7() },
    );
    expect([session.status, codeOf(session.body)]).toEqual([409, 'file_erased']);
    const rescan = await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/rescan'), undefined, {
      'Idempotency-Key': uuidv7(),
    });
    expect([rescan.status, codeOf(rescan.body)]).toEqual([409, 'file_erased']);
    // the redacted record takes no new metadata (SR-PRIV-03)
    const editMedium = await editor.panel.patch(mediaUrl(orderA, photo.mediaAssetId), { description: 'new text' }, { 'If-Match': tag(2) });
    expect([editMedium.status, codeOf(editMedium.body)]).toEqual([409, 'file_erased']);
    expect(await versionOf('media_assets', photo.mediaAssetId)).toBe(2);

    await administrator.panel.delete(mediaUrl(orderA, photo.mediaAssetId));
    const restore = await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/restore'));
    expect([restore.status, codeOf(restore.body)]).toEqual([409, 'file_erased']);

    // the workers take nothing that is erased
    const tables = mediaTables(admin());
    expect(await claimForScan(tables, photo.storedFileId, new Date(NOW), new Date(NOW))).toBeUndefined();
    expect(await claimForProcessing(tables, photo.storedFileId, new Date(NOW), new Date(NOW), 3)).toBeUndefined();
  });

  it('EVM-051 AC2 a repeat is a success without a second register entry and without a second audit event; a failed removal of the objects is finished by the repeat', async () => {
    const { orderA, administrator } = await setup();
    const photo = await readyPhoto(orderA, administrator.userId);
    current.storage.unavailable = true;
    const failing = await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/purge-file'), undefined, { 'If-Match': tag(1) });
    current.storage.unavailable = false;
    expect([failing.status, codeOf(failing.body)]).toEqual([503, 'media_storage_unavailable']);
    // the rows are changed (the intent is durable), the objects are still there, the removal is not confirmed
    expect(
      (
        await sql<{
          objects_erased_at: Date | null;
        }>`select objects_erased_at from media.stored_files where id = ${photo.storedFileId}`.execute(admin())
      ).rows[0]?.objects_erased_at,
    ).toBeNull();
    expect(current.storage.currentKeys()).toEqual(expect.arrayContaining(photo.keys));

    // the repeat needs no If-Match: it only finishes the removal
    expect((await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/purge-file'))).status).toBe(204);
    expect(current.storage.currentKeys().filter((key) => photo.keys.includes(key))).toEqual([]);
    expect(register.objects).toHaveLength(1);
    expect((await auditOf(photo.mediaAssetId)).map((row) => row.action)).toEqual(['media_asset.file_purged']);
  });

  it('EVM-051 AC3 the register entry is written BEFORE the change, with the identifiers, the code, the owner, the actor and the time - and no name or description', async () => {
    const { orderA, administrator } = await setup();
    const photo = await readyPhoto(orderA, administrator.userId);
    const seen: Array<{ filePurgedAt: Date | null; erasedAt: Date | null; objectsStill: boolean }> = [];
    register.onRecord = async () => {
      const row = (
        await sql<{ file_purged_at: Date | null; erased_at: Date | null }>`
          select a.file_purged_at, f.erased_at from media.media_assets a join media.stored_files f on f.media_asset_id = a.id where a.id = ${photo.mediaAssetId}`.execute(
          admin(),
        )
      ).rows[0];
      seen.push({
        filePurgedAt: row?.file_purged_at ?? null,
        erasedAt: row?.erased_at ?? null,
        objectsStill: current.storage.currentKeys().includes(photo.objectKey),
      });
      await Promise.resolve();
    };
    expect(
      (await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/purge-file'), undefined, { 'If-Match': tag(1) })).status,
    ).toBe(204);
    expect(seen).toEqual([{ filePurgedAt: null, erasedAt: null, objectsStill: true }]);

    expect(register.calls).toEqual([
      {
        operationCode: 'media_file_purged',
        subjectType: 'media_asset',
        subjectId: photo.mediaAssetId,
        workOrderId: orderA,
        actorUserId: administrator.userId,
      },
    ]);
    const body = JSON.parse(register.objects[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({
      operationCode: 'media_file_purged',
      subjectId: photo.mediaAssetId,
      workOrderId: orderA,
      actorUserId: administrator.userId,
    });
    expect(String(body['operationId'])).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(body['occurredAt'])).toBe(NOW);
    expect(register.objects[0]?.body).not.toContain(NAME_CANARY);
    expect(register.objects[0]?.body).not.toContain(TEXT_CANARY);
  });

  it('EVM-051 AC3 when the register refuses: 503 deletion_register_unavailable, the record, the files and the objects are untouched, and the audit record says failed', async () => {
    const { orderA, administrator } = await setup();
    const photo = await readyPhoto(orderA, administrator.userId);
    register.failAll();
    const answer = await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/purge-file'), undefined, { 'If-Match': tag(1) });
    expect([answer.status, codeOf(answer.body)]).toEqual([503, 'deletion_register_unavailable']);

    const row = (
      await sql<{
        description: string | null;
        file_purged_at: Date | null;
        version: number;
        original_filename: string | null;
        erased_at: Date | null;
      }>`
        select a.description, a.file_purged_at, a.version, f.original_filename, f.erased_at from media.media_assets a join media.stored_files f on f.media_asset_id = a.id where a.id = ${photo.mediaAssetId}`.execute(
        admin(),
      )
    ).rows[0];
    expect(row).toEqual({ description: TEXT_CANARY, file_purged_at: null, version: 1, original_filename: NAME_CANARY, erased_at: null });
    expect(current.storage.currentKeys()).toEqual(expect.arrayContaining(photo.keys));
    expect(register.objects).toEqual([]);
    expect((await auditOf(photo.mediaAssetId)).map((entry) => [entry.action, entry.outcome, entry.reason_code])).toEqual([
      ['media_asset.file_purged', 'failed', 'step_up_verified'],
    ]);
    expect(JSON.stringify(answer.body)).not.toContain(NAME_CANARY);
  });

  it('EVM-051 AC4 the audit event of the erasure has the identifiers, the code, the outcome and the step-up code - and the name and the description are nowhere (audit, register, logs, errors)', async () => {
    const { orderA, administrator } = await setup();
    const photo = await readyPhoto(orderA, administrator.userId);
    expect(
      (await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/purge-file'), undefined, { 'If-Match': tag(1) })).status,
    ).toBe(204);
    expect((await auditOf(photo.mediaAssetId)).map((row) => [row.action, row.outcome, row.reason_code, row.actor_user_id])).toEqual([
      ['media_asset.file_purged', 'success', 'step_up_verified', administrator.userId],
    ]);
    const written = await everythingWritten();
    expect(written).not.toContain(NAME_CANARY);
    expect(written).not.toContain(TEXT_CANARY);
  });

  it('EVM-051 AC7 a file the scan holds is 409 file_processing with Retry-After and nothing changes; If-Match is required (428) and checked (412)', async () => {
    const { orderA, administrator } = await setup();
    const scanning = await insertMedia(admin(), { workOrderId: orderA, createdBy: administrator.userId, state: 'scanning' });
    const photo = await readyPhoto(orderA, administrator.userId);

    const busy = await administrator.panel.post(mediaUrl(orderA, scanning.mediaAssetId, '/purge-file'), undefined, { 'If-Match': tag(1) });
    expect([busy.status, codeOf(busy.body), busy.headers['retry-after']]).toEqual([409, 'file_processing', '30']);
    expect(register.calls).toEqual([]);
    expect(await versionOf('media_assets', scanning.mediaAssetId)).toBe(1);

    const missing = await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/purge-file'));
    expect([missing.status, codeOf(missing.body)]).toEqual([428, 'precondition_required']);
    const malformed = await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/purge-file'), undefined, { 'If-Match': 'abc' });
    expect(malformed.status).toBe(400);
    const stale = await administrator.panel.post(mediaUrl(orderA, photo.mediaAssetId, '/purge-file'), undefined, { 'If-Match': tag(7) });
    expect([stale.status, codeOf(stale.body)]).toEqual([412, 'version_conflict']);
    expect(register.calls).toEqual([]);
    expect(current.storage.currentKeys()).toEqual(expect.arrayContaining(photo.keys));
  });

  it('EVM-051 AC7 a quarantined file and an unfinished upload are erased too: the object of the quarantine goes and the multipart upload is aborted', async () => {
    const { orderA, administrator } = await setup();
    const held = await insertMedia(admin(), {
      workOrderId: orderA,
      createdBy: administrator.userId,
      state: 'quarantined',
      reason: 'malware_detected',
    });
    current.storage.putObject(held.objectKey, Buffer.from('synthetic quarantined'));
    const upload = await current.storage.createMultipartUpload(`media/2026/10/${uuidv7()}/original`, 'image/jpeg');
    const pending = await insertMedia(admin(), {
      workOrderId: orderA,
      createdBy: administrator.userId,
      session: { userId: administrator.userId, uploadId: upload.uploadId },
    });

    expect(
      (await administrator.panel.post(mediaUrl(orderA, held.mediaAssetId, '/purge-file'), undefined, { 'If-Match': tag(1) })).status,
    ).toBe(204);
    expect(current.storage.isDeleted(held.objectKey)).toBe(true);
    expect(
      (await administrator.panel.post(mediaUrl(orderA, pending.mediaAssetId, '/purge-file'), undefined, { 'If-Match': tag(1) })).status,
    ).toBe(204);
    const session = (await sql<{ state: string }>`select state from media.upload_sessions where id = ${pending.sessionId}`.execute(admin()))
      .rows[0];
    expect(session?.state).toBe('aborted');
    await expect(current.storage.listParts(pending.objectKey, upload.uploadId)).rejects.toMatchObject({ code: 'no_such_upload' });
  });
});

describe('EVM-051 AC2 AC3 - the erasure of the files of a document (SR-PRIV-03, SR-PRIV-04)', () => {
  it('EVM-051 AC2 every version of the file of a document is erased; the title becomes the marker, the description and the names go, the record stays and cannot be downloaded', async () => {
    const { orderA, administrator } = await setup();
    const editor = await signIn('editor');
    const document = await readyDocument({ workOrderId: orderA }, administrator.userId);
    const secondVersion = uuidv7();
    const secondFile = uuidv7();
    const secondKey = `documents/2026/10/${secondFile}/original`;
    const tables = mediaTables(admin());
    await insertDocumentVersion(
      tables,
      { id: secondVersion, documentId: document.documentId, versionNumber: 2, createdBy: administrator.userId },
      new Date(NOW),
    );
    await insertDocumentFile(
      tables,
      {
        id: secondFile,
        documentVersionId: secondVersion,
        objectKey: secondKey,
        declaredSize: 100,
        declaredContentType: 'application/pdf',
        declaredSha256: 'b'.repeat(64),
        originalFilename: NAME_CANARY,
        createdBy: administrator.userId,
      },
      new Date(NOW),
    );
    current.storage.putObject(secondKey, Buffer.from('synthetic second version'));

    const answer = await administrator.panel.post(documentUrl(orderA, document.documentId, '/purge-file'), undefined, {
      'If-Match': tag(1),
    });
    expect(answer.status).toBe(204);
    expect(current.storage.currentKeys().filter((key) => [document.objectKey, secondKey].includes(key))).toEqual([]);
    const names = (
      await sql<{
        n: number;
      }>`select count(*)::int as n from media.stored_files where original_filename is not null and document_version_id in (${document.versionId}, ${secondVersion})`.execute(
        admin(),
      )
    ).rows[0]?.n;
    expect(names).toBe(0);

    const item = (await documentList(editor, orderA)).find((candidate) => candidate.id === document.documentId);
    expect(item).toMatchObject({ title: MARKER, description: null, originalFilename: null, fileErasedAt: NOW, canDownload: false });
    expect((await editor.panel.post(documentUrl(orderA, document.documentId, '/download-url'))).status).toBe(404);
    // the redacted record takes no new title or description (SR-PRIV-03)
    const editDocument = await editor.panel.patch(documentUrl(orderA, document.documentId), { title: 'new title' }, { 'If-Match': tag(2) });
    expect([editDocument.status, codeOf(editDocument.body)]).toEqual([409, 'file_erased']);
    expect((await documentList(editor, orderA)).find((candidate) => candidate.id === document.documentId)).toMatchObject({ title: MARKER });
    const restore = await administrator.panel.post(documentUrl(orderA, document.documentId, '/restore'));
    expect(restore.status).toBe(409);
    expect(register.calls).toEqual([
      {
        operationCode: 'document_file_purged',
        subjectType: 'document',
        subjectId: document.documentId,
        workOrderId: orderA,
        actorUserId: administrator.userId,
      },
    ]);
    expect((await auditOf(document.documentId)).map((row) => [row.action, row.reason_code])).toEqual([
      ['document.file_purged', 'step_up_verified'],
    ]);
    expect(await everythingWritten()).not.toContain(NAME_CANARY);
    expect(await everythingWritten()).not.toContain(TEXT_CANARY);
  });

  it('EVM-051 AC3 the register entry of a document of a site or a customer names the anchor (no order); a refusal leaves the document and its objects as they were', async () => {
    const { orderA, siteId, customerId, administrator } = await setup();
    const onSite = await readyDocument({ siteId }, administrator.userId);
    const onCustomer = await readyDocument({ customerId }, administrator.userId);

    register.failAll();
    const refused = await administrator.panel.post(documentUrl(orderA, onSite.documentId, '/purge-file'), undefined, {
      'If-Match': tag(1),
    });
    expect([refused.status, codeOf(refused.body)]).toEqual([503, 'deletion_register_unavailable']);
    expect(current.storage.currentKeys()).toContain(onSite.objectKey);
    expect(await versionOf('documents', onSite.documentId)).toBe(1);
    register.recover();

    for (const document of [onSite, onCustomer]) {
      expect(
        (await administrator.panel.post(documentUrl(orderA, document.documentId, '/purge-file'), undefined, { 'If-Match': tag(1) })).status,
      ).toBe(204);
    }
    const bodies = register.objects.map((object) => JSON.parse(object.body) as Record<string, unknown>);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      operationCode: 'document_file_purged',
      subjectType: 'document',
      anchorType: 'site',
      anchorId: siteId,
    });
    expect(bodies[1]).toMatchObject({ anchorType: 'customer', anchorId: customerId });
    for (const body of bodies) expect(body).not.toHaveProperty('workOrderId');
    // the anchored lists show the record with the marker
    const siteItems = ((await administrator.panel.get(`/api/v1/sites/${siteId}/documents`)).body as { items: DocumentBody[] }).items;
    expect(siteItems.find((item) => item.id === onSite.documentId)).toMatchObject({ title: MARKER, fileErasedAt: NOW, canDownload: false });
    expect((await administrator.panel.post(`/api/v1/sites/${siteId}/documents/${onSite.documentId}/download-url`)).status).toBe(404);
  });
});
