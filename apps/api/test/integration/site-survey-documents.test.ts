/**
 * The offer of a site survey through the API (EVM-147 AC1-AC4; ADR-0025 pt 1, 2, 5, 6, 7): a survey without a customer accepts a document of the ORDER of the kind
 * `quote`; the anchors of the location and the customer, the payments and the ZIP still wait for the customer; another kind and the class `identity_data` are a `400`
 * at the field; the order of the checks; a rejected survey is read only except the deletion and the erasure (art. 17); after the assignment of the customer the
 * documents are those of an ordinary order. The roles, the channel and the objects of a stranger. Synthetic data only: the title, the description, the file name and
 * the address carry SENTINELS that must stay out of the journal, the audit trail, the change log and the log.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaScanService } from '../../src/modules/media/index.ts';
import { PART_SIZE_BYTES } from '../../src/modules/media/domain/upload-plan.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { signInTo, type Browser } from '../support/customer-erasure.ts';
import { insertDocumentRow } from '../support/document-fixtures.ts';
import { sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { CITY, STREET, closeStarted, inDays, start, survey, type Started, type Survey } from '../support/site-survey-purge-harness.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';

const BASE = '/api/v1/work-orders';
const DOC_TITLE = 'Oferta-synt-147-Kowalski';
const DOC_DESCRIPTION = 'Opis-oferty-synt-147-adres';
const DOC_FILE = 'oferta-synt-147-kowalski.pdf';
const DOC_SENTINELS = [DOC_TITLE, DOC_DESCRIPTION, DOC_FILE, STREET, CITY];

let started: Started;
const app = () => started.current;
const admin = () => app().database.admin;
beforeAll(async () => {
  started = await start('report');
});
afterAll(closeStarted);
beforeEach(() => {
  app().scanner.mode = 'working';
});

const pdf = (fill = 7): Buffer => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2039, fill)]);
const offer = (over: Record<string, unknown> = {}, bytes: Buffer = pdf()) => ({
  id: uuidv7(),
  kindCode: 'quote',
  title: DOC_TITLE,
  description: DOC_DESCRIPTION,
  file: { fileName: DOC_FILE, contentType: 'application/pdf', declaredSize: bytes.length, sha256: sha256Of(bytes) },
  ...over,
});
const key = () => ({ 'Idempotency-Key': uuidv7() });
const create = (browser: Browser, orderId: string, body: unknown, headers = key()) =>
  browser.panel.post(`${BASE}/${orderId}/documents`, body, headers);
const list = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}/documents`);
const downloadUrl = (browser: Browser, orderId: string, documentId: string) =>
  browser.panel.post(`${BASE}/${orderId}/documents/${documentId}/download-url`);
const patch = (browser: Browser, orderId: string, documentId: string, body: unknown, version = 1) =>
  browser.panel.patch(`${BASE}/${orderId}/documents/${documentId}`, body, { 'If-Match': `"${String(version)}"` });
const remove = (browser: Browser, orderId: string, documentId: string) =>
  browser.panel.delete(`${BASE}/${orderId}/documents/${documentId}`);
const restore = (browser: Browser, orderId: string, documentId: string) =>
  browser.panel.post(`${BASE}/${orderId}/documents/${documentId}/restore`);
const purgeFile = (browser: Browser, orderId: string, documentId: string, version: number) =>
  browser.panel.post(`${BASE}/${orderId}/documents/${documentId}/purge-file`, undefined, { 'If-Match': `"${String(version)}"` });
const session = (browser: Browser, orderId: string, documentId: string) =>
  browser.panel.post(`${BASE}/${orderId}/documents/${documentId}/upload-sessions`, { id: uuidv7() }, key());
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const traceless = (answer: { status: number; body: unknown }) =>
  JSON.stringify({ status: answer.status, body: { ...(answer.body as object), traceId: undefined, instance: undefined } });
const count = async (query: ReturnType<typeof sql<{ n: string }>>): Promise<number> => Number((await query.execute(admin())).rows[0]?.n);
const written = async () => ({
  documents: await count(sql`select count(*)::text as n from media.documents`),
  versions: await count(sql`select count(*)::text as n from media.document_versions`),
  files: await count(sql`select count(*)::text as n from media.stored_files`),
  records: await count(sql`select count(*)::text as n from platform.idempotency_records`),
  milestones: await count(sql`select count(*)::text as n from payments.payment_milestones`),
  exports: await count(sql`select count(*)::text as n from media.media_exports`),
});
const trails = async (): Promise<string> =>
  (
    await sql<{ t: string }>`
      select (select coalesce(json_agg(e), '[]') from audit.events e)::text
        || (select coalesce(json_agg(t), '[]') from timeline.timeline_entries t)::text
        || (select coalesce(json_agg(c), '[]') from sync.change_log c)::text as t`.execute(admin())
  ).rows[0]?.t ?? '';
const expectNoDocumentSentinel = (text: string): void => {
  for (const sentinel of DOC_SENTINELS) expect(text, `sentinel ${sentinel}`).not.toContain(sentinel);
};

const openSurvey = (status?: 'on_hold' | 'cancelled'): Promise<Survey> =>
  survey(app(), { deadline: inDays(app(), 30), ...(status === undefined ? {} : { status }) });
let numbering = 0;
async function ordinaryOrder(status?: 'cancelled'): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `oferta${String(numbering)}@example.invalid` });
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-7147-${String(numbering).padStart(4, '0')}`,
      customerId,
      siteId: await insertSite(admin()),
      ...(status === undefined ? {} : { status, closedAt: inDays(app(), -1) }),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

/** A document of the order that passed the scan (`clean`, the object in the storage) - what the panel would have after the upload. */
async function cleanOffer(orderId: string, createdBy: string, override?: 'building_security'): Promise<string> {
  const bytes = pdf(Math.floor(Math.random() * 200) + 1);
  const row = await insertDocumentRow(admin(), {
    workOrderId: orderId,
    createdBy,
    kindCode: 'quote',
    title: DOC_TITLE,
    description: DOC_DESCRIPTION,
    fileName: DOC_FILE,
    state: 'clean',
    size: bytes.length,
    sha256: sha256Of(bytes),
    ...(override === undefined ? {} : { override }),
  });
  const put = app().storage.putObject(row.objectKey, bytes);
  await sql`update media.stored_files set size_bytes = ${bytes.length}, sha256 = ${sha256Of(bytes)}, s3_version_id = ${put.versionId},
    s3_etag = ${put.etag} where id = ${row.storedFileId}`.execute(admin());
  return row.documentId;
}

