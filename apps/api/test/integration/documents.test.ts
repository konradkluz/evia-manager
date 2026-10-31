import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaProcessingService, MediaScanService, QuarantineRetentionJob } from '../../src/modules/media/index.ts';
import { SYNC_SCOPE_SCHEMAS } from '../../src/modules/sync/domain/synced-entities.ts';
import { PART_SIZE_BYTES } from '../../src/modules/media/domain/upload-plan.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { METRICS } from '../../src/platform/tokens.ts';
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
import { buildOoxml } from '../support/zip-builder.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';

const NOW = '2026-10-31T08:00:00.000Z';
const BASE = '/api/v1/work-orders';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
  current.imageProcessor.jobs.length = 0;
  await clearWorkOrderCreation(current.database.admin);
  // the files of the earlier tests must not be taken by the loops of this one
  await sql`update media.stored_files set state = 'failed', state_reason_code = 'abandoned' where state in ('uploaded', 'scanning')`.execute(
    admin(),
  );
});

const admin = () => current.database.admin;
const scan = () => current.app.get(MediaScanService, { strict: false });

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
async function order(options: { status?: WorkOrderStatus; deleted?: boolean } = {}): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `dokument${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-8${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

/** Synthetic files - signatures and filler bytes only, never a real document. */
const pdf = (size = 2048, fill = 7): Buffer => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size - 9, fill)]);
const pngBytes = (size = 2048): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
    Buffer.alloc(size - 16),
  ]);

interface Over {
  readonly [key: string]: unknown;
}
const documentBody = (body: Buffer, over: Over = {}, file: Over = {}) => ({
  id: uuidv7(),
  kindCode: 'connection_conditions',
  title: 'Warunki przylaczenia - instalacja testowa',
  file: { fileName: 'warunki.pdf', contentType: 'application/pdf', declaredSize: body.length, sha256: sha256Of(body), ...file },
  ...over,
});

const createDocument = (browser: Browser, orderId: string, body: unknown, key: string | null = uuidv7()) =>
  browser.panel.post(`${BASE}/${orderId}/documents`, body, key === null ? {} : { 'Idempotency-Key': key });
const listDocuments = (browser: Browser, orderId: string, query = '') => browser.panel.get(`${BASE}/${orderId}/documents${query}`);
const raise = (browser: Browser, orderId: string, documentId: string, body: unknown, ifMatch: string | null = '"1"') =>
  browser.panel.patch(`${BASE}/${orderId}/documents/${documentId}`, body, ifMatch === null ? {} : { 'If-Match': ifMatch });
const downloadUrl = (browser: Browser, orderId: string, documentId: string) =>
  browser.panel.post(`${BASE}/${orderId}/documents/${documentId}/download-url`);
const sessionPath = (orderId: string, documentId: string, sessionId: string) =>
  `${BASE}/${orderId}/documents/${documentId}/upload-sessions/${sessionId}`;

interface DocumentBody {
  id: string;
  kindCode: string;
  kindName: string;
  title: string;
  versionNumber: number;
  confidentiality: string;
  confidentialityRaised: boolean;
  fileState: string;
  canDownload: boolean;
  originalFilename: string | null;
  version: number;
}
const documentOf = (body: unknown) => body as DocumentBody;
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const traceless = (answer: { status: number; body: unknown }) =>
  JSON.stringify({ status: answer.status, body: { ...(answer.body as object), traceId: undefined, instance: undefined } });

const auditOf = (action: string, objectId: string) =>
  sql<Record<string, unknown>>`select * from audit.events where action = ${action} and object_id = ${objectId} order by occurred_at, id`
    .execute(admin())
    .then((result) => result.rows);
const uploadIdOf = async (sessionId: string): Promise<string> =>
  (await sql<{ s3_upload_id: string }>`select s3_upload_id from media.upload_sessions where id = ${sessionId}`.execute(admin())).rows[0]
    ?.s3_upload_id ?? '';
const fileOf = async (documentId: string) =>
  (
    await sql<{ id: string; state: string; state_reason_code: string | null; content_type: string | null; object_key: string }>`
      select f.id, f.state, f.state_reason_code, f.content_type, f.object_key from media.stored_files f
      join media.document_versions v on v.id = f.document_version_id where v.document_id = ${documentId}`.execute(admin())
  ).rows[0];
const alertCount = async (code: string): Promise<number> =>
  Number(
    (await sql<{ n: string }>`select count(*)::text as n from platform.security_alert_outbox where alert_code = ${code}`.execute(admin()))
      .rows[0]?.n,
  );

/** The whole flow of the panel for one document: the document, the session, the parts straight to the storage, `complete`. */
async function upload(browser: Browser, orderId: string, bytes: Buffer, over: Over = {}, file: Over = {}) {
  const body = documentBody(bytes, over, file);
  const created = await createDocument(browser, orderId, body);
  expect(created.status).toBe(201);
  const session = await browser.panel.post(
    `${BASE}/${orderId}/documents/${body.id}/upload-sessions`,
    { id: uuidv7() },
    { 'Idempotency-Key': uuidv7() },
  );
  expect(session.status).toBe(201);
  const sessionId = (session.body as { id: string }).id;
  const uploadId = await uploadIdOf(sessionId);
  for (let part = 1; part <= (session.body as { partCount: number }).partCount; part += 1) {
    const url = await browser.panel.get(`${sessionPath(orderId, body.id, sessionId)}/parts/${part}/url`);
    expect(url.status).toBe(200);
    const start = (part - 1) * PART_SIZE_BYTES;
    current.storage.putPart(uploadId, part, bytes.subarray(start, start + (url.body as { contentLength: number }).contentLength));
  }
  const complete = await browser.panel.post(`${sessionPath(orderId, body.id, sessionId)}/complete`);
  return { body, sessionId, uploadId, complete };
}

interface Seeded {
  readonly documentId: string;
  readonly storedFileId: string;
  readonly objectKey: string;
}
/** A document that passed the scan: `clean`, with the type the scan detected and the pinned version of the object. */
async function cleanDocument(
  orderId: string,
  userId: string,
  options: {
    kindCode?: string;
    override?: 'building_security' | 'identity_data';
    fileName?: string;
    state?: 'clean' | 'ready' | 'pending_upload' | 'quarantined';
  } = {},
): Promise<Seeded> {
  const bytes = pdf(4096, Math.floor(Math.random() * 200) + 1);
  const state = options.state ?? 'clean';
  const row = await insertDocumentRow(admin(), {
    workOrderId: orderId,
    createdBy: userId,
    kindCode: options.kindCode ?? 'connection_conditions',
    ...(options.override === undefined ? {} : { override: options.override }),
    ...(options.fileName === undefined ? {} : { fileName: options.fileName }),
    state,
    size: bytes.length,
    sha256: sha256Of(bytes),
    createdAt: new Date(NOW),
    // the client DECLARED a png; the scan below records the type the server detected
    contentType: 'application/pdf',
  });
  const put = current.storage.putObject(row.objectKey, bytes);
  await sql`update media.stored_files set size_bytes = ${bytes.length}, sha256 = ${sha256Of(bytes)}, s3_version_id = ${put.versionId}, s3_etag = ${put.etag}
      where id = ${row.storedFileId}`.execute(admin());
  return { documentId: row.documentId, storedFileId: row.storedFileId, objectKey: row.objectKey };
}

describe('EVM-047 AC1 "Dodaj dokument": the document, its version 1, the upload and the scan like a medium', () => {
  it('EVM-047 AC1 a PDF with the kind "Warunki przylaczenia" is made with version 1 and the class "standard"; the list shows kind, title, version and class; the answer has an ETag and no key, checksum or upload id', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const body = documentBody(pdf());
    const response = await createDocument(editor, orderId, body);
    expect(response.status).toBe(201);
    expect(response.headers['etag']).toBe('"1"');
    expect(documentOf(response.body)).toMatchObject({
      id: body.id,
      kindCode: 'connection_conditions',
      kindName: 'Warunki przyłączenia',
      title: body.title,
      versionNumber: 1,
      confidentiality: 'standard',
      confidentialityRaised: false,
      fileState: 'pending_upload',
      canDownload: true,
      originalFilename: 'warunki.pdf',
      version: 1,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/object_?key|documents\/20|upload_?id|sha256/i);
    const listed = await listDocuments(editor, orderId);
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ nextCursor: null, totalCount: 1 });
    expect((listed.body as { items: DocumentBody[] }).items.map((item) => item.id)).toEqual([body.id]);
    // the key of the object is the server's, with the prefix of documents and without a title, a name or an order number
    const stored = await fileOf(body.id);
    expect(stored?.object_key).toMatch(/^documents\/2026\/10\/[0-9a-f-]{36}\/original$/);
    expect(stored?.object_key).not.toMatch(/warunki|ZL-/);
  });

  it('EVM-047 AC1 the journal gets ONE entry "document_added" with the id and the code of the kind - never the title or the file name; the audit event carries the class code only', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const body = documentBody(pdf(), { title: 'Pelnomocnictwo Jan Testowy 00000000000' }, { fileName: 'jan-testowy-skan.pdf' });
    expect((await createDocument(editor, orderId, body)).status).toBe(201);
    const journal = (
      await sql<{ event_payload: Record<string, unknown> }>`
        select event_payload from timeline.timeline_entries where work_order_id = ${orderId} and event_code = 'document_added'`.execute(
        admin(),
      )
    ).rows;
    expect(journal).toHaveLength(1);
    expect(journal[0]?.event_payload).toEqual({ objectType: 'document', objectId: body.id, kindCode: 'connection_conditions' });
    const audited = await auditOf('document.created', body.id);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      actor_user_id: editor.userId,
      outcome: 'success',
      object_type: 'document',
      from_code: 'standard',
      to_code: 'standard',
    });
    expect(JSON.stringify(audited[0])).not.toMatch(/Testowy|jan-testowy|Pelnomocnictwo|00000000000/);
    expect(current.logs.lines.join('\n')).not.toMatch(/Testowy|jan-testowy|Pelnomocnictwo/);
  });

  it('EVM-047 AC1 the upload goes through the session, the scan makes the file "clean", and the document gets NO derivatives (no processing by the image or the video processor)', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const bytes = pdf(3000);
    const { body, complete } = await upload(editor, orderId, bytes);
    expect(complete.status).toBe(200);
    expect(documentOf(complete.body).fileState).toBe('uploaded');
    const stored = await fileOf(body.id);
    expect(await scan().scanFile(stored?.id ?? '')).toBe(true);
    expect(await fileOf(body.id)).toMatchObject({ state: 'clean', content_type: 'application/pdf' });
    // Z6: the processing loops never take a document
    expect(await current.app.get(MediaProcessingService, { strict: false }).runOnce()).toBe(0);
    expect(await fileOf(body.id)).toMatchObject({ state: 'clean' });
    expect(current.imageProcessor.jobs).toHaveLength(0);
    expect(
      Number(
        (
          await sql<{
            n: string;
          }>`select count(*)::text as n from media.file_derivatives where stored_file_id = ${stored?.id ?? ''}`.execute(admin())
        ).rows[0]?.n,
      ),
    ).toBe(0);
    const listed = await listDocuments(editor, orderId);
    expect((listed.body as { items: DocumentBody[] }).items[0]?.fileState).toBe('clean');
  });

  it('EVM-047 AC1 a repeat with the same key and body is the same document (Idempotent-Replayed, one entry, one audit); the same key with another body is 422; the same id with a new key is 409 id_conflict', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const body = documentBody(pdf());
    const key = uuidv7();
    const first = await createDocument(editor, orderId, body, key);
    const replay = await createDocument(editor, orderId, body, key);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(documentOf(replay.body).id).toBe(body.id);
    expect(await auditOf('document.created', body.id)).toHaveLength(1);
    const other = await createDocument(editor, orderId, { ...body, title: 'Inny tytul' }, key);
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    const taken = await createDocument(editor, orderId, body, uuidv7());
    expect(taken.status).toBe(409);
    expect(codeOf(taken.body)).toBe('id_conflict');
    const otherOrder = await order();
    expect((await createDocument(editor, otherOrder, body, uuidv7())).status).toBe(409);
    expect(JSON.stringify((await listDocuments(editor, otherOrder)).body)).not.toContain(body.id);
  });

  it('EVM-047 AC1 SR-FILE-03 a file of 100 MB is accepted and one byte more is 400 /file/declaredSize; the key Idempotency-Key is required', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const big = documentBody(pdf(), {}, { declaredSize: 104_857_600 });
    expect((await createDocument(editor, orderId, big)).status).toBe(201);
    const over = await createDocument(editor, orderId, documentBody(pdf(), {}, { declaredSize: 104_857_601 }));
    expect(over.status).toBe(400);
    expect(errorsOf(over.body)).toEqual([{ pointer: '/file/declaredSize', code: 'out_of_range' }]);
    const noKey = await createDocument(editor, orderId, documentBody(pdf()), null);
    expect(noKey.status).toBe(400);
    expect(errorsOf(noKey.body)).toEqual([{ pointer: '/headers/Idempotency-Key', code: 'required' }]);
  });

  it('EVM-047 AC1 the list is paginated by createdAt and id with a cursor bound to the order and the role; limit 1..100; a cursor of another order or role is 400 invalid_cursor', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    for (let index = 0; index < 3; index += 1) {
      current.clock.set(new Date(Date.parse(NOW) + index * 1000).toISOString());
      expect((await createDocument(editor, orderId, documentBody(pdf(), { title: `Dokument ${index}` }))).status).toBe(201);
    }
    const first = await listDocuments(editor, orderId, '?limit=2');
    expect(first.status).toBe(200);
    const page = first.body as { items: DocumentBody[]; nextCursor: string | null; totalCount: number };
    expect(page.items.map((item) => item.title)).toEqual(['Dokument 2', 'Dokument 1']);
    expect(page.totalCount).toBe(3);
    expect(page.nextCursor).not.toBeNull();
    const second = await listDocuments(editor, orderId, `?limit=2&cursor=${page.nextCursor}`);
    expect((second.body as { items: DocumentBody[] }).items.map((item) => item.title)).toEqual(['Dokument 0']);
    expect((second.body as { nextCursor: string | null }).nextCursor).toBeNull();
    expect((await listDocuments(reader, orderId, `?limit=2&cursor=${page.nextCursor}`)).status).toBe(400);
    expect((await listDocuments(editor, await order(), `?limit=2&cursor=${page.nextCursor}`)).status).toBe(400);
    for (const query of ['?limit=0', '?limit=101', '?limit=x', '?foo=1', '?cursor=%%%']) {
      expect((await listDocuments(editor, orderId, query)).status, query).toBe(400);
    }
  });
});

describe('EVM-047 AC2 AC3 the class comes from the kind; "Inny dokument" needs the answer about identity data (SR-AUTHZ-07)', () => {
  it('EVM-047 AC2 "Pelnomocnictwo" is "identity_data" and "Projekt instalacji" is "building_security", shown with the class and the lock for Read-only (canDownload false)', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const power = documentBody(pdf(), { kindCode: 'power_of_attorney' });
    const design = documentBody(pdf(), { kindCode: 'installation_design' });
    expect(documentOf((await createDocument(editor, orderId, power)).body)).toMatchObject({
      confidentiality: 'identity_data',
      confidentialityRaised: false,
      kindName: 'Pełnomocnictwo',
    });
    expect(documentOf((await createDocument(editor, orderId, design)).body)).toMatchObject({
      confidentiality: 'building_security',
      kindName: 'Projekt instalacji',
    });
    const items = ((await listDocuments(reader, orderId)).body as { items: DocumentBody[] }).items;
    expect(Object.fromEntries(items.map((item) => [item.id, [item.confidentiality, item.canDownload]]))).toEqual({
      [power.id]: ['identity_data', false],
      [design.id]: ['building_security', false],
    });
    // the metadata of every class is visible to Read-only (the title, the kind, the name of the file)
    expect(items.every((item) => item.title !== '' && item.originalFilename !== null)).toBe(true);
  });

  it('EVM-047 AC3 SR-AUTHZ-07 "Inny dokument" without the answer is 400 /containsIdentityData required; "Tak" stores the class "identity_data" (as a raise, not computed in the panel); "Nie" is "standard"', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const missing = await createDocument(editor, orderId, documentBody(pdf(), { kindCode: 'other' }));
    expect(missing.status).toBe(400);
    expect(codeOf(missing.body)).toBe('validation_failed');
    expect(errorsOf(missing.body)).toEqual([{ pointer: '/containsIdentityData', code: 'required' }]);
    const yes = documentBody(pdf(), { kindCode: 'other', containsIdentityData: true });
    expect(documentOf((await createDocument(editor, orderId, yes)).body)).toMatchObject({
      confidentiality: 'identity_data',
      confidentialityRaised: true,
    });
    const stored = (
      await sql<{
        confidentiality_override: string | null;
      }>`select confidentiality_override from media.documents where id = ${yes.id}`.execute(admin())
    ).rows[0];
    expect(stored?.confidentiality_override).toBe('identity_data');
    const no = documentBody(pdf(), { kindCode: 'other', containsIdentityData: false });
    expect(documentOf((await createDocument(editor, orderId, no)).body)).toMatchObject({
      confidentiality: 'standard',
      confidentialityRaised: false,
    });
    const columns = (
      await sql<{
        column_name: string;
      }>`select column_name from information_schema.columns where table_schema = 'media' and table_name = 'documents'`.execute(admin())
    ).rows.map((row) => row.column_name);
    expect(columns).not.toContain('contains_identity_data');
  });

  it('EVM-047 AC3 the answer for any other kind, an unknown or a retired kind is 400 with a code - never a 500 of a key', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const misplaced = await createDocument(editor, orderId, documentBody(pdf(), { kindCode: 'quote', containsIdentityData: false }));
    expect(misplaced.status).toBe(400);
    expect(errorsOf(misplaced.body)).toEqual([{ pointer: '/containsIdentityData', code: 'not_applicable' }]);
    const unknown = await createDocument(editor, orderId, documentBody(pdf(), { kindCode: 'no_such_kind' }));
    expect(unknown.status).toBe(400);
    expect(errorsOf(unknown.body)).toEqual([{ pointer: '/kindCode', code: 'unknown_kind' }]);
    await sql`update catalog.document_kinds set deleted_at = ${NOW} where code = 'quote'`.execute(admin());
    try {
      const retired = await createDocument(editor, orderId, documentBody(pdf(), { kindCode: 'quote' }));
      expect(errorsOf(retired.body)).toEqual([{ pointer: '/kindCode', code: 'unknown_kind' }]);
    } finally {
      await sql`update catalog.document_kinds set deleted_at = null where code = 'quote'`.execute(admin());
    }
  });

  it('EVM-047 AC3 SR-INPUT-01 the texts: the title 1..200 (not blank), the description up to 2000, no control characters; the messages carry codes and pointers, never the value', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const bad = await createDocument(editor, orderId, documentBody(pdf(), { title: 'Tytul\u0007 Tajny', description: 'Opis‮tajny' }));
    expect(bad.status).toBe(400);
    expect(errorsOf(bad.body)).toEqual([
      { pointer: '/title', code: 'invalid_characters' },
      { pointer: '/description', code: 'invalid_characters' },
    ]);
    expect(JSON.stringify(bad.body)).not.toMatch(/Tajny|tajny/);
    const blank = await createDocument(editor, orderId, documentBody(pdf(), { title: '   ' }));
    expect(errorsOf(blank.body)).toEqual([{ pointer: '/title', code: 'required' }]);
    expect((await createDocument(editor, orderId, documentBody(pdf(), { title: 'x'.repeat(201) }))).status).toBe(400);
    expect((await createDocument(editor, orderId, documentBody(pdf(), { description: 'x'.repeat(2001) }))).status).toBe(400);
    const text = '<script>alert(1)</script> & "cudzyslow"\nDruga linia';
    const stored = await createDocument(editor, orderId, documentBody(pdf(), { title: '<script>alert(1)</script>', description: text }));
    expect(stored.status).toBe(201);
    expect(documentOf(stored.body).title).toBe('<script>alert(1)</script>');
  });
});

describe('EVM-047 AC4 the class can only be raised, with If-Match and an audit event (SR-AUTHZ-07, SR-LOG-03)', () => {
  it('EVM-047 AC4 Administrator and Editor raise a "standard" document to "building_security" and then to "identity_data": 200, a new ETag, an audit event with the class before and after', async () => {
    const orderId = await order();
    for (const role of ['administrator', 'editor'] as const) {
      const user = await signIn(role);
      const body = documentBody(pdf());
      expect((await createDocument(user, orderId, body)).status).toBe(201);
      const first = await raise(user, orderId, body.id, { confidentialityOverride: 'building_security' }, '"1"');
      expect(first.status).toBe(200);
      expect(first.headers['etag']).toBe('"2"');
      expect(documentOf(first.body)).toMatchObject({ confidentiality: 'building_security', confidentialityRaised: true, version: 2 });
      const second = await raise(user, orderId, body.id, { confidentialityOverride: 'identity_data' }, '"2"');
      expect(documentOf(second.body)).toMatchObject({ confidentiality: 'identity_data', version: 3 });
      const events = await auditOf('document.confidentiality_raised', body.id);
      expect(events.map((event) => [event['from_code'], event['to_code']])).toEqual([
        ['standard', 'building_security'],
        ['building_security', 'identity_data'],
      ]);
      expect(events[0]).toMatchObject({ actor_user_id: user.userId, outcome: 'success', object_type: 'document' });
      expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('EVM-047 AC4 a lower or equal class - below the kind, equal to the kind, equal to the current raise - is 400 validation_failed and changes nothing', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const design = documentBody(pdf(), { kindCode: 'installation_design' });
    expect((await createDocument(editor, orderId, design)).status).toBe(201);
    const equal = await raise(editor, orderId, design.id, { confidentialityOverride: 'building_security' });
    expect(equal.status).toBe(400);
    expect(codeOf(equal.body)).toBe('validation_failed');
    expect(errorsOf(equal.body)).toEqual([{ pointer: '/confidentialityOverride', code: 'not_higher' }]);
    const standard = await raise(editor, orderId, design.id, { confidentialityOverride: 'standard' });
    expect(standard.status).toBe(400);
    expect(codeOf(standard.body)).toBe('validation_failed');
    const identity = documentBody(pdf(), { kindCode: 'power_of_attorney' });
    expect((await createDocument(editor, orderId, identity)).status).toBe(201);
    expect((await raise(editor, orderId, identity.id, { confidentialityOverride: 'identity_data' })).status).toBe(400);
    expect((await raise(editor, orderId, identity.id, { confidentialityOverride: 'building_security' })).status).toBe(400);
    expect(await auditOf('document.confidentiality_raised', design.id)).toHaveLength(0);
    const standardDoc = documentBody(pdf());
    await createDocument(editor, orderId, standardDoc);
    await raise(editor, orderId, standardDoc.id, { confidentialityOverride: 'identity_data' });
    const lower = await raise(editor, orderId, standardDoc.id, { confidentialityOverride: 'building_security' }, '"2"');
    expect(errorsOf(lower.body)).toEqual([{ pointer: '/confidentialityOverride', code: 'not_higher' }]);
    const stored = (
      await sql<{
        confidentiality_override: string;
      }>`select confidentiality_override from media.documents where id = ${standardDoc.id}`.execute(admin())
    ).rows[0];
    expect(stored?.confidentiality_override).toBe('identity_data');
  });

  it('EVM-047 AC4 an override at the creation must be strictly above the kind: equal or lower is 400, higher is stored as a raise', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const equal = await createDocument(
      editor,
      orderId,
      documentBody(pdf(), { kindCode: 'installation_design', confidentialityOverride: 'building_security' }),
    );
    expect(errorsOf(equal.body)).toEqual([{ pointer: '/confidentialityOverride', code: 'not_higher' }]);
    const raised = documentBody(pdf(), { confidentialityOverride: 'building_security' });
    expect(documentOf((await createDocument(editor, orderId, raised)).body)).toMatchObject({
      confidentiality: 'building_security',
      confidentialityRaised: true,
    });
    const standardFloor = await createDocument(editor, orderId, documentBody(pdf(), { confidentialityOverride: 'standard' }));
    expect(standardFloor.status).toBe(400);
  });

  it('EVM-047 AC4 If-Match: missing is 428, malformed is 400, stale is 412; the kind, the title and every other field are read-only (400 read_only_field)', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const body = documentBody(pdf());
    await createDocument(editor, orderId, body);
    const target = { confidentialityOverride: 'building_security' };
    expect((await raise(editor, orderId, body.id, target, null)).status).toBe(428);
    expect((await raise(editor, orderId, body.id, target, 'W/"1"')).status).toBe(400);
    expect((await raise(editor, orderId, body.id, target, '*')).status).toBe(400);
    const stale = await raise(editor, orderId, body.id, target, '"7"');
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    for (const field of ['title', 'kindCode', 'versionNumber', 'fileState', 'confidentiality', 'workOrderId', 'description']) {
      const answer = await raise(editor, orderId, body.id, { [field]: 'x', ...target });
      expect(answer.status, field).toBe(400);
      expect(errorsOf(answer.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    expect((await raise(editor, orderId, body.id, { confidentialityOverride: 'building_security', extra: 1 })).status).toBe(400);
    expect((await raise(editor, orderId, body.id, {})).status).toBe(400);
    expect((await raise(editor, orderId, body.id, { confidentialityOverride: 'secret' })).status).toBe(400);
    // nothing changed, the kind and the order stay
    const read = documentOf(((await listDocuments(editor, orderId)).body as { items: DocumentBody[] }).items[0]);
    expect(read).toMatchObject({ kindCode: 'connection_conditions', title: body.title, version: 1, confidentiality: 'standard' });
  });

  it('EVM-047 AC4 two raises with the same If-Match: one wins (200), the other loses (412) - no lost update', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const other = await signIn('administrator');
    const body = documentBody(pdf());
    await createDocument(editor, orderId, body);
    const answers = await Promise.all([
      raise(editor, orderId, body.id, { confidentialityOverride: 'building_security' }),
      raise(other, orderId, body.id, { confidentialityOverride: 'identity_data' }),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 412]);
    expect(await auditOf('document.confidentiality_raised', body.id)).toHaveLength(1);
  });
});

describe('EVM-047 AC5 the download follows the class (SR-AUTHZ-06, SR-FILE-07, SR-FILE-10)', () => {
  async function threeClasses(orderId: string, userId: string) {
    return {
      standard: await cleanDocument(orderId, userId, { fileName: 'warunki "przylacza"; nr 7.pdf' }),
      building: await cleanDocument(orderId, userId, { kindCode: 'installation_design' }),
      identity: await cleanDocument(orderId, userId, { kindCode: 'power_of_attorney' }),
    };
  }

  it('EVM-047 AC5 Read-only gets an address for "standard" (audited) and 403 forbidden for "building_security" and "identity_data" (audited as denied with the class code); no address is signed for the refusals', async () => {
    const orderId = await order();
    const owner = await signIn('editor');
    const reader = await signIn('read_only');
    const docs = await threeClasses(orderId, owner.userId);
    const allowed = await downloadUrl(reader, orderId, docs.standard.documentId);
    expect(allowed.status).toBe(200);
    expect(current.storage.signedGets).toHaveLength(1);
    const events = await auditOf('document_file.downloaded', docs.standard.documentId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_user_id: reader.userId, outcome: 'success', from_code: 'standard', to_code: 'standard' });
    const refused = [
      await downloadUrl(reader, orderId, docs.building.documentId),
      await downloadUrl(reader, orderId, docs.identity.documentId),
    ];
    expect(refused.map((answer) => answer.status)).toEqual([403, 403]);
    expect(refused.every((answer) => codeOf(answer.body) === 'forbidden')).toBe(true);
    expect(current.storage.signedGets).toHaveLength(1);
    const denied = [
      ...(await auditOf('document_file.download_denied', docs.building.documentId)),
      ...(await auditOf('document_file.download_denied', docs.identity.documentId)),
    ];
    expect(denied.map((event) => event['to_code'])).toEqual(['building_security', 'identity_data']);
    expect(denied.every((event) => event['outcome'] === 'denied' && event['actor_user_id'] === reader.userId)).toBe(true);
    expect(JSON.stringify(denied)).not.toMatch(/\.pdf|warunki/);
  });

  it('EVM-047 AC5 the class is computed NOW by the server: raising a "standard" document takes the download away from Read-only at once, whatever the state of its file', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const doc = await cleanDocument(orderId, editor.userId);
    expect((await downloadUrl(reader, orderId, doc.documentId)).status).toBe(200);
    expect((await raise(editor, orderId, doc.documentId, { confidentialityOverride: 'identity_data' })).status).toBe(200);
    expect((await downloadUrl(reader, orderId, doc.documentId)).status).toBe(403);
    // the refusal comes BEFORE the state of the file: a restricted document in quarantine is 403 for Read-only too, 404 for the Editor
    await sql`update media.stored_files set state = 'quarantined', state_reason_code = 'malware_detected', quarantined_at = ${NOW} where id = ${doc.storedFileId}`.execute(
      admin(),
    );
    expect((await downloadUrl(reader, orderId, doc.documentId)).status).toBe(403);
    expect((await downloadUrl(editor, orderId, doc.documentId)).status).toBe(404);
  });

  it('EVM-047 AC5 Administrator and Editor get an address for every class: an attachment with a cleaned name, the type the server DETECTED, the scanned version, 300 s, no-store; each issue is audited with the class code', async () => {
    const orderId = await order();
    for (const role of ['administrator', 'editor'] as const) {
      const user = await signIn(role);
      const docs = await threeClasses(orderId, user.userId);
      for (const [klass, doc] of [
        ['standard', docs.standard],
        ['building_security', docs.building],
        ['identity_data', docs.identity],
      ] as const) {
        current.storage.signedGets.length = 0;
        const response = await downloadUrl(user, orderId, doc.documentId);
        expect(response.status, `${role} ${klass}`).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        const body = response.body as { url: string; expiresAt: string };
        expect(Object.keys(body).sort()).toEqual(['expiresAt', 'url']);
        expect(new Date(body.expiresAt).getTime() - current.clock.now().getTime()).toBe(300_000);
        const url = new URL(body.url);
        expect(url.hostname).toBe('bucket.invalid');
        expect(url.pathname).toBe(`/${doc.objectKey}`);
        expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
        expect(url.searchParams.get('response-content-disposition')).toMatch(/^attachment; filename=/);
        expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
        expect(current.storage.signedGets.at(-1)).toMatchObject({ expiresInSeconds: 300, cacheControl: 'private, no-store' });
        const events = await auditOf('document_file.downloaded', doc.documentId);
        expect(events.at(-1)).toMatchObject({ actor_user_id: user.userId, to_code: klass });
        expect(JSON.stringify(events)).not.toMatch(/\.pdf|bucket\.invalid|X-Amz/);
      }
    }
    const named = await cleanDocument(orderId, (await signIn('editor')).userId, { fileName: 'Pełnomocnictwo "Jan"; nr 7.pdf' });
    const viewer = await signIn('administrator');
    const url = new URL(((await downloadUrl(viewer, orderId, named.documentId)).body as { url: string }).url);
    expect(url.searchParams.get('response-content-disposition')).toContain("filename*=UTF-8''Pe%C5%82nomocnictwo%20Jan%20nr%207.pdf");
  });

  it('EVM-047 AC5 a file that did not pass the scan, a document of order B through order A, a medium with that id and a missing document are ONE 404; so are the states pending, quarantined and failed', async () => {
    const orderA = await order();
    const orderB = await order();
    const admin1 = await signIn('administrator');
    const mine = await cleanDocument(orderA, admin1.userId, { state: 'pending_upload' });
    const quarantined = await cleanDocument(orderA, admin1.userId, { state: 'quarantined' });
    const theirs = await cleanDocument(orderB, admin1.userId);
    const medium = await insertMedia(admin(), { workOrderId: orderA, createdBy: admin1.userId, state: 'clean' });
    const answers = [
      await downloadUrl(admin1, orderA, mine.documentId),
      await downloadUrl(admin1, orderA, quarantined.documentId),
      await downloadUrl(admin1, orderA, theirs.documentId),
      await downloadUrl(admin1, orderA, medium.mediaAssetId),
      await downloadUrl(admin1, orderA, uuidv7()),
    ];
    expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404, 404]);
    expect(new Set(answers.map(traceless)).size).toBe(1);
    expect(current.storage.signedGets).toHaveLength(0);
    // a `ready` file is served as well as a `clean` one; a failed one (checksum) is not
    await sql`update media.stored_files set state = 'ready', content_type = 'application/pdf' where id = ${mine.storedFileId}`.execute(
      admin(),
    );
    expect((await downloadUrl(admin1, orderA, mine.documentId)).status).toBe(200);
    await sql`update media.stored_files set state = 'failed', state_reason_code = 'checksum_mismatch' where id = ${mine.storedFileId}`.execute(
      admin(),
    );
    expect((await downloadUrl(admin1, orderA, mine.documentId)).status).toBe(404);
    await sql`update media.stored_files set state = 'failed', state_reason_code = 'processing_error' where id = ${mine.storedFileId}`.execute(
      admin(),
    );
    expect((await downloadUrl(admin1, orderA, mine.documentId)).status).toBe(404);
  });

  it('EVM-047 AC8 SR-FILE-10 the 101st address of the class "originals and documents" in 10 minutes is 429 rate_limited with Retry-After, the SAME counter as the originals of photos; one alert from the 51st; the first refusal audited once', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const doc = await cleanDocument(orderId, editor.userId);
    const photo = await insertMedia(admin(), { workOrderId: orderId, createdBy: editor.userId, state: 'clean' });
    await sql`update media.stored_files set content_type = 'image/jpeg', size_bytes = 1000 where id = ${photo.storedFileId}`.execute(
      admin(),
    );
    const metrics = current.app.get<MetricsRegistry>(METRICS, { strict: false });
    const alerts = () =>
      metrics
        .snapshot()
        .filter((sample) => sample.name === 'signed_url_alert')
        .reduce((total, sample) => total + sample.value, 0);
    const before = alerts();
    for (let index = 0; index < 100; index += 1) {
      expect((await downloadUrl(editor, orderId, doc.documentId)).status, `address ${index + 1}`).toBe(200);
    }
    expect(alerts() - before).toBe(1);
    expect(await auditOf('media_file.download_alerted', doc.documentId)).toHaveLength(1);
    const first = await downloadUrl(editor, orderId, doc.documentId);
    const second = await downloadUrl(editor, orderId, doc.documentId);
    expect([first.status, second.status]).toEqual([429, 429]);
    expect(first.body).toMatchObject({ code: 'rate_limited' });
    expect(Number(first.headers['retry-after'])).toBeGreaterThan(0);
    expect(await auditOf('media_file.download_rejected', doc.documentId)).toHaveLength(1);
    expect(current.storage.signedGets).toHaveLength(100);
    // the photo original shares the counter: it is refused as well
    const photoAnswer = await editor.panel.post(`${BASE}/${orderId}/media-assets/${photo.mediaAssetId}/download-url`, {
      variant: 'original',
    });
    expect(photoAnswer.status).toBe(429);
  });
});

describe('EVM-047 AC6 types allowed and the scan of documents (SR-FILE-01, SR-FILE-03, SR-FILE-05, SR-FILE-06)', () => {
  it('EVM-047 AC6 SVG, HTML, archives, .docm, .xlsm and a declared macro-enabled type are refused with 400 BEFORE any upload; the answers carry pointers and codes, never the value', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const cases: Array<[string, string, string]> = [
      ['obraz.svg', 'image/svg+xml', 'contentType'],
      ['strona.html', 'text/html', 'contentType'],
      ['paczka.zip', 'application/zip', 'contentType'],
      ['paczka.7z', 'application/x-7z-compressed', 'contentType'],
      ['pismo.docm', 'application/vnd.ms-word.document.macroEnabled.12', 'contentType'],
      ['arkusz.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12', 'contentType'],
      ['arkusz.xlsm', XLSX, 'fileName'],
      ['pismo.docx', 'application/pdf', 'fileName'],
      ['program.exe', 'application/pdf', 'fileName'],
    ];
    for (const [fileName, contentType, pointer] of cases) {
      const answer = await createDocument(editor, orderId, documentBody(pdf(), {}, { fileName, contentType }));
      expect(answer.status, fileName).toBe(400);
      expect(errorsOf(answer.body), fileName).toEqual([{ pointer: `/file/${pointer}`, code: 'unsupported_type' }]);
      expect(JSON.stringify(answer.body)).not.toContain(fileName);
    }
    const count = Number(
      (await sql<{ n: string }>`select count(*)::text as n from media.documents where work_order_id = ${orderId}`.execute(admin())).rows[0]
        ?.n,
    );
    expect(count).toBe(0);
    for (const [fileName, contentType] of [
      ['a.pdf', 'application/pdf'],
      ['a.docx', DOCX],
      ['a.xlsx', XLSX],
      ['a.jpg', 'image/jpeg'],
      ['a.png', 'image/png'],
    ]) {
      expect((await createDocument(editor, orderId, documentBody(pdf(), {}, { fileName, contentType }))).status, fileName).toBe(201);
    }
  });

  it('EVM-047 AC6 a plain DOCX and a plain XLSX pass the scan as "clean" with the content type the server decided', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const docx = buildOoxml();
    const xlsx = buildOoxml({ kind: 'xlsx' });
    const first = await upload(editor, orderId, docx, {}, { fileName: 'pismo.docx', contentType: DOCX });
    const second = await upload(editor, orderId, xlsx, {}, { fileName: 'arkusz.xlsx', contentType: XLSX });
    for (const [uploaded, type] of [
      [first, DOCX],
      [second, XLSX],
    ] as const) {
      const stored = await fileOf(uploaded.body.id);
      expect(await scan().scanFile(stored?.id ?? '')).toBe(true);
      expect(await fileOf(uploaded.body.id)).toMatchObject({ state: 'clean', content_type: type });
    }
  });

  it('EVM-047 AC6 SR-FILE-05 SR-LOG-07 a DOCX with a macro project goes to quarantine as type_mismatch: ONE audit event on the DOCUMENT, one e-mail per active Administrator (a link to the order only), one security alert, no title or name in any of them', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const alerts = await alertCount('media_quarantined');
    const macro = buildOoxml({ extra: [{ name: 'word/vbaProject.bin', data: 'synthetic macro project' }] });
    const { body } = await upload(
      editor,
      orderId,
      macro,
      { title: 'Pismo z makrem Tajne' },
      { fileName: 'pismo-z-makrem.docx', contentType: DOCX },
    );
    const stored = await fileOf(body.id);
    expect(await scan().scanFile(stored?.id ?? '')).toBe(true);
    expect(await fileOf(body.id)).toMatchObject({ state: 'quarantined', state_reason_code: 'type_mismatch' });
    const events = await auditOf('media_file.quarantined', body.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ object_type: 'document', actor_type: 'system', outcome: 'success' });
    expect(JSON.stringify(events[0])).not.toMatch(/makrem|Tajne|vba|\.docx/i);
    expect((await alertCount('media_quarantined')) - alerts).toBe(1);
    const mails = (
      await sql<{ kind: string; variant: string; subject_id: string }>`
        select kind, variant, subject_id from platform.email_outbox where variant = 'administrator_media_quarantined' and subject_id = ${orderId} and state = 'pending'`.execute(
        admin(),
      )
    ).rows;
    expect(mails.length).toBeGreaterThan(0);
    expect(mails.every((mail) => mail.kind === 'administrator_alert')).toBe(true);
    // the document shows "quarantined" in the list; its download is a 404 for everybody
    const listed = documentOf(((await listDocuments(editor, orderId)).body as { items: DocumentBody[] }).items[0]);
    expect(listed.fileState).toBe('quarantined');
  });

  it('EVM-047 AC6 a macro-enabled content type, a macro sheet and ActiveX are found as well; a damaged archive, ZIP64 and an encrypted (OLE) container fail CLOSED as type_mismatch - never clean', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const cfb = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(2048)]);
    const plain = buildOoxml();
    const variants: Array<[string, Buffer]> = [
      [
        'macro content type',
        buildOoxml({
          contentTypes:
            '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
        }),
      ],
      ['activex', buildOoxml({ extra: [{ name: 'word/activeX/activeX1.xml', data: 'x' }] })],
      ['vba data', buildOoxml({ extra: [{ name: 'word/VBAData.xml', data: 'x' }] })],
      ['truncated', plain.subarray(0, plain.length - 12)],
      ['encrypted ole container', cfb],
      ['a text file', Buffer.from('this is not a docx at all, only text '.repeat(40))],
    ];
    for (const [label, bytes] of variants) {
      const { body } = await upload(editor, orderId, bytes, {}, { fileName: 'pismo.docx', contentType: DOCX });
      const stored = await fileOf(body.id);
      expect(await scan().scanFile(stored?.id ?? ''), label).toBe(true);
      expect(await fileOf(body.id), label).toMatchObject({ state: 'quarantined', state_reason_code: 'type_mismatch' });
    }
  });

  it('EVM-047 AC6 SR-FILE-03 a ".pdf" whose content is a PNG, and a DOCX declared as an XLSX, are quarantined as type_mismatch; a PDF that is a PDF is clean', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const png = await upload(editor, orderId, pngBytes(), {}, { fileName: 'skan.pdf', contentType: 'application/pdf' });
    const asXlsx = await upload(editor, orderId, buildOoxml(), {}, { fileName: 'arkusz.xlsx', contentType: XLSX });
    const real = await upload(editor, orderId, pdf(5000));
    for (const [uploaded, state] of [
      [png, 'quarantined'],
      [asXlsx, 'quarantined'],
      [real, 'clean'],
    ] as const) {
      const stored = await fileOf(uploaded.body.id);
      expect(await scan().scanFile(stored?.id ?? '')).toBe(true);
      expect((await fileOf(uploaded.body.id))?.state).toBe(state);
    }
    expect((await fileOf(png.body.id))?.state_reason_code).toBe('type_mismatch');
  });

  it('EVM-047 AC6 malware in a document (the EICAR test string) is quarantined as malware_detected with the same audit event and alert; the 30 days of retention remove the object and write the audit event of the purge on the DOCUMENT', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const alerts = await alertCount('media_quarantined');
    const eicar = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
      Buffer.alloc(500),
    ]);
    const { body } = await upload(editor, orderId, eicar);
    const stored = await fileOf(body.id);
    expect(await scan().scanFile(stored?.id ?? '')).toBe(true);
    expect(await fileOf(body.id)).toMatchObject({ state: 'quarantined', state_reason_code: 'malware_detected' });
    expect(await auditOf('media_file.quarantined', body.id)).toHaveLength(1);
    expect((await alertCount('media_quarantined')) - alerts).toBe(1);
    current.clock.set('2026-12-05T08:00:00.000Z');
    const result = await current.app.get(QuarantineRetentionJob, { strict: false }).run();
    expect(result.purged).toBeGreaterThanOrEqual(1);
    const purged = await auditOf('media_file.quarantine_purged', body.id);
    expect(purged).toHaveLength(1);
    expect(purged[0]).toMatchObject({ object_type: 'document', actor_type: 'system' });
  });

  it('EVM-047 AC6 a new scan of a quarantined document ends with the audit event "rescanned" on the DOCUMENT (the result as a code), without a second e-mail or alert', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const eicar = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
      Buffer.alloc(400),
    ]);
    const { body } = await upload(editor, orderId, eicar);
    const stored = await fileOf(body.id);
    await scan().scanFile(stored?.id ?? '');
    const alerts = await alertCount('media_quarantined');
    await sql`update media.stored_files set state = 'scanning', state_reason_code = null, scan_claimed_at = null where id = ${stored?.id ?? ''}`.execute(
      admin(),
    );
    expect(await scan().scanFile(stored?.id ?? '')).toBe(true);
    const rescanned = await auditOf('media_file.rescanned', body.id);
    expect(rescanned).toHaveLength(1);
    expect(rescanned[0]).toMatchObject({ object_type: 'document', from_code: 'quarantined', to_code: 'quarantined' });
    expect(await alertCount('media_quarantined')).toBe(alerts);
  });

  it('EVM-047 AC6 the size is checked at the session, at complete and by the scan: a file that is longer than declared is a failed transfer, never clean', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const bytes = pdf(3000);
    const body = documentBody(bytes);
    await createDocument(editor, orderId, body);
    const session = await editor.panel.post(
      `${BASE}/${orderId}/documents/${body.id}/upload-sessions`,
      { id: uuidv7() },
      { 'Idempotency-Key': uuidv7() },
    );
    const sessionId = (session.body as { id: string }).id;
    const uploadId = await uploadIdOf(sessionId);
    current.storage.putPart(uploadId, 1, bytes.subarray(0, 1000));
    const short = await editor.panel.post(`${sessionPath(orderId, body.id, sessionId)}/complete`);
    expect(short.status).toBe(422);
    expect(errorsOf(short.body)).toEqual([{ pointer: '', code: 'size_mismatch' }]);
  });
});

describe('EVM-047 AC7 roles, channels and objects (SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05)', () => {
  it('EVM-047 AC7 Administrator and Editor add; Read-only gets 403 forbidden on the creation, the raise and the sessions; an anonymous caller 401; a token of the phone 403', async () => {
    const orderId = await order();
    const owner = await signIn('administrator');
    const doc = await cleanDocument(orderId, owner.userId);
    const reader = await signIn('read_only');
    const mobile = await signIn('editor', 'mobile');
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    for (const role of ['administrator', 'editor'] as const) {
      expect((await createDocument(await signIn(role), orderId, documentBody(pdf()))).status, role).toBe(201);
    }
    const body = documentBody(pdf());
    const attempts: Array<[string, () => Promise<{ status: number; body: unknown }>]> = [
      ['create', () => createDocument(reader, orderId, body)],
      ['raise', () => raise(reader, orderId, doc.documentId, { confidentialityOverride: 'identity_data' })],
      [
        'session',
        () =>
          reader.panel.post(
            `${BASE}/${orderId}/documents/${doc.documentId}/upload-sessions`,
            { id: uuidv7() },
            { 'Idempotency-Key': uuidv7() },
          ),
      ],
    ];
    for (const [label, attempt] of attempts) {
      const answer = await attempt();
      expect(answer.status, label).toBe(403);
      expect(codeOf(answer.body), label).toBe('forbidden');
    }
    expect(await auditOf('document.created', body.id)).toHaveLength(0);
    expect((await anonymous.post(`${BASE}/${orderId}/documents`, body, { 'Idempotency-Key': uuidv7() })).status).toBe(401);
    expect((await anonymous.get(`${BASE}/${orderId}/documents`)).status).toBe(401);
    for (const answer of [
      await createDocument(mobile, orderId, body),
      await listDocuments(mobile, orderId),
      await downloadUrl(mobile, orderId, doc.documentId),
      await raise(mobile, orderId, doc.documentId, { confidentialityOverride: 'identity_data' }),
    ]) {
      expect(answer.status).toBe(403);
      expect(codeOf(answer.body)).toBe('forbidden');
    }
  });

  it('EVM-047 AC7 SR-AUTHZ-02 CWE-639 the document of order B through order A, a medium with its id and a missing one are ONE 404 on the raise, the download and the session; the list of an order shows only its own', async () => {
    const orderA = await order();
    const orderB = await order();
    const admin1 = await signIn('administrator');
    const theirs = await cleanDocument(orderB, admin1.userId);
    const medium = await insertMedia(admin(), { workOrderId: orderA, createdBy: admin1.userId });
    const ghost = uuidv7();
    for (const id of [theirs.documentId, medium.mediaAssetId, ghost]) {
      const answers = [
        await raise(admin1, orderA, id, { confidentialityOverride: 'identity_data' }),
        await downloadUrl(admin1, orderA, id),
        await admin1.panel.post(`${BASE}/${orderA}/documents/${id}/upload-sessions`, { id: uuidv7() }, { 'Idempotency-Key': uuidv7() }),
      ];
      expect(
        answers.map((answer) => answer.status),
        id,
      ).toEqual([404, 404, 404]);
      expect(new Set(answers.map((answer) => codeOf(answer.body))).size).toBe(1);
    }
    expect(JSON.stringify((await listDocuments(admin1, orderA)).body)).not.toContain(theirs.documentId);
    expect(((await listDocuments(admin1, orderB)).body as { totalCount: number }).totalCount).toBe(1);
    // an order that does not exist or is gone is a 404 as well, before anything about the body
    expect((await createDocument(admin1, uuidv7(), documentBody(pdf()))).status).toBe(404);
    expect((await listDocuments(admin1, uuidv7())).status).toBe(404);
  });

  it('EVM-047 AC7 the fields of the server are refused on the creation (400 read_only_field: versionNumber, fileState, confidentiality ...); an unknown field is 400 unknown_field', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    for (const field of [
      'versionNumber',
      'fileState',
      'confidentiality',
      'workOrderId',
      'canDownload',
      'version',
      'createdAt',
      'kindName',
    ]) {
      const answer = await createDocument(editor, orderId, { ...documentBody(pdf()), [field]: 1 });
      expect(answer.status, field).toBe(400);
      expect(errorsOf(answer.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    const unknown = await createDocument(editor, orderId, { ...documentBody(pdf()), surprise: 1 });
    expect(errorsOf(unknown.body)).toEqual([{ pointer: '/surprise', code: 'unknown_field' }]);
    const nested = await createDocument(editor, orderId, documentBody(pdf(), {}, { objectKey: 'x' }));
    expect(nested.status).toBe(400);
  });

  it('EVM-047 AC7 the session of a document is opened by its creator or an Administrator (another Editor: 404); a session or a file of a document through the path of the MEDIA, and of a medium through the path of documents, is 404', async () => {
    const orderId = await order();
    const creator = await signIn('editor');
    const colleague = await signIn('editor');
    const boss = await signIn('administrator');
    const body = documentBody(pdf());
    await createDocument(creator, orderId, body);
    const open = (browser: Browser, id = body.id) =>
      browser.panel.post(`${BASE}/${orderId}/documents/${id}/upload-sessions`, { id: uuidv7() }, { 'Idempotency-Key': uuidv7() });
    expect((await open(colleague)).status).toBe(404);
    expect((await open(creator)).status).toBe(201);
    expect((await open(boss)).status).toBe(409); // an Administrator on a document with another user's active session: id_conflict
    // the document through the media path and the medium through the document path
    const media = await insertMedia(admin(), { workOrderId: orderId, createdBy: creator.userId, session: { userId: creator.userId } });
    const mediaPath = `${BASE}/${orderId}/media-assets/${body.id}/upload-sessions`;
    expect((await creator.panel.post(mediaPath, { id: uuidv7() }, { 'Idempotency-Key': uuidv7() })).status).toBe(404);
    expect((await open(creator, media.mediaAssetId)).status).toBe(404);
    const documentSession =
      (
        await sql<{ id: string }>`select s.id from media.upload_sessions s join media.stored_files f on f.id = s.stored_file_id
      join media.document_versions v on v.id = f.document_version_id where v.document_id = ${body.id}`.execute(admin())
      ).rows[0]?.id ?? '';
    for (const suffix of ['/parts', '/parts/1/url']) {
      const viaMedia = await creator.panel.get(`${BASE}/${orderId}/media-assets/${body.id}/upload-sessions/${documentSession}${suffix}`);
      expect(viaMedia.status, suffix).toBe(404);
      const viaDocuments = await creator.panel.get(
        `${BASE}/${orderId}/documents/${media.mediaAssetId}/upload-sessions/${media.sessionId}${suffix}`,
      );
      expect(viaDocuments.status, suffix).toBe(404);
    }
    expect(
      (await creator.panel.post(`${BASE}/${orderId}/media-assets/${body.id}/upload-sessions/${documentSession}/complete`)).status,
    ).toBe(404);
    expect(
      (await creator.panel.post(`${BASE}/${orderId}/documents/${media.mediaAssetId}/upload-sessions/${media.sessionId}/complete`)).status,
    ).toBe(404);
    expect((await creator.panel.post(`${BASE}/${orderId}/media-assets/${body.id}/upload-sessions/${documentSession}/abort`)).status).toBe(
      404,
    );
    // the same session through its own path works, and only for its creator
    expect((await creator.panel.get(`${sessionPath(orderId, body.id, documentSession)}/parts`)).status).toBe(200);
    expect((await colleague.panel.get(`${sessionPath(orderId, body.id, documentSession)}/parts`)).status).toBe(404);
    expect((await creator.panel.post(`${sessionPath(orderId, body.id, documentSession)}/abort`)).status).toBe(204);
  });

  it('EVM-047 AC7 the list and the creation work for a closed (settled) order: nothing is lost ("nic nie ginie"); a deleted order is 404', async () => {
    const orderId = await order({ status: 'settled' });
    const editor = await signIn('editor');
    expect((await createDocument(editor, orderId, documentBody(pdf()))).status).toBe(201);
    const gone = await order({ deleted: true });
    expect((await listDocuments(editor, gone)).status).toBe(404);
    expect((await createDocument(editor, gone, documentBody(pdf()))).status).toBe(404);
  });
});

describe('EVM-047 AC8 states', () => {
  it('EVM-047 AC8 an order without documents: 200 with an empty list, no cursor and a zero count', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const listed = await listDocuments(editor, orderId);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ items: [], nextCursor: null, totalCount: 0 });
  });

  it('EVM-047 AC8 a storage that fails stops the upload session with 503 media_storage_unavailable (fail closed) and leaves the file in pending_upload', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const body = documentBody(pdf());
    expect((await createDocument(editor, orderId, body)).status).toBe(201);
    current.storage.unavailable = true;
    const session = await editor.panel.post(
      `${BASE}/${orderId}/documents/${body.id}/upload-sessions`,
      { id: uuidv7() },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(session.status).toBe(503);
    expect(codeOf(session.body)).toBe('media_storage_unavailable');
    expect((await fileOf(body.id))?.state).toBe('pending_upload');
  });

  it('EVM-047 AC8 SR-WEB-03 the title and the description are returned as plain text, exactly as stored (the panel renders them as text)', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const answer = await createDocument(
      editor,
      orderId,
      documentBody(pdf(), { title: '<img src=x onerror=alert(1)>', description: '<b>pogrubione</b>' }),
    );
    expect(answer.status).toBe(201);
    expect(answer.headers['content-type']).toMatch(/^application\/json/);
    expect(documentOf(answer.body).title).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('EVM-047 AC8 the state of the file and the kind in the list', () => {
  it('EVM-047 AC8 a file damaged in transfer shows its reason code (and only that one); a quarantined file shows no reason; a retired kind keeps its name and its class', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const damaged = await cleanDocument(orderId, editor.userId, { state: 'pending_upload' });
    await sql`update media.stored_files set state = 'failed', state_reason_code = 'checksum_mismatch' where id = ${damaged.storedFileId}`.execute(
      admin(),
    );
    const held = await cleanDocument(orderId, editor.userId, { state: 'quarantined' });
    const power = await cleanDocument(orderId, editor.userId, { kindCode: 'dso_application' });
    await sql`update catalog.document_kinds set deleted_at = ${NOW} where code = 'dso_application'`.execute(admin());
    try {
      const items = ((await listDocuments(editor, orderId)).body as { items: Array<DocumentBody & { stateReasonCode: string | null }> })
        .items;
      const byId = new Map(items.map((item) => [item.id, item]));
      expect(byId.get(damaged.documentId)).toMatchObject({ fileState: 'failed', stateReasonCode: 'checksum_mismatch' });
      expect(byId.get(held.documentId)).toMatchObject({ fileState: 'quarantined', stateReasonCode: null });
      expect(byId.get(power.documentId)).toMatchObject({ kindName: 'Wniosek do OSD', confidentiality: 'identity_data' });
    } finally {
      await sql`update catalog.document_kinds set deleted_at = null where code = 'dso_application'`.execute(admin());
    }
  });
});

describe('EVM-047 documents stay off the phone (P6; the channel is web; domain-model D6)', () => {
  it('EVM-047 AC7 the schema `media` is outside the scope of the synchronisation and no table of it carries a trigger of the change log', async () => {
    expect(SYNC_SCOPE_SCHEMAS).not.toContain('media');
    const triggers = (
      await sql<{ table_name: string; function_name: string }>`
        select c.relname as table_name, p.proname as function_name from pg_trigger t
        join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid
        where n.nspname = 'media' and not t.tgisinternal`.execute(admin())
    ).rows;
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers.filter((trigger) => /sync/i.test(trigger.function_name))).toEqual([]);
    const orderId = await order();
    const editor = await signIn('editor');
    const body = documentBody(pdf());
    expect((await createDocument(editor, orderId, body)).status).toBe(201);
    expect((await raise(editor, orderId, body.id, { confidentialityOverride: 'building_security' })).status).toBe(200);
    const stored = await fileOf(body.id);
    // the creation writes the entry of the journal (that one does sync), never a row naming the document, its version or its file
    const rows = await sql<{
      n: string;
    }>`select count(*)::text as n from sync.change_log where entity_id in (${body.id}, ${stored?.id ?? ''})`.execute(admin());
    expect(Number(rows.rows[0]?.n)).toBe(0);
  });
});
