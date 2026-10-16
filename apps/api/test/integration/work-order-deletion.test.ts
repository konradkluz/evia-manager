import { sql } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { WorkOrderDeletionRegistry } from '../../src/modules/work-orders/index.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { BASE, CUSTOMER_EMAIL_PREFIX, MINUTE, TITLE, useDeletionApp, type Browser } from '../support/deletion-harness.ts';
import type { MilestoneSpec } from '../support/payment-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import request from 'supertest';

const harness = useDeletionApp();
const { app, admin } = harness;

const codeOf = (body: unknown) => (body as { code?: string }).code;
const del = (browser: Browser, id: string, options: { ifMatch?: string | null; key?: string } = {}) =>
  browser.panel.delete(`${BASE}/${id}`, {
    ...(options.ifMatch === null ? {} : { 'If-Match': options.ifMatch ?? '"1"' }),
    ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
  });

const planned: MilestoneSpec = { status: 'planned' };
const cancelled: MilestoneSpec = { status: 'cancelled' };
const invoiced: MilestoneSpec = { status: 'invoiced', amountMinor: 360_000, dueDate: '2026-10-30' };
const paid: MilestoneSpec = { status: 'paid', amountMinor: 120_000 };

const milestoneRows = async (orderId: string) =>
  (
    await sql<{ status: string; amount_minor: string | null; version: number; deleted: boolean }>`
      select status, amount_minor, version, deleted_at is not null as deleted
      from payments.payment_milestones where work_order_id = ${orderId} order by position`.execute(admin())
  ).rows;

