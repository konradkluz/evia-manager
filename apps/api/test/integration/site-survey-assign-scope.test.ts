import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import type { IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertMilestones } from '../support/payment-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { projectionTools } from '../support/projection.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { adminDb, bootSync, drain, editor, keysOf, upsertOf, type SyncApp } from '../support/sync-harness.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

/**
 * What the assignment of a customer changes for everybody else (EVM-136 AC6 after EVM-135; ADR-0024 pts 2, 8, 9): an open survey reaches only the phones of its
 * creator and coordinator and is hidden from Read-only; once it has a customer it is an ordinary order - in the scope of every Editor, on the list outside the
 * filter `siteSurvey=only`, in the reports and for Read-only - and the projection loses the deadline in the same transaction. The rejection and the restoration
 * move the deadline together with the status, and `verify` finds no drift after each. Synthetic data only.
 */
let current: SyncApp;
afterEach(async () => {
  await current.app.close();
});
const app = (): IdentityApp => current.app;
const db = () => adminDb(current.app);
const BASE = '/api/v1/work-orders';

async function panelOf(role: Role, fresh = false): Promise<PanelClient> {
  const user = await createUser(db(), app().clock, { role });
  const session = await createSession(db(), app().clock, user, {
    channel: 'web',
    ...(fresh ? { passkeyAuthenticatedAt: app().clock.now() } : {}),
  });
  const panel = new PanelClient(app().app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return panel;
}

/** A survey created by the phone of Editor A (no customer yet), a customer, and a milestone that is overdue (the survey cannot get one through the API). */
async function setup(sequence: number, withMilestone = true) {
  current = await bootSync({ SITE_SURVEYS_ENABLED: 'true' });
  const customerId = await insertCustomer(db(), { firstName: 'Ewa', lastName: 'Nowa' });
  const a = await editor(app());
  const c = await editor(app());
  const siteId = await insertSite(db(), { street: `ul. Przypisana ${sequence}` });
  const number = numberOf(2026, 9300 + sequence);
  const ids = await insertWorkOrders(db(), [
    { number, siteId, coordinatorId: a.account.user.id, siteSurveyExpiresAt: new Date('2027-02-14T08:00:00.000Z') },
  ]);
  const orderId = ids.get(number) ?? '';
  await sql`update work_orders.work_orders set created_by = ${a.account.user.id} where id = ${orderId}`.execute(db());
  if (withMilestone) await insertMilestones(db(), orderId, [{ status: 'invoiced', dueDate: '2026-01-10', amountMinor: 100_000 }]);
  await projectionTools(db()).maintenance.rebuild({ only: [orderId] });
  return { a, c, orderId, number, customerId, editorPanel: await panelOf('editor') };
}

const numbersOf = (body: unknown): string[] => (body as { items: Array<{ number: string }> }).items.map((item) => item.number);
const deadlineOf = async (id: string): Promise<Date | null> =>
  (
    await sql<{
      d: Date | null;
    }>`select site_survey_expires_at as d from overview.work_order_summaries where work_order_id = ${id}`.execute(db())
  ).rows[0]?.d ?? null;
const verifyClean = async (): Promise<void> => {
  const report = await projectionTools(db()).maintenance.verify({ traceId: '0'.repeat(32), alert: false });
  expect(report.drift.authorization).toEqual([]);
  expect(report.missing).toEqual([]);
  expect(Object.values(report.drift).flat()).toEqual([]);
};

describe('the others after the assignment of a customer to a site survey (EVM-136 AC6)', () => {
  it('EVM-136 AC6 Editor C, who is neither the creator nor the coordinator, gets no survey on the phone; after the assignment the next pull brings the order like any other', async () => {
    const { c, orderId, customerId, editorPanel } = await setup(1);
    const first = await drain(c.phone);
    expect(keysOf(first.changes).filter((key) => key.endsWith(`:${orderId}`))).toEqual([]);

    expect((await editorPanel.put(`${BASE}/${orderId}/customer`, { customerId, version: 1 })).status).toBe(200);

    const page = await drain(c.phone, '', first.cursor);
    expect(upsertOf(page.changes, 'work_order', orderId)).toMatchObject({ id: orderId, customerId, siteSurvey: null });
    const snapshot = await c.phone.get(`/api/v1/sync/work-orders/${orderId}`, c.phone.authorised());
    expect(snapshot.status, JSON.stringify(snapshot.body)).toBe(200);
  });

  it('EVM-136 AC6 after the assignment siteSurvey=only no longer returns the order and siteSurvey=exclude does; the reports that skipped the open survey now list it', async () => {
    const { number, orderId, customerId, editorPanel } = await setup(2);
    expect(numbersOf((await editorPanel.get(`${BASE}?siteSurvey=only`)).body)).toContain(number);
    for (const view of ['overdue_payments', 'unpaid'])
      expect(numbersOf((await editorPanel.get(`${BASE}?view=${view}`)).body), view).not.toContain(number);
    const unpaidBefore = (await editorPanel.get('/api/v1/payment-milestones')).body as { items: Array<{ workOrder: { number: string } }> };
    expect(unpaidBefore.items.map((item) => item.workOrder.number)).not.toContain(number);

    expect((await editorPanel.put(`${BASE}/${orderId}/customer`, { customerId, version: 1 })).status).toBe(200);

    expect(numbersOf((await editorPanel.get(`${BASE}?siteSurvey=only`)).body)).not.toContain(number);
    expect(numbersOf((await editorPanel.get(`${BASE}?siteSurvey=exclude`)).body)).toContain(number);
    for (const view of ['overdue_payments', 'unpaid'])
      expect(numbersOf((await editorPanel.get(`${BASE}?view=${view}`)).body), view).toContain(number);
    const unpaidAfter = (await editorPanel.get('/api/v1/payment-milestones')).body as { items: Array<{ workOrder: { number: string } }> };
    expect(unpaidAfter.items.map((item) => item.workOrder.number)).toContain(number);
  });

  it('EVM-136 AC6 Read-only gets 404 on the open survey and sees the order after the assignment', async () => {
    const { orderId, customerId, editorPanel } = await setup(3);
    const readOnly = await panelOf('read_only');
    expect((await readOnly.get(`${BASE}/${orderId}`)).status).toBe(404);
    expect((await editorPanel.put(`${BASE}/${orderId}/customer`, { customerId, version: 1 })).status).toBe(200);
    const seen = await readOnly.get(`${BASE}/${orderId}`);
    expect(seen.status, JSON.stringify(seen.body)).toBe(200);
    expect(seen.body).toMatchObject({ id: orderId, customer: { id: customerId }, siteSurvey: null });
  });

  it('EVM-136 AC6 the projection loses the deadline with the assignment and verify finds no drift', async () => {
    const { orderId, customerId, editorPanel } = await setup(4);
    expect(await deadlineOf(orderId)).toEqual(new Date('2027-02-14T08:00:00.000Z'));
    await verifyClean();
    expect((await editorPanel.put(`${BASE}/${orderId}/customer`, { customerId, version: 1 })).status).toBe(200);
    expect(await deadlineOf(orderId)).toBeNull();
    await verifyClean();
  });

  it('EVM-136 AC6 the projection follows the rejection and the restoration of a survey: the deadline moves with the status, verify finds no drift after each', async () => {
    const { orderId, editorPanel } = await setup(5, false);
    const administrator = await panelOf('administrator', true);
    const before = await deadlineOf(orderId);
    const rejected = await editorPanel.post(
      `${BASE}/${orderId}/transitions`,
      { to: 'cancelled', reasonCode: 'offer_rejected' },
      { 'If-Match': '"1"' },
    );
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const afterRejection = await deadlineOf(orderId);
    expect(afterRejection?.getTime()).toBeLessThan(before?.getTime() ?? 0);
    const row = await sql<{ d: Date }>`select site_survey_expires_at as d from work_orders.work_orders where id = ${orderId}`.execute(db());
    expect(afterRejection).toEqual(row.rows[0]?.d);
    await verifyClean();

    const restored = await administrator.post(`${BASE}/${orderId}/transitions`, { to: 'on_hold' }, { 'If-Match': '"2"' });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const row2 = await sql<{ d: Date }>`select site_survey_expires_at as d from work_orders.work_orders where id = ${orderId}`.execute(
      db(),
    );
    expect(await deadlineOf(orderId)).toEqual(row2.rows[0]?.d);
    await verifyClean();
  });
});
