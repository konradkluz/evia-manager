import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(ISSUED_AT);
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;
const BASE = '/api/v1/work-orders';
const TITLE = 'Wallbox w garażu — dom syntetyczny';
const DESCRIPTION = 'Trasa kabla przez szacht B, rozdzielnica na poziomie −1.';

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web', displayName?: string) {
  const user = await createUser(admin(), current.clock, { role, ...(displayName === undefined ? {} : { displayName }) });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
interface OrderOptions {
  readonly status?: WorkOrderStatus;
  readonly deleted?: boolean;
  readonly coordinatorId?: string;
  readonly description?: string;
  readonly plannedDate?: string;
}
async function order(options: OrderOptions = {}): Promise<string> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-4${String(numbering).padStart(3, '0')}-0001`,
      title: TITLE,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.coordinatorId === undefined ? {} : { coordinatorId: options.coordinatorId }),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  if (options.description !== undefined) {
    await sql`update work_orders.work_orders set description = ${options.description} where id = ${id}`.execute(admin());
  }
  if (options.plannedDate !== undefined) {
    await sql`update work_orders.work_orders set planned_date = ${options.plannedDate} where id = ${id}`.execute(admin());
  }
  return id;
}

interface PatchOptions {
  readonly ifMatch?: string | null;
  readonly key?: string;
}
const patch = (browser: Browser, orderId: string, body: unknown, options: PatchOptions = {}) =>
  browser.panel.patch(`${BASE}/${orderId}`, body, {
    ...(options.ifMatch === null ? {} : { 'If-Match': options.ifMatch ?? '"1"' }),
    ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
  });
const header = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}`);

const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');

interface OrderRow {
  title: string;
  description: string | null;
  planned_date: string | null;
  status: string;
  number: string;
  version: number;
  updated_by: string | null;
}
async function rowOf(orderId: string): Promise<OrderRow> {
  const { rows } =
    await sql<OrderRow>`select title, description, to_char(planned_date, 'YYYY-MM-DD') as planned_date, status, number, version,
      updated_by from work_orders.work_orders where id = ${orderId}`.execute(admin());
  const row = rows[0];
  if (row === undefined) throw new Error('no such order');
  return row;
}
const coordinatorsOf = async (orderId: string) =>
  (
    await sql<{ user_id: string; deleted_at: Date | null }>`
      select user_id, deleted_at from work_orders.work_order_assignments
      where work_order_id = ${orderId} and role = 'coordinator' order by created_at, id`.execute(admin())
  ).rows;
const rawEvents = async (orderId: string) =>
  (
    await sql<{ event_code: string; event_payload: unknown }>`
      select event_code, event_payload from timeline.timeline_entries
      where work_order_id = ${orderId} and kind = 'event' order by created_at, id`.execute(admin())
  ).rows;
/** The audit trail is append-only and is not emptied between tests: a test looks at the records of ITS order. */
const auditOf = async (action: string, objectId: string) =>
  (
    await sql<
      Record<string, unknown>
    >`select * from audit.events where action = ${action} and object_id = ${objectId} order by occurred_at, id`.execute(admin())
  ).rows;
const recordsTotal = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin())).rows[0]?.n);

