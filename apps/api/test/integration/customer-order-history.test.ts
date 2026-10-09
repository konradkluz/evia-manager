import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { clearCustomers, insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
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
  await clearWorkOrderCreation(current.database.admin);
  await clearCustomers(current.database.admin);
});

const ORDERS = '/api/v1/work-orders';
const admin = () => current.database.admin;

async function signIn(role: Role = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user);
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
interface Page {
  items: Array<{ id: string; number: string; title: string; status: string; createdAt: string }>;
  nextCursor: string | null;
}
const history = async (browser: Awaited<ReturnType<typeof signIn>>, customerId: string, extra = ''): Promise<Page> => {
  const response = await browser.panel.get(`${ORDERS}?customerId=${customerId}${extra}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
};
const numbers = (page: Page): string[] => page.items.map((item) => item.number);

describe('the history of orders of a customer (EVM-039 AC2; SR-AUTHZ-03)', () => {
  it('EVM-039 AC2 a customer with 3 orders: the list with customerId has those 3 — number, title, status, date — newest first, and no order of another customer', async () => {
    const customer = await insertCustomer(admin());
    const other = await insertCustomer(admin(), { lastName: 'Inny' });
    await insertWorkOrders(admin(), [
      { number: 'ZL-2026-0017', customerId: customer, status: 'settled', createdAt: new Date('2026-01-15T08:00:00Z') },
      { number: 'ZL-2026-0042', customerId: customer, status: 'in_progress', createdAt: new Date('2026-09-01T08:00:00Z') },
      { number: 'ZL-2026-0058', customerId: customer, status: 'new', createdAt: new Date('2026-09-28T08:00:00Z') },
      { number: 'ZL-2026-0099', customerId: other, createdAt: new Date('2026-09-29T08:00:00Z') },
      { number: 'ZL-2026-0100' },
    ]);
    const page = await history(await signIn('read_only'), customer, '&sort=-createdAt');
    expect(numbers(page)).toEqual(['ZL-2026-0058', 'ZL-2026-0042', 'ZL-2026-0017']);
    expect(page.items.map((item) => item.status)).toEqual(['new', 'in_progress', 'settled']);
    expect(page.items[0]).toMatchObject({ title: 'Zlecenie syntetyczne ZL-2026-0058', createdAt: '2026-09-28T08:00:00.000Z' });
    expect(page.nextCursor).toBeNull();
  });

  it('EVM-039 AC2 the same policy as the list of orders: an order that is soft deleted is on no page, for any role', async () => {
    const customer = await insertCustomer(admin());
    await insertWorkOrders(admin(), [
      { number: 'ZL-2026-0201', customerId: customer },
      { number: 'ZL-2026-0202', customerId: customer, deletedAt: new Date('2026-10-02T08:00:00Z') },
    ]);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      expect(numbers(await history(await signIn(role), customer)), role).toEqual(['ZL-2026-0201']);
    }
  });

  it('EVM-039 AC2 a filter is not a check of existence: a customer who is missing or deleted gives the same empty list, not a 404', async () => {
    const deleted = await insertCustomer(admin(), { deletedAt: '2026-10-02T08:00:00Z' });
    const browser = await signIn('editor');
    for (const id of [deleted, uuidv7()]) expect(await history(browser, id)).toEqual({ items: [], nextCursor: null });
  });

  it('EVM-039 AC2 the history pages with the cursor of the list, and the cursor is bound to the customer: another customerId is 400 invalid_cursor', async () => {
    const customer = await insertCustomer(admin());
    const other = await insertCustomer(admin(), { lastName: 'Inny' });
    await insertWorkOrders(
      admin(),
      Array.from({ length: 5 }, (_, index) => ({
        number: `ZL-2026-03${String(index).padStart(2, '0')}`,
        customerId: customer,
        createdAt: new Date(Date.UTC(2026, 8, 1 + index, 8)),
      })),
    );
    const browser = await signIn('editor');
    const first = await history(browser, customer, '&sort=-createdAt&limit=3');
    expect(numbers(first)).toEqual(['ZL-2026-0304', 'ZL-2026-0303', 'ZL-2026-0302']);
    const second = await history(browser, customer, `&sort=-createdAt&limit=3&cursor=${first.nextCursor ?? ''}`);
    expect(numbers(second)).toEqual(['ZL-2026-0301', 'ZL-2026-0300']);
    expect(second.nextCursor).toBeNull();
    const foreign = await browser.panel.get(`${ORDERS}?customerId=${other}&sort=-createdAt&limit=3&cursor=${first.nextCursor ?? ''}`);
    expect(foreign.status).toBe(400);
    expect((foreign.body as { code: string }).code).toBe('invalid_cursor');
  });

  it('EVM-039 AC2 customerId combines with the other filters (AND) and a malformed customerId is 400', async () => {
    const customer = await insertCustomer(admin());
    await insertWorkOrders(admin(), [
      { number: 'ZL-2026-0401', customerId: customer, status: 'new' },
      { number: 'ZL-2026-0402', customerId: customer, status: 'settled' },
    ]);
    const browser = await signIn('editor');
    expect(numbers(await history(browser, customer, '&status=settled'))).toEqual(['ZL-2026-0402']);
    const bad = await browser.panel.get(`${ORDERS}?customerId=nie-uuid`);
    expect(bad.status).toBe(400);
    expect((bad.body as { code: string }).code).toBe('validation_failed');
  });
});
