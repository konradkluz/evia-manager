import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones, type MilestoneSpec } from '../support/payment-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

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
/** A synthetic name that would betray the free text wherever it leaked to (the audit trail, an error). */
const NAME_MARKER = 'Transza-znacznik-synt';

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
async function order(options: { status?: WorkOrderStatus; deleted?: boolean; milestones?: MilestoneSpec[] } = {}) {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-3${String(numbering).padStart(3, '0')}-0053`,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.status === 'settled' || options.status === 'cancelled' ? { closedAt: new Date('2026-10-12T08:00:00Z') } : {}),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  const milestoneIds = await insertMilestones(admin(), id, options.milestones ?? []);
  return { id, milestoneIds };
}

const pln = (amountMinor: number) => ({ amountMinor, currency: 'PLN' });
const listOf = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}/payment-milestones`);
const create = (browser: Browser, orderId: string, body: unknown, key: string | null = uuidv7()) =>
  browser.panel.post(`${BASE}/${orderId}/payment-milestones`, body, key === null ? {} : { 'Idempotency-Key': key });
const patch = (
  browser: Browser,
  orderId: string,
  milestoneId: string,
  body: unknown,
  options: { ifMatch?: string | null; key?: string } = {},
) =>
  browser.panel.patch(`${BASE}/${orderId}/payment-milestones/${milestoneId}`, body, {
    ...(options.ifMatch === null ? {} : { 'If-Match': options.ifMatch ?? '"1"' }),
    ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
  });
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;

interface Row {
  name: string;
  position: number;
  amount_minor: string | null;
  currency: string | null;
  status: string;
  version: number;
  updated_by: string | null;
  work_order_id: string;
}
async function rowOf(id: string): Promise<Row | undefined> {
  const { rows } = await sql<Row>`select name, position, amount_minor, currency, status, version, updated_by, work_order_id
    from payments.payment_milestones where id = ${id}`.execute(admin());
  return rows[0];
}
const countOf = async (orderId: string): Promise<number> =>
  Number(
    (
      await sql<{ n: string }>`select count(*)::text as n from payments.payment_milestones where work_order_id = ${orderId}`.execute(
        admin(),
      )
    ).rows[0]?.n,
  );
const auditOf = async (objectId: string) =>
  (
    await sql<
      Record<string, unknown>
    >`select action, actor_user_id, object_type, object_id, outcome, amount_before_minor, amount_after_minor,
      currency, trace_id from audit.events where object_id = ${objectId} order by occurred_at, id`.execute(admin())
  ).rows;

