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
const OPERATIONS = ['transitionPaymentMilestone', 'deletePaymentMilestone', 'updatePaymentMilestone'];
const BASE = '/api/v1/work-orders';
const PAY = { to: 'paid', paidOn: '2026-10-01' };

async function fixture(app: IdentityApp) {
  app.clock.set(new Date('2026-10-13T10:00:00.000Z')); // "today" after every day of the fixtures and of the requests
  const db = app.database.admin;
  const customerId = await insertCustomer(db, { email: 'jan@example.invalid' });
  const siteId = await insertSite(db);
  const ids = await insertWorkOrders(db, [
    { number: 'ZL-3954-0001', customerId, siteId },
    { number: 'ZL-3954-0002', customerId, siteId },
    { number: 'ZL-3954-0003', customerId, siteId, deletedAt: new Date('2026-10-02T08:00:00Z') },
  ]);
  const [orderA, orderB, deleted] = [...ids.values()] as [string, string, string];
  const [ownMilestone, goneMilestone] = await insertMilestones(db, orderA, [
    { status: 'invoiced' },
    { status: 'invoiced', deletedAt: new Date('2026-10-02T08:00:00Z') },
  ]);
  const [foreignMilestone] = await insertMilestones(db, orderB, [{ status: 'invoiced' }]);
  const [deletedOrderMilestone] = await insertMilestones(db, deleted, [{ status: 'invoiced' }]);
  return {
    orderA,
    orderB,
    deleted,
    ownMilestone: ownMilestone ?? '',
    goneMilestone: goneMilestone ?? '',
    foreignMilestone: foreignMilestone ?? '',
    deletedOrderMilestone: deletedOrderMilestone ?? '',
  };
}
async function browserOf(app: IdentityApp, role: Role, channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(app.database.admin, app.clock, { role });
  const session = await createSession(app.database.admin, app.clock, user, { channel });
  const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return panel;
}
const statusesOf = async (app: IdentityApp, orderId: string) =>
  (
    await sql<{ status: string; version: number }>`
      select status, version from payments.payment_milestones
      where work_order_id = ${orderId} and deleted_at is null order by position`.execute(app.database.admin)
  ).rows;