describe('the change of the data of an order (EVM-035 AC1; SR-API-07, SR-INPUT-01)', () => {
  it('EVM-035 AC1 the title, the description, the planned date and the coordinator are saved with If-Match: 200, a new ETag, version + 1, and the header shows them', async () => {
    const anna = await signIn('editor', 'web', 'Anna Testowa');
    const piotr = await signIn('administrator', 'web', 'Piotr Testowy');
    const id = await order({ coordinatorId: anna.userId });
    const response = await patch(anna, id, {
      title: '  Garaż — pełny proces  ',
      description: 'Nowy opis\r\ndruga linia',
      plannedDate: '2026-11-15',
      assigneeUserId: piotr.userId,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(response.body).toMatchObject({
      id,
      title: 'Garaż — pełny proces',
      description: 'Nowy opis\ndruga linia',
      plannedDate: '2026-11-15',
      coordinator: { id: piotr.userId, displayName: 'Piotr Testowy' },
      status: 'new',
      version: 2,
    });
    expect(await rowOf(id)).toMatchObject({
      title: 'Garaż — pełny proces',
      description: 'Nowy opis\ndruga linia',
      planned_date: '2026-11-15',
      version: 2,
      updated_by: anna.userId,
    });
    const read = await header(anna, id);
    expect(read.headers['etag']).toBe('"2"');
    expect(read.body).toMatchObject({ description: 'Nowy opis\ndruga linia', plannedDate: '2026-11-15' });
  });

  it('EVM-035 AC1 the coordinator is REPLACED: the old assignment ends (soft delete), the new one is the only active one', async () => {
    const anna = await signIn('editor');
    const piotr = await signIn('editor');
    const id = await order({ coordinatorId: anna.userId });
    expect((await patch(anna, id, { assigneeUserId: piotr.userId })).status).toBe(200);
    const rows = await coordinatorsOf(id);
    expect(rows.map((row) => [row.user_id, row.deleted_at === null])).toEqual([
      [anna.userId, false],
      [piotr.userId, true],
    ]);
    // the same person again is no change: no new assignment
    expect((await patch(anna, id, { assigneeUserId: piotr.userId }, { ifMatch: '"2"' })).status).toBe(200);
    expect(await coordinatorsOf(id)).toHaveLength(2);
    expect((await header(anna, id)).headers['etag']).toBe('"2"');
  });

  it('EVM-035 AC1 null clears the description and the planned date; an empty text clears the description too', async () => {
    const editor = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId, description: DESCRIPTION, plannedDate: '2026-12-01' });
    const response = await patch(editor, id, { description: null, plannedDate: null });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await rowOf(id)).toMatchObject({ description: null, planned_date: null, version: 2 });
    expect(Object.keys(response.body as object)).not.toContain('description');
    expect(Object.keys(response.body as object)).not.toContain('plannedDate');
    await sql`update work_orders.work_orders set description = 'x' where id = ${id}`.execute(admin());
    expect((await patch(editor, id, { description: '   ' }, { ifMatch: '"2"' })).status).toBe(200);
    expect((await rowOf(id)).description).toBeNull();
  });

  it('EVM-035 AC1 a stale If-Match is 412 version_conflict and the order stays as it was (no event, no audit, no current value in the answer)', async () => {
    const editor = await signIn('editor');
    const other = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId });
    expect((await patch(other, id, { title: 'Zmiana kolegi' })).status).toBe(200);
    const stale = await patch(editor, id, { title: 'Moja zmiana', description: DESCRIPTION });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(JSON.stringify(stale.body)).not.toMatch(/Zmiana kolegi|Moja zmiana|"version"/);
    expect(await rowOf(id)).toMatchObject({ title: 'Zmiana kolegi', description: null, version: 2 });
    expect(await rawEvents(id)).toHaveLength(1);
    expect(await auditOf('work_order.updated', id)).toHaveLength(1);
  });

  it('EVM-035 AC1 SR-API-07 a missing If-Match is 428 precondition_required; a weak one, a list, * and a malformed one are 400 on the header', async () => {
    const editor = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId });
    const missing = await patch(editor, id, { title: 'Nowy' }, { ifMatch: null });
    expect(missing.status).toBe(428);
    expect(codeOf(missing.body)).toBe('precondition_required');
    for (const ifMatch of ['W/"1"', '*', '"1", "2"', '1', '"0"', '""']) {
      const response = await patch(editor, id, { title: 'Nowy' }, { ifMatch });
      expect(response.status, ifMatch).toBe(400);
      expect(errorsOf(response.body), ifMatch).toEqual([{ pointer: '/headers/If-Match', code: 'invalid_format' }]);
    }
    expect((await rowOf(id)).title).toBe(TITLE);
  });

  it('EVM-035 AC1 a person who does not exist, is only invited, is deactivated or is deleted is ONE answer — 400, /assigneeUserId, assignee_unavailable; the order is untouched', async () => {
    const editor = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId });
    const invited = await createUser(admin(), current.clock, { status: 'invited' });
    const deactivated = await createUser(admin(), current.clock, { status: 'deactivated' });
    const deleted = await createUser(admin(), current.clock, { status: 'active' });
    await sql`update identity.users set deleted_at = now() where id = ${deleted.id}`.execute(admin());
    const answers = [];
    for (const assigneeUserId of [uuidv7(), invited.id, deactivated.id, deleted.id]) {
      answers.push(await patch(editor, id, { title: 'Nowy tytuł', assigneeUserId }));
    }
    for (const answer of answers) {
      expect(answer.status).toBe(400);
      expect(codeOf(answer.body)).toBe('validation_failed');
      expect(errorsOf(answer.body)).toEqual([{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }]);
      expect(withoutTrace(answer.body)).toBe(withoutTrace(answers[0]?.body));
    }
    expect(await rowOf(id)).toMatchObject({ title: TITLE, version: 1 });
    expect(await coordinatorsOf(id)).toHaveLength(1);
    expect(await rawEvents(id)).toHaveLength(0);
  });

  it('EVM-035 AC1 an order that has no coordinator gets one: the first assignment, nothing to end', async () => {
    const editor = await signIn('editor');
    const piotr = await signIn('editor');
    const id = await order();
    expect(await coordinatorsOf(id)).toEqual([]);
    const response = await patch(editor, id, { assigneeUserId: piotr.userId });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await coordinatorsOf(id)).map((row) => [row.user_id, row.deleted_at === null])).toEqual([[piotr.userId, true]]);
  });

  it('EVM-035 AC1 a coordinator who is no longer active does not block saving the other fields when he is not changed', async () => {
    const editor = await signIn('editor');
    const former = await createUser(admin(), current.clock, { status: 'deactivated' });
    const id = await order({ coordinatorId: former.id });
    const response = await patch(editor, id, { title: 'Nowy tytuł', assigneeUserId: former.id });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await rowOf(id)).title).toBe('Nowy tytuł');
  });

  it('EVM-035 AC1 a repeat of the same key, order and body is the SAME change: 200 with Idempotent-Replayed, one event, one audit record — also when If-Match is already stale', async () => {
    const editor = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId });
    const key = uuidv7();
    const first = await patch(editor, id, { title: 'Nowy tytuł' }, { key });
    expect(first.status).toBe(200);
    const again = await patch(editor, id, { title: 'Nowy tytuł' }, { key });
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.headers['etag']).toBe('"2"');
    expect(await rawEvents(id)).toHaveLength(1);
    expect(await auditOf('work_order.updated', id)).toHaveLength(1);
    expect((await rowOf(id)).version).toBe(2);
  });

  it('EVM-035 AC1 SR-API-05 the key is bound to the ORDER and to the body: the same key on another order or with another body is 422 idempotency_mismatch and changes nothing', async () => {
    const editor = await signIn('editor');
    const first = await order({ coordinatorId: editor.userId });
    const second = await order({ coordinatorId: editor.userId });
    const key = uuidv7();
    expect((await patch(editor, first, { title: 'Nowy tytuł' }, { key })).status).toBe(200);
    const other = await patch(editor, second, { title: 'Nowy tytuł' }, { key });
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    const changed = await patch(editor, first, { title: 'Inny tytuł' }, { key });
    expect(changed.status).toBe(422);
    expect(codeOf(changed.body)).toBe('idempotency_mismatch');
    expect((await rowOf(second)).title).toBe(TITLE);
    expect((await rowOf(first)).title).toBe('Nowy tytuł');
  });

  it('EVM-035 AC1 SR-API-06 two people saving on the same version: exactly one wins (200), the other is 412 — the lock of the order serialises them', async () => {
    const one = await signIn('editor');
    const two = await signIn('administrator');
    const id = await order({ coordinatorId: one.userId });
    const [a, b] = await Promise.all([patch(one, id, { title: 'Wersja Anny' }), patch(two, id, { title: 'Wersja Piotra' })]);
    expect([a.status, b.status].sort()).toEqual([200, 412]);
    expect((await rowOf(id)).version).toBe(2);
  });

  it('EVM-035 AC1 a patch that changes nothing writes nothing: no new version, no event, no audit record — and the answer is the order as it is', async () => {
    const editor = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId, description: DESCRIPTION });
    const response = await patch(editor, id, { title: TITLE, description: DESCRIPTION, assigneeUserId: editor.userId });
    expect(response.status).toBe(200);
    expect(response.headers['etag']).toBe('"1"');
    expect((await rowOf(id)).version).toBe(1);
    expect(await rawEvents(id)).toHaveLength(0);
    expect(await auditOf('work_order.updated', id)).toHaveLength(0);
  });
});