describe('the section "Płatności" (EVM-053 AC2, AC7; P6)', () => {
  it('EVM-053 AC2 the milestones in the order of position with name, share, amount, status, invoice and due date; unpaid = invoiced, paid = paid (planned and cancelled in neither)', async () => {
    current.clock.set(new Date('2026-10-13T10:00:00Z'));
    const created = await order({
      milestones: [
        { name: 'Zaliczka', status: 'paid', amountMinor: 360000 },
        { name: 'Po uzyskaniu zgód', status: 'invoiced', amountMinor: 540000, dueDate: '2026-10-12' },
        { name: 'Po wykonaniu instalacji', status: 'invoiced', amountMinor: 1, dueDate: '2026-10-13' },
        { name: 'Płatność końcowa', status: 'planned', amountMinor: 360000 },
        { name: 'Dodatkowa', status: 'cancelled', amountMinor: 999 },
        { name: 'Usunięta', status: 'invoiced', amountMinor: 7, deletedAt: new Date('2026-10-12T08:00:00Z') },
      ],
    });
    const response = await listOf(await signIn('read_only'), created.id);
    expect(response.status).toBe(200);
    const body = response.body as {
      items: Array<Record<string, unknown>>;
      totals: { unpaid: unknown; paid: unknown };
    };
    expect(body.items.map((item) => [item['position'], item['name'], item['status'], item['amount'], item['isOverdue']])).toEqual([
      [1, 'Zaliczka', 'paid', pln(360000), false],
      [2, 'Po uzyskaniu zgód', 'invoiced', pln(540000), true],
      [3, 'Po wykonaniu instalacji', 'invoiced', pln(1), false],
      [4, 'Płatność końcowa', 'planned', pln(360000), false],
      [5, 'Dodatkowa', 'cancelled', pln(999), false],
    ]);
    expect(body.items[1]).toMatchObject({ invoiceNumber: 'FV/2/2026', invoicedOn: '2026-10-01', dueDate: '2026-10-12', version: 1 });
    expect(body.totals).toEqual({ unpaid: pln(540001), paid: pln(360000) });
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(
      [
        'id',
        'code',
        'name',
        'position',
        'sharePercent',
        'paymentTermDays',
        'amount',
        'status',
        'invoiceNumber',
        'invoicedOn',
        'dueDate',
        'paidOn',
        'isOverdue',
        // EVM-056 AC4: the days overdue of the tile "Płatności" (additive, read-only)
        'overdueDays',
        'version',
        'allowedTransitions',
      ].sort(),
    );
  });

  it('EVM-053 AC2 an order without milestones is an empty list with zero totals', async () => {
    const created = await order();
    const response = await listOf(await signIn(), created.id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], totals: { unpaid: pln(0), paid: pln(0) } });
  });

  it('EVM-053 AC7 SR-AUTHZ-02 a missing and a soft-deleted order are the same 404 for every role, the Administrator included; a bad id is 400', async () => {
    const deleted = await order({ deleted: true, milestones: [{}] });
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      const gone = await listOf(browser, deleted.id);
      const missing = await listOf(browser, uuidv7());
      expect(gone.status, role).toBe(404);
      expect(missing.status, role).toBe(404);
      expect(codeOf(gone.body)).toBe('not_found');
    }
    expect((await listOf(await signIn(), 'x')).status).toBe(400);
  });
});