describe('the transitions and the deletion of a milestone in the role and channel matrix (EVM-054 AC8; SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-06)', () => {
  it('EVM-054 AC8 EVM-057 AC8 completeness: the operations are in the contract, in the router (route policies checked at start) and in the matrix; the transition and the deletion have an IDOR case', async () => {
    current = await createIdentityApp();
    const fromRouter = current.app
      .get(RoutePolicyCheck)
      .routes()
      .map((route) => route.operationId ?? '');
    const cells = buildMatrix(AUTHZ_MANIFEST, lists);
    for (const operationId of OPERATIONS) {
      expect(AUTHZ_MANIFEST[operationId], operationId).toBeDefined();
      expect(fromRouter, operationId).toContain(operationId);
    }
    expect(cells.some((cell) => cell.operationId === 'transitionPaymentMilestone' && cell.idor)).toBe(true);
    expect(cells.some((cell) => cell.operationId === 'deletePaymentMilestone' && cell.idor)).toBe(true);
  });

  it('EVM-054 AC8 EVM-057 AC8 every cell is answered as expected: A and E on the web are let in to the transition, Read-only, mobile and mfa_enrollment are denied, anonymous is 401; the deletion lets in the Administrator with a fresh key only (step_up_required without one); the milestone of ANOTHER order is 404', async () => {
    current = await createIdentityApp();
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => OPERATIONS.includes(cell.operationId));
    const allowed = cells.filter(
      (cell) => cell.operationId === 'transitionPaymentMilestone' && !cell.idor && cell.expectation.outcome === 'allowed',
    );
    expect(new Set(allowed.map((cell) => (cell.caller.kind === 'session' ? `${cell.caller.role}/${cell.caller.channel}` : '')))).toEqual(
      new Set(['administrator/web', 'editor/web']),
    );
    const deletions = cells.filter((cell) => cell.operationId === 'deletePaymentMilestone');
    expect(deletions.filter((cell) => cell.expectation.outcome === 'allowed').map((cell) => cell.caller)).toEqual([
      { kind: 'session', role: 'administrator', channel: 'web', state: 'active', passkey: 'fresh' },
    ]);
    expect(deletions.filter((cell) => cell.idor)).toHaveLength(1);
    expect(await runMatrix(current, cells, await paymentObjects(current))).toEqual([]);
  });

  it('EVM-054 AC8 Tylko odczyt is 403 forbidden for every move and the change — before If-Match, the body and the existence of the milestone; nothing changes', async () => {
    current = await createIdentityApp();
    const { orderA, ownMilestone } = await fixture(current);
    const reader = await browserOf(current, 'read_only');
    const denied = [
      await reader.post(`${BASE}/${orderA}/payment-milestones/${ownMilestone}/transitions`, PAY, { 'If-Match': '"1"' }),
      await reader.post(`${BASE}/${orderA}/payment-milestones/${ownMilestone}/transitions`, {}),
      await reader.post(`${BASE}/${orderA}/payment-milestones/${uuidv7()}/transitions`, { to: 'overdue' }),
      await reader.patch(`${BASE}/${orderA}/payment-milestones/${ownMilestone}`, { invoiceNumber: 'FV/9' }, { 'If-Match': '"1"' }),
      await reader.delete(`${BASE}/${orderA}/payment-milestones/${ownMilestone}`, { 'If-Match': '"1"' }),
    ];
    for (const response of denied) {
      expect(response.status).toBe(403);
      expect((response.body as { code: string }).code).toBe('forbidden');
    }
    expect(await statusesOf(current, orderA)).toEqual([{ status: 'invoiced', version: 1 }]);
  });

  it('EVM-054 AC8 P3 a mobile token is 403 for the transition and the deletion — with the right role, a valid body and headers', async () => {
    current = await createIdentityApp();
    const { orderA, ownMilestone } = await fixture(current);
    for (const role of ['administrator', 'editor'] as const) {
      const phone = await browserOf(current, role, 'mobile');
      for (const response of [
        await phone.post(`${BASE}/${orderA}/payment-milestones/${ownMilestone}/transitions`, PAY, { 'If-Match': '"1"' }),
        await phone.delete(`${BASE}/${orderA}/payment-milestones/${ownMilestone}`, { 'If-Match': '"1"' }),
      ]) {
        expect(response.status, role).toBe(403);
        expect(JSON.stringify(response.body)).not.toMatch(/amount|invoice|paid/i);
      }
    }
    expect(await statusesOf(current, orderA)).toEqual([{ status: 'invoiced', version: 1 }]);
  });

  it('EVM-054 AC8 an anonymous caller is 401 for the transition and the deletion', async () => {
    current = await createIdentityApp();
    const { orderA, ownMilestone } = await fixture(current);
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect(
      (await anonymous.post(`${BASE}/${orderA}/payment-milestones/${ownMilestone}/transitions`, PAY, { 'If-Match': '"1"' })).status,
    ).toBe(401);
    expect((await anonymous.delete(`${BASE}/${orderA}/payment-milestones/${ownMilestone}`, { 'If-Match': '"1"' })).status).toBe(401);
  });

  it('EVM-054 AC8 SR-AUTHZ-02 CWE-639 the milestone of order B in the path of order A, a deleted milestone, one that does not exist and one of a deleted order are the same 404 — before If-Match and the body, for A and E; B is unchanged', async () => {
    current = await createIdentityApp();
    const { orderA, orderB, deleted, goneMilestone, foreignMilestone, deletedOrderMilestone } = await fixture(current);
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await browserOf(current, role);
      for (const path of [
        `${orderA}/payment-milestones/${foreignMilestone}`,
        `${orderA}/payment-milestones/${goneMilestone}`,
        `${orderA}/payment-milestones/${uuidv7()}`,
        `${deleted}/payment-milestones/${deletedOrderMilestone}`,
      ]) {
        for (const response of [
          await browser.post(`${BASE}/${path}/transitions`, PAY, { 'If-Match': '"1"' }),
          await browser.post(`${BASE}/${path}/transitions`, { to: 'overdue' }),
          await browser.patch(`${BASE}/${path}`, { invoiceNumber: 'FV/9' }),
        ]) {
          expect(response.status, `${role} ${path}`).toBe(404);
          expect((response.body as { code: string }).code).toBe('not_found');
        }
      }
    }
    expect(await statusesOf(current, orderB)).toEqual([{ status: 'invoiced', version: 1 }]);
  });

  it('EVM-054 AC8 the Administrator and the Editor both take the moves of the story', async () => {
    current = await createIdentityApp();
    const { orderA, ownMilestone } = await fixture(current);
    const administrator = await browserOf(current, 'administrator');
    const response = await administrator.post(`${BASE}/${orderA}/payment-milestones/${ownMilestone}/transitions`, PAY, {
      'If-Match': '"1"',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const editor = await browserOf(current, 'editor');
    const changed = await editor.patch(
      `${BASE}/${orderA}/payment-milestones/${ownMilestone}`,
      { paidOn: '2026-10-02' },
      { 'If-Match': '"2"' },
    );
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(await statusesOf(current, orderA)).toEqual([{ status: 'paid', version: 3 }]);
  });
});
