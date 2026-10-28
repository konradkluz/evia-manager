import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import {
  auditOf,
  auditText,
  canaryCustomer,
  CANARY,
  CANARY_VALUES,
  codeOf,
  CUSTOMERS,
  NOW,
  orderOf,
  rowOf,
  signInTo,
  startErasureApp,
  tag,
  type Browser,
  type ErasureApp,
} from '../support/customer-erasure.ts';
import { clearCustomers, insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones } from '../support/payment-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation } from '../support/work-order-fixtures.ts';

let app: ErasureApp;
beforeAll(async () => {
  app = await startErasureApp();
});
afterAll(async () => {
  await app.current.close();
});
beforeEach(async () => {
  app.current.clock.set(NOW);
  app.register().recover();
  app.register().calls.length = 0;
  app.register().objects.length = 0;
  app.register().onRecord = undefined;
  await clearWorkOrderCreation(app.current.database.admin);
  await clearCustomers(app.current.database.admin);
});
afterEach(() => {
  app.register().recover();
});

const admin = () => app.current.database.admin;
const signIn = (role: Role, options: { fresh?: boolean; channel?: 'web' | 'mobile' } = {}) => signInTo(app.current, role, options);
const url = (id: string, suffix = '') => `${CUSTOMERS}/${id}${suffix}`;
const remove = (browser: Browser, id: string, version: number, key?: string) =>
  browser.panel.delete(url(id), { 'If-Match': tag(version), ...(key === undefined ? {} : { 'Idempotency-Key': key }) });
const restore = (browser: Browser, id: string, version: number, key?: string) =>
  browser.panel.post(url(id, '/restore'), undefined, {
    'If-Match': tag(version),
    ...(key === undefined ? {} : { 'Idempotency-Key': key }),
  });
const anonymize = (browser: Browser, id: string, version: number) =>
  browser.panel.post(url(id, '/anonymize'), undefined, { 'If-Match': tag(version) });
const search = (browser: Browser, body: unknown) => browser.panel.post(`${CUSTOMERS}/search`, body);
interface Page {
  items: Array<{ id: string; displayName: string }>;
  nextCursor: string | null;
}
const listOf = async (browser: Browser, query = ''): Promise<Page> => (await browser.panel.get(`${CUSTOMERS}${query}`)).body as Page;
const idsOf = (page: Page): string[] => page.items.map((item) => item.id);
const invoiced = (invoiceNumber: string) => ({ status: 'invoiced' as const, dueDate: '2026-10-10', amountMinor: 10_000, invoiceNumber });

describe('EVM-041 AC1 - the Administrator deletes a customer without open orders (SR-AUTHZ-02, TM-18)', () => {
  it('EVM-041 AC1 a customer whose orders are all settled or cancelled is deleted: 204, version + 1, the Editor and Read-only get 404 and do not see it on the list nor in the search, the audit has the event', async () => {
    const id = await canaryCustomer(app.current);
    await orderOf(app.current, id, 'settled');
    await orderOf(app.current, id, 'cancelled');
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const readOnly = await signIn('read_only');
    expect(idsOf(await listOf(editor))).toContain(id);

    const response = await remove(administrator, id, 1);
    expect(response.status).toBe(204);
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(await rowOf(app.current, id)).toMatchObject({ version: 2, deleted_at: new Date(NOW), deleted_by: administrator.userId });

    for (const viewer of [editor, readOnly]) {
      const read = await viewer.panel.get(url(id));
      expect([read.status, codeOf(read.body)]).toEqual([404, 'not_found']);
      expect(idsOf(await listOf(viewer))).not.toContain(id);
      expect(((await search(viewer, { query: CANARY.lastName })).body as Page).items).toEqual([]);
    }
    // the Administrator: not in the live list either; the detail shows it with deletedAt (the view of W-14)
    expect(idsOf(await listOf(administrator))).not.toContain(id);
    const detail = await administrator.panel.get(url(id));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id, deletedAt: NOW, anonymizedAt: null, version: 2 });
    expect(detail.headers['etag']).toBe('"2"');
    expect(await auditOf(app.current, id)).toEqual([
      { action: 'customer.deleted', outcome: 'success', actor_user_id: administrator.userId },
    ]);
  });

  it('EVM-041 AC1 the data of the customer embedded in the orders (W-06 header and card, W-10 column and search, W-11) are gone for the Editor, Read-only AND the Administrator: "Klient usunięty", no id, no name, no link', async () => {
    const id = await canaryCustomer(app.current);
    const orderId = await orderOf(app.current, id, 'settled', { title: 'Montaż wallboxa' });
    await insertMilestones(admin(), orderId, [invoiced('FV/2026/1')]);
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    const readOnly = await signIn('read_only');
    const before = await editor.panel.get(`/api/v1/work-orders/${orderId}`);
    expect(before.body).toMatchObject({ customer: { id, displayName: `${CANARY.firstName} ${CANARY.lastName}` } });

    expect((await remove(administrator, id, 1)).status).toBe(204);

    for (const viewer of [editor, readOnly, administrator]) {
      const header = await viewer.panel.get(`/api/v1/work-orders/${orderId}`);
      expect(header.status).toBe(200);
      expect((header.body as { customer: unknown }).customer).toBeNull();
      const card = await viewer.panel.get(`/api/v1/work-orders/${orderId}/customer`);
      expect([card.status, codeOf(card.body)]).toEqual([404, 'not_found']);
      const list = await viewer.panel.get('/api/v1/work-orders');
      expect((list.body as { items: Array<{ customer: unknown }> }).items.map((item) => item.customer)).toEqual([{ deleted: true }]);
      const unpaid = await viewer.panel.get('/api/v1/payment-milestones');
      expect((unpaid.body as { items: Array<{ customer: unknown }> }).items.map((item) => item.customer)).toEqual([{ deleted: true }]);
      // the search of the orders by the data of the customer finds nothing
      for (const query of [CANARY.lastName, CANARY.firstName, CANARY.phoneDigits, CANARY.email, CANARY.city]) {
        const found = await viewer.panel.post('/api/v1/work-orders/search', { query });
        expect(found.status, query).toBe(200);
        expect((found.body as { items: unknown[] }).items, query).toEqual([]);
      }
      const everything = JSON.stringify([header.body, card.body, list.body, unpaid.body]);
      for (const hidden of [id, ...CANARY_VALUES]) expect(everything, hidden).not.toContain(hidden);
    }
  });

  it('EVM-041 AC1 the Editor and Read-only get 404 for the edit of a deleted customer too, and the Administrator as well (the edit does not read deleted customers)', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator');
    await remove(administrator, id, 1);
    for (const role of ['editor', 'administrator'] as const) {
      const browser = await signIn(role);
      const patch = await browser.panel.patch(url(id), { notes: 'x' }, { 'If-Match': tag(2) });
      expect([patch.status, codeOf(patch.body)], role).toEqual([404, 'not_found']);
    }
  });

  it('EVM-041 AC1 a customer that is deleted already is 404 (like a missing one) unless the request repeats a deletion with its key', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator');
    expect((await remove(administrator, id, 1)).status).toBe(204);
    expect((await remove(administrator, id, 1)).status).toBe(404);
    expect((await remove(administrator, uuidv7(), 1)).status).toBe(404);
    expect(await auditOf(app.current, id)).toHaveLength(1);
  });
});