describe('deleting a work order without an issued invoice (EVM-060 AC1; SR-AUTHZ-05, SR-DATA-08, SR-LOG-03)', () => {
  it('EVM-060 AC1 the Administrator deletes an order whose milestones are only planned and cancelled: 204, the row is soft deleted by the actor with the version raised, the projection follows', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([planned, cancelled]);
    const response = await del(browser, created.id);
    expect(response.status, JSON.stringify(response.body)).toBe(204);
    expect(response.text).toBe('');
    expect(await harness.rowOf(created.id)).toMatchObject({
      deleted: true,
      deleted_by: browser.userId,
      updated_by: browser.userId,
      version: 2,
    });
    expect(await harness.summaryOf(created.id)).toEqual({ deleted: true });
    // the milestones are not touched: they leave the views through the order, not by a change of their own
    expect(await milestoneRows(created.id)).toMatchObject([
      { status: 'planned', version: 1 },
      { status: 'cancelled', version: 1 },
    ]);
  });

  it('EVM-060 AC1 an order without any milestone is deleted the same way', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([]);
    expect((await del(browser, created.id)).status).toBe(204);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: true });
  });

  it('EVM-060 AC1 afterwards the order is gone for the Editor, Read-only and the Administrator too: the detail, the list, the search and every child are 404 or absent', async () => {
    const administrator = await harness.administrator();
    const editor = await harness.signIn('editor');
    const viewer = await harness.signIn('read_only');
    const kept = await harness.order([planned]);
    const created = await harness.order([planned, cancelled]);
    expect((await del(administrator, created.id)).status).toBe(204);

    for (const browser of [administrator, editor, viewer]) {
      for (const path of [
        '',
        '/scope-items',
        '/customer',
        '/site',
        '/site-orders',
        '/procedures',
        '/payment-milestones',
        '/timeline',
        '/deleted-procedures',
      ]) {
        const response = await browser.panel.get(`${BASE}/${created.id}${path}`);
        // the list of deleted processes is for the Administrator alone: the others are refused before the order is looked for
        const refused = path === '/deleted-procedures' && browser !== administrator;
        expect([response.status, codeOf(response.body)], `${browser.userId} ${path}`).toEqual(
          refused ? [403, 'forbidden'] : [404, 'not_found'],
        );
      }
      for (const sort of ['-number', 'number', '-createdAt', 'createdAt', 'urgency']) {
        const list = await browser.panel.get(`${BASE}?sort=${sort}&limit=100`);
        const ids = (list.body as { items: { id: string }[] }).items.map((item) => item.id);
        expect(ids, sort).toContain(kept.id);
        expect(ids, sort).not.toContain(created.id);
      }
      const open = await browser.panel.get(`${BASE}?view=all_open&limit=100`);
      expect((open.body as { items: { id: string }[] }).items.map((item) => item.id)).not.toContain(created.id);
      const unpaid = await browser.panel.get('/api/v1/payment-milestones');
      expect(JSON.stringify(unpaid.body)).not.toContain(created.number);
    }
    const searched = await editor.panel.post(`${BASE}/search`, { query: TITLE });
    const found = (searched.body as { items: { id: string }[] }).items.map((item) => item.id);
    expect(found).toContain(kept.id);
    expect(found).not.toContain(created.id);
    const byNumber = await administrator.panel.post(`${BASE}/search`, { query: created.number });
    expect((byNumber.body as { items: unknown[] }).items).toEqual([]);
  });

  it('EVM-060 AC1 the audit has work_order.deleted with the actor, the outcome, the address prefix and the trace; no title, customer or amount is in it or in a log line', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([planned, { status: 'cancelled', amountMinor: 987_654 }]);
    expect((await del(browser, created.id, { key: uuidv7() })).status).toBe(204);
    const [row, ...rest] = await harness.auditOf(created.id);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      action: 'work_order.deleted',
      outcome: 'success',
      actor_user_id: browser.userId,
      reason_code: null,
      ip_prefix: '127.0.0.0/24',
      object_type: 'work_order',
    });
    expect(row?.trace_id).toMatch(/^[0-9a-f]{32}$/);
    const text = await harness.auditText(created.id);
    for (const secret of [TITLE, CUSTOMER_EMAIL_PREFIX, '987654', '9876.54']) {
      expect(text).not.toContain(secret);
      expect(app().logs.text).not.toContain(secret);
    }
    expect(app().logs.text).not.toContain(created.number);
  });

  it('EVM-060 AC1 the journal of the order has no entry: an order that nobody sees has no history to show', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([planned]);
    expect((await del(browser, created.id)).status).toBe(204);
    const { rows } = await sql`select 1 from timeline.timeline_entries where work_order_id = ${created.id}`.execute(admin());
    expect(rows).toEqual([]);
  });

  it('EVM-060 AC5 If-Match is required (428), a malformed one is 400, a stale one is 412 with no current value — and none of them deletes', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([planned]);
    const missing = await del(browser, created.id, { ifMatch: null });
    expect([missing.status, codeOf(missing.body)]).toEqual([428, 'precondition_required']);
    for (const bad of ['W/"1"', '*', '1', '"0"']) expect((await del(browser, created.id, { ifMatch: bad })).status, bad).toBe(400);
    const stale = await del(browser, created.id, { ifMatch: '"7"' });
    expect([stale.status, codeOf(stale.body)]).toEqual([412, 'version_conflict']);
    expect(JSON.stringify(stale.body)).not.toMatch(/"version"/);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false, version: 1 });
    expect(await harness.auditOf(created.id)).toEqual([]);
  });

  it('EVM-060 AC1 a path that is not a UUID is 400, an order that does not exist is 404', async () => {
    const browser = await harness.administrator();
    expect((await del(browser, 'nie-uuid')).status).toBe(400);
    const missing = await del(browser, uuidv7());
    expect([missing.status, codeOf(missing.body)]).toEqual([404, 'not_found']);
  });

  it('EVM-060 AC1 an order that is deleted already is 404 (the same answer as a missing one) — also before If-Match — and writes nothing', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([planned], { deletedAt: new Date('2026-10-01T08:00:00Z') });
    for (const ifMatch of ['"1"', null]) {
      const response = await del(browser, created.id, { ifMatch });
      expect([response.status, codeOf(response.body)]).toEqual([404, 'not_found']);
    }
    expect(await harness.auditOf(created.id)).toEqual([]);
  });
});

