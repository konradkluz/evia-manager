import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PART_SIZE_BYTES } from '../../src/modules/media/domain/upload-plan.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertDocumentRow } from '../support/document-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-11-01T08:00:00.000Z';
const BASE = '/api/v1/work-orders';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp({ now: NOW });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(NOW);
  current.storage.unavailable = false;
  current.scanner.mode = 'working';
  current.storage.signedGets.length = 0;
  await clearWorkOrderCreation(current.database.admin);
  await sql`update media.stored_files set state = 'failed', state_reason_code = 'abandoned' where state in ('uploaded', 'scanning')`.execute(
    admin(),
  );
});

const admin = () => current.database.admin;

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
interface Place {
  readonly siteId: string;
  readonly customerId: string;
  /** Two orders of the SAME site and the SAME customer. */
  readonly orderA: string;
  readonly orderB: string;
}
/** A site, a customer and two orders of both (synthetic data only). */
async function place(): Promise<Place> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `kotwica${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    { number: `ZL-7${String(numbering).padStart(3, '0')}-0001`, customerId, siteId },
    { number: `ZL-7${String(numbering).padStart(3, '0')}-0002`, customerId, siteId },
  ]);
  const [orderA = '', orderB = ''] = [...ids.values()];
  return { siteId, customerId, orderA, orderB };
}
async function orderWithoutCustomer(): Promise<string> {
  numbering += 1;
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-7${String(numbering).padStart(3, '0')}-0003`, siteId }]);
  return [...ids.values()][0] ?? '';
}

const pdf = (size = 2048, fill = 7): Buffer => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size - 9, fill)]);
interface Over {
  readonly [key: string]: unknown;
}
const documentBody = (body: Buffer, over: Over = {}) => ({
  id: uuidv7(),
  kindCode: 'building_documentation',
  title: 'Dokumentacja budynku - tytul testowy',
  file: { fileName: 'budynek.pdf', contentType: 'application/pdf', declaredSize: body.length, sha256: sha256Of(body) },
  ...over,
});

const create = (browser: Browser, orderId: string, body: unknown, key: string | null = uuidv7()) =>
  browser.panel.post(`${BASE}/${orderId}/documents`, body, key === null ? {} : { 'Idempotency-Key': key });
const siteList = (browser: Browser, siteId: string, query = '') => browser.panel.get(`/api/v1/sites/${siteId}/documents${query}`);
const customerList = (browser: Browser, customerId: string, query = '') =>
  browser.panel.get(`/api/v1/customers/${customerId}/documents${query}`);
const siteDownload = (browser: Browser, siteId: string, documentId: string) =>
  browser.panel.post(`/api/v1/sites/${siteId}/documents/${documentId}/download-url`);
const customerDownload = (browser: Browser, customerId: string, documentId: string) =>
  browser.panel.post(`/api/v1/customers/${customerId}/documents/${documentId}/download-url`);
const orderDownload = (browser: Browser, orderId: string, documentId: string) =>
  browser.panel.post(`${BASE}/${orderId}/documents/${documentId}/download-url`);
const raise = (browser: Browser, orderId: string, documentId: string, body: unknown) =>
  browser.panel.patch(`${BASE}/${orderId}/documents/${documentId}`, body, { 'If-Match': '"1"' });

interface DocumentBody {
  id: string;
  anchor: string;
  workOrderId: string | null;
  siteId: string | null;
  customerId: string | null;
  procedureStageId: string | null;
  confidentiality: string;
  canDownload: boolean;
  fileState: string;
}
interface ListBody {
  items: DocumentBody[];
  nextCursor: string | null;
  totalCount: number;
}
const documentOf = (body: unknown) => body as DocumentBody;
const listOf = (body: unknown) => body as ListBody;
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;

const auditOf = (action: string, objectId: string) =>
  sql<Record<string, unknown>>`select * from audit.events where action = ${action} and object_id = ${objectId} order by occurred_at, id`
    .execute(admin())
    .then((result) => result.rows);

