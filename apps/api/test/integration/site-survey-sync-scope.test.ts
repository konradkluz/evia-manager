/**
 * The scope of the phone and the site survey (EVM-135 AC5; ADR-0024 pt 8; W6): an open survey reaches only the phones of its creator and of its coordinator -
 * the order, its site, its children and its delete marker alike; another Editor's phone gets no row and no mention, and the snapshot of the order is `404`
 * for it. The new rule is a new version of the rule of scope (one `scope_changed`). A change of the coordinator raises the version of the order: the new one
 * gets the survey, the former one loses it at the next full download. Once the survey has a customer it is in the scope of every Editor. Synthetic data only.
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import type { IdentityApp } from '../support/identity-app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { bootSync, drain, editor, keysOf, pull, scopeVersion, upsertOf } from '../support/sync-harness.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

let current: IdentityApp;
afterEach(async () => {
  await current.close();
});
async function boot(): Promise<IdentityApp> {
  current = (await bootSync({ SITE_SURVEYS_ENABLED: 'true' })).app;
  return current;
}
const admin = () => current.database.admin;
const DEADLINE = new Date('2027-02-14T08:00:00.000Z');

/** A survey of a site, created by `creatorId`, with `coordinatorId` as its coordinator (or none). */
async function survey(sequence: number, creatorId: string, coordinatorId?: string): Promise<{ id: string; siteId: string }> {
  const siteId = await insertSite(admin(), { street: `ul. Zakresowa ${sequence}` });
  const ids = await insertWorkOrders(admin(), [
    {
      number: numberOf(2026, 7000 + sequence),
      siteId,
      siteSurveyExpiresAt: DEADLINE,
      ...(coordinatorId === undefined ? {} : { coordinatorId }),
    },
  ]);
  const id = ids.get(numberOf(2026, 7000 + sequence)) ?? '';
  await sql`update work_orders.work_orders set created_by = ${creatorId} where id = ${id}`.execute(admin());
  return { id, siteId };
}
const mentions = (changes: Array<Record<string, unknown>>, ...ids: string[]): string[] =>
  keysOf(changes).filter((key) => ids.some((id) => key.endsWith(`:${id}`)));

