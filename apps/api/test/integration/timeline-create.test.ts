import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertEntries } from '../support/timeline-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';

const NOW = '2026-10-11T08:00:00.000Z';
const BASE = '/api/v1/work-orders';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
let auditBaseline = 0;
beforeEach(async () => {
  current.clock.set(NOW);
  await clearWorkOrderCreation(current.database.admin);
  auditBaseline = await auditTotal('timeline_entry.created');
});

const admin = () => current.database.admin;

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel, session };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order(options: { status?: WorkOrderStatus; deleted?: boolean; stages?: number } = {}) {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-5${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  const process = await insertProcedure(admin(), id, { stages: Array.from({ length: options.stages ?? 1 }, () => ({})) });
  return { id, stageIds: process.stageIds };
}

interface Sent {
  readonly id?: string;
  readonly key?: string | null;
}
const createEntry = (browser: Browser, orderId: string, body: Record<string, unknown>, sent: Sent = {}) =>
  browser.panel.post(
    `${BASE}/${orderId}/timeline`,
    { id: sent.id ?? uuidv7(), ...body },
    sent.key === null ? {} : { 'Idempotency-Key': sent.key ?? uuidv7() },
  );
const note = (body = 'Rozmowa z klientem — ustalono termin.', extra: Record<string, unknown> = {}) => ({
  kind: 'note',
  noteCategory: 'phone_call',
  body,
  ...extra,
});
const listOf = (browser: Browser, orderId: string, query = '') => browser.panel.get(`${BASE}/${orderId}/timeline${query}`);

const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
interface EntryBody {
  id: string;
  kind: string;
  noteCategory: string | null;
  body: string | null;
  procedureStageId: string | null;
  procedureStageName: string | null;
  author: { id: string; displayName: string } | null;
  createdAt: string;
  origin: string;
  capturedAt: string | null;
  supersedesEntryId: string | null;
  supersededByEntryId: string | null;
  redactedAt: string | null;
}
const entryOf = (body: unknown) => body as EntryBody;

const rowsOf = async (orderId: string) =>
  (
    await sql<{ id: string; body: string | null; created_by: string | null; origin: string; created_at: Date }>`
      select id, body, created_by, origin, created_at from timeline.timeline_entries where work_order_id = ${orderId} order by created_at, id`.execute(
      admin(),
    )
  ).rows;
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId} order by occurred_at, id`.execute(admin()))
    .rows;
const auditTotal = async (action: string): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from audit.events where action = ${action}`.execute(admin())).rows[0]?.n);
const idempotencyRecords = async () =>
  (await sql<Record<string, unknown>>`select * from platform.idempotency_records`.execute(admin())).rows;

