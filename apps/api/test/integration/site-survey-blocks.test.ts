/**
 * What waits for the customer of a site survey (EVM-135 AC7; ADR-0024 pt 4; W11): the payment plan, the documents (every anchor) and the ZIP export of the media
 * are `409 customer_required` while the order is an open survey - nothing is written; the scope, the processes, the journal and the media can be added. The
 * closed list of the refused operations is the one the contract names in its 409. Read-only does not see the survey at all (`404` before the block; W11).
 * The database keeps the phone of the requester to an open survey (CHECK of 0066). Synthetic data only.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

const BASE = '/api/v1/work-orders';
const CATALOG_ITEM = 'dso_agreement';
let current: IdentityApp;
let surveyId = '';
let orderId = '';

beforeAll(async () => {
  current = await createIdentityApp();
  const siteId = await insertSite(current.database.admin, {});
  const customerId = await insertCustomer(current.database.admin, {});
  const ids = await insertWorkOrders(current.database.admin, [
    { number: numberOf(2026, 6001), siteId, siteSurveyExpiresAt: new Date('2027-02-14T08:00:00.000Z') },
    { number: numberOf(2026, 6002), siteId, customerId, status: 'accepted' },
  ]);
  surveyId = ids.get(numberOf(2026, 6001)) ?? '';
  orderId = ids.get(numberOf(2026, 6002)) ?? '';
});
afterAll(async () => {
  await current.close();
});

async function signIn(role: Role = 'editor') {
  const user = await createUser(current.database.admin, current.clock, { role });
  // a fresh passkey: the export of media asks for a step-up (EVM-052)
  const session = await createSession(current.database.admin, current.clock, user, { passkeyAuthenticatedAt: current.clock.now() });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return panel;
}
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2039, 7)]);
const documentBody = (anchor: string) => ({
  id: uuidv7(),
  kindCode: 'building_documentation',
  title: 'Dokumentacja budynku',
  anchor,
  file: {
    fileName: 'budynek.pdf',
    contentType: 'application/pdf',
    declaredSize: pdf.length,
    sha256: createHash('sha256').update(pdf).digest('hex'),
  },
});
const key = () => ({ 'Idempotency-Key': uuidv7() });
/** The refused operations of AC7, each as the request it sends. */
const REFUSED: Record<string, (panel: PanelClient, id: string) => ReturnType<PanelClient['post']>> = {
  createPaymentMilestone: (panel, id) => panel.post(`${BASE}/${id}/payment-milestones`, { id: uuidv7(), name: 'Zaliczka' }, key()),
  createDocument: (panel, id) => panel.post(`${BASE}/${id}/documents`, documentBody('work_order'), key()),
  createMediaExport: (panel, id) => panel.post(`${BASE}/${id}/media-exports`, undefined, key()),
};
const n = async (query: ReturnType<typeof sql<{ n: string }>>): Promise<number> =>
  Number((await query.execute(current.database.admin)).rows[0]?.n);
const written = async () => ({
  milestones: await n(sql`select count(*)::text as n from payments.payment_milestones`),
  documents: await n(sql`select count(*)::text as n from media.documents`),
  exports: await n(sql`select count(*)::text as n from media.media_exports`),
  records: await n(sql`select count(*)::text as n from platform.idempotency_records`),
});

describe('what waits for the customer of a site survey (EVM-135 AC7)', () => {
  it('EVM-135 AC7 the closed list: exactly the operations whose 409 in the contract names customer_required', () => {
    const bundle = JSON.parse(readFileSync(new URL('../../../../packages/contracts/dist/openapi.json', import.meta.url), 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, { $ref?: string }> }>>;
      components: { responses: Record<string, { description: string }> };
    };
    const named = Object.values(bundle.paths).flatMap((item) =>
      Object.values(item).flatMap((operation) => {
        const ref = operation.responses?.['409']?.$ref?.split('/').pop();
        const text = ref === undefined ? '' : (bundle.components.responses[ref]?.description ?? '');
        return text.includes('customer_required') && operation.operationId !== undefined ? [operation.operationId] : [];
      }),
    );
    // transitionWorkOrder joins the list with EVM-136 (the rule of "accepted"); this story owns the three below
    expect(named.filter((id) => id !== 'transitionWorkOrder').sort()).toEqual(Object.keys(REFUSED).sort());
  });

  it('EVM-135 AC7 on an open survey each of them is 409 customer_required for the Administrator and the Editor - nothing is written, no record of idempotency', async () => {
    for (const role of ['administrator', 'editor'] as const) {
      const panel = await signIn(role);
      const before = await written();
      for (const [operation, send] of Object.entries(REFUSED)) {
        const response = await send(panel, surveyId);
        expect(response.status, `${role} ${operation}`).toBe(409);
        expect((response.body as { code: string }).code, `${role} ${operation}`).toBe('customer_required');
      }
      expect(await written()).toEqual(before);
    }
  });

  it('EVM-135 AC7 a document of every anchor waits for the customer (a site and a customer anchor alike)', async () => {
    const panel = await signIn('editor');
    for (const anchor of ['work_order', 'site', 'customer']) {
      const response = await panel.post(`${BASE}/${surveyId}/documents`, documentBody(anchor), key());
      expect(response.status, anchor).toBe(409);
      expect((response.body as { code: string }).code, anchor).toBe('customer_required');
    }
  });

  it('EVM-135 AC7 the same operations on an ordinary order work as before (a milestone and a document are created; the export answers its own rule)', async () => {
    const panel = await signIn('editor');
    expect((await REFUSED['createPaymentMilestone']?.(panel, orderId))?.status).toBe(201);
    expect((await REFUSED['createDocument']?.(panel, orderId))?.status).toBe(201);
    const exported = await REFUSED['createMediaExport']?.(panel, orderId);
    expect((exported?.body as { code: string }).code).toBe('no_media_to_export');
  });

  it('EVM-135 AC7 the scope, the processes, the journal and the media can be added to a survey', async () => {
    const panel = await signIn('editor');
    const scope = await panel.post(`${BASE}/${surveyId}/scope-items`, { id: uuidv7(), catalogItemCode: CATALOG_ITEM }, key());
    expect(scope.status, JSON.stringify(scope.body)).toBe(201);
    const entry = await panel.post(
      `${BASE}/${surveyId}/timeline`,
      { id: uuidv7(), kind: 'note', noteCategory: 'site_visit', body: 'Oględziny garażu.' },
      key(),
    );
    expect(entry.status, JSON.stringify(entry.body)).toBe(201);
  });

  it('EVM-135 AC7 W11 Read-only does not reach the block: the survey is 404 for its reads, and every refused operation is 403 before anything', async () => {
    const reader = await signIn('read_only');
    expect((await reader.get(`${BASE}/${surveyId}/media-exports`)).status).toBe(404);
    expect((await reader.get(`${BASE}/${surveyId}/media-assets`)).status).toBe(404);
    for (const [operation, send] of Object.entries(REFUSED)) expect((await send(reader, surveyId)).status, operation).toBe(403);
  });

  it('EVM-135 AC7 the database keeps the phone of the requester to an open survey: on an ordinary order it is refused', async () => {
    await expect(
      sql`update work_orders.work_orders set requester_phone = '+48600700800' where id = ${orderId}`.execute(current.database.admin),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
