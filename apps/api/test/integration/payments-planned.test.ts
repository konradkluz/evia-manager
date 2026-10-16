import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones, type MilestoneSpec } from '../support/payment-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import type { WorkOrderSpec } from '../support/work-order-fixtures.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const LIST = '/api/v1/payment-milestones';
const TODAY_NOON = '2026-10-03T10:00:00.000Z';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(TODAY_NOON);
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;

async function signIn(role: Role = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

interface PlannedItem {
  id: string;
  workOrder: { id: string; number: string };
  customer: { id: string; displayName: string } | { deleted: true } | null;
  name: string;
  amount: { amountMinor: number } | null;
  status: string;
  version: number;
}
interface Page {
  items: PlannedItem[];
  nextCursor: string | null;
  summary: { unpaid: { count: number }; filtered: { count: number; total: { amountMinor: number; currency: string } } };
}
const get = async (browser: Browser, query: string) => {
  const response = await browser.panel.get(`${LIST}?${query}`);
  return { status: response.status, body: response.body as Page, headers: response.headers };
};
const codeOf = (body: unknown) => (body as { code?: string }).code;

async function order(number: string, milestones: MilestoneSpec[], extra: Partial<WorkOrderSpec> = {}) {
  const ids = await insertWorkOrders(admin(), [{ number, ...extra }]);
  const id = [...ids.values()][0] ?? '';
  return { id, milestoneIds: await insertMilestones(admin(), id, milestones) };
}
const closedAt = new Date('2026-10-02T08:00:00Z');

/** 5 milestones "Planowana" in open orders (inserted out of order) and 3 in cancelled and settled ones. */
async function dataset() {
  const jan = await insertCustomer(admin(), { lastName: 'Przykładowy' });
  await order('ZL-2026-0042', [{ name: 'Po zgodach', amountMinor: 540_000 }, { name: 'Po instalacji' }, { name: 'Końcowa' }], {
    customerId: jan,
  });
  await order('ZL-2026-0038', [{ name: 'Końcowa' }, { name: 'Zrobiona', status: 'invoiced', amountMinor: 100_000 }]);
  await order('ZL-2026-0051', [{ name: 'Montaż', amountMinor: 123_000 }], { status: 'on_hold' });
  await order('ZL-2026-0060', [{ name: 'Anulowana A' }, { name: 'Anulowana B' }], { status: 'cancelled', closedAt });
  await order('ZL-2026-0061', [{ name: 'Rozliczona' }], { status: 'settled', closedAt });
}

describe('the view "Do wystawienia" (EVM-059 AC1, AC3)', () => {
  it('EVM-059 AC1 5 milestones "Planowana" in open orders and 2 in cancelled ones: 5 items sorted by the number of the order, then by the milestone, an amount or null', async () => {
    await dataset();
    const editor = await signIn();
    const { status, body, headers } = await get(editor, 'view=planned');
    expect(status).toBe(200);
    expect(headers['cache-control']).toContain('no-store');
    expect(body.items.map((item) => [item.workOrder.number, item.name, item.amount?.amountMinor ?? null, item.status])).toEqual([
      ['ZL-2026-0038', 'Końcowa', null, 'planned'],
      ['ZL-2026-0042', 'Po zgodach', 540_000, 'planned'],
      ['ZL-2026-0042', 'Po instalacji', null, 'planned'],
      ['ZL-2026-0042', 'Końcowa', null, 'planned'],
      ['ZL-2026-0051', 'Montaż', 123_000, 'planned'],
    ]);
    expect(JSON.stringify(body.items[1]?.customer)).toContain('Przykładowy');
    expect(body.items[0]?.customer).toBeNull();
    expect(body.nextCursor).toBeNull();
    expect(body.summary.filtered).toEqual({ count: 5, total: { amountMinor: 663_000, currency: 'PLN' } });
    expect(body.summary.unpaid.count).toBe(1);
  });

  it('EVM-059 AC1 the pages follow the order across the boundary of an order: limit 2 gives 3 pages without a repeat or a gap', async () => {
    await dataset();
    const editor = await signIn();
    const names: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const { status, body } = await get(editor, `view=planned&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`);
      expect(status).toBe(200);
      names.push(...body.items.map((item) => `${item.workOrder.number}/${item.name}`));
      expect(body.summary.filtered.count).toBe(5);
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(names).toEqual([
      'ZL-2026-0038/Końcowa',
      'ZL-2026-0042/Po zgodach',
      'ZL-2026-0042/Po instalacji',
      'ZL-2026-0042/Końcowa',
      'ZL-2026-0051/Montaż',
    ]);
  });

  it('EVM-059 AC1 a cursor of another view is 400 invalid_cursor; a range of due days with this view is 400 validation_failed', async () => {
    await dataset();
    const editor = await signIn();
    const { body } = await get(editor, 'view=planned&limit=1');
    expect(body.nextCursor).not.toBeNull();
    const other = await get(editor, `view=unpaid&limit=1&cursor=${body.nextCursor}`);
    expect(other.status).toBe(400);
    expect(codeOf(other.body)).toBe('invalid_cursor');
    const range = await get(editor, 'view=planned&dueFrom=2026-10-01');
    expect(range.status).toBe(400);
    expect(codeOf(range.body)).toBe('validation_failed');
  });

  it('EVM-059 AC1 the filter by a customer narrows the view; a customer who does not exist gives an empty list', async () => {
    await dataset();
    const editor = await signIn();
    const customers = (await get(editor, 'view=planned')).body.items.flatMap((item) =>
      item.customer !== null && 'id' in item.customer ? [item.customer.id] : [],
    );
    const narrowed = await get(editor, `view=planned&customerId=${customers[0]}`);
    expect(narrowed.body.items.map((item) => item.workOrder.number)).toEqual(['ZL-2026-0042', 'ZL-2026-0042', 'ZL-2026-0042']);
    expect(narrowed.body.summary.filtered.count).toBe(3);
    const none = await get(editor, `view=planned&customerId=${uuidv7()}`);
    expect(none.body.items).toEqual([]);
    expect(none.body.summary.filtered.count).toBe(0);
  });

  it('EVM-059 AC3 a deleted order and a deleted milestone are not in the view, for the Administrator too; nothing planned is an empty list', async () => {
    await order('ZL-2026-0070', [{ name: 'W usuniętym' }], { deletedAt: new Date('2026-10-02T08:00:00Z') });
    await order('ZL-2026-0071', [
      { name: 'Usunięta', deletedAt: new Date('2026-10-02T08:00:00Z') },
      { name: 'Zapłacona', status: 'paid', amountMinor: 1000 },
    ]);
    const administrator = await signIn('administrator');
    const { status, body } = await get(administrator, 'view=planned');
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.summary.filtered).toEqual({ count: 0, total: { amountMinor: 0, currency: 'PLN' } });
  });
});