const versionOf = async (table: 'work_orders.work_orders' | 'media.documents', id: string): Promise<number> => {
  const query =
    table === 'media.documents'
      ? sql<{ v: number }>`select version as v from media.documents where id = ${id}`
      : sql<{ v: number }>`select version as v from work_orders.work_orders where id = ${id}`;
  return Number((await query.execute(admin())).rows[0]?.v);
};

describe('EVM-147 AC1: the offer is added to an open survey', () => {
  it('EVM-147 AC1 the Administrator and the Editor add an offer to a survey in "Wycena" and "Wstrzymane"; the repeat is idempotent; the upload and the scan go as for an ordinary order; no title, description, file name or address in any trail', async () => {
    for (const [role, status] of [
      ['administrator', undefined],
      ['editor', 'on_hold'],
    ] as const) {
      const order = await openSurvey(status);
      const browser = await signInTo(app(), role);
      const bytes = pdf(31);
      const body = offer({}, bytes);
      const headers = key();
      const created = await create(browser, order.id, body, headers);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body).toMatchObject({ id: body.id, kindCode: 'quote', fileState: 'pending_upload', workOrderId: order.id });
      const repeated = await create(browser, order.id, body, headers);
      expect(repeated.status).toBe(201);
      expect(repeated.headers['idempotent-replayed']).toBe('true');

      const opened = await session(browser, order.id, body.id);
      expect(opened.status, JSON.stringify(opened.body)).toBe(201);
      const sessionId = (opened.body as { id: string }).id;
      const uploadId =
        (await sql<{ s3_upload_id: string }>`select s3_upload_id from media.upload_sessions where id = ${sessionId}`.execute(admin()))
          .rows[0]?.s3_upload_id ?? '';
      const sessionPath = `${BASE}/${order.id}/documents/${body.id}/upload-sessions/${sessionId}`;
      for (let part = 1; part <= (opened.body as { partCount: number }).partCount; part += 1) {
        const url = await browser.panel.get(`${sessionPath}/parts/${String(part)}/url`);
        expect(url.status).toBe(200);
        const from = (part - 1) * PART_SIZE_BYTES;
        app().storage.putPart(uploadId, part, bytes.subarray(from, from + (url.body as { contentLength: number }).contentLength));
      }
      expect((await browser.panel.post(`${sessionPath}/complete`)).status).toBe(200);
      const stored = (
        await sql<{ id: string }>`select f.id from media.stored_files f join media.document_versions v on v.id = f.document_version_id
          where v.document_id = ${body.id}`.execute(admin())
      ).rows[0];
      expect(
        await app()
          .app.get(MediaScanService, { strict: false })
          .scanFile(stored?.id ?? ''),
      ).toBe(true);
      const listed = await list(browser, order.id);
      expect(listed.status).toBe(200);
      expect((listed.body as { items: Array<{ id: string; fileState: string }> }).items).toContainEqual(
        expect.objectContaining({ id: body.id, fileState: 'clean' }),
      );
    }
    expectNoDocumentSentinel(await trails());
    expectNoDocumentSentinel(app().logs.text);
  });

  it('EVM-147 AC1 ADR-0025 pt 4 the version of the offer is written with change_note NULL, and the request that names a note of a version is refused', async () => {
    const order = await openSurvey();
    const browser = await signInTo(app(), 'editor');
    const body = offer();
    expect((await create(browser, order.id, body)).status).toBe(201);
    const notes = await sql<{
      change_note: string | null;
    }>`select change_note from media.document_versions where document_id = ${body.id}`.execute(admin());
    expect(notes.rows, 'ADR-0025 pkt 4: change_note must always be NULL (the purge of a survey does not clear it)').toEqual([
      { change_note: null },
    ]);
    for (const field of ['changeNote', 'change_note']) {
      const refused = await create(browser, order.id, offer({ [field]: 'Notatka-synt-147' }));
      expect(refused.status, `ADR-0025 pkt 4: ${field} must not be accepted`).toBe(400);
      expect(errorsOf(refused.body)).toEqual([{ pointer: `/${field}`, code: 'unknown_field' }]);
    }
    const privilege = await sql<{
      allowed: boolean;
    }>`select has_table_privilege('evia_app', 'media.document_versions', 'UPDATE') as allowed`.execute(admin());
    expect(privilege.rows[0]?.allowed, 'ADR-0025 pkt 4: the application role has no UPDATE on the versions').toBe(false);
  });

  it('EVM-147 AC1 the roles: Read-only gets 404 on the reads and 403 on the writes, a token of the phone 403, an anonymous caller 401; the objects of a stranger are 404', async () => {
    const order = await openSurvey();
    const other = await openSurvey();
    const owner = await signInTo(app(), 'administrator', { fresh: true });
    const documentId = await cleanOffer(order.id, owner.userId);
    const strangerDocument = await cleanOffer(other.id, owner.userId);
    const reader = await signInTo(app(), 'read_only', { fresh: true });
    const mobile = await signInTo(app(), 'editor', { channel: 'mobile' });
    const anonymous = { userId: '', panel: new PanelClient(app().app.getHttpServer(), PANEL_ORIGIN) };

    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signInTo(app(), role);
      expect((await list(browser, order.id)).status, role).toBe(200);
      expect((await downloadUrl(browser, order.id, documentId)).status, role).toBe(200);
    }
    expect((await list(reader, order.id)).status).toBe(404);
    expect((await downloadUrl(reader, order.id, documentId)).status).toBe(404);
    const writes: Array<[string, (browser: Browser) => PromiseLike<{ status: number; body: unknown }>]> = [
      ['create', (browser) => create(browser, order.id, offer())],
      ['session', (browser) => session(browser, order.id, documentId)],
      ['update', (browser) => patch(browser, order.id, documentId, { description: 'x' })],
      ['delete', (browser) => remove(browser, order.id, documentId)],
      ['restore', (browser) => restore(browser, order.id, documentId)],
      ['purge', (browser) => purgeFile(browser, order.id, documentId, 1)],
    ];
    for (const [label, send] of writes) {
      const answer = await send(reader);
      expect(answer.status, `read_only ${label}`).toBe(403);
      expect(codeOf(answer.body), `read_only ${label}`).toBe('forbidden');
      expect((await send(mobile)).status, `mobile ${label}`).toBe(403);
      expect((await send(anonymous)).status, `anonymous ${label}`).toBe(401);
    }
    expect((await list(mobile, order.id)).status).toBe(403);
    expect((await downloadUrl(mobile, order.id, documentId)).status).toBe(403);
    expect((await list(anonymous, order.id)).status).toBe(401);
    expect((await downloadUrl(anonymous, order.id, documentId)).status).toBe(401);

    // CWE-639: the document of another survey through this one, and of this survey through an ordinary order, is absent
    const editor = await signInTo(app(), 'editor');
    const ordinary = await ordinaryOrder();
    for (const [orderId, id] of [
      [order.id, strangerDocument],
      [ordinary, documentId],
    ] as const) {
      expect((await downloadUrl(editor, orderId, id)).status).toBe(404);
      expect((await patch(editor, orderId, id, { description: 'x' })).status).toBe(404);
      expect((await session(editor, orderId, id)).status).toBe(404);
      expect((await remove(owner, orderId, id)).status).toBe(404);
    }
    const untouched = await sql<{ description: string | null; deleted_at: Date | null }>`
      select description, deleted_at from media.documents where id in (${documentId}, ${strangerDocument})`.execute(admin());
    expect(untouched.rows).toEqual([
      { description: DOC_DESCRIPTION, deleted_at: null },
      { description: DOC_DESCRIPTION, deleted_at: null },
    ]);
  });

  it('EVM-147 AC1 no oracle of a survey: the 404 of a missing order, of an ordinary order and of a survey Read-only does not see are identical; so are the 403 of the creation for Read-only and the phone', async () => {
    const order = await openSurvey();
    const owner = await signInTo(app(), 'administrator');
    const documentId = await cleanOffer(order.id, owner.userId, 'building_security');
    const ordinary = await ordinaryOrder();
    const reader = await signInTo(app(), 'read_only');
    const mobile = await signInTo(app(), 'editor', { channel: 'mobile' });
    const ghost = uuidv7();

    const downloads = [
      await downloadUrl(reader, ghost, documentId),
      await downloadUrl(reader, ordinary, documentId),
      await downloadUrl(reader, order.id, documentId),
    ];
    expect(downloads.map((answer) => answer.status)).toEqual([404, 404, 404]);
    expect(new Set(downloads.map(traceless)).size).toBe(1);
    // the raised class of the survey's document is never judged for Read-only: no refusal of a download is audited
    const denied = await count(
      sql`select count(*)::text as n from audit.events where action = 'document_file.download_denied' and object_id = ${documentId}`,
    );
    expect(denied).toBe(0);
    const lists = [await list(reader, ghost), await list(reader, order.id)];
    expect(new Set(lists.map(traceless)).size).toBe(1);

    for (const browser of [reader, mobile]) {
      const answers = [
        await create(browser, ghost, offer()),
        await create(browser, ordinary, offer()),
        await create(browser, order.id, offer()),
      ];
      expect(answers.map((answer) => answer.status)).toEqual([403, 403, 403]);
      expect(new Set(answers.map(traceless)).size).toBe(1);
    }
  });

  it('EVM-147 AC1 the document of a survey is never shown among the documents of its location or of a customer', async () => {
    const order = await openSurvey();
    const owner = await signInTo(app(), 'administrator');
    const documentId = await cleanOffer(order.id, owner.userId);
    const siteDocuments = await owner.panel.get(`/api/v1/sites/${order.siteId}/documents`);
    expect(siteDocuments.status).toBe(200);
    expect(JSON.stringify(siteDocuments.body)).not.toContain(documentId);
    const anchors = await sql<{ site_id: string | null; customer_id: string | null; work_order_id: string | null }>`
      select site_id, customer_id, work_order_id from media.documents where id = ${documentId}`.execute(admin());
    expect(anchors.rows).toEqual([{ site_id: null, customer_id: null, work_order_id: order.id }]);
  });
});