describe('EVM-041 AC2 - a customer with open orders (SR-AUTHZ-10, SR-ERR-01)', () => {
  it('EVM-041 AC2 an order in progress: the deletion AND the anonymization are 409 has_active_dependents with the NUMBER of open orders only; the data, the version and the register are untouched', async () => {
    const id = await canaryCustomer(app.current);
    await orderOf(app.current, id, 'in_progress', { title: 'TYTUL-ZLECENIA-NIE-W-ODPOWIEDZI' });
    await orderOf(app.current, id, 'new');
    await orderOf(app.current, id, 'settled');
    await orderOf(app.current, id, 'in_progress', { deleted: true });
    const administrator = await signIn('administrator', { fresh: true });
    const before = await rowOf(app.current, id);

    for (const response of [await remove(administrator, id, 1, uuidv7()), await anonymize(administrator, id, 1)]) {
      expect([response.status, codeOf(response.body)]).toEqual([409, 'has_active_dependents']);
      expect((response.body as { openWorkOrders: number }).openWorkOrders).toBe(2);
      const text = JSON.stringify(response.body);
      expect(text).not.toMatch(/ZL-8|TYTUL-ZLECENIA/);
      for (const hidden of CANARY_VALUES) expect(text).not.toContain(hidden);
    }
    expect(await rowOf(app.current, id)).toEqual(before);
    expect(app.register().calls).toHaveLength(0);
    expect(await auditOf(app.current, id)).toEqual([]);
    // the refusal rolled the idempotency record back: the key is free (the same key, now with no open order, works)
    const records = await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin());
    expect(records.rows[0]?.n).toBe('0');
  });

  it.each(['new', 'quoting', 'accepted', 'in_progress', 'completed', 'on_hold'] as const)(
    'EVM-041 AC2 an order that is %s blocks the deletion; the closed ones (settled, cancelled) and a deleted order do not',
    async (status) => {
      const id = await canaryCustomer(app.current);
      await orderOf(app.current, id, status);
      const administrator = await signIn('administrator');
      const blocked = await remove(administrator, id, 1);
      expect([blocked.status, (blocked.body as { openWorkOrders?: number }).openWorkOrders]).toEqual([409, 1]);
      const free = await canaryCustomer(app.current);
      await orderOf(app.current, free, 'settled');
      await orderOf(app.current, free, 'cancelled');
      await orderOf(app.current, free, status, { deleted: true });
      expect((await remove(administrator, free, 1)).status).toBe(204);
    },
  );

  it('EVM-041 AC2 the Editor and Read-only never learn the number: they get 403 forbidden before anything is counted', async () => {
    const id = await canaryCustomer(app.current);
    await orderOf(app.current, id, 'in_progress');
    for (const role of ['editor', 'read_only'] as const) {
      const browser = await signIn(role, { fresh: true });
      const response = await remove(browser, id, 1);
      expect([response.status, codeOf(response.body)]).toEqual([403, 'forbidden']);
      expect(response.body).not.toHaveProperty('openWorkOrders');
    }
  });
});

