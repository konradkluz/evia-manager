import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { clearCustomers, insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { clearSitesAndParties, insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertScopeItems, insertWorkOrders, type WorkOrderSpec } from '../support/work-order-fixtures.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await sql`delete from work_orders.scope_items`.execute(current.database.admin);
  await sql`delete from work_orders.work_order_assignments`.execute(current.database.admin);
  await sql`delete from work_orders.work_orders`.execute(current.database.admin);
  await clearCustomers(current.database.admin);
  await clearSitesAndParties(current.database.admin);
});

const ORDERS = '/api/v1/work-orders';
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

const codeOf = (body: unknown) => (body as { code?: string }).code;
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');
const siteOrders = (browser: Browser, workOrderId: string) => browser.panel.get(`${ORDERS}/${workOrderId}/site-orders`);

/** Inserts the orders and returns the identifiers by number. */
const orders = (specs: readonly WorkOrderSpec[]) => insertWorkOrders(admin(), specs);
const idOf = (ids: Map<string, string>, number: string): string => {
  const id = ids.get(number);
  if (id === undefined) throw new Error(`no order ${number}`);
  return id;
};

describe('the other orders in the site of an order (EVM-036 AC5; SR-AUTHZ-03, SR-DATA-03)', () => {
  it('EVM-036 AC5 a settled order of ANOTHER customer in the same site: the number, the title, the status and the closing time — and nothing else', async () => {
    const siteId = await insertSite(admin());
    const customerA = await insertCustomer(admin(), { lastName: 'Pierwszy', email: 'pierwszy@example.test' });
    const customerB = await insertCustomer(admin(), { lastName: 'Drugi', email: 'drugi@example.test', phone: '+48600000099' });
    const closedAt = new Date('2026-09-01T10:30:00.000Z');
    const ids = await orders([
      { number: 'ZL-2026-0017', title: 'Montaż wallboxa 11 kW', status: 'settled', closedAt, customerId: customerA, siteId },
      { number: 'ZL-2026-0058', title: 'Przegląd instalacji', customerId: customerB, siteId },
    ]);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const response = await siteOrders(await signIn(role), idOf(ids, 'ZL-2026-0058'));
      expect(response.status, role).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.body).toEqual({
        total: 1,
        items: [
          {
            id: idOf(ids, 'ZL-2026-0017'),
            number: 'ZL-2026-0017',
            title: 'Montaż wallboxa 11 kW',
            status: 'settled',
            closedAt: '2026-09-01T10:30:00.000Z',
          },
        ],
      });
      expect(Object.keys((response.body as { items: object[] }).items[0] ?? {}).sort()).toEqual([
        'closedAt',
        'id',
        'number',
        'status',
        'title',
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(
        /Pierwszy|Drugi|example\.test|600000099|customer|media|thumbnail|document|payment/i,
      );
    }
  });

  it('EVM-036 AC5 the order itself is not in the list nor in the counter; an open order has no closedAt; the orders of OTHER sites are not there', async () => {
    const siteId = await insertSite(admin());
    const otherSite = await insertSite(admin(), { street: 'ul. Inna' });
    const ids = await orders([
      { number: 'ZL-2026-0001', siteId },
      { number: 'ZL-2026-0002', siteId },
      { number: 'ZL-2026-0003', siteId: otherSite },
    ]);
    const response = await siteOrders(await signIn('read_only'), idOf(ids, 'ZL-2026-0001'));
    expect(response.body).toEqual({
      total: 1,
      items: [{ id: idOf(ids, 'ZL-2026-0002'), number: 'ZL-2026-0002', title: 'Zlecenie syntetyczne ZL-2026-0002', status: 'new' }],
    });
  });

  it('EVM-036 AC5 an order alone in its site has no other orders (the section is hidden): an empty list and a counter of 0; an order without a site as well', async () => {
    const siteId = await insertSite(admin());
    const ids = await orders([{ number: 'ZL-2026-0001', siteId }, { number: 'ZL-2026-0002' }]);
    const reader = await signIn('read_only');
    for (const number of ['ZL-2026-0001', 'ZL-2026-0002']) {
      const response = await siteOrders(reader, idOf(ids, number));
      expect(response.status, number).toBe(200);
      expect(response.body, number).toEqual({ total: 0, items: [] });
    }
  });

  it('EVM-036 AC5 the page is fixed: 20 orders, the newest number first, and the counter says how many there are', async () => {
    const siteId = await insertSite(admin());
    const specs = Array.from({ length: 26 }, (_, index) => ({ number: `ZL-2026-${String(index + 1).padStart(4, '0')}`, siteId }));
    const ids = await orders(specs);
    const response = await siteOrders(await signIn('editor'), idOf(ids, 'ZL-2026-0001'));
    const body = response.body as { total: number; items: Array<{ number: string }> };
    expect(body.total).toBe(25);
    expect(body.items).toHaveLength(20);
    expect(body.items.map((item) => item.number)).toEqual(
      Array.from({ length: 20 }, (_, index) => `ZL-2026-${String(26 - index).padStart(4, '0')}`),
    );
    const withLimit = await (
      await signIn('editor')
    ).panel.get(`${ORDERS}/${idOf(ids, 'ZL-2026-0001')}/site-orders?limit=100&siteId=${siteId}`);
    expect(withLimit.status).toBe(400); // the page size is fixed on the server: a query parameter is refused, not obeyed
  });

  it('EVM-036 AC5 AC6 an order of the site that is SOFT DELETED is in neither the list nor the counter — for the Administrator too — and is a 404 on its own', async () => {
    const siteId = await insertSite(admin());
    const customerId = await insertCustomer(admin(), { lastName: 'Usuniety', email: 'usuniety@example.test' });
    const ids = await orders([
      { number: 'ZL-2026-0001', siteId },
      { number: 'ZL-2026-0002', siteId, customerId, deletedAt: new Date('2026-10-02T08:00:00Z') },
      { number: 'ZL-2026-0003', siteId },
    ]);
    const deleted = idOf(ids, 'ZL-2026-0002');
    await insertScopeItems(admin(), deleted, [{ position: 1 }]);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      const response = await siteOrders(browser, idOf(ids, 'ZL-2026-0001'));
      expect((response.body as { total: number }).total, role).toBe(1);
      expect(
        (response.body as { items: Array<{ number: string }> }).items.map((item) => item.number),
        role,
      ).toEqual(['ZL-2026-0003']);
      // the deleted order B is reachable by none of the ways that go through the order
      for (const suffix of ['', '/site', '/customer', '/scope-items', '/site-orders']) {
        const direct = await browser.panel.get(`${ORDERS}/${deleted}${suffix}`);
        expect(direct.status, `${role} ${suffix}`).toBe(404);
        expect(codeOf(direct.body)).toBe('not_found');
      }
    }
  });
});

