import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zCreateProcedureRequest,
  zCreateProcedureStageRequest,
  zDeleteProcedureStageHeaders,
  zDeletedProcedureList,
  zProcedure,
  zRestoreWorkOrderProcedureHeaders,
} from '../src/zod.ts';

const V7 = '0198b0a0-0000-7000-8000-000000000001';
const OTHER = '0198b0a0-0000-7000-8000-000000000002';

describe('manual processes and stages in the contract (EVM-042; SR-AUTHZ-01, SR-AUTHZ-05, SR-INPUT-01, SR-API-02, SR-DATA-03)', () => {
  it('EVM-042 AC6 the seven operations are in the manifest: add and delete for Administrator and Editor, restore and the list of deleted ones for Administrator only — all on the web channel', () => {
    const editing = { roles: ['administrator', 'editor'], channels: ['web'], audit: true };
    const restoring = { roles: ['administrator'], channels: ['web'], audit: true };
    expect(AUTHZ_MANIFEST['createWorkOrderProcedure']).toMatchObject({
      method: 'post',
      path: '/api/v1/work-orders/{workOrderId}/procedures',
      authz: editing,
    });
    expect(AUTHZ_MANIFEST['createProcedureStage']).toMatchObject({
      method: 'post',
      path: '/api/v1/work-orders/{workOrderId}/procedures/{procedureId}/stages',
      authz: editing,
    });
    expect(AUTHZ_MANIFEST['deleteWorkOrderProcedure']).toMatchObject({
      method: 'delete',
      path: '/api/v1/work-orders/{workOrderId}/procedures/{procedureId}',
      authz: editing,
    });
    expect(AUTHZ_MANIFEST['deleteProcedureStage']).toMatchObject({
      method: 'delete',
      path: '/api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}',
      authz: editing,
    });
    expect(AUTHZ_MANIFEST['restoreWorkOrderProcedure']).toMatchObject({
      method: 'post',
      path: '/api/v1/work-orders/{workOrderId}/procedures/{procedureId}/restore',
      authz: restoring,
    });
    expect(AUTHZ_MANIFEST['restoreProcedureStage']).toMatchObject({
      method: 'post',
      path: '/api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}/restore',
      authz: restoring,
    });
    expect(AUTHZ_MANIFEST['listDeletedWorkOrderProcedures']).toEqual({
      method: 'get',
      path: '/api/v1/work-orders/{workOrderId}/deleted-procedures',
      query: [],
      authz: { roles: ['administrator'], channels: ['web'] },
    });
  });

  it('EVM-042 AC1 the request to add a process names the id and the template only; the place is 1..30 and the fields of the server are not part of it', () => {
    expect(zCreateProcedureRequest.safeParse({ id: V7, procedureTemplateId: OTHER }).success).toBe(true);
    expect(zCreateProcedureRequest.safeParse({ id: V7, procedureTemplateId: OTHER, position: 30 }).success).toBe(true);
    expect(zCreateProcedureRequest.safeParse({ id: V7, procedureTemplateId: OTHER, position: 0 }).success).toBe(false);
    expect(zCreateProcedureRequest.safeParse({ id: V7, procedureTemplateId: OTHER, position: 31 }).success).toBe(false);
    expect(zCreateProcedureRequest.safeParse({ id: V7 }).success).toBe(false);
    expect(zCreateProcedureRequest.safeParse({ procedureTemplateId: OTHER }).success).toBe(false);
    for (const field of ['code', 'name', 'stages', 'progress', 'version', 'sourceScopeItemId', 'currentStageId']) {
      expect(Object.keys(zCreateProcedureRequest.shape), field).not.toContain(field);
    }
  });

  it('EVM-042 AC2 the request to add a stage: name 1..120 characters, place 1..30, an optional day and an optional person; no code, status or version', () => {
    const base = { id: V7, name: 'Uzgodnienie terminu wyłączenia zasilania' };
    expect(zCreateProcedureStageRequest.safeParse(base).success).toBe(true);
    expect(zCreateProcedureStageRequest.safeParse({ ...base, position: 2, dueDate: '2026-10-30', responsibleUserId: OTHER }).success).toBe(
      true,
    );
    expect(zCreateProcedureStageRequest.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(zCreateProcedureStageRequest.safeParse({ ...base, name: 'a'.repeat(120) }).success).toBe(true);
    expect(zCreateProcedureStageRequest.safeParse({ ...base, name: 'a'.repeat(121) }).success).toBe(false);
    expect(zCreateProcedureStageRequest.safeParse({ ...base, position: 31 }).success).toBe(false);
    expect(zCreateProcedureStageRequest.safeParse({ ...base, dueDate: '30.10.2026' }).success).toBe(false);
    expect(zCreateProcedureStageRequest.safeParse({ ...base, responsibleUserId: 'not-a-uuid' }).success).toBe(false);
    expect(zCreateProcedureStageRequest.safeParse({ id: V7 }).success).toBe(false);
    for (const field of ['code', 'status', 'version', 'overdue', 'responsibleUser', 'waitingOn', 'completedOn']) {
      expect(Object.keys(zCreateProcedureStageRequest.shape), field).not.toContain(field);
    }
  });

  it('EVM-042 AC3 the delete and the restore need a strong If-Match; the Idempotency-Key is an optional UUIDv7', () => {
    for (const headers of [zDeleteProcedureStageHeaders, zRestoreWorkOrderProcedureHeaders]) {
      expect(headers.safeParse({ 'If-Match': '"3"' }).success).toBe(true);
      expect(headers.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': V7 }).success).toBe(true);
      expect(headers.safeParse({}).success).toBe(false);
      expect(headers.safeParse({ 'If-Match': 'W/"3"' }).success).toBe(false);
      expect(headers.safeParse({ 'If-Match': '*' }).success).toBe(false);
      expect(headers.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': 'abc' }).success).toBe(false);
    }
  });

  it('EVM-042 AC3 the list of deleted ones is bounded (100 of each kind) and carries ids, names, places and versions only', () => {
    const deletedAt = '2026-10-14T08:00:00.000Z';
    const process = { id: V7, code: 'fire_opinion', name: 'Opinia ppoż', position: 3, stageCount: 2, version: 4, deletedAt };
    const stage = {
      id: OTHER,
      procedureId: V7,
      procedureName: 'Opinia ppoż',
      name: 'Etap ręczny',
      position: 1,
      procedureDeleted: true,
      version: 2,
      deletedAt,
    };
    expect(zDeletedProcedureList.safeParse({ procedures: [process], stages: [stage], truncated: false }).success).toBe(true);
    expect(zDeletedProcedureList.safeParse({ procedures: [], stages: [], truncated: false }).success).toBe(true);
    expect(zDeletedProcedureList.safeParse({ procedures: Array(101).fill(process), stages: [], truncated: true }).success).toBe(false);
    expect(zDeletedProcedureList.safeParse({ procedures: [], stages: Array(101).fill(stage), truncated: true }).success).toBe(false);
    expect(zDeletedProcedureList.safeParse({ procedures: [], stages: [] }).success).toBe(false);
    // a deleted stage names no person, day, note or reason of a block
    expect(Object.keys(stage)).not.toEqual(expect.arrayContaining(['responsibleUser', 'dueDate', 'notes', 'blockedReason']));
  });

  it('EVM-042 AC3 the process carries a version for If-Match; it is not required, so an older answer still fits', () => {
    const procedure = { id: V7, code: 'fire_opinion', name: 'Opinia ppoż', position: 1, progress: { done: 0, total: 0 }, stages: [] };
    expect(zProcedure.safeParse(procedure).success).toBe(true);
    expect(zProcedure.safeParse({ ...procedure, version: 3 }).success).toBe(true);
    expect(zProcedure.safeParse({ ...procedure, version: 0 }).success).toBe(false);
  });
});