describe('the rules of the fields (EVM-035 AC4, AC8; SR-INPUT-01, SR-INPUT-02, SR-INPUT-05, SR-AUTHZ-04)', () => {
  it('EVM-035 AC8 a field of the server — number, status, customerId, siteId, version — is 400 read_only_field with a pointer; the order is untouched, and no value comes back', async () => {
    const editor = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId });
    for (const [field, value] of [
      ['number', 'ZL-2026-9999'],
      ['status', 'settled'],
      ['customerId', uuidv7()],
      ['siteId', uuidv7()],
      ['version', 99],
      ['scopeItems', []],
      ['id', uuidv7()],
    ] as const) {
      const response = await patch(editor, id, { title: 'Nowy tytuł', [field]: value });
      expect(response.status, field).toBe(400);
      expect(codeOf(response.body), field).toBe('validation_failed');
      expect(errorsOf(response.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
      expect(withoutTrace(response.body), field).not.toMatch(/ZL-2026-9999|settled|99/);
    }
    expect(await rowOf(id)).toMatchObject({ title: TITLE, status: 'new', version: 1 });
  });

  it('EVM-035 AC4 a field the contract does not know is 400 unknown_field — also __proto__ and constructor; the value never comes back', async () => {
    const editor = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId });
    const unknown = await patch(editor, id, { title: 'Nowy', secret: 'wartość-sekretna' });
    expect(unknown.status).toBe(400);
    expect(errorsOf(unknown.body)).toEqual([{ pointer: '/secret', code: 'unknown_field' }]);
    expect(JSON.stringify(unknown.body)).not.toContain('wartość-sekretna');
    const proto = await editor.panel
      .patch(`${BASE}/${id}`, undefined, { 'If-Match': '"1"' })
      .set('Content-Type', 'application/json')
      .send('{"title":"Nowy","__proto__":{"isAdmin":true},"constructor":{"x":1}}');
    expect(proto.status).toBe(400);
    expect(errorsOf(proto.body)?.every((error) => error.code === 'unknown_field')).toBe(true);
    expect((await rowOf(id)).title).toBe(TITLE);
  });

  it('EVM-035 AC4 an empty patch, an empty title, null title, a title of 201 characters, a control character and a date outside the range are 400 with a pointer and a code', async () => {
    const editor = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId });
    const cases: Array<[unknown, Array<{ pointer: string; code: string }>]> = [
      [{}, [{ pointer: '', code: 'required' }]],
      [{ title: '   ' }, [{ pointer: '/title', code: 'required' }]],
      [{ title: null }, [{ pointer: '/title', code: 'invalid_type' }]],
      [{ title: 'a'.repeat(201) }, [{ pointer: '/title', code: 'too_long' }]],
      [{ title: 'a\u0007b' }, [{ pointer: '/title', code: 'invalid_characters' }]],
      [{ description: 'a'.repeat(2001) }, [{ pointer: '/description', code: 'too_long' }]],
      [{ plannedDate: '1999-12-31' }, [{ pointer: '/plannedDate', code: 'out_of_range' }]],
      [{ plannedDate: '2026-02-30' }, [{ pointer: '/plannedDate', code: 'invalid_format' }]],
      [{ assigneeUserId: null }, [{ pointer: '/assigneeUserId', code: 'invalid_type' }]],
      [{ assigneeUserId: 'x' }, [{ pointer: '/assigneeUserId', code: 'invalid_format' }]],
    ];
    for (const [body, expected] of cases) {
      const response = await patch(editor, id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(errorsOf(response.body), JSON.stringify(body)).toEqual(expected);
    }
    expect((await rowOf(id)).version).toBe(1);
  });

  it('EVM-035 AC4 SR-API-02 a body of more than 32 KB is 413 before it is parsed', async () => {
    const editor = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId });
    const response = await patch(editor, id, { title: 'a'.repeat(40_000) });
    expect(response.status).toBe(413);
    expect(codeOf(response.body)).toBe('payload_too_large');
    expect((await rowOf(id)).version).toBe(1);
  });
});