describe('EVM-041 AC3 - the restoration and the view "Usunięci" (SR-AUTHZ-05, SR-API-06)', () => {
  it('EVM-041 AC3 the Administrator restores a deleted customer: visible to every role again, version + 1, ETag, the audit has the event; a customer that is not deleted is 404', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    await remove(administrator, id, 1);
    expect((await editor.panel.get(url(id))).status).toBe(404);

    const restored = await restore(administrator, id, 2);
    expect(restored.status).toBe(200);
    expect(restored.headers['etag']).toBe('"3"');
    expect(restored.body).toMatchObject({ id, deletedAt: null, anonymizedAt: null, version: 3, lastName: CANARY.lastName });
    for (const viewer of [editor, await signIn('read_only')]) {
      expect((await viewer.panel.get(url(id))).status).toBe(200);
      expect(idsOf(await listOf(viewer))).toContain(id);
    }
    expect(await rowOf(app.current, id)).toMatchObject({ version: 3, deleted_at: null, deleted_by: null });
    expect((await auditOf(app.current, id)).map((row) => `${row.action}:${row.outcome}`)).toEqual([
      'customer.deleted:success',
      'customer.restored:success',
    ]);
    const again = await restore(administrator, id, 3);
    expect([again.status, codeOf(again.body)]).toEqual([404, 'not_found']);
    expect(codeOf((await restore(administrator, uuidv7(), 1)).body)).toBe('not_found');
  });

  it('EVM-041 AC3 the view "Usunięci": the Administrator lists and searches ONLY the deleted customers (list and search), the default view only the live ones, even for the Administrator', async () => {
    const live = await canaryCustomer(app.current, { lastName: 'Zywy' });
    const gone = await canaryCustomer(app.current, { lastName: 'Usuniety' });
    const administrator = await signIn('administrator');
    await remove(administrator, gone, 1);

    expect(idsOf(await listOf(administrator, '?deleted=true'))).toEqual([gone]);
    expect(idsOf(await listOf(administrator, '?deleted=false'))).toEqual([live]);
    expect(idsOf(await listOf(administrator))).toEqual([live]);
    expect(idsOf((await search(administrator, { query: 'Kanarkowski' })).body as Page)).toEqual([]);
    expect(idsOf((await search(administrator, { query: 'Usuniety', deleted: true })).body as Page)).toEqual([gone]);
    expect(((await search(administrator, { query: 'Zywy', deleted: true })).body as Page).items).toEqual([]);
    expect(idsOf((await search(administrator, { query: 'Zywy', deleted: false })).body as Page)).toEqual([live]);
  });

  it('EVM-041 AC3 the view "Usunięci" pages with a cursor bound to the filter: another view, another user and another role cannot open it', async () => {
    const goneIds = [await canaryCustomer(app.current, { lastName: 'Aa' }), await canaryCustomer(app.current, { lastName: 'Bb' })];
    const administrator = await signIn('administrator');
    for (const id of goneIds) await remove(administrator, id, 1);
    const first = (await administrator.panel.get(`${CUSTOMERS}?deleted=true&limit=1`)).body as Page;
    expect(first.items).toHaveLength(1);
    const cursor = first.nextCursor ?? '';
    expect(cursor).not.toBe('');
    const second = (await administrator.panel.get(`${CUSTOMERS}?deleted=true&limit=1&cursor=${cursor}`)).body as Page;
    expect([...idsOf(first), ...idsOf(second)].sort()).toEqual([...goneIds].sort());
    expect(second.nextCursor).toBeNull();

    // the cursor of the deleted view does not open on the live view (400), for the Administrator who got it...
    const wrongView = await administrator.panel.get(`${CUSTOMERS}?limit=1&cursor=${cursor}`);
    expect([wrongView.status, codeOf(wrongView.body)]).toEqual([400, 'invalid_cursor']);
    // ...and the Editor and Read-only get 403 with the filter (before the cursor is opened) and 400 without it - never a deleted customer
    for (const role of ['editor', 'read_only'] as const) {
      const viewer = await signIn(role);
      const withFilter = await viewer.panel.get(`${CUSTOMERS}?deleted=true&cursor=${cursor}`);
      expect([withFilter.status, codeOf(withFilter.body)], role).toEqual([403, 'forbidden']);
      const withoutFilter = await viewer.panel.get(`${CUSTOMERS}?cursor=${cursor}`);
      expect([withoutFilter.status, codeOf(withoutFilter.body)], role).toEqual([400, 'invalid_cursor']);
      expect(JSON.stringify([withFilter.body, withoutFilter.body])).not.toContain('Aa');
    }
    // another Administrator cannot use the cursor of the first one
    const other = await signIn('administrator');
    expect(codeOf((await other.panel.get(`${CUSTOMERS}?deleted=true&cursor=${cursor}`)).body)).toBe('invalid_cursor');
  });

  it('EVM-041 AC3 AC7 the filter "deleted" is the Administrator\'s: the Editor and Read-only get 403 forbidden on the list AND on the search (never a silent skip), whatever the rest of the request', async () => {
    const gone = await canaryCustomer(app.current, { lastName: 'Usuniety' });
    await remove(await signIn('administrator'), gone, 1);
    for (const role of ['editor', 'read_only'] as const) {
      const viewer = await signIn(role);
      for (const query of ['?deleted=true', '?deleted=true&limit=5']) {
        const listed = await viewer.panel.get(`${CUSTOMERS}${query}`);
        expect([listed.status, codeOf(listed.body)], `${role} ${query}`).toEqual([403, 'forbidden']);
      }
      const searched = await search(viewer, { query: 'Usuniety', deleted: true });
      expect([searched.status, codeOf(searched.body)], role).toEqual([403, 'forbidden']);
      // the live view of the same request is allowed and never shows the deleted customer
      expect(((await search(viewer, { query: 'Usuniety', deleted: false })).body as Page).items).toEqual([]);
      expect(((await search(viewer, { query: 'Usuniety' })).body as Page).items).toEqual([]);
    }
  });

  it('EVM-041 AC3 a repeat of a deletion or a restoration with the same key (a lost answer) is the same answer with Idempotent-Replayed, without a second change or a second audit event, even with a stale If-Match', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator');
    const deleteKey = uuidv7();
    expect((await remove(administrator, id, 1, deleteKey)).status).toBe(204);
    const replayedDeletion = await remove(administrator, id, 1, deleteKey);
    expect(replayedDeletion.status).toBe(204);
    expect(replayedDeletion.headers['idempotent-replayed']).toBe('true');
    expect((await rowOf(app.current, id))?.version).toBe(2);

    const restoreKey = uuidv7();
    expect((await restore(administrator, id, 2, restoreKey)).status).toBe(200);
    const replayedRestoration = await restore(administrator, id, 2, restoreKey);
    expect([replayedRestoration.status, replayedRestoration.headers['idempotent-replayed']]).toEqual([200, 'true']);
    expect(replayedRestoration.body).toMatchObject({ id, version: 3, deletedAt: null });
    expect((await rowOf(app.current, id))?.version).toBe(3);
    expect((await auditOf(app.current, id)).map((row) => row.action)).toEqual(['customer.deleted', 'customer.restored']);
  });

  it('EVM-041 AC3 the key is bound to the customer and to the operation: the same key on another customer or on the restoration is 422 idempotency_mismatch and changes nothing', async () => {
    const one = await canaryCustomer(app.current);
    const two = await canaryCustomer(app.current, { lastName: 'Drugi' });
    const administrator = await signIn('administrator');
    const key = uuidv7();
    expect((await remove(administrator, one, 1, key)).status).toBe(204);
    const onOther = await remove(administrator, two, 1, key);
    expect([onOther.status, codeOf(onOther.body)]).toEqual([422, 'idempotency_mismatch']);
    const onRestoration = await restore(administrator, two, 1, key);
    expect([onRestoration.status, codeOf(onRestoration.body)]).toEqual([422, 'idempotency_mismatch']);
    expect(await rowOf(app.current, two)).toMatchObject({ version: 1, deleted_at: null });
  });
});