describe('EVM-037 AC1 AC2 — an entry and a comment (SR-INPUT-01, SR-AUTHZ-02)', () => {
  it('EVM-037 AC1 an Editor adds a note with a category and a stage: 201, the author, the time of the SERVER, the origin web and Location', async () => {
    const editor = await signIn('editor');
    const { id: orderId, stageIds } = await order();
    const id = uuidv7(Date.parse('2020-01-01T00:00:00Z')); // an identifier made long ago: the order is the time of the server
    const response = await createEntry(editor, orderId, note('Rozmowa z klientem.', { procedureStageId: stageIds[0] }), { id });
    expect(response.status).toBe(201);
    expect(response.headers['location']).toBe(`${BASE}/${orderId}/timeline/${id}`);
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    const entry = entryOf(response.body);
    expect(entry).toMatchObject({
      id,
      kind: 'note',
      noteCategory: 'phone_call',
      body: 'Rozmowa z klientem.',
      procedureStageId: stageIds[0],
      origin: 'web',
      capturedAt: null,
      supersedesEntryId: null,
      supersededByEntryId: null,
      redactedAt: null,
      createdAt: NOW,
    });
    expect(entry.procedureStageName).toMatch(/^Etap syntetyczny/);
    expect(entry.author?.id).toBe(editor.userId);
    expect(typeof entry.author?.displayName).toBe('string');
    expect(Object.keys(entry.author ?? {}).sort()).toEqual(['displayName', 'id']);
    const rows = await rowsOf(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, created_by: editor.userId, origin: 'web' });
  });

  it('EVM-037 AC1 the new entry is the first on the list, with its author and stage', async () => {
    const editor = await signIn('editor');
    const { id: orderId, stageIds } = await order();
    await insertEntries(admin(), orderId, editor.userId, [{ createdAt: '2026-10-01T08:00:00.000Z' }]);
    const created = await createEntry(editor, orderId, note('Najnowszy wpis.', { procedureStageId: stageIds[0] }));
    const list = (await listOf(editor, orderId)).body as { items: EntryBody[] };
    expect(list.items[0]?.id).toBe(entryOf(created.body).id);
    expect(list.items).toHaveLength(2);
  });

  it('EVM-037 AC1 a text of 10 000 characters is accepted; 10 001 is 400 too_long with the pointer and no value', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    expect((await createEntry(editor, orderId, note('a'.repeat(10_000)))).status).toBe(201);
    const refused = await createEntry(editor, orderId, note('b'.repeat(10_001)));
    expect(refused.status).toBe(400);
    expect(codeOf(refused.body)).toBe('validation_failed');
    expect(errorsOf(refused.body)).toEqual([{ pointer: '/body', code: 'too_long' }]);
    expect(JSON.stringify(refused.body)).not.toContain('bbbbbbbbbb');
    expect(await rowsOf(orderId)).toHaveLength(1);
  });

  it('EVM-037 AC1 a text that is empty after trimming is 400 required; the length counts after normalisation', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const empty = await createEntry(editor, orderId, note('  \n\t '));
    expect(errorsOf(empty.body)).toEqual([{ pointer: '/body', code: 'required' }]);
    // 5 000 + 100 control characters + 5 000: 10 000 characters after the removal — accepted
    const padded = await createEntry(editor, orderId, note(`${'x'.repeat(5000)}${'\u0000'.repeat(100)}${'x'.repeat(5000)}`));
    expect(padded.status).toBe(201);
    expect(entryOf(padded.body).body).toHaveLength(10_000);
  });

  it('EVM-037 AC2 a comment has the kind comment and no category; a category on a comment and a note without one are 400', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const comment = await createEntry(editor, orderId, { kind: 'comment', body: 'Komentarz do Administratora.' });
    expect(comment.status).toBe(201);
    expect(entryOf(comment.body)).toMatchObject({ kind: 'comment', noteCategory: null });
    const withCategory = await createEntry(editor, orderId, { kind: 'comment', noteCategory: 'meeting', body: 'Tekst' });
    expect(withCategory.status).toBe(400);
    expect(errorsOf(withCategory.body)).toEqual([{ pointer: '/noteCategory', code: 'not_allowed' }]);
    const missing = await createEntry(editor, orderId, { kind: 'note', body: 'Tekst' });
    expect(errorsOf(missing.body)).toEqual([{ pointer: '/noteCategory', code: 'required' }]);
    const unknown = await createEntry(editor, orderId, note('Tekst', { noteCategory: 'gossip' }));
    expect(unknown.status).toBe(400);
    expect(await rowsOf(orderId)).toHaveLength(1);
  });

  it('EVM-037 AC1 the Administrator adds entries too; the author is the Administrator', async () => {
    const administrator = await signIn('administrator');
    const { id: orderId } = await order();
    const response = await createEntry(administrator, orderId, note());
    expect(response.status).toBe(201);
    expect(entryOf(response.body).author?.id).toBe(administrator.userId);
  });
});