describe('a closed order (EVM-035 AC6; PO-8, decision 17)', () => {
  it('EVM-035 AC6 a settled and a cancelled order is 409 work_order_closed — BEFORE the version, so a stale tag still learns the true reason — and nothing changes', async () => {
    const editor = await signIn('editor');
    for (const status of ['settled', 'cancelled'] as const) {
      const id = await order({ status, coordinatorId: editor.userId });
      const response = await patch(editor, id, { title: 'Nowy tytuł' }, { ifMatch: '"7"' });
      expect(response.status, status).toBe(409);
      expect(codeOf(response.body), status).toBe('work_order_closed');
      expect(JSON.stringify(response.body)).not.toMatch(/settled|cancelled|Nowy tytuł/);
      expect(await rowOf(id)).toMatchObject({ title: TITLE, version: 1 });
      expect(await rawEvents(id)).toHaveLength(0);
    }
  });

  it('EVM-035 AC6 after the order is opened again (restored), the same patch is accepted', async () => {
    const editor = await signIn('editor');
    const id = await order({ status: 'settled', coordinatorId: editor.userId });
    expect((await patch(editor, id, { title: 'Nowy tytuł' })).status).toBe(409);
    await sql`update work_orders.work_orders set status = 'completed' where id = ${id}`.execute(admin());
    expect((await patch(editor, id, { title: 'Nowy tytuł' })).status).toBe(200);
  });

  it('EVM-035 AC6 SR-API-06 the closing and a change racing each other: either the change is made before the closing (200 and the cancellation is 412), or the order is closed first (409) — never both', async () => {
    const editor = await signIn('editor');
    const id = await order({ status: 'new', coordinatorId: editor.userId });
    const cancel = editor.panel.post(`${BASE}/${id}/transitions`, { to: 'cancelled', reason: 'powód syntetyczny' }).set('If-Match', '"1"');
    const [saved, cancelled] = await Promise.all([patch(editor, id, { title: 'Nowy tytuł' }), cancel]);
    const outcome = [saved.status, cancelled.status];
    expect(outcome.join(',') === '200,412' || outcome.join(',') === '409,200').toBe(true);
    const row = await rowOf(id);
    if (saved.status === 200) expect(row).toMatchObject({ title: 'Nowy tytuł', status: 'new' });
    else expect(row).toMatchObject({ title: TITLE, status: 'cancelled' });
  });
});