describe('EVM-041 AC7 AC8 - who may, and what the preconditions say (SR-AUTHZ-02, SR-AUTHZ-05, SR-API-06)', () => {
  const operations = (browser: Browser, id: string, version = 1) => [
    remove(browser, id, version),
    restore(browser, id, version),
    anonymize(browser, id, version),
  ];

  it('EVM-041 AC7 the Editor and Read-only get 403 forbidden on the three operations - for a live, a deleted and a missing customer alike - before If-Match and before any lookup; nothing changes', async () => {
    const live = await canaryCustomer(app.current);
    const gone = await canaryCustomer(app.current, { lastName: 'Usuniety', deletedAt: NOW });
    for (const role of ['editor', 'read_only'] as const) {
      const browser = await signIn(role, { fresh: true });
      for (const id of [live, gone, uuidv7()]) {
        const answers = await Promise.all(operations(browser, id));
        expect(answers.map((answer) => [answer.status, codeOf(answer.body)])).toEqual([
          [403, 'forbidden'],
          [403, 'forbidden'],
          [403, 'forbidden'],
        ]);
      }
      // no If-Match at all: the role is still decided first
      expect(codeOf((await browser.panel.post(url(live, '/anonymize'))).body)).toBe('forbidden');
    }
    expect(await rowOf(app.current, live)).toMatchObject({ version: 1, deleted_at: null, anonymized_at: null });
    expect(await rowOf(app.current, gone)).toMatchObject({ version: 1 });
    expect(app.register().calls).toHaveLength(0);
  });

  it('EVM-041 AC7 an anonymous caller is 401 and a mobile token 403 on the three operations; a request without the CSRF token is 403 csrf_failed', async () => {
    const id = await canaryCustomer(app.current);
    const anonymous = new PanelClient(app.current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await Promise.all(operations({ userId: '', panel: anonymous }, id))).map((answer) => answer.status)).toEqual([401, 401, 401]);
    const mobile = await signIn('administrator', { fresh: true, channel: 'mobile' });
    expect((await Promise.all(operations(mobile, id))).map((answer) => answer.status)).toEqual([403, 403, 403]);

    const administrator = await signIn('administrator', { fresh: true });
    administrator.panel.csrfToken = undefined;
    for (const answer of await Promise.all(operations(administrator, id))) {
      expect([answer.status, codeOf(answer.body)]).toEqual([403, 'csrf_failed']);
    }
    expect(await rowOf(app.current, id)).toMatchObject({ version: 1, deleted_at: null, anonymized_at: null });
  });

  it('EVM-041 AC7 a missing customer is 404 on the three operations for the Administrator (the same answer as a deleted one for the live-only operations)', async () => {
    const administrator = await signIn('administrator', { fresh: true });
    const answers = await Promise.all(operations(administrator, uuidv7()));
    expect(answers.map((answer) => [answer.status, codeOf(answer.body)])).toEqual([
      [404, 'not_found'],
      [404, 'not_found'],
      [404, 'not_found'],
    ]);
    expect((await administrator.panel.get(url('not-a-uuid'))).status).toBe(400);
  });

  it('EVM-041 AC8 If-Match: missing is 428, a weak, wildcard, list or malformed one is 400, an old version is 412 without any current value - on the three operations', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator', { fresh: true });
    const gone = await canaryCustomer(app.current, { lastName: 'Usuniety', deletedAt: NOW });

    const missing = [
      administrator.panel.delete(url(id)),
      administrator.panel.post(url(gone, '/restore')),
      administrator.panel.post(url(id, '/anonymize')),
    ];
    expect((await Promise.all(missing)).map((answer) => [answer.status, codeOf(answer.body)])).toEqual([
      [428, 'precondition_required'],
      [428, 'precondition_required'],
      [428, 'precondition_required'],
    ]);
    for (const bad of ['*', 'W/"1"', '"1", "2"', '1', '""', '"0"']) {
      const answers = await Promise.all([
        administrator.panel.delete(url(id), { 'If-Match': bad }),
        administrator.panel.post(url(gone, '/restore'), undefined, { 'If-Match': bad }),
        administrator.panel.post(url(id, '/anonymize'), undefined, { 'If-Match': bad }),
      ]);
      expect(
        answers.map((answer) => answer.status),
        bad,
      ).toEqual([400, 400, 400]);
    }
    const stale = await Promise.all([remove(administrator, id, 5), restore(administrator, gone, 5), anonymize(administrator, id, 5)]);
    expect(stale.map((answer) => [answer.status, codeOf(answer.body)])).toEqual([
      [412, 'version_conflict'],
      [412, 'version_conflict'],
      [412, 'version_conflict'],
    ]);
    expect(JSON.stringify(stale.map((answer): unknown => answer.body))).not.toMatch(/"?version"?\s*:\s*\d/);
    expect(await rowOf(app.current, id)).toMatchObject({ version: 1, deleted_at: null, anonymized_at: null });
    expect(app.register().calls).toHaveLength(0);
  });

  it('EVM-041 AC7 the read policy of the module: the Administrator reads a deleted customer (GET), the Editor and Read-only get 404; the facade of the other modules stays blind to it for everybody', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator');
    await remove(administrator, id, 1);
    expect((await administrator.panel.get(url(id))).status).toBe(200);
    for (const role of ['editor', 'read_only'] as const) expect((await (await signIn(role)).panel.get(url(id))).status, role).toBe(404);
  });
});