describe('the view "Do wystawienia" in the roles and after the invoice (EVM-059 AC2, AC4)', () => {
  it('EVM-059 AC4 Administrator, Editor and Read-only see the same 5 items; an unauthenticated caller gets 401', async () => {
    await dataset();
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const { status, body } = await get(await signIn(role), 'view=planned');
      expect(status, role + JSON.stringify(body)).toBe(200);
      expect(body.items, role).toHaveLength(5);
    }
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await anonymous.get(`${LIST}?view=planned`)).status).toBe(401);
  });

  it('EVM-059 AC2 the item carries the version for "Wystaw fakturę…"; after planned → invoiced the milestone leaves the view and enters the unpaid list', async () => {
    await dataset();
    const editor = await signIn();
    const first = (await get(editor, 'view=planned')).body.items[1];
    expect(first?.version).toBe(1);
    const response = await editor.panel.post(
      `/api/v1/work-orders/${first?.workOrder.id}/payment-milestones/${first?.id}/transitions`,
      {
        to: 'invoiced',
        amount: { amountMinor: 540_000, currency: 'PLN' },
        invoiceNumber: 'FV/TEST/0012/2026',
        invoicedOn: '2026-10-03',
        dueDate: '2026-10-31',
      },
      { 'If-Match': `"${first?.version}"`, 'Idempotency-Key': uuidv7() },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const after = await get(editor, 'view=planned');
    expect(after.body.items.map((item) => item.id)).not.toContain(first?.id);
    expect(after.body.summary.filtered.count).toBe(4);
    expect(after.body.summary.unpaid.count).toBe(2);
  });
});
