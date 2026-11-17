import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { BASE, useDeletionApp, type Browser } from '../support/deletion-harness.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';

/**
 * "Zaakceptowane" needs a customer (EVM-136 AC4; ADR-0024 pt 4): a work order without a customer is a site survey; every move to "accepted" - also the
 * resumption of an order held from "accepted" - is `409 customer_required` and changes nothing; the CHECK of the database is the second line. Synthetic data.
 */
const harness = useDeletionApp();
const { admin } = harness;
const DEADLINE = new Date('2027-02-14T08:00:00.000Z');
let numbering = 0;

async function survey(status: WorkOrderStatus = 'quoting'): Promise<string> {
  numbering += 1;
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-8${String(numbering).padStart(3, '0')}-0136`,
      siteSurveyExpiresAt: DEADLINE,
      siteId: await insertSite(admin()),
      status,
      ...(status === 'cancelled' ? { closedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

const move = (browser: Browser, id: string, body: unknown, version: number) =>
  browser.panel.post(`${BASE}/${id}/transitions`, body, { 'If-Match': `"${String(version)}"` });
const codeOf = (body: unknown) => (body as { code?: string }).code;
const rowOf = async (id: string) =>
  (
    await sql<{ status: string; version: number; resume_status: string | null; customer_id: string | null }>`
      select status, version, resume_status, customer_id from work_orders.work_orders where id = ${id}`.execute(admin())
  ).rows[0];
const trailOf = async (id: string) => ({
  audit: (await sql`select id from audit.events where object_id = ${id}`.execute(admin())).rows.length,
  journal: (await sql`select id from timeline.timeline_entries where work_order_id = ${id} and kind = 'event'`.execute(admin())).rows
    .length,
});

describe('"Zaakceptowane" needs a customer (EVM-136 AC4)', () => {
  for (const role of ['editor', 'administrator'] as const) {
    it(`EVM-136 AC4 a survey in "Wycena": the ${role} gets 409 customer_required for "accepted" and nothing changes - the status, the version, the audit trail, the journal`, async () => {
      const browser = await harness.signIn(role);
      const id = await survey();
      const before = await trailOf(id);
      const refused = await move(browser, id, { to: 'accepted' }, 1);
      expect([refused.status, codeOf(refused.body)]).toEqual([409, 'customer_required']);
      expect(JSON.stringify(refused.body)).not.toContain(id);
      expect(await rowOf(id)).toMatchObject({ status: 'quoting', version: 1, customer_id: null });
      expect(await trailOf(id)).toEqual(before);
    });
  }

  it('EVM-136 AC4 a survey held and resumed goes back to "Wycena" without a customer - and "accepted" is not a row of "Wstrzymane" (invalid_state_transition)', async () => {
    const editor = await harness.signIn('editor');
    const id = await survey();
    expect((await move(editor, id, { to: 'on_hold', reason: 'czekamy na odpowiedź' }, 1)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: 'on_hold', resume_status: 'quoting' });
    const skipped = await move(editor, id, { to: 'accepted' }, 2);
    expect([skipped.status, codeOf(skipped.body)]).toEqual([409, 'invalid_state_transition']);
    const resumed = await move(editor, id, { to: 'quoting' }, 2);
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: 'quoting', customer_id: null });
  });

  it('EVM-136 AC4 the resumption of an order without a customer that was held from "accepted" (data the hold command did not make) is 409 customer_required, whichever role resumes it', async () => {
    const id = await survey('on_hold');
    await sql`update work_orders.work_orders set resume_status = 'accepted' where id = ${id}`.execute(admin());
    for (const role of ['editor', 'administrator'] as const) {
      const refused = await move(await harness.signIn(role), id, { to: 'accepted' }, 1);
      expect([refused.status, codeOf(refused.body)], role).toEqual([409, 'customer_required']);
    }
    expect(await rowOf(id)).toMatchObject({ status: 'on_hold', version: 1, resume_status: 'accepted' });
  });

  it('EVM-136 AC4 after the customer is assigned the same transition works as before: 200 and "accepted"', async () => {
    const editor = await harness.signIn('editor');
    const id = await survey();
    expect((await move(editor, id, { to: 'accepted' }, 1)).status).toBe(409);
    const customerId = await insertCustomer(admin());
    expect((await editor.panel.put(`${BASE}/${id}/customer`, { customerId, version: 1 })).status).toBe(200);
    const accepted = await move(editor, id, { to: 'accepted' }, 2);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body).toMatchObject({ status: 'accepted', siteSurvey: null });
    expect(await rowOf(id)).toMatchObject({ status: 'accepted', customer_id: customerId, version: 3 });
  });

  it('EVM-136 AC4 the order of the checks: Tylko odczyt is 403 before the rule, a row that is not in the table is invalid_state_transition, a stale If-Match is 412 version_conflict - and only then customer_required', async () => {
    const id = await survey();
    const viewer = await harness.signIn('read_only');
    expect((await move(viewer, id, { to: 'accepted' }, 1)).status).toBe(403);
    const editor = await harness.signIn('editor');
    const notARow = await move(editor, id, { to: 'in_progress' }, 1);
    expect([notARow.status, codeOf(notARow.body)]).toEqual([409, 'invalid_state_transition']);
    const stale = await move(editor, id, { to: 'accepted' }, 9);
    expect([stale.status, codeOf(stale.body)]).toEqual([412, 'version_conflict']);
    const current = await move(editor, id, { to: 'accepted' }, 1);
    expect([current.status, codeOf(current.body)]).toEqual([409, 'customer_required']);
  });

  it('EVM-136 AC4 an ordinary order is accepted as before (the rule asks for a customer only where there is none) and the database is the second line: a survey cannot be written as "accepted" (23514)', async () => {
    const editor = await harness.signIn('editor');
    const ordinary = await harness.order([], { status: 'new' });
    expect((await move(editor, ordinary.id, { to: 'accepted' }, 1)).status).toBe(200);
    const id = await survey();
    await expect(sql`update work_orders.work_orders set status = 'accepted' where id = ${id}`.execute(admin())).rejects.toMatchObject({
      code: '23514',
    });
    expect(await rowOf(id)).toMatchObject({ status: 'quoting', version: 1 });
  });
});