describe('EVM-041 AC4 - the anonymization (SR-DATA-08, SR-SESS-08, ASVS V14.2.7)', () => {
  it('EVM-041 AC4 a person: every personal field is neutral, the telephone is the constant, the search text is recomputed - the old name, telephone, e-mail, city and note are found NOWHERE (customers, orders)', async () => {
    const id = await canaryCustomer(app.current);
    const orderId = await orderOf(app.current, id, 'settled', { title: 'Montaż po zakończeniu' });
    const administrator = await signIn('administrator', { fresh: true });
    const editor = await signIn('editor');
    expect(((await search(editor, { query: CANARY.lastName })).body as Page).items).toHaveLength(1);

    const response = await anonymize(administrator, id, 1);
    expect(response.status).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.body).toEqual({
      id,
      kind: 'person',
      firstName: 'Klient',
      lastName: 'zanonimizowany',
      phone: '+48000000000',
      displayName: 'Klient zanonimizowany',
      version: 2,
      createdAt: expect.any(String) as string,
      updatedAt: NOW,
      deletedAt: null,
      anonymizedAt: NOW,
    });
    expect(await rowOf(app.current, id)).toMatchObject({
      version: 2,
      first_name: 'Klient',
      last_name: 'zanonimizowany',
      company_name: null,
      tax_id: null,
      phone: '+48000000000',
      email: null,
      city: null,
      notes: null,
      display_name: 'Klient zanonimizowany',
      anonymized_at: new Date(NOW),
      anonymized_by: administrator.userId,
    });
    const text = (await rowOf(app.current, id))?.search_text ?? '';
    for (const old of [CANARY.firstName, CANARY.lastName, CANARY.phoneDigits, CANARY.email, CANARY.city, CANARY.notes]) {
      expect(text.toLowerCase(), old).not.toContain(old.toLowerCase());
    }

    for (const viewer of [administrator, editor]) {
      for (const query of [CANARY.lastName, CANARY.firstName, CANARY.phoneDigits, CANARY.phone, CANARY.email, CANARY.city, 'Kanarkowski']) {
        expect(((await search(viewer, { query })).body as Page).items, query).toEqual([]);
        const orders = await viewer.panel.post('/api/v1/work-orders/search', { query });
        expect((orders.body as { items: unknown[] }).items, query).toEqual([]);
      }
      expect(((await search(viewer, { query: 'zanonimizowany' })).body as Page).items.map((item) => item.id)).toEqual([id]);
    }
    // the orders of the customer show "Klient zanonimizowany": the header, the list and the card with the mark
    const header = await editor.panel.get(`/api/v1/work-orders/${orderId}`);
    expect((header.body as { customer: unknown }).customer).toEqual({ id, displayName: 'Klient zanonimizowany' });
    const list = await editor.panel.get('/api/v1/work-orders');
    expect((list.body as { items: Array<{ customer: unknown }> }).items[0]?.customer).toEqual({ id, displayName: 'Klient zanonimizowany' });
    const card = await editor.panel.get(`/api/v1/work-orders/${orderId}/customer`);
    expect(card.body).toEqual({ displayName: 'Klient zanonimizowany', phone: '+48000000000', email: null, anonymized: true });
    // a customer that is not anonymized has the mark false
    const other = await canaryCustomer(app.current, { lastName: 'Zwykly' });
    const otherOrder = await orderOf(app.current, other, 'new');
    expect(((await editor.panel.get(`/api/v1/work-orders/${otherOrder}/customer`)).body as { anonymized: boolean }).anonymized).toBe(false);
  });

  it('EVM-041 AC4 a company: the company name, the tax id, the contact person and the address are neutral; the old company and NIP are not found', async () => {
    const id = await insertCustomer(admin(), {
      kind: 'company',
      companyName: CANARY.company,
      taxId: CANARY.taxId,
      phone: CANARY.phone,
      email: CANARY.email,
      city: CANARY.city,
      notes: CANARY.notes,
    });
    const administrator = await signIn('administrator', { fresh: true });
    expect(((await search(administrator, { query: CANARY.taxId })).body as Page).items).toHaveLength(1);
    const response = await anonymize(administrator, id, 1);
    expect(response.body).toEqual({
      id,
      kind: 'company',
      companyName: 'Klient zanonimizowany',
      phone: '+48000000000',
      displayName: 'Klient zanonimizowany',
      version: 2,
      createdAt: expect.any(String) as string,
      updatedAt: NOW,
      deletedAt: null,
      anonymizedAt: NOW,
    });
    for (const query of [CANARY.taxId, 'Kanarkowa', CANARY.email, CANARY.city]) {
      expect(((await search(administrator, { query })).body as Page).items, query).toEqual([]);
    }
  });

  it('EVM-041 AC4 an anonymized customer is final: the edit is 409 customer_anonymized, a second anonymization 409 already_anonymized (even with the version of before) - one object in the register, no change', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator', { fresh: true });
    expect((await anonymize(administrator, id, 1)).status).toBe(200);

    const patch = await administrator.panel.patch(url(id), { firstName: CANARY.firstName }, { 'If-Match': tag(2) });
    expect([patch.status, codeOf(patch.body)]).toEqual([409, 'customer_anonymized']);
    const editor = await signIn('editor');
    const patchByEditor = await editor.panel.patch(url(id), { phone: CANARY.phone }, { 'If-Match': tag(2) });
    expect([patchByEditor.status, codeOf(patchByEditor.body)]).toEqual([409, 'customer_anonymized']);
    const staleEdit = await editor.panel.patch(url(id), { phone: CANARY.phone }, { 'If-Match': tag(1) });
    expect(codeOf(staleEdit.body)).toBe('customer_anonymized');

    for (const version of [2, 1]) {
      const again = await anonymize(administrator, id, version);
      expect([again.status, codeOf(again.body)], String(version)).toEqual([409, 'already_anonymized']);
    }
    expect(app.register().objects).toHaveLength(1);
    expect(await rowOf(app.current, id)).toMatchObject({ version: 2, first_name: 'Klient', phone: '+48000000000' });
    expect(JSON.stringify(await rowOf(app.current, id))).not.toContain(CANARY.lastName);
  });

  it('EVM-041 AC4 a deleted customer can be anonymized (its data are still in the database); an anonymized one can be deleted and restored and stays anonymized', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator', { fresh: true });
    await remove(administrator, id, 1);
    const response = await anonymize(administrator, id, 2);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ deletedAt: NOW, anonymizedAt: NOW, displayName: 'Klient zanonimizowany', version: 3 });
    const restored = await restore(administrator, id, 3);
    expect(restored.body).toMatchObject({ deletedAt: null, anonymizedAt: NOW, version: 4 });
    expect((await remove(administrator, id, 4)).status).toBe(204);
    expect((await restore(administrator, id, 5)).body).toMatchObject({ deletedAt: null, anonymizedAt: NOW, version: 6 });
    expect(app.register().objects).toHaveLength(1);
  });

  it('EVM-041 AC7 SR-SESS-08 without a passkey authentication in the last 15 minutes the anonymization is 403 step_up_required BEFORE anything is read, counted or written: no register call, nothing changes; for the Editor it is forbidden', async () => {
    const id = await canaryCustomer(app.current);
    await orderOf(app.current, id, 'in_progress');
    const stale = await signIn('administrator');
    const response = await anonymize(stale, id, 1);
    expect([response.status, codeOf(response.body)]).toEqual([403, 'step_up_required']);
    // the open order is not even counted: the answer is not the 409
    expect(response.body).not.toHaveProperty('openWorkOrders');
    const missing = await anonymize(stale, uuidv7(), 1);
    expect(codeOf(missing.body)).toBe('step_up_required');
    const fresh = await signIn('administrator', { fresh: true });
    app.current.clock.advance(16 * 60_000);
    expect(codeOf((await anonymize(fresh, id, 1)).body)).toBe('step_up_required');
    expect(app.register().calls).toHaveLength(0);
    expect(await rowOf(app.current, id)).toMatchObject({ version: 1, anonymized_at: null });
    const editor = await signIn('editor');
    expect(codeOf((await anonymize(editor, id, 1)).body)).toBe('forbidden');
  });
});