describe('the idempotency of the deletion (EVM-060 AC1; SR-API-05, ASVS V2.3.1)', () => {
  it('EVM-060 AC1 a repeat with the same key answers 204 with Idempotent-Replayed, even with a stale If-Match, and audits once', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([planned]);
    const key = uuidv7();
    expect((await del(browser, created.id, { key })).status).toBe(204);
    const again = await del(browser, created.id, { key, ifMatch: '"1"' });
    expect(again.status).toBe(204);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const stale = await del(browser, created.id, { key, ifMatch: '"99"' });
    expect(stale.status).toBe(204);
    expect(await harness.auditOf(created.id)).toHaveLength(1);
    expect(await harness.rowOf(created.id)).toMatchObject({ version: 2 });
  });

  it('EVM-060 AC1 the key is bound to the order: the same key on another order is 422 idempotency_mismatch and the other order is not deleted', async () => {
    const browser = await harness.administrator();
    const first = await harness.order([planned]);
    const second = await harness.order([planned]);
    const key = uuidv7();
    expect((await del(browser, first.id, { key })).status).toBe(204);
    const other = await del(browser, second.id, { key });
    expect([other.status, codeOf(other.body)]).toEqual([422, 'idempotency_mismatch']);
    expect(await harness.rowOf(second.id)).toMatchObject({ deleted: false, version: 1 });
  });

  it('EVM-060 AC1 the key is bound to the operation: a key used for the deletion does not replay the restoration, and the other way round', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([planned]);
    const key = uuidv7();
    expect((await del(browser, created.id, { key })).status).toBe(204);
    const restore = await browser.panel.post(`${BASE}/${created.id}/restore`, undefined, { 'If-Match': '"2"', 'Idempotency-Key': key });
    expect([restore.status, codeOf(restore.body)]).toEqual([422, 'idempotency_mismatch']);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: true });
  });

  it('EVM-060 AC1 the key is bound to the user: the stored 204 is never replayed to another Administrator', async () => {
    const first = await harness.administrator();
    const second = await harness.administrator();
    const created = await harness.order([planned]);
    const key = uuidv7();
    expect((await del(first, created.id, { key })).status).toBe(204);
    // another Administrator with the same key: no record is his, so the command runs again — and the order is deleted already: 404, not a replay
    const other = await del(second, created.id, { key });
    expect([other.status, codeOf(other.body)]).toEqual([404, 'not_found']);
    expect(other.headers['idempotent-replayed']).toBeUndefined();
  });

  it('EVM-060 AC1 a repeat of the key of a deletion after the order was restored is still the stored answer (the record is the same command)', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([planned]);
    const key = uuidv7();
    expect((await del(browser, created.id, { key })).status).toBe(204);
    expect((await browser.panel.post(`${BASE}/${created.id}/restore`, undefined, { 'If-Match': '"2"' })).status).toBe(200);
    const again = await del(browser, created.id, { key });
    expect([again.status, again.headers['idempotent-replayed']]).toEqual([204, 'true']);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false });
  });
});

describe('an order with an issued invoice cannot be deleted (EVM-060 AC2; SR-AUTHZ-10; AB-17; ASVS V16.5.1)', () => {
  it('EVM-060 AC2 an invoiced milestone is 409 has_active_dependents — with or without a fresh step-up — and nothing is written: no row, no audit, no idempotency record', async () => {
    const fresh = await harness.administrator();
    const stale = await harness.signIn('administrator');
    const created = await harness.order([planned, invoiced]);
    const before = await milestoneRows(created.id);
    for (const browser of [fresh, stale]) {
      const response = await del(browser, created.id, { key: uuidv7() });
      expect([response.status, codeOf(response.body)]).toEqual([409, 'has_active_dependents']);
      // no count, no amount, no id of a milestone in the answer (ASVS V16.5.1)
      expect(JSON.stringify(response.body)).not.toMatch(/360000|invoiced|milestone|amount/i);
    }
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false, version: 1 });
    expect(await harness.auditOf(created.id)).toEqual([]);
    expect(await harness.idempotencyRecords()).toBe(0);
    expect(await milestoneRows(created.id)).toEqual(before);
  });

  it('EVM-060 AC2 invoiced together with paid is 409 as well: the block comes before the step-up, so a stale session is told 409, not 403', async () => {
    const stale = await harness.signIn('administrator');
    const created = await harness.order([paid, invoiced]);
    const response = await del(stale, created.id);
    expect([response.status, codeOf(response.body)]).toEqual([409, 'has_active_dependents']);
  });

  it('EVM-060 AC2 a deleted invoiced milestone does not block (only the live ones count), a paid one in its place asks for the step-up', async () => {
    const stale = await harness.signIn('administrator');
    const created = await harness.order([{ ...invoiced, deletedAt: new Date('2026-10-14T08:00:00Z') }, planned]);
    expect((await del(stale, created.id)).status).toBe(204);
  });
});

