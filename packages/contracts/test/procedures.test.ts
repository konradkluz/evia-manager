import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zListWorkOrderProceduresPath,
  zProcedureList,
  zProcedureStage,
  zProcedureStagePatch,
  zUpdateProcedureStageHeaders,
  zUpdateProcedureStagePath,
} from '../src/zod.ts';

const V7 = '0198b0a0-0000-7000-8000-000000000001';
const USER = '0198b0a0-0000-7000-8000-000000000002';
const stage = {
  id: V7,
  code: 'submit_request',
  name: 'Złożenie wniosku',
  position: 1,
  status: 'todo',
  dueDate: '2026-10-02',
  overdue: true,
  responsibleUser: { id: USER, displayName: 'Anna Testowa' },
  waitingOn: null,
  waitingParty: null,
  waitingSince: null,
  waitingDays: null,
  blockedReason: null,
  startedAt: null,
  completedOn: null,
  version: 1,
};

describe('procedures contract (EVM-031; SR-AUTHZ-01, SR-AUTHZ-04, SR-API-02, SR-API-07, SR-DATA-03)', () => {
  it('EVM-031 AC7 the read is open to the three roles, the change to Administrator and Editor with audit — both on the web channel only', () => {
    expect(AUTHZ_MANIFEST['listWorkOrderProcedures']).toMatchObject({
      method: 'get',
      path: '/api/v1/work-orders/{workOrderId}/procedures',
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'] },
    });
    expect(AUTHZ_MANIFEST['updateProcedureStage']).toMatchObject({
      method: 'patch',
      path: '/api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}',
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
  });

  it('EVM-031 AC6 the stage is addressed by the order AND the stage in the path — there is no operation with the stage alone', () => {
    const paths = Object.values(AUTHZ_MANIFEST).map((operation) => operation.path);
    expect(paths.filter((path) => path.includes('{stageId}'))).toEqual([
      '/api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}',
      '/api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}/transitions',
    ]);
    expect(zUpdateProcedureStagePath.safeParse({ workOrderId: V7, stageId: V7 }).success).toBe(true);
    expect(zUpdateProcedureStagePath.safeParse({ workOrderId: V7, stageId: 'x' }).success).toBe(false);
    expect(zUpdateProcedureStagePath.safeParse({ workOrderId: 'x', stageId: V7 }).success).toBe(false);
    expect(zListWorkOrderProceduresPath.safeParse({ workOrderId: 'x' }).success).toBe(false);
  });

  it('EVM-031 AC3 the change needs If-Match as a strong tag and takes an optional UUIDv7 Idempotency-Key', () => {
    const headers = zUpdateProcedureStageHeaders;
    expect(headers.safeParse({ 'If-Match': '"3"' }).success).toBe(true);
    expect(headers.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': V7 }).success).toBe(true);
    expect(headers.safeParse({}).success).toBe(false);
    expect(headers.safeParse({ 'If-Match': 'W/"3"' }).success).toBe(false);
    expect(headers.safeParse({ 'If-Match': '*' }).success).toBe(false);
    expect(headers.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': 'abc' }).success).toBe(false);
  });

  it('EVM-031 AC3 the patch names the person responsible and the due date only; both take null to clear', () => {
    expect(zProcedureStagePatch.safeParse({ responsibleUserId: USER, dueDate: '2026-10-09' }).success).toBe(true);
    expect(zProcedureStagePatch.safeParse({ responsibleUserId: null }).success).toBe(true);
    expect(zProcedureStagePatch.safeParse({ dueDate: null }).success).toBe(true);
    expect(zProcedureStagePatch.safeParse({ responsibleUserId: 'not-a-uuid' }).success).toBe(false);
    expect(zProcedureStagePatch.safeParse({ dueDate: '09.10.2026' }).success).toBe(false);
    expect(zProcedureStagePatch.safeParse({ dueDate: '2026-02-30' }).success).toBe(false);
    expect(zProcedureStagePatch.safeParse({ dueDate: 20261009 }).success).toBe(false);
    // the fields of the server are not part of the patch (the service answers read_only_field for them)
    for (const field of ['status', 'name', 'code', 'position', 'version', 'overdue', 'responsibleUser']) {
      expect(Object.keys(zProcedureStagePatch.shape), field).not.toContain(field);
    }
  });

  it('EVM-031 AC2 SR-DATA-03 a stage carries the person responsible as id and displayName only, and no notes or internal keys', () => {
    expect(zProcedureStage.safeParse(stage).success).toBe(true);
    expect(zProcedureStage.safeParse({ ...stage, dueDate: null, responsibleUser: null, overdue: false }).success).toBe(true);
    expect(zProcedureStage.safeParse({ ...stage, status: 'unknown' }).success).toBe(false);
    const parsed = zProcedureStage.parse({ ...stage, responsibleUser: { id: USER, displayName: 'A', email: 'a@example.invalid' } });
    expect(parsed.responsibleUser).toEqual({ id: USER, displayName: 'A' });
    for (const field of ['notes', 'waitingOnPartyId', 'workOrderId', 'procedureId']) {
      expect(Object.keys(zProcedureStage.shape), field).not.toContain(field);
    }
  });

  it('EVM-031 SR-API-02 the list is bounded: at most 30 processes and 30 stages in each', () => {
    const procedure = { id: V7, code: 'osd', name: 'Uzgodnienia z OSD', position: 1, progress: { done: 0, total: 1 }, stages: [stage] };
    expect(zProcedureList.safeParse({ items: [procedure], openStageCount: 1 }).success).toBe(true);
    expect(zProcedureList.safeParse({ items: [], openStageCount: 0 }).success).toBe(true);
    expect(zProcedureList.safeParse({ items: Array.from({ length: 31 }, () => procedure), openStageCount: 0 }).success).toBe(false);
    expect(
      zProcedureList.safeParse({ items: [{ ...procedure, stages: Array.from({ length: 31 }, () => stage) }], openStageCount: 0 }).success,
    ).toBe(false);
    expect(zProcedureList.safeParse({ items: [] }).success).toBe(false);
  });
});