describe('"Zmień kwotę" — the amount of a planned milestone (EVM-053 AC3, AC5, AC7; SR-API-07, SR-LOG-03, SR-AUTHZ-10)', () => {
  it('EVM-053 AC3 the Editor enters 3 600,00 zł: the amount is stored in grosze (360000, PLN) with If-Match, the version goes up and the audit event has the amount before and after', async () => {
    const editor = await signIn();
    const created = await order({ milestones: [{ name: NAME_MARKER }] });
    const milestoneId = created.milestoneIds[0] ?? '';
    const response = await patch(editor, created.id, milestoneId, { amount: pln(360000) });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.body).toMatchObject({ id: milestoneId, amount: pln(360000), status: 'planned', version: 2 });
    expect(await rowOf(milestoneId)).toMatchObject({ amount_minor: '360000', currency: 'PLN', version: 2, updated_by: editor.userId });

    const again = await patch(editor, created.id, milestoneId, { amount: pln(400050) }, { ifMatch: '"2"' });
    expect(again.status).toBe(200);
    const audit = await auditOf(milestoneId);
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'payment_milestone.amount_changed',
        actor_user_id: editor.userId,
        object_type: 'payment_milestone',
        outcome: 'success',
        amount_before_minor: null,
        amount_after_minor: '360000',
        currency: 'PLN',
      }),
      expect.objectContaining({ amount_before_minor: '360000', amount_after_minor: '400050', currency: 'PLN' }),
    ]);
    expect(JSON.stringify(audit)).not.toContain(NAME_MARKER);
  });

  it('EVM-053 AC3 an amount of zero, negative, with a fraction of a grosz, as text, in another currency or null is 400 (a pointer and a code, never the value); the row is unchanged', async () => {
    const editor = await signIn();
    const created = await order({ milestones: [{}] });
    const milestoneId = created.milestoneIds[0] ?? '';
    for (const amount of [
      pln(0),
      pln(-100),
      pln(360000.5),
      { amountMinor: '360000', currency: 'PLN' },
      { amountMinor: 1, currency: 'EUR' },
      null,
    ]) {
      const response = await patch(editor, created.id, milestoneId, { amount });
      expect(response.status, JSON.stringify(amount)).toBe(400);
      expect(codeOf(response.body)).toBe('validation_failed');
      expect(errorsOf(response.body)?.[0]?.pointer).toMatch(/^\/amount/);
      expect(JSON.stringify(response.body)).not.toContain('360000');
    }
    expect(await rowOf(milestoneId)).toMatchObject({ amount_minor: null, version: 1 });
  });

  it('EVM-053 AC3 without If-Match it is 428; a weak or malformed tag 400; a stale version 412 with no current value — nothing is written', async () => {
    const editor = await signIn();
    const created = await order({ milestones: [{}] });
    const milestoneId = created.milestoneIds[0] ?? '';
    expect((await patch(editor, created.id, milestoneId, { amount: pln(1) }, { ifMatch: null })).status).toBe(428);
    expect((await patch(editor, created.id, milestoneId, { amount: pln(1) }, { ifMatch: 'W/"1"' })).status).toBe(400);
    const stale = await patch(editor, created.id, milestoneId, { amount: pln(1) }, { ifMatch: '"7"' });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(JSON.stringify(stale.body)).not.toMatch(/"version"|amount/);
    expect(await rowOf(milestoneId)).toMatchObject({ amount_minor: null, version: 1 });
    expect(await auditOf(milestoneId)).toEqual([]);
  });

  it('EVM-053 AC3 EVM-054 AC5 the amount of a milestone in another status than "Planowana" is 403 forbidden for the Editor and the Administrator (a correction — EVM-057), before the version (the order of EVM-054: 403 before 409 before 412)', async () => {
    const created = await order({ milestones: [{ status: 'invoiced', amountMinor: 100 }, { status: 'paid' }, { status: 'cancelled' }] });
    for (const role of ['editor', 'administrator'] as const) {
      const browser = await signIn(role);
      for (const milestoneId of created.milestoneIds) {
        const response = await patch(browser, created.id, milestoneId, { amount: pln(360000) });
        expect(response.status, `${role} ${milestoneId}`).toBe(403);
        expect(codeOf(response.body)).toBe('forbidden');
      }
      const stale = await patch(browser, created.id, created.milestoneIds[0] ?? '', { amount: pln(360000) }, { ifMatch: '"5"' });
      expect(stale.status).toBe(403);
    }
    expect(await rowOf(created.milestoneIds[0] ?? '')).toMatchObject({ amount_minor: '100', version: 1, status: 'invoiced' });
  });

  it('EVM-053 AC3 the same amount again is a change without effect: 200 with the current milestone, no new version and no audit event; 412 and 403 still come first', async () => {
    const editor = await signIn();
    const created = await order({ milestones: [{ amountMinor: 360000 }, { status: 'invoiced', amountMinor: 360000 }] });
    const [planned, invoiced] = created.milestoneIds;
    const same = await patch(editor, created.id, planned ?? '', { amount: pln(360000) });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.headers['etag']).toBe('"1"');
    expect(same.body).toMatchObject({ id: planned, amount: pln(360000), status: 'planned', version: 1 });
    const repeated = await patch(editor, created.id, planned ?? '', { amount: pln(360000) }, { key: uuidv7() });
    expect(repeated.status).toBe(200);
    expect(await rowOf(planned ?? '')).toMatchObject({ amount_minor: '360000', version: 1 });
    expect(await auditOf(planned ?? '')).toEqual([]);

    const stale = await patch(editor, created.id, planned ?? '', { amount: pln(360000) }, { ifMatch: '"2"' });
    expect(stale.status).toBe(412);
    const closed = await patch(editor, created.id, invoiced ?? '', { amount: pln(360000) });
    expect(closed.status).toBe(403);
    expect(await auditOf(invoiced ?? '')).toEqual([]);
  });

  it('EVM-053 AC7 EVM-054 AC4 SR-AUTHZ-04 the fields of the server — status, sharePercent, name, id, version, allowedTransitions, the reason — are read_only_field; a stranger is unknown_field', async () => {
    const editor = await signIn();
    const created = await order({ milestones: [{}] });
    const milestoneId = created.milestoneIds[0] ?? '';
    for (const field of [
      'status',
      'sharePercent',
      'name',
      'id',
      'version',
      'code',
      'position',
      'paymentTermDays',
      'isOverdue',
      'allowedTransitions',
      'statusReason',
    ]) {
      const response = await patch(editor, created.id, milestoneId, { amount: pln(1), [field]: 'paid' });
      expect(response.status, field).toBe(400);
      expect(errorsOf(response.body), field).toContainEqual({ pointer: `/${field}`, code: 'read_only_field' });
    }
    const stranger = await patch(editor, created.id, milestoneId, { amount: pln(1), discount: 5 });
    expect(errorsOf(stranger.body)).toContainEqual({ pointer: '/discount', code: 'unknown_field' });
    expect(await rowOf(milestoneId)).toMatchObject({ status: 'planned', version: 1 });
  });

  it('EVM-053 AC3 SR-API-05 a repeat with the same key and body is 200 with Idempotent-Replayed — one change, one audit event; the same key on another milestone is 422', async () => {
    const editor = await signIn();
    const created = await order({ milestones: [{}, {}] });
    const [first, second] = created.milestoneIds;
    const key = uuidv7();
    const once = await patch(editor, created.id, first ?? '', { amount: pln(360000) }, { key });
    const twice = await patch(editor, created.id, first ?? '', { amount: pln(360000) }, { key });
    expect(once.status).toBe(200);
    expect(twice.status).toBe(200);
    expect(twice.headers['idempotent-replayed']).toBe('true');
    expect(await rowOf(first ?? '')).toMatchObject({ version: 2 });
    expect(await auditOf(first ?? '')).toHaveLength(1);
    const elsewhere = await patch(editor, created.id, second ?? '', { amount: pln(360000) }, { key });
    expect(elsewhere.status).toBe(422);
    expect(codeOf(elsewhere.body)).toBe('idempotency_mismatch');
    const otherBody = await patch(editor, created.id, first ?? '', { amount: pln(1) }, { key, ifMatch: '"2"' });
    expect(codeOf(otherBody.body)).toBe('idempotency_mismatch');
  });

  it('EVM-053 AC7 SR-AUTHZ-02 the milestone of order B in the path of order A is 404 — as is a deleted milestone and one of a deleted order; B is unchanged', async () => {
    const editor = await signIn();
    const orderA = await order({ milestones: [{}] });
    const orderB = await order({ milestones: [{}, { deletedAt: new Date('2026-10-12T08:00:00Z') }] });
    const deleted = await order({ deleted: true, milestones: [{}] });
    const ofB = orderB.milestoneIds[0] ?? '';
    const cases = [
      [orderA.id, ofB],
      [orderB.id, orderB.milestoneIds[1] ?? ''],
      [deleted.id, deleted.milestoneIds[0] ?? ''],
      [orderA.id, uuidv7()],
    ] as const;
    for (const [orderId, milestoneId] of cases) {
      const response = await patch(editor, orderId, milestoneId, { amount: pln(1) }, { ifMatch: null });
      expect(response.status, `${orderId}/${milestoneId}`).toBe(404);
      expect(codeOf(response.body)).toBe('not_found');
    }
    expect(await rowOf(ofB)).toMatchObject({ amount_minor: null, version: 1, work_order_id: orderB.id });
  });
});

