import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zAuditAction,
  zProcedureStage,
  zProcedureStagePatch,
  zStageStatus,
  zTransitionProcedureStageHeaders,
  zTransitionProcedureStagePath,
  zTransitionProcedureStageRequest,
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
const operation = bundled.paths['/api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}/transitions']?.['post'];

describe('stage transition contract (EVM-032 AC1–AC7; SR-AUTHZ-01, SR-AUTHZ-05, SR-API-07, SR-INPUT-01, SR-DATA-02)', () => {
  it('EVM-032 AC7 transitionProcedureStage is a POST for Administrator and Editor on the web channel only, audited, with the graph procedureStageStatus', () => {
    expect(AUTHZ_MANIFEST['transitionProcedureStage']).toEqual({
      method: 'post',
      path: '/api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}/transitions',
      query: [],
      authz: { roles: ['administrator', 'editor'], channels: ['web'], stepUp: false, transitions: 'procedureStageStatus', audit: true },
    });
  });

  it('EVM-032 AC6 the command needs If-Match (a strong tag) and takes an optional UUIDv7 Idempotency-Key; both ids of the path are UUIDs', () => {
    const headers = (operation?.parameters ?? []).filter((parameter) => parameter.in === 'header');
    expect(headers.map((parameter) => [parameter.name, parameter.required ?? false])).toEqual([
      ['If-Match', true],
      ['Idempotency-Key', false],
    ]);
    expect(zTransitionProcedureStageHeaders.safeParse({ 'If-Match': '"3"' }).success).toBe(true);
    for (const weak of ['W/"3"', '*', '"3", "4"', '3', '"0"']) {
      expect(zTransitionProcedureStageHeaders.safeParse({ 'If-Match': weak }).success, weak).toBe(false);
    }
    expect(zTransitionProcedureStageHeaders.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': 'abc' }).success).toBe(false);
    expect(zTransitionProcedureStagePath.safeParse({ workOrderId: ID, stageId: ID }).success).toBe(true);
    expect(zTransitionProcedureStagePath.safeParse({ workOrderId: ID, stageId: 'x' }).success).toBe(false);
    expect(zTransitionProcedureStagePath.safeParse({ workOrderId: 'x', stageId: ID }).success).toBe(false);
  });

  it('EVM-032 AC6 AC7 every outcome is documented: 200, 400, 401, 403, 404, 409, 412, 413, 415, 422, 428, 429', () => {
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
      ['200', '400', '401', '403', '404', '409', '412', '413', '415', '422', '428', '429'].sort(),
    );
  });

  it('EVM-032 AC1 AC2 AC4 the body is strict: to (one of the six statuses) and the fields of the transition, nothing else', () => {
    expect(Object.keys(zTransitionProcedureStageRequest.shape).sort()).toEqual(
      ['blockedReason', 'completedOn', 'to', 'waitingOn', 'waitingOnPartyId', 'waitingSince'].sort(),
    );
    expect(bundled.components.schemas['TransitionProcedureStageRequest']?.additionalProperties).toBe(false);
    expect(bundled.components.schemas['TransitionProcedureStageRequest']?.required).toEqual(['to']);
    for (const to of zStageStatus.options) expect(zTransitionProcedureStageRequest.safeParse({ to }).success, to).toBe(true);
    expect(zTransitionProcedureStageRequest.safeParse({ to: 'archived' }).success).toBe(false);
    expect(zTransitionProcedureStageRequest.safeParse({}).success).toBe(false);
    expect(zTransitionProcedureStageRequest.safeParse({ to: 'waiting', waitingOn: 'nobody' }).success).toBe(false);
  });

  it('EVM-032 AC2 AC4 the dates are dates (not date-times, no 30th of February) and the reason is at most 500 characters', () => {
    const ok = (body: object) => zTransitionProcedureStageRequest.safeParse(body).success;
    expect(ok({ to: 'waiting', waitingOn: 'customer', waitingSince: '2026-10-09' })).toBe(true);
    expect(ok({ to: 'waiting', waitingOn: 'customer', waitingSince: '2026-02-30' })).toBe(false);
    expect(ok({ to: 'waiting', waitingOn: 'customer', waitingSince: '2026-10-09T10:00:00Z' })).toBe(false);
    expect(ok({ to: 'done', completedOn: '2026-10-09' })).toBe(true);
    expect(ok({ to: 'done', completedOn: '09.10.2026' })).toBe(false);
    expect(ok({ to: 'blocked', blockedReason: 'a'.repeat(500) })).toBe(true);
    expect(ok({ to: 'blocked', blockedReason: 'a'.repeat(501) })).toBe(false);
    expect(ok({ to: 'waiting', waitingOn: 'party', waitingOnPartyId: 'not-a-uuid' })).toBe(false);
  });

  it("EVM-032 AC6 the fields of the server are not in the command: status, version, waitingParty, waitingDays and startedAt are the server's", () => {
    for (const serverField of ['status', 'version', 'waitingParty', 'waitingDays', 'startedAt']) {
      expect(Object.keys(zProcedureStage.shape), serverField).toContain(serverField);
      expect(Object.keys(zTransitionProcedureStageRequest.shape), serverField).not.toContain(serverField);
    }
  });

  it('EVM-032 AC3 the patch can change the party waited for (waitingOn, waitingOnPartyId, waitingSince), but never the status or the reason of a block', () => {
    expect(Object.keys(zProcedureStagePatch.shape)).toEqual(
      expect.arrayContaining(['responsibleUserId', 'dueDate', 'waitingOn', 'waitingOnPartyId', 'waitingSince']),
    );
    for (const field of ['status', 'blockedReason', 'completedOn', 'startedAt', 'waitingParty', 'waitingDays']) {
      expect(Object.keys(zProcedureStagePatch.shape), field).not.toContain(field);
    }
  });

  it('EVM-032 AC2 SR-DATA-02 the party waited for is { id, displayName } and nothing else', () => {
    const stage = {
      id: ID,
      code: 'conditions',
      name: 'Warunki przyłączenia',
      position: 1,
      status: 'waiting',
      dueDate: null,
      overdue: false,
      responsibleUser: null,
      waitingOn: 'party',
      waitingParty: { id: ID, displayName: 'Operator Syntetyczny', phone: '+48000000000', email: 'x@example.invalid' },
      waitingSince: '2026-09-18',
      waitingDays: 15,
      blockedReason: null,
      startedAt: null,
      completedOn: null,
      version: 2,
    };
    expect(zProcedureStage.parse(stage).waitingParty).toEqual({ id: ID, displayName: 'Operator Syntetyczny' });
  });

  it('EVM-032 AC7 the audit trail knows the transition', () => {
    expect(zAuditAction.options).toContain('procedure_stage.transitioned');
  });
});
