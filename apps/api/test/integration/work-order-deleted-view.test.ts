import { sql } from 'kysely';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../src/modules/work-orders/index.ts';
import { BULK_READ_CONTROL } from '../../src/platform/tokens.ts';
import type { BulkReadControl } from '../../src/platform/bulk-read/bulk-read-control.ts';
import { principal } from '../support/principals.ts';
import { BASE, TITLE, useDeletionApp, type Browser } from '../support/deletion-harness.ts';
import type { MilestoneSpec } from '../support/payment-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';

const harness = useDeletionApp({ countStatements: true });
const { app, admin, statements } = harness;

const ROLES_UNDER_TEST = ['administrator', 'editor', 'read_only'] as const;
const codeOf = (body: unknown) => (body as { code?: string }).code;
interface Item {
  id: string;
  number: string;
  title: string;
  customer?: { id?: string; displayName?: string; deleted?: true } | null;
  site?: { city: string } | null;
  deletedAt?: string;
  version?: number;
  payment?: unknown;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}
const page = (response: { body: unknown }) => response.body as Page;
const idsOf = (response: { body: unknown }) => page(response).items.map((item) => item.id);
const del = (browser: Browser, id: string, ifMatch = '"1"') => browser.panel.delete(`${BASE}/${id}`, { 'If-Match': ifMatch });
const planned: MilestoneSpec = { status: 'planned', amountMinor: 40_000 };
const paid: MilestoneSpec = { status: 'paid', amountMinor: 120_000 };

