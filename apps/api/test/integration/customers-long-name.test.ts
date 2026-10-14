import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { clearCustomers } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation } from '../support/work-order-fixtures.ts';

/**
 * EVM-078: a regression test of EVM-020 — a person with a first and a last name of 200 characters each has a display name of 401
 * characters; no path (create, read, list, search, work order, edit) may answer 500 `internal_error`.
 */
let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await clearWorkOrderCreation(current.database.admin);
  await clearCustomers(current.database.admin);
});

const admin = () => current.database.admin;
const FIRST = 'a'.repeat(200);
const LAST = 'b'.repeat(200);
const FULL_NAME = `${FIRST} ${LAST}`;
const SORT_NAME = `${LAST} ${FIRST}`;

async function signIn(role: Role = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const person = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  kind: 'person',
  firstName: FIRST,
  lastName: LAST,
  phone: '600 000 001',
  ...overrides,
});

/** The Editor creates the customer of 200 + 200 and an order for them; returns the identifiers. */
async function longNamedOrder(editor: Browser) {
  const body = person();
  const customer = await editor.panel.post('/api/v1/customers', body);
  expect(customer.status, JSON.stringify(customer.body)).toBe(201);
  const template = (await sql<{ id: string }>`select id from catalog.work_order_templates limit 1`.execute(admin())).rows[0]?.id;
  const siteId = await insertSite(admin(), {});
  const order = await editor.panel.post('/api/v1/work-orders', { id: uuidv7(), customerId: body.id, siteId, templateId: template });
  return { customerId: body.id, customer, order, orderId: (order.body as { id?: string }).id ?? '' };
}

describe('a customer with a 200 + 200 character name (EVM-078)', () => {
  it('EVM-078 AC1 the Editor creates the customer and then an order for them: both 201, displayName of 401 characters', async () => {
    const { customer, order } = await longNamedOrder(await signIn('editor'));
    expect((customer.body as { displayName: string }).displayName).toBe(FULL_NAME);
    expect(FULL_NAME).toHaveLength(401);
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect((order.body as { customer: { displayName: string } }).customer.displayName).toBe(FULL_NAME);
  });

  it.each<Role>(['administrator', 'editor', 'read_only'])(
    'EVM-078 AC2 %s reads the customer (detail, list, search), the orders (detail, card, list, search) with the full name: 200, no internal_error',
    async (role) => {
      const { customerId, orderId } = await longNamedOrder(await signIn('editor'));
      const reader = await signIn(role);
      const get = (path: string) => reader.panel.get(path);

      const detail = await get(`/api/v1/customers/${customerId}`);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      expect(detail.body).toMatchObject({ displayName: FULL_NAME });

      const list = await get('/api/v1/customers');
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect((list.body as { items: unknown[] }).items).toEqual([
        expect.objectContaining({ id: customerId, displayName: FULL_NAME, sortName: SORT_NAME }),
      ]);

      const found = await reader.panel.post('/api/v1/customers/search', { query: 'bbb' });
      expect(found.status, JSON.stringify(found.body)).toBe(200);
      expect((found.body as { items: unknown[] }).items).toEqual([expect.objectContaining({ id: customerId, displayName: FULL_NAME })]);

      const order = await get(`/api/v1/work-orders/${orderId}`);
      expect(order.status, JSON.stringify(order.body)).toBe(200);
      expect(order.body).toMatchObject({ customer: { id: customerId, displayName: FULL_NAME } });

      const card = await get(`/api/v1/work-orders/${orderId}/customer`);
      expect(card.status, JSON.stringify(card.body)).toBe(200);
      expect(card.body).toMatchObject({ displayName: FULL_NAME });

      const orders = await get('/api/v1/work-orders');
      expect(orders.status, JSON.stringify(orders.body)).toBe(200);
      expect((orders.body as { items: unknown[] }).items).toEqual([
        expect.objectContaining({ id: orderId, customer: { id: customerId, displayName: FULL_NAME } }),
      ]);

      const orderSearch = await reader.panel.post('/api/v1/work-orders/search', { query: 'bbb' });
      expect(orderSearch.status, JSON.stringify(orderSearch.body)).toBe(200);
      expect((orderSearch.body as { items: unknown[] }).items).toEqual([
        expect.objectContaining({ id: orderId, customer: { id: customerId, displayName: FULL_NAME } }),
      ]);
    },
  );

  it('EVM-078 AC3 the Editor changes the last name to 200 other characters (PATCH with If-Match): 200', async () => {
    const editor = await signIn('editor');
    const body = person();
    expect((await editor.panel.post('/api/v1/customers', body)).status).toBe(201);
    const lastName = 'c'.repeat(200);
    const response = await editor.panel.patch(`/api/v1/customers/${body.id}`, { lastName }, { 'If-Match': '"1"' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ lastName, displayName: `${FIRST} ${lastName}`, version: 2 });
  });

  it('EVM-078 AC4 a first name, a last name or a company name of 201 characters is 400 too_long with the pointer of the field (create and edit)', async () => {
    const editor = await signIn('editor');
    const long = 'x'.repeat(201);
    for (const field of ['firstName', 'lastName']) {
      const response = await editor.panel.post('/api/v1/customers', person({ [field]: long }));
      expect(response.status, field).toBe(400);
      expect(errorsOf(response.body)).toEqual([{ pointer: `/${field}`, code: 'too_long' }]);
    }
    const company = await editor.panel.post('/api/v1/customers', {
      id: uuidv7(),
      kind: 'company',
      companyName: long,
      phone: '600 000 002',
    });
    expect(company.status).toBe(400);
    expect(errorsOf(company.body)).toEqual([{ pointer: '/companyName', code: 'too_long' }]);

    const body = person();
    expect((await editor.panel.post('/api/v1/customers', body)).status).toBe(201);
    for (const field of ['firstName', 'lastName']) {
      const response = await editor.panel.patch(`/api/v1/customers/${body.id}`, { [field]: long }, { 'If-Match': '"1"' });
      expect(response.status, field).toBe(400);
      expect(errorsOf(response.body)).toEqual([{ pointer: `/${field}`, code: 'too_long' }]);
    }
  });
});