describe('an order with a paid milestone needs a step-up (EVM-060 AC3; SR-AUTHZ-10, SR-SESS-08; ASVS V7.5.3)', () => {
  it('EVM-060 AC3 without a passkey in the session: 403 step_up_required, the order is untouched, no audit, no idempotency record', async () => {
    const stale = await harness.signIn('administrator');
    const created = await harness.order([paid, planned]);
    const response = await del(stale, created.id, { key: uuidv7() });
    expect([response.status, codeOf(response.body)]).toEqual([403, 'step_up_required']);
    expect(JSON.stringify(response.body)).not.toMatch(/120000|paid|amount/i);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false, version: 1 });
    expect(await harness.auditOf(created.id)).toEqual([]);
    expect(await harness.idempotencyRecords()).toBe(0);
    expect(await milestoneRows(created.id)).toMatchObject([{ status: 'paid' }, { status: 'planned' }]);
  });

  it('EVM-060 AC3 the window is exact: a key authenticated 14:59 ago passes, 15:00 ago does not (the clock of the application)', async () => {
    const inside = await harness.signIn('administrator', { keyAgeMs: 15 * MINUTE - 1_000 });
    const edge = await harness.signIn('administrator', { keyAgeMs: 15 * MINUTE });
    const older = await harness.signIn('administrator', { key: 16 });
    const created = await harness.order([paid]);
    for (const browser of [edge, older]) {
      const response = await del(browser, created.id);
      expect([response.status, codeOf(response.body)]).toEqual([403, 'step_up_required']);
    }
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false });
    expect((await del(inside, created.id)).status).toBe(204);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: true });
  });

  it('EVM-060 AC3 the clock moves the window: a step-up that is fresh when the request is sent is stale a minute later', async () => {
    const browser = await harness.signIn('administrator', { key: 'fresh' });
    const created = await harness.order([paid]);
    app().clock.advance(15 * MINUTE);
    expect((await del(browser, created.id)).status).toBe(403);
    app().clock.advance(-1_000);
    expect((await del(browser, created.id)).status).toBe(204);
  });

  it('EVM-060 AC3 with a fresh step-up the order is deleted and the audit says so: reason_code step_up_verified, nothing about the amounts', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([paid, planned]);
    const response = await del(browser, created.id, { key: uuidv7() });
    expect(response.status, JSON.stringify(response.body)).toBe(204);
    expect(await harness.auditOf(created.id)).toMatchObject([
      { action: 'work_order.deleted', outcome: 'success', actor_user_id: browser.userId, reason_code: 'step_up_verified' },
    ]);
    expect(await harness.auditText(created.id)).not.toContain('120000');
    // the milestones are not changed by the deletion: no status, no amount
    expect(await milestoneRows(created.id)).toMatchObject([
      { status: 'paid', amount_minor: '120000', version: 1 },
      { status: 'planned', version: 1 },
    ]);
  });

  it('EVM-060 AC3 a refusal leaves the key free: the same key works once the step-up is fresh (nothing was stored by the refusal)', async () => {
    const stale = await harness.signIn('administrator');
    const created = await harness.order([paid]);
    const key = uuidv7();
    expect((await del(stale, created.id, { key })).status).toBe(403);
    const fresh = await harness.administrator();
    expect((await del(fresh, created.id, { key })).status).toBe(204);
  });

  it('EVM-060 AC3 the order of the decisions: a stale version is 412 only after the step-up, and the dependents are asked before the version', async () => {
    const stale = await harness.signIn('administrator');
    const fresh = await harness.administrator();
    const created = await harness.order([paid]);
    expect((await del(stale, created.id, { ifMatch: '"9"' })).status).toBe(403);
    expect((await del(fresh, created.id, { ifMatch: '"9"' })).status).toBe(412);
  });
});

describe('fail closed (EVM-060 AC2; SR-ERR-01; ASVS V16.5.3)', () => {
  it('EVM-060 AC2 startup: the module of payments has registered its participant, so the deletion is never decided without it', () => {
    expect(app().app.get(WorkOrderDeletionRegistry, { strict: false }).names()).toContain('payments');
  });

  it('EVM-060 AC2 an empty registry refuses the deletion (500, nothing written) instead of allowing it', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([planned]);
    const registry = app().app.get(WorkOrderDeletionRegistry, { strict: false });
    const spy = vi.spyOn(registry, 'ordered').mockReturnValue([]);
    try {
      const response = await del(browser, created.id, { key: uuidv7() });
      expect([response.status, codeOf(response.body)]).toEqual([500, 'internal_error']);
    } finally {
      spy.mockRestore();
    }
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false, version: 1 });
    expect(await harness.auditOf(created.id)).toEqual([]);
    expect(await harness.idempotencyRecords()).toBe(0);
  });

  it('EVM-060 AC2 a participant that throws ends the command with 500 and nothing written', async () => {
    const browser = await harness.administrator();
    const created = await harness.order([planned]);
    const registry = app().app.get(WorkOrderDeletionRegistry, { strict: false });
    const [payments] = registry.ordered();
    const spy = vi.spyOn(payments as NonNullable<typeof payments>, 'assess').mockRejectedValue(new Error('synthetic failure'));
    try {
      const response = await del(browser, created.id);
      expect([response.status, codeOf(response.body)]).toEqual([500, 'internal_error']);
    } finally {
      spy.mockRestore();
    }
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false, version: 1 });
    expect(await harness.auditOf(created.id)).toEqual([]);
  });
});

