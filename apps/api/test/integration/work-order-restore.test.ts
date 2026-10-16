import { sql } from 'kysely';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { BASE, CUSTOMER_EMAIL_PREFIX, TITLE, useDeletionApp, type Browser } from '../support/deletion-harness.ts';
import type { MilestoneSpec } from '../support/payment-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';

const harness = useDeletionApp();
const { app, admin } = harness;

const codeOf = (body: unknown) => (body as { code?: string }).code;
const idsOf = (body: unknown) => (body as { items: { id: string }[] }).items.map((item) => item.id);
const restore = (browser: Browser, id: string, options: { ifMatch?: string | null; key?: string } = {}) =>
  browser.panel.post(`${BASE}/${id}/restore`, undefined, {
    ...(options.ifMatch === null ? {} : { 'If-Match': options.ifMatch ?? '"2"' }),
    ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
  });
const del = (browser: Browser, id: string, ifMatch = '"1"') => browser.panel.delete(`${BASE}/${id}`, { 'If-Match': ifMatch });

const planned: MilestoneSpec = { status: 'planned', amountMinor: 40_000 };
const paid: MilestoneSpec = { status: 'paid', amountMinor: 120_000 };
const milestoneRows = async (orderId: string) =>
  (
    await sql<{ status: string; amount_minor: string | null; version: number; deleted: boolean }>`
      select status, amount_minor, version, deleted_at is not null as deleted
      from payments.payment_milestones where work_order_id = ${orderId} order by position`.execute(admin())
  ).rows;

/** A deleted order (version 2, the way the API leaves it): the milestones given and a deletion by an Administrator with a fresh step-up. */
async function deletedOrder(milestones: readonly MilestoneSpec[] = [planned]) {
  const administrator = await harness.administrator();
  const created = await harness.order(milestones);
  expect((await del(administrator, created.id)).status).toBe(204);
  return { ...created, administrator };
}

describe('restoring a deleted work order (EVM-060 AC4; SR-AUTHZ-05, SR-LOG-03)', () => {
  it('EVM-060 AC4 the Administrator restores it: 200 with the order and a new ETag, the row is live again with the version raised, the projection follows', async () => {
    const created = await deletedOrder();
    const response = await restore(created.administrator, created.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"3"');
    expect(response.body).toMatchObject({ id: created.id, number: created.number, version: 3 });
    expect(await harness.rowOf(created.id)).toMatchObject({
      deleted: false,
      deleted_by: null,
      version: 3,
      updated_by: created.administrator.userId,
    });
    expect(await harness.summaryOf(created.id)).toEqual({ deleted: false });
  });

  it('EVM-060 AC4 the order and its children are back for every role: the detail, the list, the search, the scope, the processes, the payments, the timeline', async () => {
    const created = await deletedOrder([planned, { status: 'cancelled' }]);
    const editor = await harness.signIn('editor');
    const viewer = await harness.signIn('read_only');
    expect((await editor.panel.get(`${BASE}/${created.id}`)).status).toBe(404);
    expect((await restore(created.administrator, created.id)).status).toBe(200);
    for (const browser of [created.administrator, editor, viewer]) {
      for (const path of ['', '/scope-items', '/customer', '/site', '/site-orders', '/procedures', '/payment-milestones', '/timeline']) {
        const response = await browser.panel.get(`${BASE}/${created.id}${path}`);
        expect(response.status, `${browser.userId} ${path}`).toBe(200);
      }
      expect(idsOf((await browser.panel.get(`${BASE}?limit=100`)).body)).toContain(created.id);
    }
    expect(idsOf((await editor.panel.post(`${BASE}/search`, { query: TITLE })).body)).toContain(created.id);
  });

  it('EVM-060 AC5 the milestones come back as they were: the same statuses, amounts and versions — neither the deletion nor the restoration is a correction of a payment', async () => {
    const created = await deletedOrder([paid, planned]);
    const before = await milestoneRows(created.id);
    expect(before).toMatchObject([
      { status: 'paid', amount_minor: '120000', version: 1 },
      { status: 'planned', version: 1 },
    ]);
    expect((await restore(created.administrator, created.id)).status).toBe(200);
    expect(await milestoneRows(created.id)).toEqual(before);
    const list = await (await harness.signIn('editor')).panel.get(`${BASE}/${created.id}/payment-milestones`);
    expect(JSON.stringify(list.body)).toContain('120000');
  });

  it('EVM-060 AC4 the audit has work_order.undeleted (the actor, the outcome, the address prefix, the trace) — a trail of its own, not work_order.restored — and no title, customer or amount', async () => {
    const created = await deletedOrder([paid]);
    const key = uuidv7();
    expect((await restore(created.administrator, created.id, { key })).status).toBe(200);
    const rows = await harness.auditOf(created.id);
    expect(rows.map((row) => row.action)).toEqual(['work_order.deleted', 'work_order.undeleted']);
    expect(rows[1]).toMatchObject({
      outcome: 'success',
      actor_user_id: created.administrator.userId,
      reason_code: null,
      ip_prefix: '127.0.0.0/24',
      object_type: 'work_order',
    });
    expect(rows[1]?.trace_id).toMatch(/^[0-9a-f]{32}$/);
    const text = await harness.auditText(created.id);
    for (const secret of [TITLE, CUSTOMER_EMAIL_PREFIX, '120000']) {
      expect(text).not.toContain(secret);
      expect(app().logs.text).not.toContain(secret);
    }
  });

  it('EVM-060 AC4 D5 there is no step-up: an Administrator whose session has no passkey restores an order that had a paid milestone (it restores visibility only)', async () => {
    const created = await deletedOrder([paid]);
    const plain = await harness.signIn('administrator');
    const response = await restore(plain, created.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  });

  it('EVM-060 AC4 TM-18 a customer deleted in the meantime does not block the restoration: it is 200, and the list shows "Klient usunięty" to the Editor', async () => {
    const created = await deletedOrder([planned]);
    await sql`update customers.customers set deleted_at = now() where id = ${created.customerId}`.execute(admin());
    expect((await restore(created.administrator, created.id)).status).toBe(200);
    const editor = await harness.signIn('editor');
    const list = await editor.panel.get(`${BASE}?limit=100`);
    const item = (list.body as { items: { id: string; customer: unknown }[] }).items.find((entry) => entry.id === created.id);
    expect(item?.customer).toEqual({ deleted: true });
  });

  it('EVM-060 AC4 the restored order can be deleted again (the cycle is repeatable), the version going 1, 2, 3, 4', async () => {
    const created = await deletedOrder();
    expect((await restore(created.administrator, created.id)).status).toBe(200);
    expect((await del(created.administrator, created.id, '"3"')).status).toBe(204);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: true, version: 4 });
  });
});

