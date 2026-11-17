/**
 * Read-only does not see an open site survey in any source (EVM-135 AC4; ADR-0024 pt 8; W2, SR-AUTHZ-03): ONE read policy for the orders and the projection, so
 * the detail, the children of the order (the scope, the processes, the journal, the media, the documents, the payments, the exports, the cards), the list, the
 * search and the other orders of a site all answer as if the survey did not exist - `404` and the same body as a missing order. The Administrator and the
 * Editor see it; nobody without a session gets anything but `401`. Synthetic data only.
 */
import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

let current: IdentityApp;
let siteId = '';
let surveyId = '';
let orderId = '';
const SURVEY_NUMBER = numberOf(2026, 9135);
const ORDER_NUMBER = numberOf(2026, 9136);

beforeAll(async () => {
  current = await createIdentityApp();
  const admin = current.database.admin;
  siteId = await insertSite(admin, { street: 'ul. Wizyjna', city: 'Wizjogród' });
  const customerId = await insertCustomer(admin, {});
  const ids = await insertWorkOrders(admin, [
    { number: SURVEY_NUMBER, title: 'Wizja lokalna garaż', siteId, siteSurveyExpiresAt: new Date('2027-02-14T08:00:00.000Z') },
    { number: ORDER_NUMBER, title: 'Zlecenie garaż', siteId, customerId },
  ]);
  surveyId = ids.get(SURVEY_NUMBER) ?? '';
  orderId = ids.get(ORDER_NUMBER) ?? '';
});
afterAll(async () => {
  await current.close();
});