describe('the journal and the audit trail of a change (EVM-035 AC7; SR-LOG-03, SR-DATA-01, TM-20)', () => {
  it('EVM-035 AC7 ONE event with the NAMES of the fields that changed — and the raw payload and the audit record hold no title, no description and no name of the person', async () => {
    const anna = await signIn('editor', 'web', 'Anna Testowa');
    const piotr = await signIn('editor', 'web', 'Piotr Testowy');
    const id = await order({ coordinatorId: anna.userId });
    const response = await patch(anna, id, {
      title: 'Tytuł z danymi Jana Przykładowego',
      description: 'Klucz u sąsiadki pod numerem 12',
      plannedDate: '2026-11-20',
      assigneeUserId: piotr.userId,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const events = await rawEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event_code: 'work_order_fields_changed',
      event_payload: { objectType: 'work_order', objectId: id, changedFields: ['title', 'description', 'plannedDate', 'coordinator'] },
    });
    const raw = JSON.stringify(events);
    expect(raw).not.toMatch(/Jana|Przykładow|sąsiad|Klucz|Anna|Piotr|2026-11-20/);

    const records = await auditOf('work_order.updated', id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: 'work_order.updated',
      outcome: 'success',
      object_type: 'work_order',
      object_id: id,
      actor_user_id: anna.userId,
    });
    expect(JSON.stringify(records)).not.toMatch(/Jana|Przykładow|sąsiad|Klucz|Anna|Piotr|2026-11-20|title|description/);
  });

  it('EVM-035 AC7 the journal of the order shows the event to a reader, as the names of the fields only (the API of EVM-037)', async () => {
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const id = await order({ coordinatorId: editor.userId });
    expect((await patch(editor, id, { plannedDate: '2026-11-20', description: DESCRIPTION })).status).toBe(200);
    const response = await reader.panel.get(`${BASE}/${id}/timeline?eventGroup=status_changes&limit=100`);
    expect(response.status).toBe(200);
    const items = (
      response.body as {
        items: Array<{ kind: string; body: string | null; author: { id: string } | null; event: Record<string, unknown> }>;
      }
    ).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'event',
      body: null,
      author: { id: editor.userId },
      event: { code: 'work_order_fields_changed', objectType: 'work_order', changedFields: ['description', 'plannedDate'] },
    });
    expect(JSON.stringify(response.body)).not.toContain(DESCRIPTION);
  });

  it('EVM-035 AC7 SR-API-06 when the event cannot be written, the change is not stored: the order, the audit and the idempotency record are as before', async () => {
    const editor = await signIn('editor');
    const id = await order({ coordinatorId: editor.userId });
    const recordsBefore = await recordsTotal();
    await sql`
      create function timeline.fail_event_write() returns trigger language plpgsql as $$
      begin
        if new.kind = 'event' then raise exception 'the journal refuses an event' using errcode = 'EV999'; end if;
        return new;
      end $$`.execute(admin());
    await sql`create trigger fail_event_write before insert on timeline.timeline_entries
      for each row execute function timeline.fail_event_write()`.execute(admin());
    try {
      const response = await patch(editor, id, { title: 'Nowy tytuł' }, { key: uuidv7() });
      expect(response.status).toBe(500);
      expect(codeOf(response.body)).toBe('internal_error');
      expect(JSON.stringify(response.body)).not.toMatch(/journal refuses|EV999|timeline|trigger|Nowy tytuł/i);
    } finally {
      await sql`drop trigger fail_event_write on timeline.timeline_entries`.execute(admin());
      await sql`drop function timeline.fail_event_write()`.execute(admin());
    }
    expect(await rowOf(id)).toMatchObject({ title: TITLE, version: 1 });
    expect(await auditOf('work_order.updated', id)).toHaveLength(0);
    expect(await recordsTotal()).toBe(recordsBefore);
  });
});