describe('EVM-037 AC4 — the text is text (SR-INPUT-05, SR-WEB-03)', () => {
  it('EVM-037 AC4 markup and a javascript: link are stored as written; control characters are removed, the new line stays, NUL never reaches the database', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const raw = '<script>alert(1)</script>\r\njavascript:alert(1)\u0000\u0007 https://example.invalid/a\n\ndruga linia';
    const response = await createEntry(editor, orderId, note(raw));
    expect(response.status).toBe(201);
    const expected = '<script>alert(1)</script>\njavascript:alert(1) https://example.invalid/a\n\ndruga linia';
    expect(entryOf(response.body).body).toBe(expected);
    expect((await rowsOf(orderId))[0]?.body).toBe(expected);
    const read = await editor.panel.get(`${BASE}/${orderId}/timeline/${entryOf(response.body).id}`);
    expect(entryOf(read.body).body).toBe(expected);
  });

  it('EVM-037 AC4 a lone UTF-16 surrogate is 400 invalid_characters — never a 500 from the database', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const response = await editor.panel
      .post(`${BASE}/${orderId}/timeline`, undefined, { 'Idempotency-Key': uuidv7() })
      .set('Content-Type', 'application/json')
      .send(`{"id":"${uuidv7()}","kind":"note","noteCategory":"other","body":"tekst \\ud800 koniec"}`);
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual([{ pointer: '/body', code: 'invalid_characters' }]);
    expect(await rowsOf(orderId)).toHaveLength(0);
  });
});