describe('the view "Usunięte" of the list (EVM-060 AC4; ADR-0017; SR-AUTHZ-02, SR-API-02; ASVS V8.2.2, V2.4.1)', () => {
  it('EVM-060 AC4 the Administrator sees the deleted orders and only them: the title, the customer, the place, the time of the deletion and the version for If-Match — and no column of payments', async () => {
    const administrator = await harness.administrator();
    const gone = await harness.order([paid, planned]);
    const live = await harness.order([planned]);
    expect((await del(administrator, gone.id)).status).toBe(204);

    const response = await administrator.panel.get(`${BASE}?view=deleted&limit=100`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(idsOf(response)).toEqual([gone.id]);
    expect(idsOf(response)).not.toContain(live.id);
    const [item] = page(response).items;
    expect(item).toMatchObject({ id: gone.id, number: gone.number, version: 2 });
    expect(item?.title).toContain(TITLE);
    expect(item?.customer).toMatchObject({ id: gone.customerId });
    expect(item?.site).toMatchObject({ city: expect.any(String) as string });
    expect(Date.parse(item?.deletedAt ?? '')).toBe(app().clock.now().getTime());
    expect(item).not.toHaveProperty('payment');
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('EVM-060 AC4 the version of the item is the one the restoration asks for, and an item of any other view has neither deletedAt nor version', async () => {
    const administrator = await harness.administrator();
    const gone = await harness.order([planned]);
    const live = await harness.order([planned]);
    expect((await del(administrator, gone.id)).status).toBe(204);
    const [item] = page(await administrator.panel.get(`${BASE}?view=deleted`)).items;
    const restored = await administrator.panel.post(`${BASE}/${gone.id}/restore`, undefined, { 'If-Match': `"${item?.version}"` });
    expect(restored.status).toBe(200);
    const open = page(await administrator.panel.get(`${BASE}?view=all_open&limit=100`)).items;
    expect(open.map((entry) => entry.id)).toEqual(expect.arrayContaining([gone.id, live.id]));
    for (const entry of open) {
      expect(entry).not.toHaveProperty('deletedAt');
      expect(entry).not.toHaveProperty('version');
    }
    expect(idsOf(await administrator.panel.get(`${BASE}?view=deleted`))).toEqual([]);
  });

  it('EVM-060 AC4 the page follows by a cursor, and the cursor belongs to the view: used with another view it is 400 invalid_cursor', async () => {
    const administrator = await harness.administrator();
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await harness.order([planned]);
      ids.push(created.id);
      expect((await del(administrator, created.id)).status).toBe(204);
    }
    const first = await administrator.panel.get(`${BASE}?view=deleted&limit=2`);
    expect(page(first).items).toHaveLength(2);
    const cursor = page(first).nextCursor ?? '';
    const second = await administrator.panel.get(`${BASE}?view=deleted&limit=2&cursor=${cursor}`);
    expect([...idsOf(first), ...idsOf(second)].sort()).toEqual([...ids].sort());
    expect(page(second).nextCursor).toBeNull();
    const other = await administrator.panel.get(`${BASE}?view=all_open&limit=2&cursor=${cursor}`);
    expect([other.status, codeOf(other.body)]).toEqual([400, 'invalid_cursor']);
  });

  it('EVM-060 AC4 the filters still combine with the view by AND (a status, a customer)', async () => {
    const administrator = await harness.administrator();
    const first = await harness.order([planned], { status: 'in_progress' });
    const second = await harness.order([planned], { status: 'on_hold' });
    for (const created of [first, second]) expect((await del(administrator, created.id)).status).toBe(204);
    expect(idsOf(await administrator.panel.get(`${BASE}?view=deleted&status=on_hold`))).toEqual([second.id]);
    expect(idsOf(await administrator.panel.get(`${BASE}?view=deleted&customerId=${first.customerId}`))).toEqual([first.id]);
  });

  it('EVM-060 AC4 the Editor and Read-only are 403 forbidden and the meter of mass reading is never asked; an anonymous caller is 401 and a mobile token 403', async () => {
    const administrator = await harness.administrator();
    const gone = await harness.order([planned]);
    expect((await del(administrator, gone.id)).status).toBe(204);
    const control = app().app.get<BulkReadControl>(BULK_READ_CONTROL, { strict: false });
    const before = vi.spyOn(control, 'before');
    const after = vi.spyOn(control, 'after');
    try {
      for (const role of ['editor', 'read_only'] as const) {
        const browser = await harness.signIn(role);
        const response = await browser.panel.get(`${BASE}?view=deleted`);
        expect([response.status, codeOf(response.body)], role).toEqual([403, 'forbidden']);
        expect(JSON.stringify(response.body)).not.toContain(gone.number);
      }
      expect(before).not.toHaveBeenCalled();
      expect(after).not.toHaveBeenCalled();
      const anonymous = await request(app().app.getHttpServer()).get(`${BASE}?view=deleted`);
      expect([anonymous.status, codeOf(anonymous.body)]).toEqual([401, 'unauthenticated']);
      const phone = await harness.signIn('administrator', { channel: 'mobile', key: 'fresh' });
      expect((await phone.panel.get(`${BASE}?view=deleted`)).status).toBe(403);
      expect(before).not.toHaveBeenCalled();
    } finally {
      before.mockRestore();
      after.mockRestore();
    }
  });

  it('EVM-060 AC4 SR-API-02 for the Administrator the view counts against the limit of mass reading like every list: the meter is asked once and the records returned are counted', async () => {
    const administrator = await harness.administrator();
    const first = await harness.order([planned]);
    const second = await harness.order([planned]);
    for (const created of [first, second]) expect((await del(administrator, created.id)).status).toBe(204);
    const control = app().app.get<BulkReadControl>(BULK_READ_CONTROL, { strict: false });
    const before = vi.spyOn(control, 'before');
    const after = vi.spyOn(control, 'after');
    try {
      expect((await administrator.panel.get(`${BASE}?view=deleted`)).status).toBe(200);
      expect(before).toHaveBeenCalledTimes(1);
      expect(after).toHaveBeenCalledWith(administrator.userId, 2);
    } finally {
      before.mockRestore();
      after.mockRestore();
    }
  });

  it('EVM-060 AC4 the number of statements does not depend on the size of the page: two deleted orders and eight cost the same (no N+1)', async () => {
    const administrator = await harness.administrator();
    const run = async (count: number) => {
      const created: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const order = await harness.order([planned]);
        created.push(order.id);
        expect((await del(administrator, order.id)).status).toBe(204);
      }
      statements.length = 0;
      const response = await administrator.panel.get(`${BASE}?view=deleted&limit=100`);
      expect(page(response).items.length).toBeGreaterThanOrEqual(count);
      return statements.length;
    };
    const small = await run(2);
    const large = await run(6);
    expect(large).toBe(small);
  });

  it('EVM-060 AC4 the customer of a deleted order that was deleted too is "Klient usunięty" — no identifier, no name', async () => {
    const administrator = await harness.administrator();
    const gone = await harness.order([planned]);
    expect((await del(administrator, gone.id)).status).toBe(204);
    await sql`update customers.customers set deleted_at = now() where id = ${gone.customerId}`.execute(admin());
    const [item] = page(await administrator.panel.get(`${BASE}?view=deleted`)).items;
    expect(item?.customer).toEqual({ deleted: true });
  });
});

describe('the parity of the reads: a deleted order is in the mode "deleted" and nowhere else (EVM-060 AC1, AC4; ADR-0017 T1; SR-AUTHZ-02)', () => {
  it('EVM-060 AC1 the list in every other view and sort, the detail and the search never show it — for any role, the Administrator included — and the search does not accept the view', async () => {
    const administrator = await harness.administrator();
    const gone = await harness.order([planned]);
    const live = await harness.order([planned]);
    expect((await del(administrator, gone.id)).status).toBe(204);
    for (const browser of [administrator, await harness.signIn('editor'), await harness.signIn('read_only')]) {
      for (const query of [
        '',
        'view=all_open',
        'view=mine',
        'view=waiting_on_dso_over_14_days',
        'view=overdue_payments',
        'view=unpaid',
        'sort=-number',
        'sort=number',
        'sort=createdAt',
        'sort=urgency',
        `customerId=${gone.customerId}`,
        'status=in_progress',
      ]) {
        const response = await browser.panel.get(`${BASE}?${query}&limit=100`);
        expect(response.status, query).toBe(200);
        expect(idsOf(response), `${browser.userId} ${query}`).not.toContain(gone.id);
      }
      expect((await browser.panel.get(`${BASE}/${gone.id}`)).status).toBe(404);
      for (const body of [{ query: TITLE }, { query: gone.number }, { query: TITLE, customerId: gone.customerId }]) {
        const found = await browser.panel.post(`${BASE}/search`, body);
        expect(found.status).toBe(200);
        expect(idsOf(found)).not.toContain(gone.id);
      }
      const view = await browser.panel.post(`${BASE}/search`, { query: TITLE, view: 'deleted' });
      expect([view.status, codeOf(view.body)]).toEqual([400, 'validation_failed']);
      expect(idsOf(await browser.panel.get(`${BASE}?limit=100`))).toContain(live.id);
    }
  });

  it('EVM-060 AC1 the history of its customer (the list filtered by the customer) does not show it', async () => {
    const administrator = await harness.administrator();
    const gone = await harness.order([planned]);
    expect((await del(administrator, gone.id)).status).toBe(204);
    const editor = await harness.signIn('editor');
    const history = await editor.panel.get(`${BASE}?customerId=${gone.customerId}`);
    expect(idsOf(history)).toEqual([]);
  });

  it('EVM-060 AC4 the facade of the titles has the mode "deleted" for the Administrator only: for the Editor and Read-only it returns nothing, and the mode "visible" never returns a deleted order', async () => {
    const administrator = await harness.administrator();
    const gone = await harness.order([planned]);
    const live = await harness.order([planned]);
    expect((await del(administrator, gone.id)).status).toBe(204);
    const directory = app().app.get<WorkOrderDirectory>(WORK_ORDER_DIRECTORY, { strict: false });
    const db = admin();
    const ids = [gone.id, live.id];
    for (const role of ROLES_UNDER_TEST) {
      const caller = principal({ role });
      const deleted = await directory.deletedRefsOf(db, caller, ids);
      expect([...deleted.keys()], role).toEqual(role === 'administrator' ? [gone.id] : []);
      expect([...(await directory.titlesOf(db, caller, ids)).keys()], role).toEqual([live.id]);
      expect([...(await directory.refsOf(db, caller, ids)).keys()], role).toEqual([live.id]);
      expect(await directory.findVisible(db, caller, gone.id), role).toBeUndefined();
      expect(await directory.searchIds(db, caller, gone.number, 10), role).toEqual([]);
    }
    expect(await directory.deletedRefsOf(db, principal({ role: 'administrator' }), [])).toEqual(new Map());
  });
});

describe('the lists of payments and the order deleted and restored (EVM-060 AC5; SR-AUTHZ-10; AB-17; ADR-0017 T1)', () => {
  const paymentViews = ['/api/v1/payment-milestones', '/api/v1/payment-milestones?view=overdue', '/api/v1/payment-milestones?view=planned'];

  it('EVM-060 AC5 the views of payments ("Do wystawienia", the unpaid ones, the summaries) do not show the deleted order, and after the restoration it is back with the same statuses and amounts', async () => {
    const administrator = await harness.administrator();
    const editor = await harness.signIn('editor');
    const created = await harness.order([paid, { status: 'planned', amountMinor: 77_000, name: 'Transza-znacznik-do-wystawienia' }]);
    const readAll = async () => {
      const bodies: string[] = [];
      for (const path of paymentViews) bodies.push(JSON.stringify((await editor.panel.get(path)).body));
      bodies.push(JSON.stringify((await editor.panel.get(`${BASE}/${created.id}/payment-milestones`)).body));
      bodies.push(JSON.stringify(page(await editor.panel.get(`${BASE}?limit=100`)).items.find((item) => item.id === created.id)));
      return bodies;
    };
    const before = await readAll();
    expect(before.join()).toContain('Transza-znacznik-do-wystawienia');
    expect((await del(administrator, created.id)).status).toBe(204);
    for (const body of (await readAll()).slice(0, 3)) {
      expect(body).not.toContain('Transza-znacznik-do-wystawienia');
      expect(body).not.toContain(created.number);
    }
    const gone = await editor.panel.get(`${BASE}/${created.id}/payment-milestones`);
    expect(gone.status).toBe(404);
    expect((await administrator.panel.post(`${BASE}/${created.id}/restore`, undefined, { 'If-Match': '"2"' })).status).toBe(200);
    expect(await readAll()).toEqual(before);
  });

  it('EVM-060 AC5 a request with the key of the deletion on an unknown order is the same 404 as a request without one', async () => {
    const administrator = await harness.administrator();
    const withKey = await administrator.panel.delete(`${BASE}/${uuidv7()}`, { 'If-Match': '"1"', 'Idempotency-Key': uuidv7() });
    const without = await administrator.panel.delete(`${BASE}/${uuidv7()}`, { 'If-Match': '"1"' });
    expect([withKey.status, without.status]).toEqual([404, 404]);
  });
});
