import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zAuditAction,
  zTransitionWorkOrderHeaders,
  zTransitionWorkOrderPath,
  zTransitionWorkOrderRequest,
  zWorkOrderDetails,
  zWorkOrderStatus,
} from '../src/zod.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';

interface BundledOperation {
  readonly responses: Record<string, unknown>;
  readonly parameters?: ReadonlyArray<{ readonly name: string; readonly in: string; readonly required?: boolean }>;
}
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, BundledOperation>>;
  components: { schemas: Record<string, { additionalProperties?: unknown; properties?: Record<string, unknown>; required?: string[] }> };
};
const operation = bundled.paths['/api/v1/work-orders/{workOrderId}/transitions']?.['post'];

describe('work order transition contract (EVM-030 AC1–AC5, AC7; SR-AUTHZ-01, SR-AUTHZ-04, SR-AUTHZ-12, SR-API-07, SR-DATA-01)', () => {
  it('EVM-030 AC7 transitionWorkOrder is a POST for Administrator and Editor on the web channel only, with audit and the table of transitions — and no operation-level step-up (the restoration is decided by the use case)', () => {
    expect(AUTHZ_MANIFEST['transitionWorkOrder']).toEqual({
      method: 'post',
      path: '/api/v1/work-orders/{workOrderId}/transitions',
      query: [],
      authz: { roles: ['administrator', 'editor'], channels: ['web'], stepUp: false, transitions: 'workOrderStatus', audit: true },
    });
  });

  it('EVM-030 AC5 the command needs If-Match (required, a strong tag) and takes an optional Idempotency-Key (UUIDv7); the path id is a UUID', () => {
    const headers = (operation?.parameters ?? []).filter((parameter) => parameter.in === 'header');
    expect(headers.map((parameter) => [parameter.name, parameter.required ?? false])).toEqual([
      ['If-Match', true],
      ['Idempotency-Key', false],
    ]);
    expect(zTransitionWorkOrderHeaders.safeParse({ 'If-Match': '"3"' }).success).toBe(true);
    for (const weak of ['W/"3"', '*', '"3", "4"', '3', '"0"', '"abc"']) {
      expect(zTransitionWorkOrderHeaders.safeParse({ 'If-Match': weak }).success, weak).toBe(false);
    }
    expect(zTransitionWorkOrderHeaders.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': ID }).success).toBe(true);
    expect(
      zTransitionWorkOrderHeaders.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': '0198b0a0-0000-4000-8000-000000000002' }).success,
    ).toBe(false);
    expect(zTransitionWorkOrderPath.safeParse({ workOrderId: ID }).success).toBe(true);
    expect(zTransitionWorkOrderPath.safeParse({ workOrderId: 'nie-uuid' }).success).toBe(false);
  });

  it('EVM-030 AC5 AC7 every outcome of the command is documented: 200, 400, 401, 403, 404, 409, 412, 413, 415, 422, 428, 429', () => {
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
      ['200', '400', '401', '403', '404', '409', '412', '413', '415', '422', '428', '429'].sort(),
    );
  });

  it('EVM-030 AC4 the 403 documents step_up_required and the 422 documents transition_condition_not_met (and the 409 invalid_state_transition)', () => {
    const text = (name: string) =>
      JSON.stringify(
        (JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as { components: { responses: Record<string, unknown> } }).components
          .responses[name],
      );
    expect(text('TransitionForbidden')).toContain('step_up_required');
    expect(text('TransitionForbidden')).toContain('forbidden');
    expect(text('TransitionUnprocessable')).toContain('transition_condition_not_met');
    expect(text('TransitionConflict')).toContain('invalid_state_transition');
    expect(text('PreconditionFailed')).toContain('version_conflict');
    expect(text('PreconditionRequired')).toContain('precondition_required');
  });

  it('EVM-030 AC1 AC2 the body is {to, reason?, completedOn?}: `to` is one of the eight statuses, nothing else is accepted', () => {
    expect(Object.keys(zTransitionWorkOrderRequest.shape).sort()).toEqual(['completedOn', 'reason', 'to']);
    expect(bundled.components.schemas['TransitionWorkOrderRequest']?.additionalProperties).toBe(false);
    expect(bundled.components.schemas['TransitionWorkOrderRequest']?.required).toEqual(['to']);
    for (const to of zWorkOrderStatus.options) expect(zTransitionWorkOrderRequest.safeParse({ to }).success, to).toBe(true);
    expect(zTransitionWorkOrderRequest.safeParse({ to: 'archived' }).success).toBe(false);
    expect(zTransitionWorkOrderRequest.safeParse({}).success).toBe(false);
  });

  it('EVM-030 AC2 the reason is at most 500 characters and the completion day is a date, not a date-time', () => {
    expect(zTransitionWorkOrderRequest.safeParse({ to: 'on_hold', reason: 'a'.repeat(500) }).success).toBe(true);
    expect(zTransitionWorkOrderRequest.safeParse({ to: 'on_hold', reason: 'a'.repeat(501) }).success).toBe(false);
    expect(zTransitionWorkOrderRequest.safeParse({ to: 'completed', completedOn: '2026-10-08' }).success).toBe(true);
    expect(zTransitionWorkOrderRequest.safeParse({ to: 'completed', completedOn: '2026-10-08T10:00:00Z' }).success).toBe(false);
  });

  it("EVM-030 AC5 the fields of the server are not in the command: status, resumeStatus, closedAt and statusChangedAt are the server's (the answer has them, the request has none)", () => {
    for (const serverField of ['status', 'resumeStatus', 'closedAt', 'statusChangedAt']) {
      expect(Object.keys(zWorkOrderDetails.shape), serverField).toContain(serverField);
      expect(Object.keys(zTransitionWorkOrderRequest.shape), serverField).not.toContain(serverField);
    }
  });

  it('EVM-030 AC1 AC7 the order carries allowedTransitions for the caller (required, at most eight statuses) and the life cycle fields, and never the reason (SR-DATA-01)', () => {
    const details = bundled.components.schemas['WorkOrderDetails'];
    expect(details?.required).toContain('allowedTransitions');
    expect(Object.keys(details?.properties ?? {})).toEqual(
      expect.arrayContaining(['allowedTransitions', 'resumeStatus', 'statusChangedAt', 'closedAt', 'completedOn']),
    );
    for (const secret of ['reason', 'statusReason']) expect(Object.keys(zWorkOrderDetails.shape), secret).not.toContain(secret);
    expect(details?.additionalProperties).toBe(false);
  });

  it('EVM-030 AC3 AC4 the audit trail knows the cancellation and the restoration', () => {
    expect(zAuditAction.options).toEqual(expect.arrayContaining(['work_order.created', 'work_order.cancelled', 'work_order.restored']));
  });
});