describe('no access to the data of an order through its site (EVM-036 AC6; SR-AUTHZ-02, SR-AUTHZ-08, AB-19, CWE-639)', () => {
  it('EVM-036 AC6 the site and its other orders carry no key of a customer, a medium or a document; the customer of B is read only through the order B', async () => {
    const siteId = await insertSite(admin(), { notes: 'notatka' });
    const customerB = await insertCustomer(admin(), { lastName: 'Klient-B', email: 'klient-b@example.test' });
    const ids = await orders([
      { number: 'ZL-2026-0001', siteId },
      { number: 'ZL-2026-0002', siteId, customerId: customerB },
    ]);
    const reader = await signIn('read_only');
    const viaSite = await reader.panel.get(`/api/v1/sites/${siteId}`);
    const viaList = await siteOrders(reader, idOf(ids, 'ZL-2026-0001'));
    const viaCard = await reader.panel.get(`${ORDERS}/${idOf(ids, 'ZL-2026-0001')}/site`);
    for (const response of [viaSite, viaList, viaCard]) {
      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toMatch(/Klient-B|klient-b|customer|media|document|payment|thumbnail/i);
    }
    // the card of B's customer is the answer of the authorization of the order B — the same for a direct read
    const direct = await reader.panel.get(`${ORDERS}/${idOf(ids, 'ZL-2026-0002')}/customer`);
    expect(direct.status).toBe(200);
    expect(direct.body).toMatchObject({ displayName: 'Jan Klient-B' });
  });

  it('EVM-036 AC6 there is no route that reaches the media, the documents, the orders or the customers by the id of a site: all 404, for every role', async () => {
    const siteId = await insertSite(admin());
    await orders([{ number: 'ZL-2026-0001', siteId }]);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      for (const suffix of ['media', 'documents', 'work-orders', 'orders', 'customers', 'site-orders']) {
        const response = await browser.panel.get(`/api/v1/sites/${siteId}/${suffix}`);
        expect(response.status, `${role} ${suffix}`).toBe(404);
      }
      const list = await browser.panel.get(`${ORDERS}?siteId=${siteId}`);
      expect(list.status, role).toBe(400); // the list has no filter by site: an unknown parameter is refused
    }
  });

  it('EVM-036 AC6 the order is the only anchor: a site id in the query string of site-orders is refused, and the path takes an order, not a site', async () => {
    const siteA = await insertSite(admin(), { street: 'ul. Pierwsza' });
    const siteB = await insertSite(admin(), { street: 'ul. Druga' });
    const ids = await orders([
      { number: 'ZL-2026-0001', siteId: siteA },
      { number: 'ZL-2026-0002', siteId: siteB, title: 'Tylko w lokalizacji B' },
    ]);
    const editor = await signIn('editor');
    const forged = await editor.panel.get(`${ORDERS}/${idOf(ids, 'ZL-2026-0001')}/site-orders?siteId=${siteB}`);
    expect(forged.status).toBe(400); // the contract has no query parameter here: a site id in the query string is refused, not obeyed
    const asSite = await siteOrders(editor, siteB); // a site id where an order id belongs: no such order
    expect(asSite.status).toBe(404);
  });
});