describe('EVM-041 AC5 - the register of deletions before the change (SR-PRIV-04, SR-ERR-01)', () => {
  it('EVM-041 AC5 the object is written BEFORE the change in the database and holds the customer id, the code, the actor and the time - no value of the customer, no order', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator', { fresh: true });
    let seen: { version: number; firstName: string | null } | undefined;
    app.register().onRecord = async () => {
      // the register is asked while the data are still the old ones (the change commits only after it)
      const row = await rowOf(app.current, id);
      seen = row === undefined ? undefined : { version: row.version, firstName: row.first_name };
    };
    const response = await anonymize(administrator, id, 1);
    expect(response.status).toBe(200);
    expect(seen).toEqual({ version: 1, firstName: CANARY.firstName });
    expect(app.register().calls).toEqual([
      {
        operationCode: 'customer_anonymized',
        subjectType: 'customer',
        subjectId: id,
        workOrderId: null,
        actorUserId: administrator.userId,
      },
    ]);
    expect(app.register().objects).toHaveLength(1);
    const object = JSON.parse(app.register().objects[0]?.body ?? '{}') as Record<string, unknown>;
    expect(object).toEqual({
      schemaVersion: 1,
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      operationCode: 'customer_anonymized',
      subjectType: 'customer',
      subjectId: id,
      actorUserId: administrator.userId,
      occurredAt: NOW,
    });
    expect(app.register().objects[0]?.key).toBe(`2026/${String(object['operationId'])}.json`);
    for (const value of CANARY_VALUES) expect(JSON.stringify(app.register().objects), value).not.toContain(value);
  });

  it('EVM-041 AC5 fail closed: a register that refuses is 503 deletion_register_unavailable - the data, the version and the search text are untouched, the audit has the failed event, no object, the service stays healthy', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator', { fresh: true });
    const before = await rowOf(app.current, id);
    app.register().failAll();
    const response = await anonymize(administrator, id, 1);
    expect([response.status, codeOf(response.body)]).toEqual([503, 'deletion_register_unavailable']);
    expect(await rowOf(app.current, id)).toEqual(before);
    expect(app.register().objects).toEqual([]);
    expect(await auditOf(app.current, id)).toEqual([
      { action: 'customer.anonymized', outcome: 'failed', actor_user_id: administrator.userId },
    ]);
    expect((await request(app.current.app.getHttpServer()).get('/api/health')).status).toBe(200);
    // the 503 says nothing about the storage and nothing about the customer
    const text = JSON.stringify(response.body);
    expect(text).not.toMatch(/bucket|endpoint|s3|amazon|scaleway/i);
    for (const value of CANARY_VALUES) expect(text).not.toContain(value);
    // the register is back: the same request now works
    app.register().recover();
    expect((await anonymize(administrator, id, 1)).status).toBe(200);
  });

  it('EVM-041 AC5 fail closed: an installation without the register answers 503 to the anonymization while the service stays healthy and the deletion works', async () => {
    const bare = await createIdentityApp({ now: NOW });
    try {
      const user = await createUser(bare.database.admin, bare.clock, { role: 'administrator' });
      const session = await createSession(bare.database.admin, bare.clock, user, { passkeyAuthenticatedAt: bare.clock.now() });
      const panel = new PanelClient(bare.app.getHttpServer(), PANEL_ORIGIN);
      panel.cookie = session.cookie;
      panel.csrfToken = session.csrfToken;
      const id = await canaryCustomer(bare);
      const response = await panel.post(url(id, '/anonymize'), undefined, { 'If-Match': tag(1) });
      expect([response.status, codeOf(response.body)]).toEqual([503, 'deletion_register_unavailable']);
      expect((await rowOf(bare, id))?.first_name).toBe(CANARY.firstName);
      expect((await panel.delete(url(id), { 'If-Match': tag(1) })).status).toBe(204);
      expect((await request(bare.app.getHttpServer()).get('/api/health')).status).toBe(200);
    } finally {
      await bare.close();
    }
  });

  it('EVM-041 AC5 a request that ends in 404, 409, 412 or 428 never reaches the register (the object is written AFTER every check)', async () => {
    const id = await canaryCustomer(app.current);
    const busy = await canaryCustomer(app.current, { lastName: 'Zajety' });
    await orderOf(app.current, busy, 'in_progress');
    const done = await canaryCustomer(app.current, { lastName: 'Gotowy' });
    const administrator = await signIn('administrator', { fresh: true });
    await anonymize(administrator, done, 1);
    app.register().calls.length = 0;
    app.register().objects.length = 0;
    const answers = [
      await anonymize(administrator, uuidv7(), 1),
      await anonymize(administrator, id, 7),
      await administrator.panel.post(url(id, '/anonymize')),
      await anonymize(administrator, busy, 1),
      await anonymize(administrator, done, 2),
    ];
    expect(answers.map((answer) => answer.status)).toEqual([404, 412, 428, 409, 409]);
    expect(app.register().calls).toHaveLength(0);
    expect(await auditOf(app.current, id)).toEqual([]);
  });

  it('EVM-041 AC5 a failure after the register (the change does not commit) leaves the data as they were; the orphaned object is harmless', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator', { fresh: true });
    // a trigger that refuses the anonymizing UPDATE: the object was written, the change was not
    await sql`create function public.refuse_anonymization() returns trigger language plpgsql set search_path = pg_catalog as $$
      begin if new.anonymized_at is not null then raise exception 'refused for the test' using errcode = 'EV001'; end if; return new; end $$`.execute(
      admin(),
    );
    await sql`create trigger refuse_anonymization before update on customers.customers for each row execute function public.refuse_anonymization()`.execute(
      admin(),
    );
    try {
      const response = await anonymize(administrator, id, 1);
      expect(response.status).toBe(500);
    } finally {
      await sql`drop trigger refuse_anonymization on customers.customers`.execute(admin());
      await sql`drop function public.refuse_anonymization()`.execute(admin());
    }
    expect(app.register().objects).toHaveLength(1);
    expect(await rowOf(app.current, id)).toMatchObject({ version: 1, anonymized_at: null, first_name: CANARY.firstName });
  });
});