async function signIn(role: Role) {
  const user = await createUser(current.database.admin, current.clock, { role });
  const session = await createSession(current.database.admin, current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return panel;
}
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');

/** Every READ of the manifest addressed by the order alone: a GET with `{workOrderId}` as its only path parameter, open to Read-only on the web. */
const ORDER_READS = Object.entries(AUTHZ_MANIFEST)
  .filter(
    ([, operation]) =>
      operation.method === 'get' &&
      operation.planned !== true &&
      /^\/api\/v1\/work-orders\/\{workOrderId\}(\/[a-z-]+)?$/.test(operation.path) &&
      operation.authz.roles?.includes('read_only') === true &&
      operation.authz.channels?.includes('web') === true,
  )
  .map(([id, operation]) => ({ id, path: operation.path }));
const at = (path: string, id: string): string => path.replace('{workOrderId}', id);

describe('one read policy for every source (EVM-135 AC4)', () => {
  it('EVM-135 AC4 the reads addressed by an order are the detail and its children - the list of the test is the manifest, not a hand-kept list', () => {
    expect(ORDER_READS.map((read) => read.id).sort()).toEqual(
      expect.arrayContaining([
        'getWorkOrder',
        'listWorkOrderScopeItems',
        'listMediaAssets',
        'listTimelineEntries',
        'listDocuments',
        'listPaymentMilestones',
      ]),
    );
    expect(ORDER_READS.length).toBeGreaterThanOrEqual(10);
  });

  it('EVM-135 AC4 Read-only gets 404 not_found for EVERY read of an open survey - the same body as for a missing order - and the same reads of an ordinary order answer', async () => {
    const reader = await signIn('read_only');
    for (const read of ORDER_READS) {
      const hidden = await reader.get(at(read.path, surveyId));
      const missing = await reader.get(at(read.path, uuidv7()));
      expect(hidden.status, read.id).toBe(404);
      expect(missing.status, read.id).toBe(404);
      expect(withoutTrace(hidden.body), read.id).toBe(withoutTrace(missing.body));
      expect((await reader.get(at(read.path, orderId))).status, `${read.id} (ordinary order)`).toBe(200);
    }
  });

  it('EVM-135 AC4 the Administrator and the Editor read the survey (the card of a customer it does not have is 404, as for any order without one)', async () => {
    for (const role of ['administrator', 'editor'] as const) {
      const panel = await signIn(role);
      for (const read of ORDER_READS) {
        const response = await panel.get(at(read.path, surveyId));
        expect(response.status, `${role} ${read.id}`).toBe(read.id === 'getWorkOrderCustomer' ? 404 : 200);
      }
      expect((await panel.get(at('/api/v1/work-orders/{workOrderId}', surveyId))).body).toMatchObject({
        number: SURVEY_NUMBER,
        customer: null,
      });
    }
  });

  it('EVM-135 AC4 nobody without a session gets anything but 401', async () => {
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    for (const read of ORDER_READS) expect((await anonymous.get(at(read.path, surveyId))).status, read.id).toBe(401);
  });

  it('EVM-135 AC4 the list, every view and the search: Read-only does not find the survey (by number, title or address); the Administrator and the Editor do', async () => {
    const numbersOf = (body: unknown): string[] => (body as { items: Array<{ number: string }> }).items.map((item) => item.number);
    for (const role of ['read_only', 'editor', 'administrator'] as const) {
      const panel = await signIn(role);
      const sees = role !== 'read_only';
      for (const query of ['', '?view=all_open', '?status=quoting', '?sort=-createdAt']) {
        const list = await panel.get(`/api/v1/work-orders${query}`);
        expect(list.status, `${role} ${query}`).toBe(200);
        expect(numbersOf(list.body).includes(SURVEY_NUMBER), `${role} ${query}`).toBe(sees);
      }
      for (const phrase of [SURVEY_NUMBER, 'Wizja lokalna', 'Wizyjna']) {
        const found = await panel.post('/api/v1/work-orders/search', { query: phrase });
        expect(found.status, `${role} ${phrase}`).toBe(200);
        expect(numbersOf(found.body).includes(SURVEY_NUMBER), `${role} ${phrase}`).toBe(sees);
      }
    }
  });

  it('EVM-135 AC4 the other orders of the site: Read-only reading the ordinary order does not see the survey at the same address; the Editor does', async () => {
    const idsOf = (body: unknown): string[] =>
      JSON.stringify(body).match(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
    const reader = await signIn('read_only');
    const editor = await signIn('editor');
    const forReader = await reader.get(`/api/v1/work-orders/${orderId}/site-orders`);
    const forEditor = await editor.get(`/api/v1/work-orders/${orderId}/site-orders`);
    expect([forReader.status, forEditor.status]).toEqual([200, 200]);
    expect(idsOf(forReader.body)).not.toContain(surveyId);
    expect(idsOf(forEditor.body)).toContain(surveyId);
  });

  it('EVM-135 AC4 IDOR: Read-only cannot tell a survey from a missing order on the writes either - a write is 403 before anything is looked at', async () => {
    const reader = await signIn('read_only');
    for (const id of [surveyId, uuidv7()]) {
      const patch = await reader.patch(`/api/v1/work-orders/${id}`, { title: 'x' }).set('If-Match', '"1"');
      expect(patch.status).toBe(403);
      const exports = await reader.post(`/api/v1/work-orders/${id}/media-exports`, {});
      expect(exports.status).toBe(403);
    }
  });

  it('EVM-135 AC4 once the survey has a customer (the shape of EVM-136: the deadline cleared in the same update) Read-only reads it', async () => {
    const customerId = await insertCustomer(current.database.admin, {});
    const extra = await insertWorkOrders(current.database.admin, [
      { number: numberOf(2026, 9137), siteId, siteSurveyExpiresAt: new Date('2027-02-14T08:00:00.000Z') },
    ]);
    const id = extra.get(numberOf(2026, 9137)) ?? '';
    const reader = await signIn('read_only');
    expect((await reader.get(`/api/v1/work-orders/${id}`)).status).toBe(404);
    await sql`update work_orders.work_orders set customer_id = ${customerId}, site_survey_expires_at = null, status = 'accepted', version = version + 1
      where id = ${id}`.execute(current.database.admin);
    const { rebuildProjection } = await import('../support/projection.ts');
    await rebuildProjection(current.database.admin, [id]);
    expect((await reader.get(`/api/v1/work-orders/${id}`)).status).toBe(200);
  });
});
