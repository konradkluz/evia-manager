import { assertSyncProjectionStrict } from '@evia/contracts/sync';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import type { IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import type { Phone } from '../support/mobile-flows.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { adminDb, bootSync, drain, editor, keysOf, upsertOf, type SyncApp } from '../support/sync-harness.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

/**
 * The assignment of a customer in the panel reaches the phone of the creator (EVM-136 AC6, the part that holds before EVM-135 narrows the scope of the phone;
 * ADR-0021 D3, ADR-0024 pt 3): the phone holds the survey without a customer, the Editor of the panel assigns a customer, the next pull brings the order that now
 * names a customer the replica does not know, and the snapshot of the order brings the customer. The list of the panel shows the customer. Synthetic data.
 */
let current: SyncApp;
afterEach(async () => {
  await current.app.close();
});
const app = (): IdentityApp => current.app;
const db = () => adminDb(current.app);
const STREET = 'ul. Znacznik-synchronizacji-synt';
const PHONE = '+48600938001';
const snapshot = (phone: Phone, id: string) => phone.get(`/api/v1/sync/work-orders/${id}`, phone.authorised());

interface SnapshotBody {
  entities: Array<Record<string, unknown>>;
}
const keyOf = (entity: Record<string, unknown>): string => `${String(entity['type'])}:${String(entity['id'])}`;

/** The Editor of the panel: a session of the web channel with the token of the CSRF. */
async function panelEditor(): Promise<PanelClient> {
  const user = await createUser(db(), app().clock, { role: 'editor' });
  const session = await createSession(db(), app().clock, user, { channel: 'web' });
  const panel = new PanelClient(app().app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return panel;
}

/** The phone of the creator holds a survey (its coordinator is the creator) and is current: the cursor of the first download is in hand. */
async function holdingPhone(customer: Parameters<typeof insertCustomer>[1] = { firstName: 'Ewa', lastName: 'Nowa' }) {
  current = await bootSync();
  // the customer and the Editor of the panel exist BEFORE the first download: no order of the phone names the customer, so the replica does not hold it (D3)
  const customerId = await insertCustomer(db(), customer);
  const panel = await panelEditor();
  const { phone, account } = await editor(app());
  const siteId = await insertSite(db(), { street: STREET });
  const number = numberOf(2026, 136);
  const ids = await insertWorkOrders(db(), [
    { number, siteId, coordinatorId: account.user.id, siteSurveyExpiresAt: new Date('2027-02-14T08:00:00.000Z') },
  ]);
  const orderId = ids.get(number) ?? '';
  await sql`update work_orders.work_orders set requester_phone = ${PHONE} where id = ${orderId}`.execute(db());
  const first = await drain(phone);
  return { phone, orderId, siteId, customerId, panel, cursor: first.cursor, firstKeys: keysOf(first.changes) };
}

describe('the phone after the assignment of a customer in the panel (EVM-136 AC6; ADR-0021 D3)', () => {
  it('EVM-136 AC6 the replica of the creator holds the survey without a customer; after the assignment the next pull brings the order with the customer it does not know, the snapshot brings the customer, and the order is no survey any more', async () => {
    const { phone, orderId, siteId, customerId, panel, cursor, firstKeys } = await holdingPhone();
    expect(firstKeys).toContain(`work_order:${orderId}`);
    const before = await drain(phone);
    expect(upsertOf(before.changes, 'work_order', orderId)).toMatchObject({
      customerId: null,
      siteSurvey: { requesterPhone: PHONE },
    });

    const assigned = await panel.put(`/api/v1/work-orders/${orderId}/customer`, { customerId, version: 1 });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);

    const page = await drain(phone, '', cursor);
    // the page holds the changed order, which now points to a customer the replica does not hold (D3), and the entry of the journal of the assignment - not the customer
    expect(keysOf(page.changes).filter((key) => !key.startsWith('timeline_entry:'))).toEqual([`work_order:${orderId}`]);
    expect(keysOf(page.changes).filter((key) => key.startsWith('timeline_entry:'))).toHaveLength(1);
    expect(keysOf(page.changes)).not.toContain(`customer:${customerId}`);
    expect(upsertOf(page.changes, 'work_order', orderId)).toMatchObject({
      id: orderId,
      version: 2,
      status: 'quoting',
      customerId,
      siteId,
      siteSurvey: null,
    });
    expect(JSON.stringify(page.changes)).not.toContain(PHONE);

    const response = await snapshot(phone, orderId);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const entities = (response.body as SnapshotBody).entities;
    expect(entities.map(keyOf)).toEqual(expect.arrayContaining([`work_order:${orderId}`, `customer:${customerId}`, `site:${siteId}`]));
    for (const entity of entities)
      expect(assertSyncProjectionStrict({ op: 'upsert', entity }), JSON.stringify(entity)).toEqual({ ok: true });
    expect(entities.find((entity) => entity['type'] === 'work_order')).toMatchObject({ customerId, siteSurvey: null });
    // every reference of the order resolves inside the snapshot
    const known = new Set(entities.map(keyOf));
    expect(known.has(`customer:${customerId}`) && known.has(`site:${siteId}`)).toBe(true);
    expect(JSON.stringify(entities)).not.toContain(PHONE);
  });

  it('EVM-136 AC6 the customer of the snapshot is the projection of the customer for the phone - the name and the telephone of the customer, no e-mail, no notes - and the same call is idempotent', async () => {
    const { phone, orderId, customerId, panel } = await holdingPhone({
      firstName: 'Ewa',
      lastName: 'Nowa',
      phone: '+48600938002',
      email: 'ewa-nowa-synt@example.invalid',
      notes: 'SENTINEL-CUSTOMER-NOTES',
    });
    expect((await panel.put(`/api/v1/work-orders/${orderId}/customer`, { customerId, version: 1 })).status).toBe(200);
    const entities = ((await snapshot(phone, orderId)).body as SnapshotBody).entities;
    const customer = entities.find((entity) => entity['type'] === 'customer');
    expect(customer).toMatchObject({ id: customerId, displayName: 'Ewa Nowa', phone: '+48600938002' });
    expect(JSON.stringify(entities)).not.toContain('ewa-nowa-synt@example.invalid');
    expect(JSON.stringify(entities)).not.toContain('SENTINEL-CUSTOMER-NOTES');
    // the repeat changes nothing, so the next pull has nothing new
    const cursor = (await drain(phone)).cursor;
    expect((await panel.put(`/api/v1/work-orders/${orderId}/customer`, { customerId, version: 1 })).status).toBe(200);
    expect((await drain(phone, '', cursor)).changes).toEqual([]);
  });

  it('EVM-136 AC6 the panel shows the customer of the order after the assignment - in the detail and in the list (the projection is recomputed in the transaction of the assignment)', async () => {
    const { orderId, customerId, panel } = await holdingPhone();
    const row = async () =>
      (
        (await panel.get('/api/v1/work-orders?limit=100')).body as {
          items: Array<{ id: string; customer: { id: string; displayName: string } | null }>;
        }
      ).items.find((item) => item.id === orderId);
    expect(await row()).toMatchObject({ customer: null });
    expect((await panel.put(`/api/v1/work-orders/${orderId}/customer`, { customerId, version: 1 })).status).toBe(200);
    expect(await row()).toMatchObject({ customer: { id: customerId, displayName: 'Ewa Nowa' } });
    const detail = await panel.get(`/api/v1/work-orders/${orderId}`);
    expect(detail.body).toMatchObject({ customer: { id: customerId, displayName: 'Ewa Nowa' }, siteSurvey: null });
    const projection = (
      await sql<{ customer_id: string | null; site_survey_expires_at: Date | null }>`
        select customer_id, site_survey_expires_at from overview.work_order_summaries where work_order_id = ${orderId}`.execute(db())
    ).rows[0];
    expect(projection).toEqual({ customer_id: customerId, site_survey_expires_at: null });
  });

  it('EVM-136 AC6 W5 the change log of the synchronisation holds identifiers only after the assignment: no street, no phone of the requester, no name of the customer', async () => {
    const { orderId, customerId, panel } = await holdingPhone();
    expect((await panel.put(`/api/v1/work-orders/${orderId}/customer`, { customerId, version: 1 })).status).toBe(200);
    const log = JSON.stringify((await sql`select to_jsonb(t) as r from sync.change_log t`.execute(db())).rows);
    for (const secret of [STREET, PHONE, '600938001', 'Ewa', 'Nowa']) expect(log, secret).not.toContain(secret);
    expect(log).toContain(orderId);
  });
});