describe('the preconditions of the restoration (EVM-060 AC4, AC6; SR-API-05; ASVS V2.3.1)', () => {
  it('EVM-060 AC4 an order that is not deleted or does not exist is 404 (the same answer) — also before If-Match — and writes nothing', async () => {
    const administrator = await harness.administrator();
    const live = await harness.order([planned]);
    for (const [id, ifMatch] of [
      [live.id, '"1"'],
      [live.id, null],
      [uuidv7(), '"1"'],
      [uuidv7(), null],
    ] as const) {
      const response = await restore(administrator, id, { ifMatch });
      expect([response.status, codeOf(response.body)]).toEqual([404, 'not_found']);
    }
    expect(await harness.auditOf(live.id)).toEqual([]);
    expect(await harness.rowOf(live.id)).toMatchObject({ deleted: false, version: 1 });
  });

  it('EVM-060 AC4 If-Match is required (428), a malformed one is 400, a stale one is 412 without a current value — none of them restores', async () => {
    const created = await deletedOrder();
    const missing = await restore(created.administrator, created.id, { ifMatch: null });
    expect([missing.status, codeOf(missing.body)]).toEqual([428, 'precondition_required']);
    for (const bad of ['W/"2"', '*', '2', '"0"'])
      expect((await restore(created.administrator, created.id, { ifMatch: bad })).status, bad).toBe(400);
    const stale = await restore(created.administrator, created.id, { ifMatch: '"1"' });
    expect([stale.status, codeOf(stale.body)]).toEqual([412, 'version_conflict']);
    expect(JSON.stringify(stale.body)).not.toMatch(/"version"/);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: true, version: 2 });
    expect((await harness.auditOf(created.id)).map((row) => row.action)).toEqual(['work_order.deleted']);
  });

  it('EVM-060 AC4 a path that is not a UUID is 400', async () => {
    const administrator = await harness.administrator();
    expect((await restore(administrator, 'nie-uuid')).status).toBe(400);
  });

  it('EVM-060 AC4 a repeat with the same key answers 200 with Idempotent-Replayed — also with a stale If-Match — and audits once', async () => {
    const created = await deletedOrder();
    const key = uuidv7();
    expect((await restore(created.administrator, created.id, { key })).status).toBe(200);
    const again = await restore(created.administrator, created.id, { key, ifMatch: '"2"' });
    expect([again.status, again.headers['idempotent-replayed']]).toEqual([200, 'true']);
    expect(again.headers['etag']).toBe('"3"');
    const stale = await restore(created.administrator, created.id, { key, ifMatch: '"99"' });
    expect(stale.status).toBe(200);
    expect((await harness.auditOf(created.id)).filter((row) => row.action === 'work_order.undeleted')).toHaveLength(1);
  });

  it('EVM-060 AC4 the key is bound to the order and to the operation: another order or the deletion is 422 idempotency_mismatch', async () => {
    const first = await deletedOrder();
    const second = await deletedOrder();
    const key = uuidv7();
    expect((await restore(first.administrator, first.id, { key })).status).toBe(200);
    const other = await restore(first.administrator, second.id, { key });
    expect([other.status, codeOf(other.body)]).toEqual([422, 'idempotency_mismatch']);
    expect(await harness.rowOf(second.id)).toMatchObject({ deleted: true });
    const asDeletion = await first.administrator.panel.delete(`${BASE}/${first.id}`, { 'If-Match': '"3"', 'Idempotency-Key': key });
    expect([asDeletion.status, codeOf(asDeletion.body)]).toEqual([422, 'idempotency_mismatch']);
    expect(await harness.rowOf(first.id)).toMatchObject({ deleted: false });
  });

  it('EVM-060 AC4 the stored 200 is never replayed to another user: with the same key another Administrator gets the 404 of an order that is not deleted', async () => {
    const created = await deletedOrder();
    const other = await harness.administrator();
    const key = uuidv7();
    expect((await restore(created.administrator, created.id, { key })).status).toBe(200);
    const response = await restore(other, created.id, { key });
    expect([response.status, codeOf(response.body)]).toEqual([404, 'not_found']);
    expect(response.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('roles and channels of the restoration (EVM-060 AC6; SR-AUTHZ-05, SR-AUTHZ-12; ASVS V8.1.1, V8.2.1, V8.2.2; TM-17, TM-24)', () => {
  it('EVM-060 AC6 the Editor and Read-only get 403 forbidden — before 404, If-Match and the state — and the order stays deleted', async () => {
    const created = await deletedOrder();
    const editor = await harness.signIn('editor', { key: 'fresh' });
    const viewer = await harness.signIn('read_only');
    const live = await harness.order([planned]);
    for (const browser of [editor, viewer]) {
      for (const response of [
        await restore(browser, created.id),
        await restore(browser, created.id, { ifMatch: null }),
        await restore(browser, uuidv7()),
        await restore(browser, live.id),
        await restore(browser, 'nie-uuid'),
      ]) {
        expect([response.status, codeOf(response.body)]).toEqual([403, 'forbidden']);
      }
    }
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: true, version: 2 });
    expect(await harness.idempotencyRecords()).toBe(0);
  });

  it('EVM-060 AC6 an anonymous caller is 401 and a mobile token of the Administrator with a fresh key is 403', async () => {
    const created = await deletedOrder();
    const anonymous = await request(app().app.getHttpServer())
      .post(`${BASE}/${created.id}/restore`)
      .set('Origin', PANEL_ORIGIN)
      .set('If-Match', '"2"');
    expect([anonymous.status, codeOf(anonymous.body)]).toEqual([401, 'unauthenticated']);
    const phone = await harness.signIn('administrator', { channel: 'mobile', key: 'fresh' });
    const response = await restore(phone, created.id);
    expect([response.status, codeOf(response.body)]).toEqual([403, 'forbidden']);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: true });
  });

  it('EVM-060 AC6 the Editor cannot restore through the other doors either: the PATCH and the transition of a deleted order are 404', async () => {
    const created = await deletedOrder();
    const editor = await harness.signIn('editor');
    const patch = await editor.panel.patch(`${BASE}/${created.id}`, { title: 'Nowy tytuł' }, { 'If-Match': '"2"' });
    expect([patch.status, codeOf(patch.body)]).toEqual([404, 'not_found']);
    const transition = await editor.panel.post(`${BASE}/${created.id}/transitions`, { to: 'on_hold', reason: 'x' }, { 'If-Match': '"2"' });
    expect([transition.status, codeOf(transition.body)]).toEqual([404, 'not_found']);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: true, version: 2 });
  });
});