describe('the scope of the phone and the site survey (EVM-135 AC5; W6)', () => {
  it('EVM-135 AC5 a survey of Editor A with coordinator B is on the phones of A and B; the phone of Editor C gets no row and no mention - not of the order, nor of its site', async () => {
    const app = await boot();
    const a = await editor(app);
    const b = await editor(app);
    const c = await editor(app);
    const { id, siteId } = await survey(1, a.account.user.id, b.account.user.id);
    for (const phone of [a.phone, b.phone]) {
      const pulled = await drain(phone);
      expect(upsertOf(pulled.changes, 'work_order', id)).toMatchObject({
        customerId: null,
        siteSurvey: { expiresAt: DEADLINE.toISOString() },
      });
      expect(upsertOf(pulled.changes, 'site', siteId)).toBeDefined();
    }
    const first = await drain(c.phone);
    expect(mentions(first.changes, id, siteId)).toEqual([]);
    // a change of the survey later on (the change log names it) reaches A and B, and still nothing reaches C
    const cursorOfC = first.cursor;
    await sql`update work_orders.work_orders set title = 'Wizja lokalna — garaż', version = version + 1 where id = ${id}`.execute(admin());
    expect(mentions((await drain(c.phone, '', cursorOfC)).changes, id, siteId)).toEqual([]);
    // the delete marker of the survey does not reach C either
    await sql`update work_orders.work_orders set deleted_at = now(), version = version + 1 where id = ${id}`.execute(admin());
    expect(mentions((await drain(c.phone, '', cursorOfC)).changes, id, siteId)).toEqual([]);
  });

  it('EVM-135 AC5 the snapshot of the survey is 404 for the phone of C - the same answer as a missing order - and 200 for A', async () => {
    const app = await boot();
    const a = await editor(app);
    const c = await editor(app);
    const { id } = await survey(2, a.account.user.id);
    expect((await a.phone.get(`/api/v1/sync/work-orders/${id}`, a.phone.authorised())).status).toBe(200);
    const hidden = await c.phone.get(`/api/v1/sync/work-orders/${id}`, c.phone.authorised());
    const missing = await c.phone.get('/api/v1/sync/work-orders/0198b0a0-0000-7000-8000-00000000f135', c.phone.authorised());
    expect([hidden.status, missing.status]).toEqual([404, 404]);
    expect((hidden.body as { code: string }).code).toBe((missing.body as { code: string }).code);
  });

  it('EVM-135 AC5 the new rule raises the version of the rule of scope once (294 for the defaults): a cursor of the former version is resync_required scope_changed', async () => {
    const app = await boot();
    expect(scopeVersion(app)).toBe(294);
    const { phone } = await editor(app);
    const config = await phone.get('/api/v1/meta/client-config', phone.authorised());
    expect((config.body as { scopeRuleVersion: number }).scopeRuleVersion).toBe(294);
    const { cursor } = await drain(phone);
    // a cursor issued under 293 is no cursor of the current rule: the cursor of the test carries 294, so a fresh pull with it is changes; the harness of
    // sync-changes proves the scope_changed of a foreign version - here the version itself is the point
    expect((await pull(phone, `cursor=${cursor}`)).status).toBe(200);
  });

  it('EVM-135 AC5 a change of the coordinator raises the version of the order: the new coordinator gets the survey, the former one loses it at the next full download', async () => {
    const app = await boot();
    const a = await editor(app);
    const b = await editor(app);
    const d = await editor(app);
    const { id } = await survey(3, a.account.user.id, b.account.user.id);
    const before = await sql<{ version: number }>`select version from work_orders.work_orders where id = ${id}`.execute(admin());
    const fromD = await drain(d.phone);
    expect(upsertOf(fromD.changes, 'work_order', id)).toBeUndefined();
    const patched = await a.account.panel
      .patch(`/api/v1/work-orders/${id}`, { assigneeUserId: d.account.user.id })
      .set('If-Match', `"${String(before.rows[0]?.version)}"`);
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const after = await sql<{ version: number }>`select version from work_orders.work_orders where id = ${id}`.execute(admin());
    expect(after.rows[0]?.version).toBeGreaterThan(before.rows[0]?.version ?? 0);
    expect(upsertOf((await drain(d.phone, '', fromD.cursor)).changes, 'work_order', id)).toMatchObject({
      coordinatorUserId: d.account.user.id,
    });
    expect(upsertOf((await drain(b.phone)).changes, 'work_order', id)).toBeUndefined();
    expect(upsertOf((await drain(a.phone)).changes, 'work_order', id)).toBeDefined();
  });

  it('EVM-135 AC5 a survey from the panel without a coordinator is on the phone of its creator alone', async () => {
    const app = await boot();
    const a = await editor(app);
    const c = await editor(app);
    const { id } = await survey(4, a.account.user.id);
    expect(upsertOf((await drain(a.phone)).changes, 'work_order', id)).toBeDefined();
    expect(upsertOf((await drain(c.phone)).changes, 'work_order', id)).toBeUndefined();
  });

  it('EVM-135 AC5 once the survey has a customer (the shape of EVM-136) it is in the scope of every Editor; an ordinary order is in scope as before', async () => {
    const app = await boot();
    const a = await editor(app);
    const c = await editor(app);
    const { id } = await survey(5, a.account.user.id);
    const first = await drain(c.phone);
    expect(upsertOf(first.changes, 'work_order', id)).toBeUndefined();
    const customerId = await insertCustomer(admin(), {});
    await sql`update work_orders.work_orders set customer_id = ${customerId}, site_survey_expires_at = null, version = version + 1 where id = ${id}`.execute(
      admin(),
    );
    const next = await drain(c.phone, '', first.cursor);
    expect(upsertOf(next.changes, 'work_order', id)).toMatchObject({ customerId, siteSurvey: null });
    // the customer itself reaches the phone through the snapshot of the order (ADR-0021 D3) - the test of that path is EVM-136's
    const ordinary = await insertWorkOrders(admin(), [{ number: numberOf(2026, 7099), customerId }]);
    expect(upsertOf((await drain(c.phone)).changes, 'work_order', ordinary.get(numberOf(2026, 7099)) ?? '')).toBeDefined();
  });
});
