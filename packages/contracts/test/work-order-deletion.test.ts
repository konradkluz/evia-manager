import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zAuditAction,
  zAuditReasonCode,
  zDeleteWorkOrderHeaders,
  zDeleteWorkOrderPath,
  zRestoreWorkOrderHeaders,
  zWorkOrderListItem,
  zWorkOrderView,
} from '../src/zod.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';

interface BundledOperation {
  readonly description?: string;
  readonly responses: Record<string, unknown>;
  readonly parameters?: ReadonlyArray<{ readonly name: string; readonly in: string; readonly required?: boolean }>;
}
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, BundledOperation>>;
};
const deletion = bundled.paths['/api/v1/work-orders/{workOrderId}']?.['delete'];
const restoration = bundled.paths['/api/v1/work-orders/{workOrderId}/restore']?.['post'];

describe('deleting and restoring a work order in the contract (EVM-060; SR-AUTHZ-05, SR-AUTHZ-10, SR-SESS-08, SR-API-05, SR-LOG-03)', () => {
  it('EVM-060 AC5 AC6 deleteWorkOrder and restoreWorkOrder are for the Administrator only, web channel, with audit; no step-up at the operation level (it depends on the state of the milestones)', () => {
    expect(AUTHZ_MANIFEST['deleteWorkOrder']).toEqual({
      method: 'delete',
      path: '/api/v1/work-orders/{workOrderId}',
      query: [],
      authz: { roles: ['administrator'], channels: ['web'], stepUp: false, audit: true },
    });
    expect(AUTHZ_MANIFEST['restoreWorkOrder']).toEqual({
      method: 'post',
      path: '/api/v1/work-orders/{workOrderId}/restore',
      query: [],
      authz: { roles: ['administrator'], channels: ['web'], audit: true },
    });
  });

  it('EVM-060 AC3 the description of the deletion says that the step-up depends on the state of the milestones', () => {
    expect(deletion?.description).toContain('step-up');
    expect(deletion?.description).toContain('`stepUp: false`');
    expect(deletion?.description).toContain('`403 step_up_required`');
    expect(deletion?.description).toContain('`409 has_active_dependents`');
  });

  it('EVM-060 AC1 both commands need If-Match (a strong tag) and take an optional Idempotency-Key (UUIDv7); the path id is a UUID', () => {
    for (const operation of [deletion, restoration]) {
      expect(JSON.stringify(operation?.parameters)).toContain('IfMatchHeader');
      expect(JSON.stringify(operation?.parameters)).toContain('IdempotencyKeyHeader');
    }
    expect(zDeleteWorkOrderHeaders.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': ID }).success).toBe(true);
    for (const weak of ['W/"3"', '*', '3', '"0"']) {
      expect(zDeleteWorkOrderHeaders.safeParse({ 'If-Match': weak }).success, weak).toBe(false);
      expect(zRestoreWorkOrderHeaders.safeParse({ 'If-Match': weak }).success, weak).toBe(false);
    }
    expect(zDeleteWorkOrderPath.safeParse({ workOrderId: 'nie-uuid' }).success).toBe(false);
  });

  it('EVM-060 AC2 AC3 AC5 the outcomes of the deletion are documented: 204, 400, 401, 403, 404, 409, 412, 422, 428, 429 (no body: no 413, no 415)', () => {
    expect(Object.keys(deletion?.responses ?? {}).sort()).toEqual(['204', '400', '401', '403', '404', '409', '412', '422', '428', '429']);
    expect(Object.keys(restoration?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
      '412',
      '422',
      '428',
      '429',
    ]);
  });

  it('EVM-060 AC2 the 409 documents has_active_dependents (no count, no amount), the 403 documents step_up_required', () => {
    const response = (name: string) =>
      JSON.stringify(
        (JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as { components: { responses: Record<string, unknown> } }).components
          .responses[name],
      );
    expect(JSON.stringify(deletion?.responses['409'])).toContain('WorkOrderDeleteConflict');
    expect(response('WorkOrderDeleteConflict')).toContain('has_active_dependents');
    expect(response('WorkOrderDeleteConflict')).toContain('idempotency_in_progress');
    expect(response('WorkOrderDeleteForbidden')).toContain('step_up_required');
  });

  it('EVM-060 AC4 the view "Usunięte" is an additive value of WorkOrderView and the item carries deletedAt and version only for it (optional)', () => {
    expect(zWorkOrderView.options).toEqual(['all_open', 'mine', 'waiting_on_dso_over_14_days', 'overdue_payments', 'unpaid', 'deleted']);
    const base = { id: ID, number: 'ZL-2026-0001', title: 'Test', status: 'new', coordinator: null, createdAt: '2026-10-16T08:00:00.000Z' };
    expect(zWorkOrderListItem.safeParse(base).success).toBe(true);
    expect(zWorkOrderListItem.safeParse({ ...base, deletedAt: '2026-10-16T09:00:00.000Z', version: 4 }).success).toBe(true);
    expect(zWorkOrderListItem.safeParse({ ...base, version: 0 }).success).toBe(false);
  });

  it('EVM-060 AC1 AC4 the audit trail knows work_order.deleted, work_order.undeleted and the reason code step_up_verified', () => {
    expect(zAuditAction.safeParse('work_order.deleted').success).toBe(true);
    expect(zAuditAction.safeParse('work_order.undeleted').success).toBe(true);
    expect(zAuditReasonCode.safeParse('step_up_verified').success).toBe(true);
  });
});