describe('EVM-041 AC5 - concurrent operations on one customer (RR-NOC-T2-4)', () => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const until = async (condition: () => boolean) => {
    for (let waited = 0; !condition() && waited < 5000; waited += 10) await sleep(10);
    expect(condition()).toBe(true);
  };

  it('EVM-041 AC5 a deletion that waits for the lock of a slow anonymization longer than the statement timeout is 503 service_unavailable with Retry-After, not 500 - and the anonymization still ends 200', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator', { fresh: true });
    app.register().onRecord = () => sleep(2600);
    const anonymization = anonymize(administrator, id, 1).then((answer) => answer);
    await until(() => app.register().calls.length === 1);
    const deletion = await remove(administrator, id, 1);
    expect([deletion.status, codeOf(deletion.body)]).toEqual([503, 'service_unavailable']);
    expect(deletion.headers['retry-after']).toBe('2');
    for (const value of CANARY_VALUES) expect(JSON.stringify(deletion.body)).not.toContain(value);
    expect((await anonymization).status).toBe(200);
    expect((await rowOf(app.current, id))?.deleted_at).toBeNull();
  });

  it('EVM-041 AC5 two anonymizations of one customer at once: one is 200 with ONE object in the register, the other 409 already_anonymized (the lock made it wait)', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signIn('administrator', { fresh: true });
    const answers = await Promise.all([1, 2].map(() => anonymize(administrator, id, 1).then((answer) => answer)));
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(app.register().objects).toHaveLength(1);
    expect((await rowOf(app.current, id))?.version).toBe(2);
  });
});

