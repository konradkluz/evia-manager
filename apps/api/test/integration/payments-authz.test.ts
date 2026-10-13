import { AUTHZ_MANIFEST, MFA_ENROLLMENT_OPERATIONS, PUBLIC_OPERATIONS } from '@evia/contracts/authz';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { RoutePolicyCheck } from '../../src/modules/authorization/index.ts';
import { buildMatrix, runMatrix, type MatrixLists } from '../authorization/role-matrix.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { paymentObjects } from '../support/matrix-objects.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones } from '../support/payment-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';

let current: IdentityApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const lists: MatrixLists = { publicOperations: PUBLIC_OPERATIONS, mfaEnrollmentOperations: MFA_ENROLLMENT_OPERATIONS };
const WRITERS = ['createPaymentMilestone', 'updatePaymentMilestone'];
const OPERATIONS = ['listPaymentMilestones', ...WRITERS];
const BASE = '/api/v1/work-orders';

async function fixture(app: IdentityApp) {
  const db = app.database.admin;
  const customerId = await insertCustomer(db, { email: 'jan@example.invalid' });
  const siteId = await insertSite(db);
  const ids = await insertWorkOrders(db, [{ number: 'ZL-3953-0001', customerId, siteId }]);
  const orderId = [...ids.values()][0] ?? '';
  const [milestoneId] = await insertMilestones(db, orderId, [{}]);
  return { orderId, milestoneId: milestoneId ?? '' };
}
async function browserOf(app: IdentityApp, role: Role, channel: 'web' | 'mobile') {
  const user = await createUser(app.database.admin, app.clock, { role });
  const session = await createSession(app.database.admin, app.clock, user, { channel });
  const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return panel;
}

describe('the payment milestones in the role and channel matrix (EVM-053 AC7; SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-06, SR-AUTHZ-12)', () => {
  it('EVM-053 AC7 completeness: the three operations are in the contract, in the router (route policies checked at start) and in the matrix, each with an IDOR case', async () => {
    current = await createIdentityApp();
    const fromRouter = current.app
      .get(RoutePolicyCheck)
      .routes()
      .map((route) => route.operationId ?? '');
    const cells = buildMatrix(AUTHZ_MANIFEST, lists);
    for (const operationId of OPERATIONS) {
      expect(AUTHZ_MANIFEST[operationId], operationId).toBeDefined();
      expect(fromRouter, operationId).toContain(operationId);
      expect(
        cells.some((cell) => cell.operationId === operationId && cell.idor),
        operationId,
      ).toBe(true);
    }
    expect(Object.keys(await paymentObjects(current)).sort()).toEqual([...OPERATIONS].sort());
  });

  it('EVM-053 AC7 every cell of the three operations is answered as expected: A and E on the web are let in; Tylko odczyt reads and is 403 forbidden for a change; mobile and mfa_enrollment are denied; anonymous is 401; the milestone of ANOTHER order and a deleted order are 404', async () => {
    current = await createIdentityApp();
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => OPERATIONS.includes(cell.operationId));
    for (const operationId of OPERATIONS) {
      const own = cells.filter((cell) => cell.operationId === operationId && !cell.idor);
      const allowed = own.filter((cell) => cell.expectation.outcome === 'allowed');
      expect(
        allowed.every((cell) => cell.caller.kind === 'session' && cell.caller.channel === 'web' && cell.caller.state === 'active'),
        operationId,
      ).toBe(true);
      const roles = new Set(allowed.map((cell) => (cell.caller.kind === 'session' ? cell.caller.role : '')));
      expect(roles, operationId).toEqual(
        new Set(WRITERS.includes(operationId) ? ['administrator', 'editor'] : ['administrator', 'editor', 'read_only']),
      );
      for (const cell of own.filter((candidate) => candidate.caller.kind === 'session' && candidate.caller.channel === 'mobile')) {
        expect(cell.expectation, operationId).toMatchObject({ outcome: 'denied', status: 403 });
      }
      const anonymous = own.find((cell) => cell.caller.kind === 'anonymous');
      expect(anonymous?.expectation, operationId).toEqual({ outcome: 'denied', status: 401, code: 'unauthenticated' });
    }
    expect(await runMatrix(current, cells, await paymentObjects(current))).toEqual([]);
  });

  it('EVM-053 AC7 P3 a mobile token is 403 on each of the three operations — with the right role, a valid body and headers — and no payment field leaves the API', async () => {
    current = await createIdentityApp();
    const { orderId, milestoneId } = await fixture(current);
    for (const role of ['administrator', 'editor'] as const) {
      const phone = await browserOf(current, role, 'mobile');
      const responses = [
        await phone.get(`${BASE}/${orderId}/payment-milestones`),
        await phone.post(`${BASE}/${orderId}/payment-milestones`, { id: uuidv7(), name: 'Z telefonu' }, { 'Idempotency-Key': uuidv7() }),
        await phone.patch(`${BASE}/${orderId}/payment-milestones/${milestoneId}`, { amountMinor: 1 }, { 'If-Match': '"1"' }),
        await phone.patch(
          `${BASE}/${orderId}/payment-milestones/${milestoneId}`,
          { amount: { amountMinor: 1, currency: 'PLN' } },
          { 'If-Match': '"1"' },
        ),
      ];
      for (const response of responses) {
        expect(response.status, role).toBe(403);
        expect((response.body as { code: string }).code).toBe('forbidden');
        expect(JSON.stringify(response.body)).not.toMatch(/amount|milestone|Transza/i);
      }
    }
    const { rows } = await sql<{ version: number; amount_minor: string | null }>`
      select version, amount_minor from payments.payment_milestones where work_order_id = ${orderId}`.execute(current.database.admin);
    expect(rows).toEqual([{ version: 1, amount_minor: null }]);
  });

  it('EVM-053 AC7 Tylko odczyt sees the milestones and the totals and every mutation of it is 403 forbidden — before the headers, the body and the existence of the milestone', async () => {
    current = await createIdentityApp();
    const { orderId, milestoneId } = await fixture(current);
    const reader = await browserOf(current, 'read_only', 'web');
    const list = await reader.get(`${BASE}/${orderId}/payment-milestones`);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ items: [{ id: milestoneId }], totals: { unpaid: { amountMinor: 0 } } });
    const denied = [
      await reader.post(`${BASE}/${orderId}/payment-milestones`, { id: uuidv7(), name: 'Zaliczka' }, { 'Idempotency-Key': uuidv7() }),
      await reader.post(`${BASE}/${orderId}/payment-milestones`, {}),
      await reader.patch(
        `${BASE}/${orderId}/payment-milestones/${milestoneId}`,
        { amount: { amountMinor: 1, currency: 'PLN' } },
        { 'If-Match': '"1"' },
      ),
      await reader.patch(`${BASE}/${orderId}/payment-milestones/${uuidv7()}`, {}),
    ];
    for (const response of denied) {
      expect(response.status).toBe(403);
      expect((response.body as { code: string }).code).toBe('forbidden');
    }
  });
});
