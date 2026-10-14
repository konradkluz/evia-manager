import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import { bundleContract } from '../src/redocly.ts';
import {
  zAuditEvent,
  zDeletePaymentMilestoneHeaders,
  zDeletePaymentMilestonePath,
  zListTimelineEntriesQuery,
  zPaymentMilestone,
  zPaymentMilestonePatch,
  zPaymentMilestoneTransition,
  zTimelineEvent,
  zTransitionPaymentMilestoneHeaders,
  zTransitionPaymentMilestonePath,
} from '../src/zod.ts';

const V7 = '0198b0a0-0000-7000-8000-000000000001';
const BASE = '/api/v1/work-orders/{workOrderId}/payment-milestones/{milestoneId}';

interface BundledOperation {
  readonly parameters?: { name: string; in: string; required?: boolean }[];
  readonly responses: Record<string, unknown>;
  readonly description: string;
}
function bundle() {
  const output = join(mkdtempSync(join(tmpdir(), 'evia-contracts-')), 'openapi.json');
  expect(bundleContract(output).status).toBe(0);
  return JSON.parse(readFileSync(output, 'utf8')) as {
    paths: Record<string, Record<string, BundledOperation>>;
    components: { schemas: Record<string, { minProperties?: number; properties?: Record<string, { readOnly?: boolean }> }> };
  };
}