describe('EVM-147 AC2: the bounds of a survey without a customer', () => {
  it('EVM-147 AC2 the anchor of the location or the customer, a payment and the ZIP are 409 customer_required; another kind is 400 /kindCode and identity_data 400 /confidentialityOverride, requires_customer, without a value; nothing is written', async () => {
    const order = await openSurvey();
    const browser = await signInTo(app(), 'editor', { fresh: true });
    const before = await written();
    for (const anchor of ['site', 'customer']) {
      const answer = await create(browser, order.id, offer({ anchor }));
      expect(answer.status, anchor).toBe(409);
      expect(codeOf(answer.body), anchor).toBe('customer_required');
    }
    const milestone = await browser.panel.post(`${BASE}/${order.id}/payment-milestones`, { id: uuidv7(), name: 'Zaliczka' }, key());
    expect([milestone.status, codeOf(milestone.body)]).toEqual([409, 'customer_required']);
    const zip = await browser.panel.post(`${BASE}/${order.id}/media-exports`, undefined, key());
    expect([zip.status, codeOf(zip.body)]).toEqual([409, 'customer_required']);

    for (const over of [
      { kindCode: 'building_documentation' },
      { kindCode: 'connection_conditions' },
      { kindCode: 'other', containsIdentityData: false },
    ]) {
      const answer = await create(browser, order.id, offer(over));
      expect(answer.status, over.kindCode).toBe(400);
      expect(codeOf(answer.body)).toBe('validation_failed');
      expect(errorsOf(answer.body), over.kindCode).toEqual([{ pointer: '/kindCode', code: 'requires_customer' }]);
      expect(JSON.stringify(answer.body)).not.toContain(over.kindCode);
    }
    const raised = await create(browser, order.id, offer({ confidentialityOverride: 'identity_data' }));
    expect(raised.status).toBe(400);
    expect(errorsOf(raised.body)).toEqual([{ pointer: '/confidentialityOverride', code: 'requires_customer' }]);
    const text = JSON.stringify(raised.body);
    for (const value of ['identity_data', 'quote', DOC_TITLE, 'quoting', 'customerId']) expect(text).not.toContain(value);
    expect(await written()).toEqual(before);

    const security = await create(browser, order.id, offer({ confidentialityOverride: 'building_security' }));
    expect(security.status, JSON.stringify(security.body)).toBe(201);
    expect(security.body).toMatchObject({ confidentiality: 'building_security', confidentialityRaised: true });
  });

  it('EVM-147 AC2 the order of the checks: an invisible order 404, the structure 400, the anchor 409 customer_required, the rejected survey 409 work_order_closed, the fields 400', async () => {
    const open = await openSurvey();
    const rejected = await openSurvey('cancelled');
    const browser = await signInTo(app(), 'editor');
    const before = await written();

    const missing = await create(browser, uuidv7(), { anchor: 'site', kindCode: 'other', unknown: 1 });
    expect(missing.status).toBe(404);
    const structure = await create(browser, rejected.id, offer({ anchor: 'site', unknown: 1 }));
    expect([structure.status, codeOf(structure.body)]).toEqual([400, 'validation_failed']);
    const anchorFirst = await create(browser, rejected.id, offer({ anchor: 'site', kindCode: 'other' }));
    expect([anchorFirst.status, codeOf(anchorFirst.body)]).toEqual([409, 'customer_required']);
    const closedFirst = await create(
      browser,
      rejected.id,
      offer({ kindCode: 'building_documentation', confidentialityOverride: 'identity_data' }),
    );
    expect([closedFirst.status, codeOf(closedFirst.body)]).toEqual([409, 'work_order_closed']);
    const fields = await create(browser, open.id, offer({ kindCode: 'building_documentation', title: ' ' }));
    expect(fields.status).toBe(400);
    expect(errorsOf(fields.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/title', code: 'required' },
        { pointer: '/kindCode', code: 'requires_customer' },
      ]),
    );
    expect(await written()).toEqual(before);
  });
});

