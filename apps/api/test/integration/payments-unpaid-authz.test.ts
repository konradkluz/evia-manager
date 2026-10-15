import { AUTHZ_MANIFEST, MFA_ENROLLMENT_OPERATIONS, PUBLIC_OPERATIONS } from '@evia/contracts/authz';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { RoutePolicyCheck } from '../../src/modules/authorization/index.ts';
import { buildMatrix, runMatrix, type MatrixLists } from '../authorization/role-matrix.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones } from '../support/payment-fixtures.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';

let current: IdentityApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const OPERATION = 'listUnpaidPaymentMilestones';
const LIST = '/api/v1/payment-milestones';
const lists: MatrixLists = { publicOperations: PUBLIC_OPERATIONS, mfaEnrollmentOperations: MFA_ENROLLMENT_OPERATIONS };

async function fixture(app: IdentityApp) {
  const ids = await insertWorkOrders(app.database.admin, [{ number: 'ZL-3955-0001' }]);
  const orderId = [...ids.values()][0] ?? '';
  const [milestoneId] = await insertMilestones(app.database.admin, orderId, [{ status: 'invoiced', amountMinor: 250_000 }]);
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

describe('the summary of unpaid invoices in the role and channel matrix (EVM-055 AC5, AC7; SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-06, SR-AUTHZ-12)', () => {
  it('EVM-055 AC7 completeness: the operation is in the contract, in the router (route policies checked at start) and in the matrix of the roles, on the web channel only, with no audit of the read', async () => {
    current = await createIdentityApp();
    const fromRouter = current.app
      .get(RoutePolicyCheck)
      .routes()
      .map((route) => route.operationId ?? '');
    expect(AUTHZ_MANIFEST[OPERATION]).toMatchObject({
      method: 'get',
      path: LIST,
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'] },
    });
    expect(fromRouter).toContain(OPERATION);
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => cell.operationId === OPERATION);
    expect(cells.length).toBeGreaterThan(0);
    const allowed = cells.filter((cell) => cell.expectation.outcome === 'allowed');
    expect(allowed.every((cell) => cell.caller.kind === 'session' && cell.caller.channel === 'web' && cell.caller.state === 'active')).toBe(
      true,
    );
    expect(new Set(allowed.map((cell) => (cell.caller.kind === 'session' ? cell.caller.role : '')))).toEqual(
      new Set(['administrator', 'editor', 'read_only']),
    );
    expect(cells.find((cell) => cell.caller.kind === 'anonymous')?.expectation).toEqual({
      outcome: 'denied',
      status: 401,
      code: 'unauthenticated',
    });
  });

  it('EVM-055 AC7 every cell is answered as expected: A, E and R on the web are let in; mobile and mfa_enrollment are denied; anonymous, a revoked and an expired session are 401', async () => {
    current = await createIdentityApp();
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => cell.operationId === OPERATION);
    expect(await runMatrix(current, cells)).toEqual([]);
  });

  it('EVM-055 AC5 AC7 every role of the office reads the amounts, the invoice numbers and the due days; a mobile token of any role is 403 and no payment field leaves the API; anonymous is 401', async () => {
    current = await createIdentityApp();
    await fixture(current);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const response = await (await browserOf(current, role, 'web')).get(LIST);
      expect(response.status, role).toBe(200);
      expect(response.body, role).toMatchObject({
        items: [{ invoiceNumber: 'FV/1/2026', amount: { amountMinor: 250_000 }, dueDate: '2026-10-08' }],
      });
      const phone = await browserOf(current, role, 'mobile');
      const denied = await phone.get(LIST);
      expect(denied.status, role).toBe(403);
      expect(JSON.stringify(denied.body), role).not.toMatch(/amount|FV\/|ZL-/i);
    }
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await anonymous.get(LIST)).status).toBe(401);
  });

  it('EVM-055 AC5 Tylko odczyt cannot act on a row of the summary: the transition, the change and the deletion of that milestone are 403 forbidden — also with the version and If-Match taken from the list; nothing changes', async () => {
    current = await createIdentityApp();
    const { orderId, milestoneId } = await fixture(current);
    const reader = await browserOf(current, 'read_only', 'web');
    const listed = await reader.get(LIST);
    const row = (listed.body as { items: Array<{ id: string; workOrder: { id: string }; version: number }> }).items[0];
    expect(row?.id).toBe(milestoneId);
    const path = `/api/v1/work-orders/${row?.workOrder.id}/payment-milestones/${row?.id}`;
    const ifMatch = { 'If-Match': `"${row?.version}"` };
    const denied = [
      await reader.post(`${path}/transitions`, { to: 'paid', paidOn: '2026-10-01' }, ifMatch),
      await reader.patch(path, { invoiceNumber: 'FV/9' }, ifMatch),
      await reader.delete(path, ifMatch),
    ];
    for (const response of denied) {
      expect(response.status).toBe(403);
      expect((response.body as { code: string }).code).toBe('forbidden');
    }
    const { rows } = await sql<{ status: string; version: number }>`
      select status, version from payments.payment_milestones where work_order_id = ${orderId}`.execute(current.database.admin);
    expect(rows).toEqual([{ status: 'invoiced', version: 1 }]);
  });

  it('EVM-055 AC5 AC6 a read of the summary writes nothing to the audit trail', async () => {
    current = await createIdentityApp();
    await fixture(current);
    const before = await sql<{ count: string }>`select count(*)::text as count from audit.events`.execute(current.database.admin);
    expect((await (await browserOf(current, 'editor', 'web')).get(LIST)).status).toBe(200);
    const after = await sql<{ count: string }>`
      select count(*)::text as count from audit.events`.execute(current.database.admin);
    expect(Number(after.rows[0]?.count) - Number(before.rows[0]?.count)).toBe(0);
  });
});