describe('"Dodaj transzę" (EVM-053 AC4, AC5, AC7; SR-API-05, SR-INPUT-01, SR-LOG-03)', () => {
  it('EVM-053 AC4 the milestone "Planowana" is added at the end of the list with the UUIDv7 of the client: 201, ETag, Location; code, share and term are null; the audit event has the amount', async () => {
    const editor = await signIn();
    const created = await order({ milestones: [{}, {}] });
    const id = uuidv7();
    const response = await create(editor, created.id, { id, name: `  ${NAME_MARKER}  `, amount: pln(360000) });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers['etag']).toBe('"1"');
    expect(response.headers['location']).toBe(`${BASE}/${created.id}/payment-milestones/${id}`);
    expect(response.body).toMatchObject({
      id,
      name: NAME_MARKER,
      position: 3,
      code: null,
      sharePercent: null,
      paymentTermDays: null,
      amount: pln(360000),
      status: 'planned',
      version: 1,
    });
    const list = await listOf(editor, created.id);
    expect((list.body as { items: Array<{ id: string }> }).items.at(-1)?.id).toBe(id);
    const audit = await auditOf(id);
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'payment_milestone.created',
        actor_user_id: editor.userId,
        amount_before_minor: null,
        amount_after_minor: '360000',
        currency: 'PLN',
      }),
    ]);
    expect(JSON.stringify(audit)).not.toContain(NAME_MARKER);
  });

  it('EVM-053 AC4 without an amount the milestone has none and its audit event carries none', async () => {
    const editor = await signIn();
    const created = await order();
    const id = uuidv7();
    const response = await create(editor, created.id, { id, name: 'Dopłata' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ position: 1, amount: null });
    expect(await auditOf(id)).toEqual([expect.objectContaining({ amount_after_minor: null, currency: null })]);
  });

  it('EVM-053 AC4 SR-API-05 a repeat of the request (same key, order and body) creates no second milestone: 201 with Idempotent-Replayed; another body or another order with the key is 422', async () => {
    const editor = await signIn();
    const created = await order();
    const other = await order();
    const key = uuidv7();
    const body = { id: uuidv7(), name: 'Zaliczka', amount: pln(100) };
    expect((await create(editor, created.id, body, key)).status).toBe(201);
    const repeat = await create(editor, created.id, body, key);
    expect(repeat.status).toBe(201);
    expect(repeat.headers['idempotent-replayed']).toBe('true');
    expect(await countOf(created.id)).toBe(1);
    expect(await auditOf(body.id)).toHaveLength(1);
    expect(codeOf((await create(editor, created.id, { ...body, name: 'Inna' }, key)).body)).toBe('idempotency_mismatch');
    const elsewhere = await create(editor, other.id, body, key);
    expect(elsewhere.status).toBe(422);
    expect(codeOf(elsewhere.body)).toBe('idempotency_mismatch');
    expect(await countOf(other.id)).toBe(0);
  });

  it('EVM-053 AC4 an empty name, a name over 120 characters, a control character or a wrong amount is 400; no Idempotency-Key is 400; nothing is written', async () => {
    const editor = await signIn();
    const created = await order();
    const cases: Array<[unknown, string]> = [
      [{ id: uuidv7(), name: '' }, '/name'],
      [{ id: uuidv7(), name: '   ' }, '/name'],
      [{ id: uuidv7(), name: 'x'.repeat(121) }, '/name'],
      [{ id: uuidv7(), name: `Zal${String.fromCharCode(0)}iczka` }, '/name'],
      [{ id: uuidv7(), name: 'Zaliczka', amount: pln(0) }, '/amount/amountMinor'],
      [{ id: uuidv7(), name: 'Zaliczka', amount: pln(12.345) }, '/amount/amountMinor'],
      [{ id: uuidv7(), name: 'Zaliczka', amount: { amountMinor: 1, currency: 'EUR' } }, '/amount/currency'],
      [{ id: '0198b0a0-0000-4000-8000-000000000001', name: 'Zaliczka' }, '/id'],
      [{ name: 'Zaliczka' }, '/id'],
    ];
    for (const [body, pointer] of cases) {
      const response = await create(editor, created.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(
        errorsOf(response.body)?.map((error) => error.pointer),
        JSON.stringify(body),
      ).toContain(pointer);
    }
    const unkeyed = await create(editor, created.id, { id: uuidv7(), name: 'Zaliczka' }, null);
    expect(unkeyed.status).toBe(400);
    expect(errorsOf(unkeyed.body)).toEqual([{ pointer: '/headers/Idempotency-Key', code: 'required' }]);
    expect(await countOf(created.id)).toBe(0);
  });

  it('EVM-053 AC4 a name of exactly 120 characters is accepted', async () => {
    const created = await order();
    expect((await create(await signIn(), created.id, { id: uuidv7(), name: 'x'.repeat(120) })).status).toBe(201);
  });

  it('EVM-053 AC4 the 21st milestone is 422 limit_exceeded — the cancelled ones count', async () => {
    const editor = await signIn();
    const created = await order({ milestones: [...Array.from({ length: 19 }, () => ({})), { status: 'cancelled' }] });
    const response = await create(editor, created.id, { id: uuidv7(), name: 'Dwudziesta pierwsza' });
    expect(response.status).toBe(422);
    expect(codeOf(response.body)).toBe('limit_exceeded');
    expect(errorsOf(response.body)).toEqual([{ pointer: '', code: 'too_many_payment_milestones' }]);
    expect(await countOf(created.id)).toBe(20);
  });

  it('EVM-053 AC4 SR-AUTHZ-02 an id that exists — a milestone of ANOTHER order or a deleted one — is 409 id_conflict; nothing is overwritten', async () => {
    const editor = await signIn();
    const orderA = await order();
    const orderB = await order({ milestones: [{ name: 'Transza B' }, { deletedAt: new Date('2026-10-12T08:00:00Z') }] });
    for (const id of orderB.milestoneIds) {
      const response = await create(editor, orderA.id, { id, name: 'Przejęcie', amount: pln(1) });
      expect(response.status).toBe(409);
      expect(codeOf(response.body)).toBe('id_conflict');
      expect(JSON.stringify(response.body)).not.toContain('Transza B');
    }
    expect(await rowOf(orderB.milestoneIds[0] ?? '')).toMatchObject({ name: 'Transza B', amount_minor: null, work_order_id: orderB.id });
    expect(await countOf(orderA.id)).toBe(0);
  });

  it('EVM-053 AC7 SR-AUTHZ-04 the fields of the server in a creation — status, sharePercent, code, position, version — are read_only_field', async () => {
    const editor = await signIn();
    const created = await order();
    for (const field of ['status', 'sharePercent', 'code', 'position', 'version', 'paymentTermDays', 'invoiceNumber']) {
      const response = await create(editor, created.id, { id: uuidv7(), name: 'Zaliczka', [field]: 'paid' });
      expect(response.status, field).toBe(400);
      expect(errorsOf(response.body), field).toContainEqual({ pointer: `/${field}`, code: 'read_only_field' });
    }
    expect(await countOf(created.id)).toBe(0);
  });
});

describe('a closed order (EVM-053 AC5; PO-8)', () => {
  it('EVM-053 AC5 an order "Rozliczone" or "Anulowane": adding a milestone and changing an amount are 409 work_order_closed, nothing is written', async () => {
    const editor = await signIn();
    for (const status of ['settled', 'cancelled'] as const) {
      const closed = await order({ status, milestones: [{ status: status === 'settled' ? 'paid' : 'cancelled' }, {}] });
      const added = await create(editor, closed.id, { id: uuidv7(), name: 'Za późno' });
      expect(added.status, status).toBe(409);
      expect(codeOf(added.body)).toBe('work_order_closed');
      const changed = await patch(editor, closed.id, closed.milestoneIds[1] ?? '', { amount: pln(1) });
      expect(changed.status, status).toBe(409);
      expect(codeOf(changed.body)).toBe('work_order_closed');
      expect(JSON.stringify(changed.body)).not.toContain(status);
      expect(await countOf(closed.id)).toBe(2);
    }
  });
});