describe('roles and channels of the deletion (EVM-060 AC5, AC6; SR-AUTHZ-05, SR-AUTHZ-12; ASVS V8.1.1, V8.2.1, V8.2.2; TM-17, TM-24)', () => {
  it('EVM-060 AC5 the Editor and Read-only get 403 forbidden — before 404, If-Match and the state of the milestones — and nothing changes', async () => {
    const editor = await harness.signIn('editor', { key: 'fresh' });
    const viewer = await harness.signIn('read_only');
    const created = await harness.order([invoiced]);
    const open = await harness.order([planned]);
    for (const browser of [editor, viewer]) {
      for (const response of [
        await del(browser, open.id),
        await del(browser, open.id, { ifMatch: null }),
        await del(browser, uuidv7()),
        await del(browser, created.id),
        await del(browser, 'nie-uuid'),
      ]) {
        expect([response.status, codeOf(response.body)]).toEqual([403, 'forbidden']);
      }
    }
    expect(await harness.rowOf(open.id)).toMatchObject({ deleted: false, version: 1 });
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false, version: 1 });
    expect(await harness.auditOf(open.id)).toEqual([]);
    expect(await harness.idempotencyRecords()).toBe(0);
  });

  it('EVM-060 AC6 an anonymous caller is 401 and a mobile token of the Administrator with a fresh key is 403 forbidden', async () => {
    const created = await harness.order([planned]);
    const anonymous = await request(app().app.getHttpServer())
      .delete(`${BASE}/${created.id}`)
      .set('Origin', PANEL_ORIGIN)
      .set('If-Match', '"1"');
    expect([anonymous.status, codeOf(anonymous.body)]).toEqual([401, 'unauthenticated']);
    const phone = await harness.signIn('administrator', { channel: 'mobile', key: 'fresh' });
    const response = await del(phone, created.id);
    expect([response.status, codeOf(response.body)]).toEqual([403, 'forbidden']);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false });
  });

  it('EVM-060 AC5 the Administrator who addresses an order that is not there gets the 404 of a deleted one — no role learns the difference', async () => {
    const browser = await harness.administrator();
    const deleted = await harness.order([planned], { deletedAt: new Date('2026-10-01T08:00:00Z') });
    const [missing, gone] = [await del(browser, uuidv7()), await del(browser, deleted.id)];
    expect([missing.status, gone.status]).toEqual([404, 404]);
    expect(missing.body).toEqual({ ...(gone.body as object), traceId: (missing.body as { traceId: string }).traceId });
  });
});

describe('the deletion and a milestone issued in parallel (EVM-060 AC2; SR-API-06; ASVS V2.3.3; CWE-362)', () => {
  it('EVM-060 AC2 the two are serialised on the row of the order: either the order is deleted and the milestone stays planned, or the milestone is invoiced and the deletion is 409 — never both', async () => {
    const browser = await harness.administrator();
    const editor = await harness.signIn('editor');
    for (let round = 0; round < 6; round += 1) {
      const created = await harness.order([{ status: 'planned', amountMinor: 50_000 }]);
      const milestoneId = created.milestoneIds[0] ?? '';
      const [removal, invoicing] = await Promise.all([
        del(browser, created.id),
        editor.panel.post(
          `${BASE}/${created.id}/payment-milestones/${milestoneId}/transitions`,
          { to: 'invoiced', invoiceNumber: `FV/TEST/${round}`, dueDate: '2026-10-30' },
          { 'If-Match': '"1"' },
        ),
      ]);
      const rows = await milestoneRows(created.id);
      const order = await harness.rowOf(created.id);
      if (removal.status === 204) {
        expect(invoicing.status, `round ${round}`).toBe(404);
        expect(rows[0]?.status).toBe('planned');
        expect(order?.deleted).toBe(true);
      } else {
        expect([removal.status, codeOf(removal.body)], `round ${round}`).toEqual([409, 'has_active_dependents']);
        expect(invoicing.status).toBe(200);
        expect(rows[0]?.status).toBe('invoiced');
        expect(order?.deleted).toBe(false);
      }
    }
  });
});