describe('the transitions of a payment milestone in the contract (EVM-054; SR-AUTHZ-01, SR-AUTHZ-10, SR-API-07, SR-INPUT-01)', () => {
  it('EVM-054 AC8 the transition is open to Administrator and Editor on the web channel, without a step-up and with audit', () => {
    expect(AUTHZ_MANIFEST['transitionPaymentMilestone']).toMatchObject({
      method: 'post',
      path: `${BASE}/transitions`,
      authz: { roles: ['administrator', 'editor'], channels: ['web'], stepUp: false, audit: true },
    });
    expect(zTransitionPaymentMilestonePath.safeParse({ workOrderId: V7, milestoneId: V7 }).success).toBe(true);
    expect(zTransitionPaymentMilestonePath.safeParse({ workOrderId: V7, milestoneId: 'x' }).success).toBe(false);
  });

  it('EVM-054 AC5 Q1 EVM-057 AC4 the deletion of a milestone is the Administrator with a step-up and audit, web only; If-Match required, Idempotency-Key optional; 204 with Idempotent-Replayed on a repeat', () => {
    expect(AUTHZ_MANIFEST['deletePaymentMilestone']).toMatchObject({
      method: 'delete',
      path: BASE,
      authz: { roles: ['administrator'], channels: ['web'], stepUp: true, audit: true },
    });
    expect(zDeletePaymentMilestonePath.safeParse({ workOrderId: V7, milestoneId: 'x' }).success).toBe(false);
    expect(zDeletePaymentMilestoneHeaders.safeParse({ 'If-Match': '"1"' }).success).toBe(true);
    expect(zDeletePaymentMilestoneHeaders.safeParse({ 'If-Match': '"1"', 'Idempotency-Key': V7 }).success).toBe(true);
    expect(zDeletePaymentMilestoneHeaders.safeParse({}).success).toBe(false);
    const operation = bundle().paths[BASE]?.['delete'] as BundledOperation & {
      responses: Record<string, { headers?: Record<string, unknown> }>;
    };
    expect(Object.keys(operation.responses).sort()).toEqual(['204', '400', '401', '403', '404', '409', '412', '428', '429']);
    expect(Object.keys(operation.responses['204']?.headers ?? {})).toEqual(['Idempotent-Replayed']);
    expect(operation.description).toContain('EVM-057');
    expect(operation.description).toContain('`404 not_found`');
    expect(operation.description).not.toContain('Do EVM-057');
  });

  it('EVM-057 AC1 AC2 AC3 AC4 SR-LOG-03 the audit trail knows the six actions of a correction; an action outside the list is refused', () => {
    const event = {
      id: V7,
      occurredAt: '2026-10-14T08:00:00.000Z',
      actor: null,
      action: 'payment_milestone.invoice_withdrawn',
      outcome: 'success',
      reasonCode: null,
      objectType: 'payment_milestone',
      objectId: V7,
      ipPrefix: null,
    };
    for (const action of [
      'payment_milestone.invoice_withdrawn',
      'payment_milestone.invoice_cancelled',
      'payment_milestone.payment_undone',
      'payment_milestone.restored',
      'payment_milestone.amount_corrected',
      'payment_milestone.deleted',
    ])
      expect(zAuditEvent.safeParse({ ...event, action }).success, action).toBe(true);
    expect(zAuditEvent.safeParse({ ...event, action: 'payment_milestone.purged' }).success).toBe(false);
  });

  it('EVM-057 AC6 SR-AUTHZ-10 the inventory of routes: no deletion of a work order, and the writes of a milestone are its addition, change, transition and deletion only', () => {
    expect(
      Object.values(AUTHZ_MANIFEST).some(
        (operation) => operation.method === 'delete' && operation.path === '/api/v1/work-orders/{workOrderId}',
      ),
    ).toBe(false);
    const writes = Object.entries(AUTHZ_MANIFEST)
      .filter(([, operation]) => operation.method !== 'get' && operation.path.includes('payment-milestones'))
      .map(([operationId]) => operationId)
      .sort();
    expect(writes).toEqual(['createPaymentMilestone', 'deletePaymentMilestone', 'transitionPaymentMilestone', 'updatePaymentMilestone']);
  });

  it('EVM-057 AC6 the command of a correction is the target alone in the schema; the representation may name the four targets of the corrections', () => {
    expect(zPaymentMilestoneTransition.safeParse({ to: 'planned' }).success).toBe(true);
    expect(zPaymentMilestonePatch.safeParse({ amount: null }).success).toBe(false);
    const description = bundle().components.schemas['PaymentMilestoneTransition'] as unknown as { description: string };
    expect(description.description).toContain('`400 not_allowed`');
    expect(description.description).toContain('`403 step_up_required`');
  });

  it('EVM-054 AC7 the transition needs If-Match as a strong tag and takes an optional UUIDv7 Idempotency-Key', () => {
    expect(zTransitionPaymentMilestoneHeaders.safeParse({ 'If-Match': '"3"' }).success).toBe(true);
    expect(zTransitionPaymentMilestoneHeaders.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': V7 }).success).toBe(true);
    expect(zTransitionPaymentMilestoneHeaders.safeParse({}).success).toBe(false);
    expect(zTransitionPaymentMilestoneHeaders.safeParse({ 'If-Match': 'W/"3"' }).success).toBe(false);
  });

  it('EVM-054 AC1 AC2 AC3 the command names the target and the fields of the three moves; the status of the server and the fields of the milestone are not part of it', () => {
    const invoice = { to: 'invoiced', amount: { amountMinor: 123000, currency: 'PLN' }, invoiceNumber: 'FV/TEST/0021/2026' };
    expect(zPaymentMilestoneTransition.safeParse({ ...invoice, invoicedOn: '2026-10-03', dueDate: '2026-10-10' }).success).toBe(true);
    expect(zPaymentMilestoneTransition.safeParse({ to: 'paid', paidOn: '2026-10-03' }).success).toBe(true);
    expect(zPaymentMilestoneTransition.safeParse({ to: 'cancelled', reason: 'Rezygnacja' }).success).toBe(true);
    expect(zPaymentMilestoneTransition.safeParse({ to: 'overdue' }).success).toBe(false);
    expect(zPaymentMilestoneTransition.safeParse({ to: 'paid', paidOn: '03.10.2026' }).success).toBe(false);
    expect(zPaymentMilestoneTransition.safeParse({ to: 'cancelled', reason: 'x'.repeat(501) }).success).toBe(false);
    expect(zPaymentMilestoneTransition.safeParse({ ...invoice, invoiceNumber: 'x'.repeat(61) }).success).toBe(false);
    for (const field of ['status', 'version', 'name', 'allowedTransitions', 'isOverdue'])
      expect(Object.keys(zPaymentMilestoneTransition.shape), field).not.toContain(field);
  });

  it('EVM-054 AC4 the patch is a merge-patch of at least one field; null is not a value of it; allowedTransitions is read-only', () => {
    expect(zPaymentMilestonePatch.safeParse({ invoiceNumber: 'FV/1', invoicedOn: '2026-10-03', dueDate: '2026-10-10' }).success).toBe(true);
    expect(zPaymentMilestonePatch.safeParse({ paidOn: '2026-10-03' }).success).toBe(true);
    expect(zPaymentMilestonePatch.safeParse({ dueDate: null }).success).toBe(false);
    const { schemas } = bundle().components;
    expect(schemas['PaymentMilestonePatch']?.minProperties).toBe(1);
    expect(schemas['PaymentMilestone']?.properties?.['allowedTransitions']?.readOnly).toBe(true);
  });

  it('EVM-054 AC5 the representation carries the transitions of the role of the caller (at most four statuses of the list)', () => {
    const milestone = {
      id: V7,
      code: null,
      name: 'Zaliczka',
      position: 1,
      sharePercent: null,
      paymentTermDays: null,
      amount: { amountMinor: 123000, currency: 'PLN' },
      status: 'invoiced',
      invoiceNumber: 'FV/TEST/0021/2026',
      invoicedOn: '2026-10-03',
      dueDate: '2026-10-10',
      paidOn: null,
      isOverdue: false,
      version: 2,
      allowedTransitions: ['paid'],
    };
    expect(zPaymentMilestone.safeParse(milestone).success).toBe(true);
    expect(zPaymentMilestone.safeParse({ ...milestone, allowedTransitions: [] }).success).toBe(true);
    expect(zPaymentMilestone.safeParse({ ...milestone, allowedTransitions: ['overdue'] }).success).toBe(false);
    const withoutTransitions: Record<string, unknown> = { ...milestone };
    delete withoutTransitions['allowedTransitions'];
    expect(zPaymentMilestone.safeParse(withoutTransitions).success).toBe(false);
  });

  it('EVM-054 AC1 AC2 AC3 SR-LOG-03 the audit event has the actions of the moves and the codes of the status before and after — optional, nullable, codes only', () => {
    const event = {
      id: V7,
      occurredAt: '2026-10-03T08:00:00.000Z',
      actor: null,
      action: 'payment_milestone.invoiced',
      outcome: 'success',
      reasonCode: null,
      objectType: 'payment_milestone',
      objectId: V7,
      ipPrefix: null,
    };
    for (const action of ['payment_milestone.invoiced', 'payment_milestone.paid', 'payment_milestone.details_changed'])
      expect(zAuditEvent.safeParse({ ...event, action }).success, action).toBe(true);
    expect(zAuditEvent.safeParse({ ...event, fromCode: 'planned', toCode: 'invoiced' }).success).toBe(true);
    expect(zAuditEvent.safeParse({ ...event, fromCode: null, toCode: null }).success).toBe(true);
    expect(zAuditEvent.safeParse({ ...event, fromCode: 'Planowana', toCode: 'invoiced' }).success).toBe(false);
  });

  it('EVM-054 AC3 the journal has the group payments and the event of a milestone with its id and name (null when the milestone is deleted)', () => {
    expect(zListTimelineEntriesQuery.safeParse({ eventGroup: 'payments' }).success).toBe(true);
    const event = {
      code: 'payment_milestone_status_changed',
      objectType: 'payment_milestone',
      fromStatus: 'planned',
      toStatus: 'invoiced',
      waitingOn: null,
      waitingOnParty: null,
      changedFields: [],
    };
    expect(zTimelineEvent.safeParse({ ...event, paymentMilestone: { id: V7, name: 'Zaliczka' } }).success).toBe(true);
    expect(zTimelineEvent.safeParse({ ...event, paymentMilestone: { id: V7, name: null } }).success).toBe(true);
    expect(zTimelineEvent.safeParse({ ...event, paymentMilestone: { id: V7 } }).success).toBe(false);
  });
  it('EVM-057 AC4 the journal entry of a deleted milestone names the milestone without a name and without a status', () => {
    const deleted = {
      code: 'payment_milestone_deleted',
      objectType: 'payment_milestone',
      fromStatus: null,
      toStatus: null,
      waitingOn: null,
      waitingOnParty: null,
      changedFields: [],
      paymentMilestone: { id: V7, name: null },
    };
    expect(zTimelineEvent.safeParse(deleted).success).toBe(true);
  });
});
