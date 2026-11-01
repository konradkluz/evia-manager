import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../src/modules/procedures/index.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertDocumentRow } from '../support/document-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertMedia, sha256Of } from '../support/media-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-11-01T08:00:00.000Z';
const BASE = '/api/v1/work-orders';
/** A synthetic marker: it must appear in the answer of its own medium and NOWHERE else (audit, logs, errors). */
const MARKER = 'MARKER-OPIS-Zxq7';

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
  await clearWorkOrderCreation(current.database.admin);
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
async function order(options: { status?: WorkOrderStatus } = {}): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `metadane${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-7${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

const jpeg = (size = 2048): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.alloc(size - 12, 7)]);
const pdf = (size = 2048): Buffer => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size - 9, 7)]);

const mediaItem = (over: Record<string, unknown> = {}) => {
  const body = jpeg();
  return {
    id: uuidv7(),
    category: 'in_progress',
    fileName: 'IMG_0001.JPG',
    declaredSize: body.length,
    contentType: 'image/jpeg',
    sha256: sha256Of(body),
    ...over,
  };
};
const documentBody = (over: Record<string, unknown> = {}) => {
  const body = pdf();
  return {
    id: uuidv7(),
    kindCode: 'connection_conditions',
    title: 'Warunki przylaczenia - instalacja testowa',
    file: { fileName: 'warunki.pdf', contentType: 'application/pdf', declaredSize: body.length, sha256: sha256Of(body) },
    ...over,
  };
};

const createMedia = (browser: Browser, orderId: string, items: unknown[]) =>
  browser.panel.post(`${BASE}/${orderId}/media-assets`, { items }, { 'Idempotency-Key': uuidv7() });
const createDocument = (browser: Browser, orderId: string, body: unknown) =>
  browser.panel.post(`${BASE}/${orderId}/documents`, body, { 'Idempotency-Key': uuidv7() });
const patchMedia = (browser: Browser, orderId: string, id: string, body: unknown, ifMatch: string | null = '"1"') =>
  browser.panel.patch(`${BASE}/${orderId}/media-assets/${id}`, body, ifMatch === null ? {} : { 'If-Match': ifMatch });
const patchDocument = (browser: Browser, orderId: string, id: string, body: unknown, ifMatch: string | null = '"1"') =>
  browser.panel.patch(`${BASE}/${orderId}/documents/${id}`, body, ifMatch === null ? {} : { 'If-Match': ifMatch });
const listMedia = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}/media-assets`);
const listDocuments = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}/documents`);

interface MediaBody {
  id: string;
  category: string;
  description: string | null;
  procedureStageId: string | null;
  procedureStageName: string | null;
  version: number;
  mediaType: string;
  quarantineReasonCode?: string;
}
interface DocumentBody {
  id: string;
  title: string;
  description: string | null;
  procedureStageId: string | null;
  procedureStageName: string | null;
  confidentiality: string;
  version: number;
}
const mediaOf = (body: unknown) => body as MediaBody;
const documentOf = (body: unknown) => body as DocumentBody;
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const traceless = (answer: { status: number; body: unknown }) =>
  JSON.stringify({ status: answer.status, body: { ...(answer.body as object), traceId: undefined, instance: undefined } });

const auditOf = (action: string, objectId: string) =>
  sql<Record<string, unknown>>`select * from audit.events where action = ${action} and object_id = ${objectId} order by occurred_at, id`
    .execute(admin())
    .then((result) => result.rows);
const stateOfMedia = async (id: string) =>
  (
    await sql<{
      version: number;
      category: string;
      description: string | null;
      procedure_stage_id: string | null;
      updated_by: string | null;
    }>`
      select version, category, description, procedure_stage_id, updated_by from media.media_assets where id = ${id}`.execute(admin())
  ).rows[0];
const stateOfDocument = async (id: string) =>
  (
    await sql<{ version: number; title: string; description: string | null; procedure_stage_id: string | null }>`
      select version, title, description, procedure_stage_id from media.documents where id = ${id}`.execute(admin())
  ).rows[0];

/** A ready medium of an order, straight into the database. */
const readyMedia = (orderId: string, userId: string) => insertMedia(admin(), { workOrderId: orderId, createdBy: userId, state: 'ready' });

describe('EVM-048 AC1 the stage while sending (SR-AUTHZ-02, SR-INPUT-02)', () => {
  it('EVM-048 AC1 a batch of media with a stage of THIS order is saved with the assignment; the answer and the list carry the id and the name of the stage', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const process = await insertProcedure(admin(), orderId, { stages: [{ name: 'Montaz wallboxa' }] });
    const stageId = process.stageIds[0] as string;
    const withStage = mediaItem({ procedureStageId: stageId, description: '  Skrzynka  ' });
    const without = mediaItem();
    const created = await createMedia(editor, orderId, [withStage, without]);
    expect(created.status).toBe(201);
    const items = (created.body as { items: MediaBody[] }).items;
    expect(items[0]).toMatchObject({
      procedureStageId: stageId,
      procedureStageName: 'Montaz wallboxa',
      description: 'Skrzynka',
      version: 1,
    });
    expect(items[1]).toMatchObject({ procedureStageId: null, procedureStageName: null });
    expect((await stateOfMedia(withStage.id))?.procedure_stage_id).toBe(stageId);
  });

  it('EVM-048 AC1 a document with a stage of THIS order is saved with the assignment and listed with the name of the stage', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const process = await insertProcedure(admin(), orderId, { stages: [{ name: 'Warunki przylaczenia' }] });
    const stageId = process.stageIds[0] as string;
    const body = documentBody({ procedureStageId: stageId });
    const created = await createDocument(editor, orderId, body);
    expect(created.status).toBe(201);
    expect(documentOf(created.body)).toMatchObject({ procedureStageId: stageId, procedureStageName: 'Warunki przylaczenia' });
    const listed = ((await listDocuments(editor, orderId)).body as { items: DocumentBody[] }).items;
    expect(listed[0]).toMatchObject({ id: body.id, procedureStageId: stageId, procedureStageName: 'Warunki przylaczenia' });
  });

  it('EVM-048 AC4 AC1 a stage of another order, a deleted stage and a missing one are ONE answer 400 validation_failed at the pointer; nothing is saved', async () => {
    const orderId = await order();
    const otherOrder = await order();
    const editor = await signIn('editor');
    const strangers = await insertProcedure(admin(), otherOrder, { stages: [{}] });
    const gone = await insertProcedure(admin(), orderId, { position: 1, stages: [{ deletedAt: new Date('2026-10-20T08:00:00Z') }] });
    const goneProcess = await insertProcedure(admin(), orderId, { position: 2, deletedAt: new Date('2026-10-20T08:00:00Z'), stages: [{}] });
    const stageIds = [strangers.stageIds[0], gone.stageIds[0], goneProcess.stageIds[0], uuidv7()] as string[];

    const mediaAnswers = [];
    for (const stageId of stageIds) {
      const item = mediaItem({ procedureStageId: stageId });
      const answer = await createMedia(editor, orderId, [mediaItem(), item]);
      expect(answer.status, stageId).toBe(400);
      expect(errorsOf(answer.body)).toEqual([{ pointer: '/items/1/procedureStageId', code: 'unknown_stage' }]);
      mediaAnswers.push(traceless(answer));
      expect(await stateOfMedia(item.id)).toBeUndefined();
    }
    expect(new Set(mediaAnswers).size).toBe(1);

    const documentAnswers = [];
    for (const stageId of stageIds) {
      const body = documentBody({ procedureStageId: stageId });
      const answer = await createDocument(editor, orderId, body);
      expect(answer.status, stageId).toBe(400);
      expect(errorsOf(answer.body)).toEqual([{ pointer: '/procedureStageId', code: 'unknown_stage' }]);
      documentAnswers.push(traceless(answer));
      expect(await stateOfDocument(body.id)).toBeUndefined();
    }
    expect(new Set(documentAnswers).size).toBe(1);
  });
});

describe('EVM-048 AC2 the metadata of a medium with If-Match (SR-INPUT-05, SR-LOG-03)', () => {
  it('EVM-048 AC2 Administrator and Editor change the category, the description and the stage: 200, a new ETag and version, ONE audit event without the description', async () => {
    const orderId = await order();
    const process = await insertProcedure(admin(), orderId, { stages: [{ name: 'Etap testowy' }] });
    const stageId = process.stageIds[0] as string;
    for (const role of ['administrator', 'editor'] as const) {
      const user = await signIn(role);
      const medium = await readyMedia(orderId, user.userId);
      const answer = await patchMedia(user, orderId, medium.mediaAssetId, {
        category: 'defect',
        description: `  ${MARKER} <script>alert(1)</script>\r\nnastepna linia `,
        procedureStageId: stageId,
      });
      expect(answer.status, role).toBe(200);
      expect(answer.headers['etag']).toBe('"2"');
      expect(mediaOf(answer.body)).toMatchObject({
        category: 'defect',
        description: `${MARKER} <script>alert(1)</script>\nnastepna linia`,
        procedureStageId: stageId,
        procedureStageName: 'Etap testowy',
        version: 2,
        mediaType: 'photo',
      });
      expect(await stateOfMedia(medium.mediaAssetId)).toMatchObject({ version: 2, category: 'defect', updated_by: user.userId });
      const events = await auditOf('media_asset.metadata_updated', medium.mediaAssetId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actor_user_id: user.userId, outcome: 'success', object_type: 'media_asset' });
      expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.stringify(events[0])).not.toContain(MARKER);
      expect(JSON.stringify(events[0])).not.toContain('Etap testowy');
    }
    expect(current.logs.lines.join('\n')).not.toContain(MARKER);
  });

  it('EVM-048 AC2 null clears the description and the stage; a text empty after trimming is the same as null; a request that changes nothing is 200 without a new version and without audit', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const process = await insertProcedure(admin(), orderId, { stages: [{}] });
    const medium = await readyMedia(orderId, editor.userId);
    const id = medium.mediaAssetId;
    const set = await patchMedia(editor, orderId, id, { description: 'Opis', procedureStageId: process.stageIds[0] });
    expect(mediaOf(set.body).version).toBe(2);
    const cleared = await patchMedia(editor, orderId, id, { description: null, procedureStageId: null }, '"2"');
    expect(mediaOf(cleared.body)).toMatchObject({ description: null, procedureStageId: null, procedureStageName: null, version: 3 });
    const blank = await patchMedia(editor, orderId, id, { description: ' \n\t ' }, '"3"');
    expect(blank.status).toBe(200);
    expect(mediaOf(blank.body)).toMatchObject({ description: null, version: 3 });
    const same = await patchMedia(editor, orderId, id, { category: 'in_progress', procedureStageId: null }, '"3"');
    expect(same.status).toBe(200);
    expect(same.headers['etag']).toBe('"3"');
    expect(await auditOf('media_asset.metadata_updated', id)).toHaveLength(2);
  });

  it('EVM-048 AC2 If-Match: missing is 428, malformed is 400, stale is 412 version_conflict and the data stay', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const medium = await readyMedia(orderId, editor.userId);
    const id = medium.mediaAssetId;
    const target = { category: 'defect', description: 'Nowy opis' };
    expect((await patchMedia(editor, orderId, id, target, null)).status).toBe(428);
    expect((await patchMedia(editor, orderId, id, target, 'W/"1"')).status).toBe(400);
    expect((await patchMedia(editor, orderId, id, target, '*')).status).toBe(400);
    const stale = await patchMedia(editor, orderId, id, target, '"7"');
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(await stateOfMedia(id)).toMatchObject({ version: 1, category: 'in_progress', description: null });
    expect(await auditOf('media_asset.metadata_updated', id)).toHaveLength(0);
  });

  it('EVM-048 AC2 two changes with the same If-Match: one wins (200), the other loses (412) - no lost update', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const other = await signIn('administrator');
    const medium = await readyMedia(orderId, editor.userId);
    const answers = await Promise.all([
      patchMedia(editor, orderId, medium.mediaAssetId, { category: 'defect' }),
      patchMedia(other, orderId, medium.mediaAssetId, { category: 'measurement' }),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 412]);
    expect(await auditOf('media_asset.metadata_updated', medium.mediaAssetId)).toHaveLength(1);
  });

  it('EVM-048 AC2 SR-INPUT-05 the description with a control or invisible character, over 1000 characters, an unknown category and an empty body are 400 and change nothing; the error does not repeat the value', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const medium = await readyMedia(orderId, editor.userId);
    const id = medium.mediaAssetId;
    const bad: Array<[unknown, string, string]> = [
      [{ description: `${MARKER}\u0000` }, '/description', 'invalid_characters'],
      [{ description: `${MARKER}\u202E` }, '/description', 'invalid_characters'],
      [{ description: `${MARKER}${'x'.repeat(1000)}` }, '/description', 'too_long'],
      [{ category: 'secret' }, '/category', 'invalid_value'],
      [{ procedureStageId: 'not-a-uuid' }, '/procedureStageId', 'invalid_format'],
      [{}, '', 'required'],
    ];
    for (const [body, pointer, code] of bad) {
      const answer = await patchMedia(editor, orderId, id, body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(errorsOf(answer.body)).toEqual([{ pointer, code }]);
      expect(JSON.stringify(answer.body)).not.toContain(MARKER);
    }
    expect(await stateOfMedia(id)).toMatchObject({ version: 1, description: null });
  });

  it('EVM-048 AC7 TM-18 the fields of the server (mediaType, fileState, workOrderId, version ...) are read_only_field and the unknown ones unknown_field; nothing changes', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const medium = await readyMedia(orderId, editor.userId);
    for (const field of [
      'mediaType',
      'fileState',
      'workOrderId',
      'version',
      'origin',
      'createdAt',
      'originalFilename',
      'quarantineReasonCode',
    ]) {
      const answer = await patchMedia(editor, orderId, medium.mediaAssetId, { [field]: 'x', category: 'defect' });
      expect(answer.status, field).toBe(400);
      expect(errorsOf(answer.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    const unknown = await patchMedia(editor, orderId, medium.mediaAssetId, { category: 'defect', extra: 1 });
    expect(errorsOf(unknown.body)).toEqual([{ pointer: '/extra', code: 'unknown_field' }]);
    expect(await stateOfMedia(medium.mediaAssetId)).toMatchObject({ version: 1, category: 'in_progress' });
  });
});

describe('EVM-048 AC3 the metadata of a document with If-Match (SR-INPUT-05, SR-LOG-03)', () => {
  it('EVM-048 AC3 the title, the description and the stage change with ONE version and ONE audit event without their values', async () => {
    const orderId = await order();
    const process = await insertProcedure(admin(), orderId, { stages: [{ name: 'Etap dokumentu' }] });
    const stageId = process.stageIds[0] as string;
    for (const role of ['administrator', 'editor'] as const) {
      const user = await signIn(role);
      const body = documentBody();
      await createDocument(user, orderId, body);
      const answer = await patchDocument(user, orderId, body.id, {
        title: `  Nowy tytul ${MARKER}  `,
        description: `Opis\r\n${MARKER}`,
        procedureStageId: stageId,
      });
      expect(answer.status, role).toBe(200);
      expect(answer.headers['etag']).toBe('"2"');
      expect(documentOf(answer.body)).toMatchObject({
        title: `Nowy tytul ${MARKER}`,
        description: `Opis\n${MARKER}`,
        procedureStageId: stageId,
        procedureStageName: 'Etap dokumentu',
        version: 2,
      });
      const events = await auditOf('document.metadata_updated', body.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actor_user_id: user.userId,
        outcome: 'success',
        object_type: 'document',
        from_code: null,
        to_code: null,
      });
      expect(JSON.stringify(events[0])).not.toContain(MARKER);
      expect(JSON.stringify(events[0])).not.toContain('Etap dokumentu');
      expect(await auditOf('document.confidentiality_raised', body.id)).toHaveLength(0);
    }
    expect(current.logs.lines.join('\n')).not.toContain(MARKER);
  });

  it('EVM-048 AC3 a request with the class and the metadata is ONE version bump and TWO events; a request that changes nothing is 200 without audit and without a new version', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const body = documentBody();
    await createDocument(editor, orderId, body);
    const both = await patchDocument(editor, orderId, body.id, { title: 'Tytul po zmianie', confidentialityOverride: 'building_security' });
    expect(both.status).toBe(200);
    expect(documentOf(both.body)).toMatchObject({ title: 'Tytul po zmianie', confidentiality: 'building_security', version: 2 });
    expect(await auditOf('document.metadata_updated', body.id)).toHaveLength(1);
    const raised = await auditOf('document.confidentiality_raised', body.id);
    expect(raised.map((event) => [event['from_code'], event['to_code']])).toEqual([['standard', 'building_security']]);
    const same = await patchDocument(editor, orderId, body.id, { title: 'Tytul po zmianie', description: null }, '"2"');
    expect(same.status).toBe(200);
    expect(same.headers['etag']).toBe('"2"');
    expect(await auditOf('document.metadata_updated', body.id)).toHaveLength(1);
  });

  it('EVM-048 AC3 SR-AUTHZ-07 a lower or equal class is 400 also together with a title; the class never falls and the title stays', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const body = documentBody({ kindCode: 'installation_design' });
    await createDocument(editor, orderId, body);
    const equal = await patchDocument(editor, orderId, body.id, { title: 'Inny tytul', confidentialityOverride: 'building_security' });
    expect(equal.status).toBe(400);
    expect(errorsOf(equal.body)).toEqual([{ pointer: '/confidentialityOverride', code: 'not_higher' }]);
    await patchDocument(editor, orderId, body.id, { confidentialityOverride: 'identity_data' });
    const lower = await patchDocument(
      editor,
      orderId,
      body.id,
      { title: 'Inny tytul', confidentialityOverride: 'building_security' },
      '"2"',
    );
    expect(lower.status).toBe(400);
    expect(await stateOfDocument(body.id)).toMatchObject({ version: 2, title: body.title });
    await expect(
      sql`update media.documents set confidentiality_override = 'building_security' where id = ${body.id}`.execute(admin()),
    ).rejects.toMatchObject({ code: 'EV002' });
  });

  it('EVM-048 AC3 a title that is empty after trimming is required; a new line in the title, a control character and a title over 200 are 400; the description may be cleared with null', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const body = documentBody({ description: 'Opis poczatkowy' });
    await createDocument(editor, orderId, body);
    const cases: Array<[unknown, string, string]> = [
      [{ title: '   ' }, '/title', 'required'],
      [{ title: 'a\nb' }, '/title', 'invalid_characters'],
      [{ title: `a\u0000${MARKER}` }, '/title', 'invalid_characters'],
      [{ title: 'x'.repeat(201) }, '/title', 'too_long'],
      [{ description: 'a\u200Bb' }, '/description', 'invalid_characters'],
      [{}, '', 'required'],
    ];
    for (const [payload, pointer, code] of cases) {
      const answer = await patchDocument(editor, orderId, body.id, payload);
      expect(answer.status, JSON.stringify(payload)).toBe(400);
      expect(errorsOf(answer.body)).toEqual([{ pointer, code }]);
      expect(JSON.stringify(answer.body)).not.toContain(MARKER);
    }
    const cleared = await patchDocument(editor, orderId, body.id, { description: null });
    expect(documentOf(cleared.body)).toMatchObject({ description: null, version: 2 });
  });

  it('EVM-048 AC7 TM-18 the kind, the order, the file and the version are read_only_field in the change of a document; stale If-Match is 412 with the data unchanged', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const body = documentBody();
    await createDocument(editor, orderId, body);
    for (const field of ['kindCode', 'workOrderId', 'fileState', 'version', 'kindName', 'versionNumber']) {
      const answer = await patchDocument(editor, orderId, body.id, { [field]: 'x', title: 'Zmiana' });
      expect(answer.status, field).toBe(400);
      expect(errorsOf(answer.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    const stale = await patchDocument(editor, orderId, body.id, { title: 'Zmiana' }, '"9"');
    expect(stale.status).toBe(412);
    expect(await stateOfDocument(body.id)).toMatchObject({ version: 1, title: body.title });
  });
});

describe('EVM-048 AC4 the stage of another order (SR-AUTHZ-02, SR-INPUT-02, CWE-639)', () => {
  it('EVM-048 AC4 a stage of order B for a medium and a document of order A is 400 validation_failed; the assignment, the version and the audit stay; a deleted and a missing stage give the SAME answer', async () => {
    const orderA = await order();
    const orderB = await order();
    const editor = await signIn('editor');
    const strangers = await insertProcedure(admin(), orderB, { stages: [{}] });
    const gone = await insertProcedure(admin(), orderA, { stages: [{ deletedAt: new Date('2026-10-20T08:00:00Z') }] });
    const goneProcess = await insertProcedure(admin(), orderA, { position: 2, deletedAt: new Date('2026-10-20T08:00:00Z'), stages: [{}] });
    const medium = await readyMedia(orderA, editor.userId);
    const document = documentBody();
    await createDocument(editor, orderA, document);
    const stageIds = [strangers.stageIds[0], gone.stageIds[0], goneProcess.stageIds[0], uuidv7()] as string[];
    const answers = [];
    for (const stageId of stageIds) {
      const onMedium = await patchMedia(editor, orderA, medium.mediaAssetId, { procedureStageId: stageId });
      const onDocument = await patchDocument(editor, orderA, document.id, { procedureStageId: stageId });
      for (const answer of [onMedium, onDocument]) {
        expect(answer.status, stageId).toBe(400);
        expect(codeOf(answer.body)).toBe('validation_failed');
        expect(errorsOf(answer.body)).toEqual([{ pointer: '/procedureStageId', code: 'unknown_stage' }]);
      }
      answers.push(traceless(onMedium), traceless(onDocument));
    }
    expect(new Set(answers.filter((_, index) => index % 2 === 0)).size).toBe(1);
    expect(new Set(answers.filter((_, index) => index % 2 === 1)).size).toBe(1);
    expect(await stateOfMedia(medium.mediaAssetId)).toMatchObject({ version: 1, procedure_stage_id: null });
    expect(await stateOfDocument(document.id)).toMatchObject({ version: 1, procedure_stage_id: null });
    expect(await auditOf('media_asset.metadata_updated', medium.mediaAssetId)).toHaveLength(0);
    expect(await auditOf('document.metadata_updated', document.id)).toHaveLength(0);
  });

  it('EVM-048 AC4 SR-ERR-01 a failure of the facade of the stages rolls the whole change back: the assignment, the title and the version stay', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const process = await insertProcedure(admin(), orderId, { stages: [{}] });
    const medium = await readyMedia(orderId, editor.userId);
    const document = documentBody();
    await createDocument(editor, orderId, document);
    const stages = current.app.get<ProcedureStageDirectory>(PROCEDURE_STAGE_DIRECTORY, { strict: false });
    const spy = vi.spyOn(stages, 'existsInOrder').mockRejectedValue(new Error('facade down'));
    try {
      const onMedium = await patchMedia(editor, orderId, medium.mediaAssetId, {
        category: 'defect',
        procedureStageId: process.stageIds[0],
      });
      const onDocument = await patchDocument(editor, orderId, document.id, { title: 'Zmiana', procedureStageId: process.stageIds[0] });
      expect(onMedium.status).toBe(500);
      expect(onDocument.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await stateOfMedia(medium.mediaAssetId)).toMatchObject({ version: 1, category: 'in_progress', procedure_stage_id: null });
    expect(await stateOfDocument(document.id)).toMatchObject({ version: 1, title: document.title, procedure_stage_id: null });
  });

  it('EVM-048 AC4 SR-AUTHZ-02 the database refuses a stage of another order (the composite key) for a medium and for a document', async () => {
    const orderA = await order();
    const orderB = await order();
    const editor = await signIn('editor');
    const strangers = await insertProcedure(admin(), orderB, { stages: [{}] });
    const medium = await readyMedia(orderA, editor.userId);
    const document = await insertDocumentRow(admin(), { workOrderId: orderA, createdBy: editor.userId });
    const stage = strangers.stageIds[0] as string;
    await expect(
      sql`update media.media_assets set procedure_stage_id = ${stage} where id = ${medium.mediaAssetId}`.execute(admin()),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      sql`update media.documents set procedure_stage_id = ${stage} where id = ${document.documentId}`.execute(admin()),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('EVM-048 AC5 the list carries the stage (also when the stage was deleted later)', () => {
  it('EVM-048 AC5 the lists of media and documents return the id and the name of the stage; the name of a stage deleted afterwards stays, a medium without a stage has null', async () => {
    const orderId = await order();
    const editor = await signIn('editor');
    const process = await insertProcedure(admin(), orderId, { stages: [{ name: 'Montaz' }, { name: 'Odbior' }] });
    const [first, second] = process.stageIds as [string, string];
    const withStage = await readyMedia(orderId, editor.userId);
    const without = await readyMedia(orderId, editor.userId);
    expect((await patchMedia(editor, orderId, withStage.mediaAssetId, { procedureStageId: first })).status).toBe(200);
    const document = documentBody({ procedureStageId: second });
    await createDocument(editor, orderId, document);
    await sql`update procedures.procedure_stages set deleted_at = ${new Date('2026-10-30T08:00:00Z')} where id = ${first}`.execute(admin());

    const media = ((await listMedia(editor, orderId)).body as { items: MediaBody[] }).items;
    expect(media.find((item) => item.id === withStage.mediaAssetId)).toMatchObject({
      procedureStageId: first,
      procedureStageName: 'Montaz',
    });
    expect(media.find((item) => item.id === without.mediaAssetId)).toMatchObject({ procedureStageId: null, procedureStageName: null });
    const documents = ((await listDocuments(editor, orderId)).body as { items: DocumentBody[] }).items;
    expect(documents[0]).toMatchObject({ procedureStageId: second, procedureStageName: 'Odbior' });
  });
});

describe('EVM-048 AC6 a closed order still takes the change (PO-8)', () => {
  it('EVM-048 AC6 the metadata of a medium and of a document of a settled and of a cancelled order change: 200', async () => {
    for (const status of ['settled', 'cancelled'] as const) {
      const orderId = await order({ status });
      const editor = await signIn('editor');
      const medium = await readyMedia(orderId, editor.userId);
      const document = await insertDocumentRow(admin(), { workOrderId: orderId, createdBy: editor.userId });
      expect((await patchMedia(editor, orderId, medium.mediaAssetId, { category: 'completed_work' })).status, status).toBe(200);
      expect((await patchDocument(editor, orderId, document.documentId, { title: 'Po rozliczeniu' })).status, status).toBe(200);
    }
  });
});

describe('EVM-048 AC7 roles, channels and objects (SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05)', () => {
  it('EVM-048 AC7 Read-only gets 403 forbidden BEFORE If-Match and the body, an anonymous caller 401, a token of the phone 403; the data stay and nothing is audited', async () => {
    const orderId = await order();
    const owner = await signIn('administrator');
    const medium = await readyMedia(orderId, owner.userId);
    const document = await insertDocumentRow(admin(), { workOrderId: orderId, createdBy: owner.userId });
    const reader = await signIn('read_only');
    const mobile = await signIn('editor', 'mobile');
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const mediaPath = `${BASE}/${orderId}/media-assets/${medium.mediaAssetId}`;
    const documentPath = `${BASE}/${orderId}/documents/${document.documentId}`;
    for (const [label, user] of [
      ['read-only', reader],
      ['mobile', mobile],
    ] as const) {
      // no If-Match and a body that would be refused: the guard answers first
      for (const path of [mediaPath, documentPath]) {
        const answer = await user.panel.patch(path, { mediaType: 'video' });
        expect(answer.status, `${label} ${path}`).toBe(403);
        expect(codeOf(answer.body), `${label} ${path}`).toBe('forbidden');
      }
    }
    expect((await anonymous.patch(mediaPath, { category: 'defect' }, { 'If-Match': '"1"' })).status).toBe(401);
    expect((await anonymous.patch(documentPath, { title: 'x' }, { 'If-Match': '"1"' })).status).toBe(401);
    expect(await stateOfMedia(medium.mediaAssetId)).toMatchObject({ version: 1, category: 'in_progress' });
    expect(await auditOf('media_asset.metadata_updated', medium.mediaAssetId)).toHaveLength(0);
    expect(await auditOf('document.metadata_updated', document.documentId)).toHaveLength(0);
  });

  it('EVM-048 AC7 CWE-639 the medium or the document of order B through order A, a document with the id of a medium and the reverse, and a missing id are ONE 404 on the change', async () => {
    const orderA = await order();
    const orderB = await order();
    const admin1 = await signIn('administrator');
    const mediumB = await readyMedia(orderB, admin1.userId);
    const documentB = await insertDocumentRow(admin(), { workOrderId: orderB, createdBy: admin1.userId });
    const mediumA = await readyMedia(orderA, admin1.userId);
    const documentA = await insertDocumentRow(admin(), { workOrderId: orderA, createdBy: admin1.userId });
    const ghost = uuidv7();
    const onMedia = [mediumB.mediaAssetId, documentA.documentId, ghost];
    const onDocuments = [documentB.documentId, mediumA.mediaAssetId, ghost];
    const answers: string[] = [];
    for (const id of onMedia) {
      const answer = await patchMedia(admin1, orderA, id, { category: 'defect' });
      expect(answer.status, id).toBe(404);
      answers.push(traceless(answer));
    }
    for (const id of onDocuments) {
      const answer = await patchDocument(admin1, orderA, id, { title: 'Obcy' });
      expect(answer.status, id).toBe(404);
      answers.push(traceless(answer));
    }
    expect(new Set(answers).size).toBe(1);
    // the stale version of a foreign object is 404, never 412
    expect((await patchMedia(admin1, orderA, mediumB.mediaAssetId, { category: 'defect' }, '"99"')).status).toBe(404);
    expect(await stateOfMedia(mediumB.mediaAssetId)).toMatchObject({ version: 1, category: 'in_progress' });
    expect(await stateOfDocument(documentB.documentId)).toMatchObject({ version: 1 });
    // a deleted or a missing order of the path
    expect((await patchMedia(admin1, ghost, mediumA.mediaAssetId, { category: 'defect' })).status).toBe(404);
  });

  it('EVM-048 AC7 SR-AUTHZ-04 the answer of the Editor never carries the reason of a quarantine; the Administrator gets it for a held file', async () => {
    const orderId = await order();
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const held = await insertMedia(admin(), {
      workOrderId: orderId,
      createdBy: administrator.userId,
      state: 'quarantined',
      reason: 'malware_detected',
    });
    const asEditor = await patchMedia(editor, orderId, held.mediaAssetId, { category: 'defect' });
    expect(asEditor.status).toBe(200);
    expect(Object.keys(asEditor.body as object)).not.toContain('quarantineReasonCode');
    const asAdministrator = await patchMedia(administrator, orderId, held.mediaAssetId, { category: 'measurement' }, '"2"');
    expect(mediaOf(asAdministrator.body).quarantineReasonCode).toBe('malware_detected');
  });
});