describe('who may change the data of an order (EVM-035 AC8; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639)', () => {
  it('EVM-035 AC8 Administrator and Editor change it; Tylko odczyt is 403 forbidden for any order — one that exists, a deleted one and one that does not exist — and for any body; an anonymous caller is 401', async () => {
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const reader = await signIn('read_only');
    const id = await order({ coordinatorId: editor.userId });
    expect((await patch(administrator, id, { title: 'Od administratora' })).status).toBe(200);
    expect((await patch(editor, id, { title: 'Od edytora' }, { ifMatch: '"2"' })).status).toBe(200);
    const deleted = await order({ deleted: true });
    for (const target of [id, deleted, uuidv7()]) {
      for (const body of [{ title: 'Nowy' }, {}, { number: 'x' }]) {
        const response = await patch(reader, target, body, { ifMatch: null });
        expect(response.status).toBe(403);
        expect(codeOf(response.body)).toBe('forbidden');
      }
    }
    const anonymous = await current.panel().patch(`${BASE}/${id}`).send({ title: 'Nowy' });
    expect(anonymous.status).toBe(401);
    expect((await rowOf(id)).title).toBe('Od edytora');
  });

  it('EVM-035 AC8 the token of the mobile channel is 403 forbidden: the panel edits, the phone synchronises (M2)', async () => {
    const mobile = await signIn('editor', 'mobile');
    const id = await order({ coordinatorId: mobile.userId });
    const response = await patch(mobile, id, { title: 'Nowy tytuł' });
    expect(response.status).toBe(403);
    expect((await rowOf(id)).title).toBe(TITLE);
  });

  it('EVM-035 AC8 a deleted order and one that does not exist are the same 404 for Administrator and Editor — before the headers and the body', async () => {
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const deleted = await order({ deleted: true });
    const answers = [];
    for (const browser of [administrator, editor]) {
      for (const target of [deleted, uuidv7()]) {
        answers.push(await patch(browser, target, { number: 'x' }, { ifMatch: null }));
      }
    }
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(codeOf(answer.body)).toBe('not_found');
      expect(withoutTrace(answer.body)).toBe(withoutTrace(answers[0]?.body));
    }
    expect((await rowOf(deleted)).title).toBe(TITLE);
  });
});