describe('EVM-041 AC6 - the audit trail, the logs, the register and the problems carry no value (SR-LOG-03, SR-DATA-08)', () => {
  it('EVM-041 AC6 the three operations and the refusals leave only the customer id, the action, the outcome and the actor: not the name, the telephone, the e-mail, the NIP, the note or the city anywhere', async () => {
    const id = await canaryCustomer(app.current);
    const company = await insertCustomer(admin(), {
      kind: 'company',
      companyName: CANARY.company,
      taxId: CANARY.taxId,
      phone: CANARY.phone,
    });
    const busy = await canaryCustomer(app.current, { lastName: 'Zajety' });
    await orderOf(app.current, busy, 'new');
    const administrator = await signIn('administrator', { fresh: true });
    const responses = [
      await remove(administrator, id, 1),
      await restore(administrator, id, 2),
      await anonymize(administrator, id, 3),
      await anonymize(administrator, id, 4),
      await anonymize(administrator, company, 1),
      await remove(administrator, busy, 1),
      await anonymize(administrator, busy, 1),
    ];
    app.register().failAll();
    const another = await canaryCustomer(app.current, { lastName: 'Inny' });
    responses.push(await anonymize(administrator, another, 1));
    expect(responses.map((response) => response.status)).toEqual([204, 200, 200, 409, 200, 409, 409, 503]);

    // the answers of the operations that leave data out; the restoration returns the customer to the Administrator as it was (not tested here)
    const bodies = JSON.stringify(
      [responses[0], responses[3], responses[5], responses[6], responses[7]].map((response) => response?.body as unknown),
    );
    for (const value of CANARY_VALUES) expect(bodies, value).not.toContain(value);
    expect(await auditText(app.current)).not.toMatch(
      new RegExp(CANARY_VALUES.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')),
    );
    for (const value of CANARY_VALUES) expect(app.current.logs.text, value).not.toContain(value);
    expect(JSON.stringify(app.register().objects)).not.toMatch(/Kanark|Zdzis|601999|example|CANARY/);

    expect((await auditOf(app.current, id)).map((row) => `${row.action}:${row.outcome}`)).toEqual([
      'customer.deleted:success',
      'customer.restored:success',
      'customer.anonymized:success',
    ]);
    const rows = await sql<
      Record<string, unknown>
    >`select * from audit.events where object_id = ${id} and action like 'customer.%'`.execute(admin());
    for (const row of rows.rows) {
      expect(row['object_type']).toBe('customer');
      expect(row['reason_code']).toBeNull();
      expect(row['trace_id']).toMatch(/^[0-9a-f]{32}$/);
      expect(row['actor_user_id']).toBe(administrator.userId);
    }
    expect(await auditOf(app.current, another)).toEqual([
      { action: 'customer.anonymized', outcome: 'failed', actor_user_id: administrator.userId },
    ]);
  });
});