describe('EVM-037 AC5 — a repeat does not duplicate (SR-API-05, AB-09)', () => {
  it('EVM-037 AC5 the same id, key and body twice: one entry, the same answer, Idempotent-Replayed, one audit event, no text in the record', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const sent = { id: uuidv7(), key: uuidv7() };
    const body = note('Tekst unikalnyINTERNAL-MARKER-1.');
    const first = await createEntry(editor, orderId, body, sent);
    current.clock.advance(5000);
    const second = await createEntry(editor, orderId, body, sent);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await rowsOf(orderId)).toHaveLength(1);
    expect(await auditOf(sent.id)).toHaveLength(1);
    const records = await idempotencyRecords();
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain('INTERNAL-MARKER');
    expect(records[0]).toMatchObject({ result_status: 201, result_resource_id: sent.id, user_id: editor.userId });
  });

  it('EVM-037 K7 a repeat reads the entry again: an entry that is gone since (soft deleted) is 404, not a stored answer', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const sent = { id: uuidv7(), key: uuidv7() };
    const body = note('Tekst do usunięcia.');
    expect((await createEntry(editor, orderId, body, sent)).status).toBe(201);
    await sql`update timeline.timeline_entries set deleted_at = ${new Date(NOW)}, deleted_by = ${editor.userId} where id = ${sent.id}`.execute(
      admin(),
    );
    const again = await createEntry(editor, orderId, body, sent);
    expect(again.status).toBe(404);
    expect(codeOf(again.body)).toBe('not_found');
    expect(JSON.stringify(again.body)).not.toContain('usunięcia');
  });

  it('EVM-037 AC5 the same key with another body is 422 idempotency_mismatch and writes nothing', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const key = uuidv7();
    expect((await createEntry(editor, orderId, note('Pierwsza.'), { key })).status).toBe(201);
    const mismatch = await createEntry(editor, orderId, note('Inna treść.'), { key });
    expect(mismatch.status).toBe(422);
    expect(codeOf(mismatch.body)).toBe('idempotency_mismatch');
    expect(await rowsOf(orderId)).toHaveLength(1);
  });

  it('EVM-037 K7 the key is bound to the ORDER: the same key and body on another order is 422 idempotency_mismatch, never the entry of the first', async () => {
    const editor = await signIn('editor');
    const orderA = await order();
    const orderB = await order();
    const sent = { id: uuidv7(), key: uuidv7() };
    const body = note('Ta sama treść.');
    expect((await createEntry(editor, orderA.id, body, sent)).status).toBe(201);
    const other = await createEntry(editor, orderB.id, body, sent);
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    expect(await rowsOf(orderB.id)).toHaveLength(0);
  });

  it('EVM-037 AC5 an existing id with another key is 409 id_conflict and says nothing of the existing entry — also an entry of another order', async () => {
    const editor = await signIn('editor');
    const orderA = await order();
    const orderB = await order();
    const sent = { id: uuidv7() };
    expect((await createEntry(editor, orderA.id, note('Pierwszy.'), sent)).status).toBe(201);
    const same = await createEntry(editor, orderA.id, note('Drugi.'), { id: sent.id });
    const foreign = await createEntry(editor, orderB.id, note('Trzeci.'), { id: sent.id });
    for (const response of [same, foreign]) {
      expect(response.status).toBe(409);
      expect(codeOf(response.body)).toBe('id_conflict');
      expect(JSON.stringify(response.body)).not.toContain('Pierwszy');
    }
    expect(await rowsOf(orderB.id)).toHaveLength(0);
    // the failed attempt leaves no record: the key of the refused request is free
    expect(await idempotencyRecords()).toHaveLength(1);
  });

  it('EVM-037 AC5 a parallel request with the same key is 409 idempotency_in_progress with Retry-After', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const key = uuidv7();
    await admin()
      .transaction()
      .execute(async (tx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`idempotency|${editor.userId}||${key}`}, 0))`.execute(tx);
        const refused = await createEntry(editor, orderId, note(), { key });
        expect(refused.status).toBe(409);
        expect(codeOf(refused.body)).toBe('idempotency_in_progress');
        expect(refused.headers['retry-after']).toBe('1');
      });
    expect(await rowsOf(orderId)).toHaveLength(0);
  });

  it('EVM-037 K7 the Idempotency-Key is required: a missing or malformed one is 400 with the pointer of the header', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const missing = await createEntry(editor, orderId, note(), { key: null });
    expect(missing.status).toBe(400);
    expect(errorsOf(missing.body)).toEqual([{ pointer: '/headers/Idempotency-Key', code: 'required' }]);
    const malformed = await createEntry(editor, orderId, note(), { key: 'not-a-key' });
    expect(errorsOf(malformed.body)).toEqual([{ pointer: '/headers/Idempotency-Key', code: 'invalid_format' }]);
    expect(await idempotencyRecords()).toHaveLength(0);
  });

  it('EVM-037 K7 a rejected request leaves no record of idempotency (the record exists only after validation)', async () => {
    const editor = await signIn('editor');
    const orderA = await order();
    const orderB = await order();
    const stageOfB = orderB.stageIds[0];
    await createEntry(editor, orderA.id, note('Tekst', { procedureStageId: stageOfB }));
    await createEntry(editor, orderA.id, note('Tekst', { supersedesEntryId: uuidv7() }));
    await createEntry(editor, orderA.id, { kind: 'note', body: 'Tekst' });
    expect(await idempotencyRecords()).toHaveLength(0);
    expect((await auditTotal('timeline_entry.created')) - auditBaseline).toBe(0);
  });
});

describe('EVM-037 AC7 — a closed order and the consistency of the order (SR-AUTHZ-02, CWE-639)', () => {
  it.each<WorkOrderStatus>(['settled', 'cancelled'])(
    'EVM-037 AC7 an order that is %s takes an entry (nic nie ginie, PO-8)',
    async (status) => {
      const editor = await signIn('editor');
      const { id: orderId } = await order({ status });
      const response = await createEntry(editor, orderId, note('Wpis po zamknięciu.'));
      expect(response.status).toBe(201);
      expect(await rowsOf(orderId)).toHaveLength(1);
    },
  );

  it('EVM-037 AC7 a stage of another order, a missing stage and a deleted stage are ONE answer: 400 validation_failed at /procedureStageId', async () => {
    const editor = await signIn('editor');
    const orderA = await order();
    const orderB = await order();
    const deleted = await insertProcedure(admin(), orderA.id, {
      position: 2,
      stages: [{ deletedAt: new Date('2026-10-10T08:00:00Z') }],
    });
    const answers = [];
    for (const stageId of [orderB.stageIds[0], uuidv7(), deleted.stageIds[0]]) {
      const response = await createEntry(editor, orderA.id, note('Tekst', { procedureStageId: stageId }));
      expect(response.status).toBe(400);
      answers.push(JSON.stringify({ ...(response.body as object), traceId: '' }));
    }
    expect(new Set(answers).size).toBe(1);
    expect(JSON.parse(answers[0] ?? '{}')).toMatchObject({
      code: 'validation_failed',
      errors: [{ pointer: '/procedureStageId', code: 'unknown_stage' }],
    });
    expect(await rowsOf(orderA.id)).toHaveLength(0);
  });

  it('EVM-037 AC7 a stage of an order that is closed is accepted (the stage is only a label)', async () => {
    const editor = await signIn('editor');
    const { id: orderId, stageIds } = await order({ status: 'settled' });
    const response = await createEntry(editor, orderId, note('Tekst', { procedureStageId: stageIds[0] }));
    expect(response.status).toBe(201);
  });

  it('EVM-037 AC7 a deleted order and a missing order are the same 404 for the list and the creation — for every role', async () => {
    const deleted = await order({ deleted: true });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      const missingList = await listOf(browser, uuidv7());
      const deletedList = await listOf(browser, deleted.id);
      expect(missingList.status).toBe(404);
      expect(deletedList.status).toBe(404);
      expect(codeOf(deletedList.body)).toBe('not_found');
      if (role === 'read_only') continue;
      const missing = await createEntry(browser, uuidv7(), note());
      const gone = await createEntry(browser, deleted.id, note());
      expect([missing.status, gone.status]).toEqual([404, 404]);
      expect(codeOf(gone.body)).toBe('not_found');
      // 404 comes before the header and the body: a malformed request tells nothing about an order that is not the caller's
      const malformed = await createEntry(browser, deleted.id, { kind: 'event' }, { key: null });
      expect(malformed.status).toBe(404);
    }
    expect(await rowsOf(deleted.id)).toHaveLength(0);
  });
});

describe('EVM-037 AC8 — roles, channel and CSRF (SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-12)', () => {
  it('EVM-037 AC8 Read-only gets 403 forbidden for ANY body — valid, malformed, without a key — and nothing is written', async () => {
    const reader = await signIn('read_only');
    const { id: orderId } = await order();
    const valid = await createEntry(reader, orderId, note());
    const malformed = await createEntry(reader, orderId, { kind: 'event', body: 12 }, { key: null });
    const foreign = await createEntry(reader, uuidv7(), note());
    for (const response of [valid, malformed, foreign]) {
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    expect(await rowsOf(orderId)).toHaveLength(0);
    expect(await idempotencyRecords()).toHaveLength(0);
  });

  it('EVM-037 AC8 an anonymous caller gets 401 and a request without the CSRF token 403 csrf_failed', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const noSession = await anonymous.post(`${BASE}/${orderId}/timeline`, { id: uuidv7(), ...note() }, { 'Idempotency-Key': uuidv7() });
    expect(noSession.status).toBe(401);
    const noToken = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    noToken.cookie = editor.panel.cookie;
    const refused = await noToken.post(`${BASE}/${orderId}/timeline`, { id: uuidv7(), ...note() }, { 'Idempotency-Key': uuidv7() });
    expect(refused.status).toBe(403);
    expect(codeOf(refused.body)).toBe('csrf_failed');
    expect((await anonymous.get(`${BASE}/${orderId}/timeline`)).status).toBe(401);
    expect(await rowsOf(orderId)).toHaveLength(0);
  });

  it('EVM-037 AC8 a mobile token is 403 channel_not_allowed on the three operations, before the object is looked at', async () => {
    const mobile = await signIn('editor', 'mobile');
    const { id: orderId } = await order();
    const entryId = (await insertEntries(admin(), orderId, mobile.userId, [{}]))[0] ?? '';
    const write = await createEntry(mobile, orderId, note());
    const list = await listOf(mobile, orderId);
    const read = await mobile.panel.get(`${BASE}/${orderId}/timeline/${entryId}`);
    for (const response of [write, list, read]) expect(response.status).toBe(403);
    const missing = await listOf(mobile, uuidv7());
    expect(missing.status).toBe(403);
    expect(await rowsOf(orderId)).toHaveLength(1);
  });
});

describe('EVM-037 K4 — the strict contract (SR-INPUT-01, SR-AUTHZ-04, CWE-915)', () => {
  it.each(['author', 'createdAt', 'origin', 'capturedAt', 'supersededByEntryId', 'redactedAt', 'version', 'workOrderId', 'createdBy'])(
    'EVM-037 K4 the server field %s is 400 read_only_field and writes nothing',
    async (field) => {
      const editor = await signIn('editor');
      const { id: orderId } = await order();
      const response = await createEntry(editor, orderId, note('Tekst', { [field]: field === 'version' ? 1 : 'x' }));
      expect(response.status).toBe(400);
      expect(errorsOf(response.body)).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
      expect(await rowsOf(orderId)).toHaveLength(0);
    },
  );

  it('EVM-037 K4 a stranger is 400 unknown_field; kind event, a bad uuid and a non-string body are 400', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const stranger = await createEntry(editor, orderId, note('Tekst', { role: 'administrator' }));
    expect(errorsOf(stranger.body)).toEqual([{ pointer: '/role', code: 'unknown_field' }]);
    const proto = await editor.panel
      .post(`${BASE}/${orderId}/timeline`, undefined, { 'Idempotency-Key': uuidv7() })
      .set('Content-Type', 'application/json')
      .send(`{"id":"${uuidv7()}","kind":"note","noteCategory":"other","body":"x","__proto__":{"origin":"system"}}`);
    expect(proto.status).toBe(400);
    expect((await createEntry(editor, orderId, { kind: 'event', body: 'x' })).status).toBe(400);
    expect((await createEntry(editor, orderId, note('x'), { id: 'abc' })).status).toBe(400);
    expect((await createEntry(editor, orderId, { kind: 'note', noteCategory: 'other', body: 12 })).status).toBe(400);
    expect((await createEntry(editor, orderId, note('x', { procedureStageId: 'abc' }))).status).toBe(400);
    expect(await rowsOf(orderId)).toHaveLength(0);
  });

  it('EVM-037 K13 a body over the limit of the route (64 KB) is 413 without an echo of the text', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const huge = await createEntry(editor, orderId, note('z'.repeat(70_000)));
    expect(huge.status).toBe(413);
    expect(codeOf(huge.body)).toBe('payload_too_large');
    expect(JSON.stringify(huge.body)).not.toContain('zzzzzzzzzz');
  });
});

describe('EVM-037 K10 — the audit trail and the logs never carry the text (SR-LOG-02, SR-LOG-03, SR-ERR-02)', () => {
  it('EVM-037 K10 timeline_entry.created carries the actor, the entry, the outcome and the trace — and no text, category or stage', async () => {
    const editor = await signIn('editor');
    const { id: orderId, stageIds } = await order();
    const id = uuidv7();
    const marker = 'POUFNE-NAZWISKO-KLIENTA-ZZ9';
    const response = await createEntry(editor, orderId, note(`Rozmowa z ${marker}.`, { procedureStageId: stageIds[0] }), { id });
    expect(response.status).toBe(201);
    const events = await auditOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'timeline_entry.created',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: editor.userId,
      object_type: 'timeline_entry',
      object_id: id,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toContain(marker);
    expect(JSON.stringify(events)).not.toContain('phone_call');
    expect(current.logs.text).not.toContain(marker);
  });

  it('EVM-037 K10 a rejected request — too long, a stranger field, a foreign stage — leaves the text nowhere: not in the answer, the logs, the audit trail or the records', async () => {
    const editor = await signIn('editor');
    const orderA = await order();
    const orderB = await order();
    const marker = 'POUFNY-TEKST-ODRZUCONY-QQ7';
    const attempts = [
      note(`${marker}${'a'.repeat(10_000)}`),
      note(marker, { role: 'administrator' }),
      note(marker, { procedureStageId: orderB.stageIds[0] }),
      note(marker, { supersedesEntryId: uuidv7() }),
      { kind: 'comment', noteCategory: 'other', body: marker },
    ];
    for (const attempt of attempts) {
      const response = await createEntry(editor, orderA.id, attempt);
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain(marker);
    }
    expect(current.logs.text).not.toContain(marker);
    expect(JSON.stringify(await idempotencyRecords())).not.toContain(marker);
    expect((await auditTotal('timeline_entry.created')) - auditBaseline).toBe(0);
  });
});