describe('EVM-147 AC3: the reads and the changes of a document of a survey', () => {
  it('EVM-147 AC3 the Administrator and the Editor download, change the description and delete; the class cannot reach identity_data; Read-only gets 404 on the reads and 403 on the change and the deletion', async () => {
    const order = await openSurvey();
    const owner = await signInTo(app(), 'administrator');
    const editor = await signInTo(app(), 'editor');
    const reader = await signInTo(app(), 'read_only');
    const documentId = await cleanOffer(order.id, owner.userId);

    expect((await downloadUrl(editor, order.id, documentId)).status).toBe(200);
    const changed = await patch(editor, order.id, documentId, { description: 'Opis-zmieniony-synt-147' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const identity = await patch(editor, order.id, documentId, { confidentialityOverride: 'identity_data' }, 2);
    expect(identity.status).toBe(400);
    expect(errorsOf(identity.body)).toEqual([{ pointer: '/confidentialityOverride', code: 'requires_customer' }]);
    expect(await versionOf('media.documents', documentId)).toBe(2);
    expect((await patch(editor, order.id, documentId, { confidentialityOverride: 'building_security' }, 2)).status).toBe(200);

    expect((await list(reader, order.id)).status).toBe(404);
    expect((await downloadUrl(reader, order.id, documentId)).status).toBe(404);
    expect((await patch(reader, order.id, documentId, { description: 'x' }, 3)).status).toBe(403);
    expect((await remove(reader, order.id, documentId)).status).toBe(403);

    expect((await remove(owner, order.id, documentId)).status).toBe(204);
    const row = await sql<{ deleted_at: Date | null }>`select deleted_at from media.documents where id = ${documentId}`.execute(admin());
    expect(row.rows[0]?.deleted_at).not.toBeNull();
    expectNoDocumentSentinel(await trails());
  });
});

describe('EVM-147 AC4: the assignment of the customer, the rejection and the restoration', () => {
  it('EVM-147 AC4 after the assignment of the customer the documents are those of the order (the same ids, versions and classes) and any kind and anchor can be added', async () => {
    const order = await openSurvey();
    const editor = await signInTo(app(), 'editor');
    const owner = await signInTo(app(), 'administrator');
    const plain = await cleanOffer(order.id, owner.userId);
    const raised = await cleanOffer(order.id, owner.userId, 'building_security');
    const before = (
      await sql`select d.id, d.version, d.kind_code, d.confidentiality_override, v.version_number from media.documents d
        join media.document_versions v on v.document_id = d.id where d.work_order_id = ${order.id} order by d.id`.execute(admin())
    ).rows;
    expect(before).toHaveLength(2);
    const customerId = await insertCustomer(admin(), { email: 'przypisanie147@example.invalid' });
    const assigned = await editor.panel.put(`${BASE}/${order.id}/customer`, {
      customerId,
      version: await versionOf('work_orders.work_orders', order.id),
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);

    const after = (
      await sql`select d.id, d.version, d.kind_code, d.confidentiality_override, v.version_number from media.documents d
        join media.document_versions v on v.document_id = d.id where d.work_order_id = ${order.id} order by d.id`.execute(admin())
    ).rows;
    expect(after).toEqual(before);
    expect([plain, raised].sort()).toEqual(after.map((row) => (row as { id: string }).id).sort());
    expect((await create(editor, order.id, offer({ kindCode: 'building_documentation', anchor: 'site' }))).status).toBe(201);
    expect((await create(editor, order.id, offer({ kindCode: 'connection_conditions', anchor: 'customer' }))).status).toBe(201);
  });

  it('EVM-147 AC4 a rejected survey: the download works; the creation, the change and the restore are 409 work_order_closed; no ZIP; the deletion and the erasure of the file (art. 17) work; after the restoration of the survey the change works again', async () => {
    const order = await openSurvey();
    const editor = await signInTo(app(), 'editor');
    const owner = await signInTo(app(), 'administrator', { fresh: true });
    const kept = await cleanOffer(order.id, owner.userId);
    const deleted = await cleanOffer(order.id, owner.userId);
    const erased = await cleanOffer(order.id, owner.userId);
    expect((await remove(owner, order.id, deleted)).status).toBe(204);
    const rejected = await editor.panel.post(
      `${BASE}/${order.id}/transitions`,
      { to: 'cancelled', reasonCode: 'offer_rejected' },
      { 'If-Match': `"${String(await versionOf('work_orders.work_orders', order.id))}"` },
    );
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const before = await written();

    expect((await downloadUrl(editor, order.id, kept)).status).toBe(200);
    expect((await list(editor, order.id)).status).toBe(200);
    for (const [label, answer] of [
      ['create', await create(editor, order.id, offer())],
      ['update', await patch(editor, order.id, kept, { description: 'x' })],
      ['restore', await restore(owner, order.id, deleted)],
    ] as const) {
      expect([answer.status, codeOf(answer.body)], label).toEqual([409, 'work_order_closed']);
    }
    const zip = await owner.panel.post(`${BASE}/${order.id}/media-exports`, undefined, key());
    expect(zip.status).toBe(409);
    expect(await written()).toEqual(before);

    // art. 17 RODO: the Administrator deletes and erases in the 14 days of a rejected survey
    expect((await remove(owner, order.id, kept)).status).toBe(204);
    const registered = started.register.objects.length;
    const purged = await purgeFile(owner, order.id, erased, await versionOf('media.documents', erased));
    expect(purged.status, JSON.stringify(purged.body)).toBe(204);
    expect(started.register.objects).toHaveLength(registered + 1);
    const entry = JSON.parse(started.register.objects.at(-1)?.body ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({ operationCode: 'document_file_purged', subjectId: erased, workOrderId: order.id });
    const files = await sql<{ erased_at: Date | null; original_filename: string | null }>`
      select f.erased_at, f.original_filename from media.stored_files f join media.document_versions v on v.id = f.document_version_id
      where v.document_id = ${erased}`.execute(admin());
    expect(files.rows[0]?.erased_at).not.toBeNull();
    expect(files.rows[0]?.original_filename).toBeNull();

    // the Administrator restores the survey: its documents can be changed again, the restore of a document too
    const restored = await owner.panel.post(
      `${BASE}/${order.id}/transitions`,
      { to: 'on_hold' },
      { 'If-Match': `"${String(await versionOf('work_orders.work_orders', order.id))}"` },
    );
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect((await restore(owner, order.id, kept)).status).toBe(204);
    expect(
      (await patch(editor, order.id, kept, { description: 'Po-przywroceniu-synt' }, await versionOf('media.documents', kept))).status,
    ).toBe(200);
    expectNoDocumentSentinel(await trails());
    expectNoDocumentSentinel(app().logs.text);
  });

  it('EVM-147 AC4 the upload of an offer created BEFORE the rejection may still finish (ADR-0025 pt 5 blocks the creation, the change and the restore only); the file goes with the survey', async () => {
    const order = await openSurvey();
    const editor = await signInTo(app(), 'editor');
    const body = offer();
    expect((await create(editor, order.id, body)).status).toBe(201);
    const rejected = await editor.panel.post(
      `${BASE}/${order.id}/transitions`,
      { to: 'cancelled', reasonCode: 'offer_rejected' },
      { 'If-Match': `"${String(await versionOf('work_orders.work_orders', order.id))}"` },
    );
    expect(rejected.status).toBe(200);
    const opened = await session(editor, order.id, body.id);
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
  });

  it('EVM-147 AC4 a cancelled ORDINARY order is not a rejected survey: its documents are added, changed and restored as before (PO-8)', async () => {
    const orderId = await ordinaryOrder('cancelled');
    const editor = await signInTo(app(), 'editor');
    const owner = await signInTo(app(), 'administrator');
    const body = offer({ kindCode: 'connection_conditions' });
    expect((await create(editor, orderId, body)).status).toBe(201);
    expect((await patch(editor, orderId, body.id, { description: 'Zmiana-synt-147' })).status).toBe(200);
    expect((await remove(owner, orderId, body.id)).status).toBe(204);
    expect((await restore(owner, orderId, body.id)).status).toBe(204);
  });
});