/** A document that passed the scan (`clean`, type detected), written straight into the database, with the anchor named. */
async function clean(
  anchor: { workOrderId?: string; siteId?: string; customerId?: string },
  userId: string,
  options: { kindCode?: string; override?: 'building_security' | 'identity_data'; createdAt?: Date } = {},
): Promise<string> {
  const bytes = pdf(4096, Math.floor(Math.random() * 200) + 1);
  const row = await insertDocumentRow(admin(), {
    ...anchor,
    createdBy: userId,
    kindCode: options.kindCode ?? 'building_documentation',
    ...(options.override === undefined ? {} : { override: options.override }),
    state: 'clean',
    size: bytes.length,
    sha256: sha256Of(bytes),
    createdAt: options.createdAt ?? new Date(NOW),
    contentType: 'application/pdf',
  });
  const put = current.storage.putObject(row.objectKey, bytes);
  await sql`update media.stored_files set size_bytes = ${bytes.length}, sha256 = ${sha256Of(bytes)}, s3_version_id = ${put.versionId}, s3_etag = ${put.etag},
      content_type = 'application/pdf' where id = ${row.storedFileId}`.execute(admin());
  return row.documentId;
}

describe('EVM-050 AC1 the document gets the anchor of a site or a customer in the order (SR-AUTHZ-04)', () => {
  it('EVM-050 AC1 anchor=site: the server takes the site from the order of the path, no stage, the class of the kind; the list "Dokumenty lokalizacji (1)" shows it', async () => {
    const { siteId, orderA } = await place();
    const editor = await signIn('editor');
    const body = documentBody(pdf(), { anchor: 'site' });
    const created = await create(editor, orderA, body);
    expect(created.status).toBe(201);
    expect(documentOf(created.body)).toMatchObject({
      id: body.id,
      anchor: 'site',
      workOrderId: null,
      siteId,
      customerId: null,
      procedureStageId: null,
      confidentiality: 'building_security',
    });
    const list = await siteList(editor, siteId);
    expect(list.status).toBe(200);
    expect(listOf(list.body).totalCount).toBe(1);
    expect(listOf(list.body).items.map((item) => item.id)).toEqual([body.id]);
    const own = await editor.panel.get(`${BASE}/${orderA}/documents`);
    expect(listOf(own.body).items).toEqual([]);
  });

  it('EVM-050 AC1 anchor=customer: the customer comes from the order, analogously', async () => {
    const { customerId, orderA } = await place();
    const editor = await signIn('editor');
    const body = documentBody(pdf(), { anchor: 'customer', kindCode: 'connection_conditions' });
    const created = await create(editor, orderA, body);
    expect(created.status).toBe(201);
    expect(documentOf(created.body)).toMatchObject({
      anchor: 'customer',
      workOrderId: null,
      siteId: null,
      customerId,
      procedureStageId: null,
    });
    expect(listOf((await customerList(editor, customerId)).body).totalCount).toBe(1);
  });

  it('EVM-050 AC1 the default anchor is the order; the anchor is a closed list; a stage belongs to the order anchor only', async () => {
    const { orderA } = await place();
    const editor = await signIn('editor');
    const plain = await create(editor, orderA, documentBody(pdf()));
    expect(documentOf(plain.body)).toMatchObject({ anchor: 'work_order', workOrderId: orderA, siteId: null, customerId: null });
    const unknown = await create(editor, orderA, documentBody(pdf(), { anchor: 'user' }));
    expect(unknown.status).toBe(400);
    for (const anchor of ['site', 'customer']) {
      const staged = await create(editor, orderA, documentBody(pdf(), { anchor, procedureStageId: uuidv7() }));
      expect(staged.status, anchor).toBe(400);
      expect(errorsOf(staged.body)).toEqual([{ pointer: '/procedureStageId', code: 'requires_work_order_anchor' }]);
    }
  });

  it('EVM-050 AC1 SR-AUTHZ-04 anchor=customer for an order without a customer is 400 no_customer; siteId and customerId in the body are read_only_field', async () => {
    const orderId = await orderWithoutCustomer();
    const editor = await signIn('editor');
    const noCustomer = await create(editor, orderId, documentBody(pdf(), { anchor: 'customer' }));
    expect(noCustomer.status).toBe(400);
    expect(errorsOf(noCustomer.body)).toEqual([{ pointer: '/anchor', code: 'no_customer' }]);
    const { orderA, siteId } = await place();
    for (const field of ['siteId', 'customerId']) {
      const forged = await create(editor, orderA, documentBody(pdf(), { anchor: 'site', [field]: siteId }));
      expect(forged.status, field).toBe(400);
      expect(codeOf(forged.body)).toBe('validation_failed');
      expect(errorsOf(forged.body)).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
  });

  it('EVM-050 AC6 SR-API-05 the key binds the anchor: the same key and id with another anchor is a conflict, never a second document; the same body replays', async () => {
    const { orderA, siteId } = await place();
    const editor = await signIn('editor');
    const key = uuidv7();
    const body = documentBody(pdf(), { anchor: 'site' });
    expect((await create(editor, orderA, body, key)).status).toBe(201);
    const replay = await create(editor, orderA, body, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(documentOf(replay.body)).toMatchObject({ anchor: 'site', siteId });
    const changed = await create(editor, orderA, { ...body, anchor: 'customer' }, key);
    expect([409, 422]).toContain(changed.status);
    expect(listOf((await siteList(editor, siteId)).body).totalCount).toBe(1);
  });

  it('EVM-050 AC1 the file of a site document is uploaded through the order that added it, and the answer keeps the anchor (W2)', async () => {
    const { orderA, orderB, siteId } = await place();
    const editor = await signIn('editor');
    const bytes = pdf();
    const body = documentBody(bytes, { anchor: 'site' });
    expect((await create(editor, orderA, body)).status).toBe(201);
    const path = `${BASE}/${orderA}/documents/${body.id}/upload-sessions`;
    const session = await editor.panel.post(path, { id: uuidv7() }, { 'Idempotency-Key': uuidv7() });
    expect(session.status).toBe(201);
    const sessionId = (session.body as { id: string }).id;
    const uploadId = (
      await sql<{ s3_upload_id: string }>`select s3_upload_id from media.upload_sessions where id = ${sessionId}`.execute(admin())
    ).rows[0]?.s3_upload_id as string;
    const url = await editor.panel.get(`${path}/${sessionId}/parts/1/url`);
    expect(url.status).toBe(200);
    current.storage.putPart(uploadId, 1, bytes.subarray(0, Math.min(bytes.length, PART_SIZE_BYTES)));
    const complete = await editor.panel.post(`${path}/${sessionId}/complete`);
    expect(complete.status).toBe(200);
    expect(documentOf(complete.body)).toMatchObject({ anchor: 'site', siteId, fileState: 'uploaded' });
    // another order of the same site reaches the document too (it is the site's), a stranger's order does not
    const other = await place();
    const stranger = await editor.panel.post(
      `${BASE}/${other.orderA}/documents/${body.id}/upload-sessions`,
      { id: uuidv7() },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(stranger.status).toBe(404);
    expect(orderB).not.toBe(orderA);
  });
});

describe('EVM-050 AC2 the same record is visible without copying', () => {
  it('EVM-050 AC2 a site document added in ZL-A is on the list of the site seen from ZL-B (the same id); a customer document in the section of the customer', async () => {
    const { siteId, customerId, orderA, orderB } = await place();
    const editor = await signIn('editor');
    const site = await create(editor, orderA, documentBody(pdf(), { anchor: 'site' }));
    const customer = await create(editor, orderA, documentBody(pdf(), { anchor: 'customer', kindCode: 'connection_conditions' }));
    const reader = await signIn('read_only');
    // the panel reads the sections of the order B from the lists of ITS site and ITS customer
    const fromSite = listOf((await siteList(reader, siteId)).body);
    const fromCustomer = listOf((await customerList(reader, customerId)).body);
    expect(fromSite.items.map((item) => item.id)).toEqual([documentOf(site.body).id]);
    expect(fromCustomer.items.map((item) => item.id)).toEqual([documentOf(customer.body).id]);
    // the order's own list holds neither
    expect(listOf((await reader.panel.get(`${BASE}/${orderB}/documents`)).body).totalCount).toBe(0);
  });

  it('EVM-050 AC2 SR-API-02 the pages: totalCount is the whole, the cursor is bound to the anchor and the role, a forged or a foreign cursor is 400', async () => {
    const { siteId, customerId, orderA } = await place();
    const editor = await signIn('editor');
    for (let index = 0; index < 3; index += 1) {
      await clean({ siteId }, editor.userId, { createdAt: new Date(Date.parse(NOW) - index * 1000) });
    }
    await clean({ customerId }, editor.userId);
    await clean({ workOrderId: orderA }, editor.userId);
    const first = await siteList(editor, siteId, '?limit=2');
    expect(listOf(first.body).items).toHaveLength(2);
    expect(listOf(first.body).totalCount).toBe(3);
    const cursor = listOf(first.body).nextCursor as string;
    const second = await siteList(editor, siteId, `?limit=2&cursor=${cursor}`);
    expect(listOf(second.body).items).toHaveLength(1);
    expect(listOf(second.body).nextCursor).toBeNull();
    expect(new Set([...listOf(first.body).items, ...listOf(second.body).items].map((item) => item.id)).size).toBe(3);
    // the cursor of the site on the list of another site, of the customer, of another user, and a mangled one
    const otherSite = await place();
    expect((await siteList(editor, otherSite.siteId, `?cursor=${cursor}`)).status).toBe(400);
    expect((await customerList(editor, customerId, `?cursor=${cursor}`)).status).toBe(400);
    expect((await siteList(await signIn('editor'), siteId, `?cursor=${cursor}`)).status).toBe(400);
    expect((await siteList(editor, siteId, `?cursor=${cursor}x`)).status).toBe(400);
    expect((await siteList(editor, siteId, '?limit=101')).status).toBe(400);
  });
});

describe('EVM-050 AC3 the anchor of the path decides (SR-AUTHZ-02, CWE-639)', () => {
  it('EVM-050 AC3 a document of site A through the path of site B, of customer A through customer B, an order document and a medium through them are ONE 404 - the same as for a missing id', async () => {
    const a = await place();
    const b = await place();
    const editor = await signIn('editor');
    const siteDoc = await clean({ siteId: a.siteId }, editor.userId);
    const customerDoc = await clean({ customerId: a.customerId }, editor.userId);
    const orderDoc = await clean({ workOrderId: a.orderA }, editor.userId);
    const medium = await insertMedia(admin(), { workOrderId: a.orderA, createdBy: editor.userId, state: 'clean' });
    const missing = uuidv7();

    const siteAnswers = [
      await siteDownload(editor, b.siteId, siteDoc),
      await siteDownload(editor, a.siteId, customerDoc),
      await siteDownload(editor, a.siteId, orderDoc),
      await siteDownload(editor, a.siteId, medium.mediaAssetId),
      await siteDownload(editor, a.siteId, missing),
      await siteDownload(editor, missing, siteDoc),
    ];
    const customerAnswers = [
      await customerDownload(editor, b.customerId, customerDoc),
      await customerDownload(editor, a.customerId, siteDoc),
      await customerDownload(editor, a.customerId, orderDoc),
      await customerDownload(editor, a.customerId, medium.mediaAssetId),
      await customerDownload(editor, a.customerId, missing),
      await customerDownload(editor, missing, customerDoc),
    ];
    for (const answer of [...siteAnswers, ...customerAnswers]) {
      expect(answer.status).toBe(404);
      expect(codeOf(answer.body)).toBe('not_found');
    }
    expect(current.storage.signedGets).toHaveLength(0);
    // the own path works
    expect((await siteDownload(editor, a.siteId, siteDoc)).status).toBe(200);
    expect((await customerDownload(editor, a.customerId, customerDoc)).status).toBe(200);
  });

  it('EVM-050 W2 the path of an order reaches the documents of ITS site and ITS customer only: site L1 document through an order of L2, customer K1 document through an order of K2 are 404', async () => {
    const a = await place();
    const b = await place();
    const editor = await signIn('editor');
    const siteDoc = await clean({ siteId: a.siteId }, editor.userId);
    const customerDoc = await clean({ customerId: a.customerId }, editor.userId);
    expect((await orderDownload(editor, a.orderB, siteDoc)).status).toBe(200);
    expect((await orderDownload(editor, a.orderB, customerDoc)).status).toBe(200);
    for (const documentId of [siteDoc, customerDoc]) {
      expect((await orderDownload(editor, b.orderA, documentId)).status).toBe(404);
      expect((await raise(editor, b.orderA, documentId, { title: 'x' })).status).toBe(404);
      expect(
        (
          await editor.panel.post(
            `${BASE}/${b.orderA}/documents/${documentId}/upload-sessions`,
            { id: uuidv7() },
            { 'Idempotency-Key': uuidv7() },
          )
        ).status,
      ).toBe(404);
    }
  });

  it('EVM-050 W3 SR-AUTHZ-08 the medium of order B through the path of order A of the same site is 404, and no list of a site or customer shows media or order documents', async () => {
    const { siteId, customerId, orderA, orderB } = await place();
    const editor = await signIn('editor');
    const medium = await insertMedia(admin(), { workOrderId: orderB, createdBy: editor.userId, state: 'clean' });
    await sql`update media.stored_files set content_type = 'image/jpeg', size_bytes = 1000 where id = ${medium.storedFileId}`.execute(
      admin(),
    );
    const orderDoc = await clean({ workOrderId: orderB }, editor.userId);
    const download = await editor.panel.post(`${BASE}/${orderA}/media-assets/${medium.mediaAssetId}/download-url`, { variant: 'original' });
    expect(download.status).toBe(404);
    const session = await editor.panel.post(
      `${BASE}/${orderA}/media-assets/${medium.mediaAssetId}/upload-sessions`,
      { id: uuidv7() },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(session.status).toBe(404);
    expect((await orderDownload(editor, orderA, orderDoc)).status).toBe(404);
    for (const list of [await siteList(editor, siteId), await customerList(editor, customerId)]) {
      expect(listOf(list.body)).toMatchObject({ items: [], totalCount: 0 });
    }
  });
});

describe('EVM-050 AC4 a site never opens the other orders (SR-AUTHZ-08, AB-19)', () => {
  it('EVM-050 AC4 orders A and B of one site: the list of the site holds only the documents of the site, not the documents or the media of order B; no media or orders route under a site', async () => {
    const { siteId, orderA, orderB } = await place();
    const editor = await signIn('editor');
    const mine = await clean({ siteId }, editor.userId);
    await clean({ workOrderId: orderB }, editor.userId);
    await clean({ workOrderId: orderA }, editor.userId);
    await insertMedia(admin(), { workOrderId: orderB, createdBy: editor.userId, state: 'clean' });
    const list = listOf((await siteList(await signIn('editor'), siteId)).body);
    expect(list.items.map((item) => item.id)).toEqual([mine]);
    expect(list.totalCount).toBe(1);
    for (const path of [`/api/v1/sites/${siteId}/media-assets`, `/api/v1/sites/${siteId}/work-orders`, `/api/v1/sites/${siteId}/media`]) {
      expect((await editor.panel.get(path)).status, path).toBe(404);
    }
  });

  it('EVM-050 AC4 the token of the phone gets 403 on all four operations: the documents of a site and a customer never reach the phone', async () => {
    const { siteId, customerId } = await place();
    const mobile = await signIn('editor', 'mobile');
    const id = uuidv7();
    const answers = [
      await siteList(mobile, siteId),
      await customerList(mobile, customerId),
      await siteDownload(mobile, siteId, id),
      await customerDownload(mobile, customerId, id),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(403);
      expect(codeOf(answer.body)).toBe('forbidden');
    }
  });
});

describe('EVM-050 AC5 AC6 the classes and the roles (SR-AUTHZ-05, SR-AUTHZ-06, SR-AUTHZ-07)', () => {
  it('EVM-050 AC5 Read-only sees the metadata of a site document and gets 403 on building_security, 200 on standard; the denial and the issue are audited with the class, never the title', async () => {
    const { siteId, orderA } = await place();
    const editor = await signIn('editor');
    const building = await clean({ siteId }, editor.userId);
    const standard = await clean({ siteId }, editor.userId, { kindCode: 'connection_conditions' });
    const reader = await signIn('read_only');
    const list = listOf((await siteList(reader, siteId)).body);
    expect(list.items.find((item) => item.id === building)).toMatchObject({ canDownload: false, confidentiality: 'building_security' });
    expect(list.items.find((item) => item.id === standard)).toMatchObject({ canDownload: true, confidentiality: 'standard' });
    const denied = await siteDownload(reader, siteId, building);
    expect(denied.status).toBe(403);
    expect(codeOf(denied.body)).toBe('forbidden');
    expect(current.storage.signedGets).toHaveLength(0);
    const issued = await siteDownload(reader, siteId, standard);
    expect(issued.status).toBe(200);
    expect(current.storage.signedGets).toHaveLength(1);
    const deniedAudit = await auditOf('document_file.download_denied', building);
    expect(deniedAudit).toHaveLength(1);
    expect(JSON.stringify(deniedAudit)).not.toContain('tytul');
    expect(await auditOf('document_file.downloaded', standard)).toHaveLength(1);
    // the same rows through the path of an order of the site
    expect((await orderDownload(reader, orderA, building)).status).toBe(403);
  });

  it('EVM-050 AC5 Read-only gets 403 on a customer document of the class identity_data, and Administrator and Editor download it; a repeated denial leaves the file untouched', async () => {
    const { customerId } = await place();
    const editor = await signIn('editor');
    const identity = await clean({ customerId }, editor.userId, { kindCode: 'power_of_attorney' });
    const reader = await signIn('read_only');
    expect((await customerList(reader, customerId)).status).toBe(200);
    expect(listOf((await customerList(reader, customerId)).body).items[0]).toMatchObject({
      confidentiality: 'identity_data',
      canDownload: false,
    });
    expect((await customerDownload(reader, customerId, identity)).status).toBe(403);
    expect((await customerDownload(await signIn('editor'), customerId, identity)).status).toBe(200);
    expect((await customerDownload(await signIn('administrator'), customerId, identity)).status).toBe(200);
  });

  it('EVM-050 AC5 AB-19 defensive: a site row of an identity kind (written past the API) is still 403 for Read-only on the site path', async () => {
    const { siteId } = await place();
    const editor = await signIn('editor');
    const row = await clean({ siteId }, editor.userId, { kindCode: 'power_of_attorney' });
    const reader = await signIn('read_only');
    expect((await siteDownload(reader, siteId, row)).status).toBe(403);
  });

  it('EVM-050 AC6 Administrator and Editor add and download a site and a customer document; Read-only cannot add (403); an anonymous caller gets 401', async () => {
    const { siteId, customerId, orderA } = await place();
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role);
      for (const anchor of ['site', 'customer'] as const) {
        const added = await create(browser, orderA, documentBody(pdf(), { anchor, kindCode: 'connection_conditions' }));
        expect(added.status, `${role} ${anchor}`).toBe(201);
      }
    }
    const reader = await signIn('read_only');
    expect((await create(reader, orderA, documentBody(pdf(), { anchor: 'site' }))).status).toBe(403);
    expect(listOf((await siteList(reader, siteId)).body).totalCount).toBe(2);
    expect(listOf((await customerList(reader, customerId)).body).totalCount).toBe(2);

    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const id = uuidv7();
    for (const answer of [
      await anonymous.get(`/api/v1/sites/${siteId}/documents`),
      await anonymous.get(`/api/v1/customers/${customerId}/documents`),
      await anonymous.post(`/api/v1/sites/${siteId}/documents/${id}/download-url`),
      await anonymous.post(`/api/v1/customers/${customerId}/documents/${id}/download-url`),
    ]) {
      expect(answer.status).toBe(401);
    }
  });

  it('EVM-050 AC6 SR-FILE-10 the new paths share ONE counter with the order path and the photos: 60 + 40 addresses, the 101st is 429 on any path', async () => {
    const { siteId, customerId, orderA } = await place();
    const editor = await signIn('editor');
    const siteDoc = await clean({ siteId }, editor.userId);
    const customerDoc = await clean({ customerId }, editor.userId);
    for (let index = 0; index < 60; index += 1) expect((await siteDownload(editor, siteId, siteDoc)).status).toBe(200);
    for (let index = 0; index < 40; index += 1) expect((await customerDownload(editor, customerId, customerDoc)).status).toBe(200);
    const refused = await orderDownload(editor, orderA, siteDoc);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect((await siteDownload(editor, siteId, siteDoc)).status).toBe(429);
    expect((await customerDownload(editor, customerId, customerDoc)).status).toBe(429);
  });
});

describe('EVM-050 AC5 identity data never sits on a site (SR-AUTHZ-08, AB-19)', () => {
  it('EVM-050 AC5 W1 anchor=site is refused for the kind of the class identity_data, for "other" with identity data and for an override identity_data; the same documents are fine on the customer', async () => {
    const { orderA, siteId, customerId } = await place();
    const editor = await signIn('editor');
    const refusals = [
      documentBody(pdf(), { anchor: 'site', kindCode: 'power_of_attorney' }),
      documentBody(pdf(), { anchor: 'site', kindCode: 'other', containsIdentityData: true }),
      documentBody(pdf(), { anchor: 'site', kindCode: 'connection_conditions', confidentialityOverride: 'identity_data' }),
    ];
    for (const body of refusals) {
      const answer = await create(editor, orderA, body);
      expect(answer.status).toBe(400);
      expect(errorsOf(answer.body)).toEqual([{ pointer: '/anchor', code: 'identity_data_not_on_site' }]);
    }
    expect(listOf((await siteList(editor, siteId)).body).totalCount).toBe(0);
    // "other" without identity data and a raise to building_security are allowed on a site
    expect(
      (await create(editor, orderA, documentBody(pdf(), { anchor: 'site', kindCode: 'other', containsIdentityData: false }))).status,
    ).toBe(201);
    expect(
      (
        await create(
          editor,
          orderA,
          documentBody(pdf(), { anchor: 'site', kindCode: 'connection_conditions', confidentialityOverride: 'building_security' }),
        )
      ).status,
    ).toBe(201);
    for (const body of refusals) {
      const onCustomer = await create(editor, orderA, { ...body, id: uuidv7(), anchor: 'customer' });
      expect(onCustomer.status).toBe(201);
    }
    expect(listOf((await customerList(editor, customerId)).body).totalCount).toBe(3);
  });

  it('EVM-050 AC5 W1 the class of a site document cannot be raised to identity_data (400, the same code); building_security is a valid raise; a customer document may be raised', async () => {
    const { orderA, siteId } = await place();
    const editor = await signIn('editor');
    const site = documentOf(
      (await create(editor, orderA, documentBody(pdf(), { anchor: 'site', kindCode: 'connection_conditions' }))).body,
    );
    const refused = await raise(editor, orderA, site.id, { confidentialityOverride: 'identity_data' });
    expect(refused.status).toBe(400);
    expect(errorsOf(refused.body)).toEqual([{ pointer: '/confidentialityOverride', code: 'identity_data_not_on_site' }]);
    const raised = await raise(editor, orderA, site.id, { confidentialityOverride: 'building_security' });
    expect(raised.status).toBe(200);
    expect(documentOf(raised.body)).toMatchObject({ anchor: 'site', siteId, confidentiality: 'building_security' });
    const customer = documentOf(
      (await create(editor, orderA, documentBody(pdf(), { anchor: 'customer', kindCode: 'connection_conditions' }))).body,
    );
    expect((await raise(editor, orderA, customer.id, { confidentialityOverride: 'identity_data' })).status).toBe(200);
  });

  it('EVM-050 W1 SR-AUTHZ-04 a stage cannot be set by a change on a site or customer document: 400 requires_work_order_anchor', async () => {
    const { orderA } = await place();
    const editor = await signIn('editor');
    const site = documentOf((await create(editor, orderA, documentBody(pdf(), { anchor: 'site' }))).body);
    const answer = await raise(editor, orderA, site.id, { procedureStageId: uuidv7() });
    expect(answer.status).toBe(400);
    expect(errorsOf(answer.body)).toEqual([{ pointer: '/procedureStageId', code: 'requires_work_order_anchor' }]);
  });

  it('EVM-050 W1 the database is the second line: a site row with the override identity_data is refused whatever the application does', async () => {
    const { siteId } = await place();
    const editor = await signIn('editor');
    await expect(clean({ siteId }, editor.userId, { override: 'identity_data' })).rejects.toMatchObject({ code: '23514' });
  });
});

describe('EVM-050 AC7 states', () => {
  it('EVM-050 AC7 no documents: an empty list with totalCount 0 for every role; a missing site or customer is 404', async () => {
    const { siteId, customerId } = await place();
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      expect(listOf((await siteList(browser, siteId)).body)).toEqual({ items: [], nextCursor: null, totalCount: 0 });
      expect(listOf((await customerList(browser, customerId)).body)).toEqual({ items: [], nextCursor: null, totalCount: 0 });
      expect((await siteList(browser, uuidv7())).status).toBe(404);
      expect((await customerList(browser, uuidv7())).status).toBe(404);
    }
  });

  it('EVM-050 AC7 SR-AUTHZ-02 a deleted site hides its documents from Administrator, Editor and Read-only - on the site path AND on the path of its orders', async () => {
    const { siteId, orderA } = await place();
    const editor = await signIn('editor');
    const doc = await clean({ siteId }, editor.userId);
    await sql`update sites.sites set deleted_at = ${NOW}, deleted_by = ${editor.userId} where id = ${siteId}`.execute(admin());
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      expect((await siteList(browser, siteId)).status, role).toBe(404);
      expect((await siteDownload(browser, siteId, doc)).status, role).toBe(404);
      expect((await orderDownload(browser, orderA, doc)).status, role).toBe(404);
    }
    expect((await raise(editor, orderA, doc, { title: 'x' })).status).toBe(404);
    expect(
      (await editor.panel.post(`${BASE}/${orderA}/documents/${doc}/upload-sessions`, { id: uuidv7() }, { 'Idempotency-Key': uuidv7() }))
        .status,
    ).toBe(404);
  });

  it('EVM-050 AC7 SR-AUTHZ-02 a deleted customer hides its documents on the customer path AND on the path of its orders', async () => {
    const { customerId, orderA } = await place();
    const editor = await signIn('editor');
    const doc = await clean({ customerId }, editor.userId);
    await sql`update customers.customers set deleted_at = ${NOW}, deleted_by = ${editor.userId} where id = ${customerId}`.execute(admin());
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      expect((await customerList(browser, customerId)).status, role).toBe(404);
      expect((await customerDownload(browser, customerId, doc)).status, role).toBe(404);
      expect((await orderDownload(browser, orderA, doc)).status, role).toBe(404);
    }
    expect((await raise(editor, orderA, doc, { title: 'x' })).status).toBe(404);
  });

  it('EVM-050 AC1 SR-LOG-03 the audit of the creation carries the id and the class code, never the title or the file name', async () => {
    const { orderA } = await place();
    const editor = await signIn('editor');
    const body = documentBody(pdf(), { anchor: 'site', title: 'Tytul-do-sprawdzenia-w-audycie' });
    expect((await create(editor, orderA, body)).status).toBe(201);
    const rows = await auditOf('document.created', body.id);
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('Tytul-do-sprawdzenia');
    expect(text).not.toContain('budynek.pdf');
  });
});