describe('who may read the other orders (EVM-036 AC7; SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-08)', () => {
  it('EVM-036 AC7 an order that is soft deleted and one that never existed are the SAME 404 not_found for every role; a malformed id is 400', async () => {
    const siteId = await insertSite(admin());
    const ids = await orders([{ number: 'ZL-2026-0001', siteId, deletedAt: new Date('2026-10-02T08:00:00Z') }]);
    const answers: string[] = [];
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const browser = await signIn(role);
      for (const id of [idOf(ids, 'ZL-2026-0001'), uuidv7()]) {
        const response = await siteOrders(browser, id);
        expect(response.status, role).toBe(404);
        answers.push(withoutTrace(response.body));
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect((await siteOrders(await signIn(), 'abc')).status).toBe(400);
  });

  it('EVM-036 AC7 AC6 an anonymous caller is 401; a mobile token is 403 (the section is only in the panel)', async () => {
    const siteId = await insertSite(admin());
    const ids = await orders([{ number: 'ZL-2026-0001', siteId }]);
    const id = idOf(ids, 'ZL-2026-0001');
    expect((await new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN).get(`${ORDERS}/${id}/site-orders`)).status).toBe(401);
    const mobile = await signIn('editor', 'mobile');
    const response = await siteOrders(mobile, id);
    expect(response.status).toBe(403);
    expect(codeOf(response.body)).toBe('forbidden');
  });

  it('EVM-036 AC5 the read is not audited and nothing about the orders reaches the log of the API', async () => {
    const siteId = await insertSite(admin());
    const ids = await orders([
      { number: 'ZL-2026-0001', siteId },
      { number: 'ZL-2026-0002', siteId, title: 'Tytuł-poufny-xyz' },
    ]);
    const reader = await signIn('read_only');
    const before = current.logs.lines.length;
    const { rows: events } = await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin());
    expect((await siteOrders(reader, idOf(ids, 'ZL-2026-0001'))).status).toBe(200);
    expect(current.logs.lines.slice(before).join('\n')).not.toMatch(/poufny|ZL-2026-0002/);
    const { rows: after } = await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin());
    expect(after[0]?.n).toBe(events[0]?.n);
  });

  it('EVM-036 AC5 the list and the counter run on an index: the plan of the query for one site walks work_orders_site_number_idx', async () => {
    const siteId = await insertSite(admin());
    await orders(Array.from({ length: 30 }, (_, index) => ({ number: `ZL-2026-${String(index + 1).padStart(4, '0')}`, siteId })));
    const plan = await admin()
      .transaction()
      .execute(async (tx) => {
        await sql`set local enable_seqscan = off`.execute(tx);
        const { rows } = await sql`explain select id from work_orders.work_orders where site_id = ${siteId} and deleted_at is null
          order by number desc, id desc limit 20`.execute(tx);
        return rows;
      });
    expect(JSON.stringify(plan)).toMatch(/work_orders_site_number_idx/);
  });
});
