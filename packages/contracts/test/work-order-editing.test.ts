import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zAuditAction,
  zCreateScopeItemRequest,
  zCreateWorkOrderScopeItemHeaders,
  zProcedure,
  zScopeItem,
  zScopeItemAddition,
  zScopeItemList,
  zScopeItemPatch,
  zTimelineEvent,
  zUpdateWorkOrderHeaders,
  zUpdateWorkOrderScopeItemHeaders,
  zWorkOrderDetails,
  zWorkOrderPatch,
} from '../src/zod.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';

interface BundledParameter {
  readonly name: string;
  readonly in: string;
  readonly required?: boolean;
}
interface BundledOperation {
  readonly responses: Record<string, unknown>;
  readonly parameters?: ReadonlyArray<BundledParameter | { readonly $ref: string }>;
}
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, BundledOperation>>;
  components: {
    parameters: Record<string, BundledParameter>;
    schemas: Record<
      string,
      {
        additionalProperties?: unknown;
        properties?: Record<string, unknown>;
        required?: string[];
        minProperties?: number;
        maxItems?: number;
      }
    >;
  };
};
const ITEMS = '/api/v1/work-orders/{workOrderId}/scope-items';
const ITEM = `${ITEMS}/{scopeItemId}`;

describe('editing the data and the scope of an order — the contract (EVM-035; SR-AUTHZ-01, SR-AUTHZ-04, SR-INPUT-01, SR-API-02, SR-API-07)', () => {
  it('EVM-035 AC8 the five operations are for Administrator and Editor on the web channel (the read of one item also for Tylko odczyt) and the edits are audited', () => {
    expect(AUTHZ_MANIFEST['updateWorkOrder']).toEqual({
      method: 'patch',
      path: '/api/v1/work-orders/{workOrderId}',
      query: [],
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
    expect(AUTHZ_MANIFEST['createWorkOrderScopeItem']).toEqual({
      method: 'post',
      path: ITEMS,
      query: [],
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
    expect(AUTHZ_MANIFEST['getWorkOrderScopeItem']).toEqual({
      method: 'get',
      path: ITEM,
      query: [],
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'] },
    });
    expect(AUTHZ_MANIFEST['updateWorkOrderScopeItem']).toEqual({
      method: 'patch',
      path: ITEM,
      query: [],
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
    expect(AUTHZ_MANIFEST['deleteWorkOrderScopeItem']).toEqual({
      method: 'delete',
      path: ITEM,
      query: [],
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
  });

  it('EVM-035 AC1 AC8 the changes need If-Match (a strong tag) and take an optional UUIDv7 Idempotency-Key; the creation takes no If-Match', () => {
    const resolve = (parameter: BundledParameter | { readonly $ref: string }): BundledParameter =>
      '$ref' in parameter ? (bundled.components.parameters[parameter.$ref.split('/').pop() ?? ''] as BundledParameter) : parameter;
    const headers = (path: string, method: string) =>
      (bundled.paths[path]?.[method]?.parameters ?? [])
        .map(resolve)
        .filter((parameter) => parameter.in === 'header')
        .map((parameter) => [parameter.name, parameter.required ?? false]);
    expect(headers('/api/v1/work-orders/{workOrderId}', 'patch')).toEqual([
      ['If-Match', true],
      ['Idempotency-Key', false],
    ]);
    expect(headers(ITEM, 'patch')).toEqual([
      ['If-Match', true],
      ['Idempotency-Key', false],
    ]);
    expect(headers(ITEM, 'delete')).toEqual([
      ['If-Match', true],
      ['Idempotency-Key', false],
    ]);
    expect(headers(ITEMS, 'post')).toEqual([['Idempotency-Key', false]]);
    for (const schema of [zUpdateWorkOrderHeaders, zUpdateWorkOrderScopeItemHeaders]) {
      expect(schema.safeParse({ 'If-Match': '"3"' }).success).toBe(true);
      for (const weak of ['W/"3"', '*', '"3", "4"', '3', '"0"']) expect(schema.safeParse({ 'If-Match': weak }).success, weak).toBe(false);
    }
    expect(zCreateWorkOrderScopeItemHeaders.safeParse({ 'Idempotency-Key': 'abc' }).success).toBe(false);
  });

  it('EVM-035 AC1 AC5 AC6 every outcome is documented', () => {
    expect(Object.keys(bundled.paths['/api/v1/work-orders/{workOrderId}']?.['patch']?.responses ?? {}).sort()).toEqual(
      ['200', '400', '401', '403', '404', '409', '412', '413', '415', '422', '428', '429'].sort(),
    );
    expect(Object.keys(bundled.paths[ITEMS]?.['post']?.responses ?? {}).sort()).toEqual(
      ['201', '400', '401', '403', '404', '409', '413', '415', '422', '429'].sort(),
    );
    expect(Object.keys(bundled.paths[ITEM]?.['delete']?.responses ?? {}).sort()).toEqual(
      ['204', '400', '401', '403', '404', '409', '412', '422', '428', '429'].sort(),
    );
  });

  it('EVM-035 AC8 SR-AUTHZ-04 the patch of an order has no field of the server: number, status, customerId, siteId and version are not in it', () => {
    expect(Object.keys(zWorkOrderPatch.shape).sort()).toEqual(['assigneeUserId', 'description', 'plannedDate', 'title']);
    expect(bundled.components.schemas['WorkOrderPatch']?.additionalProperties).toBe(false);
    expect(bundled.components.schemas['WorkOrderPatch']?.minProperties).toBe(1);
    expect(zWorkOrderPatch.safeParse({ title: 'Nowy tytuł', description: null, plannedDate: null }).success).toBe(true);
    expect(zWorkOrderPatch.safeParse({ plannedDate: '2026-02-30' }).success).toBe(false);
    expect(zWorkOrderPatch.safeParse({ title: 'a'.repeat(201) }).success).toBe(false);
    expect(zWorkOrderPatch.safeParse({ assigneeUserId: 'x' }).success).toBe(false);
    expect(zWorkOrderPatch.safeParse({ title: null }).success).toBe(false);
  });

  it('EVM-035 AC2 AC4 AC8 the request of a new item names the catalogue code, not a name, a set or a position — and holds at most 30 distinct process codes', () => {
    expect(Object.keys(zCreateScopeItemRequest.shape).sort()).toEqual(['catalogItemCode', 'id', 'notes', 'parameters', 'procedureCodes']);
    expect(bundled.components.schemas['CreateScopeItemRequest']?.additionalProperties).toBe(false);
    expect(bundled.components.schemas['CreateScopeItemRequest']?.required).toEqual(['id', 'catalogItemCode']);
    const ok = (body: object) => zCreateScopeItemRequest.safeParse({ id: ID, catalogItemCode: 'supply_installation', ...body }).success;
    expect(ok({})).toBe(true);
    expect(
      ok({
        parameters: { dedicatedCircuit: true, cableLengthM: 18 },
        notes: 'Trasa przez garaż',
        procedureCodes: ['electrical_installation'],
      }),
    ).toBe(true);
    expect(ok({ catalogItemCode: 'Nope' })).toBe(false);
    expect(ok({ notes: 'a'.repeat(1001) })).toBe(false);
    expect(ok({ procedureCodes: Array.from({ length: 31 }, (_, index) => `process_${index}`) })).toBe(false);
    expect(
      zCreateScopeItemRequest.safeParse({ id: '0198b0a0-0000-4000-8000-000000000001', catalogItemCode: 'supply_installation' }).success,
    ).toBe(false);
  });

  it("EVM-035 AC4 AC8 the patch of an item changes the parameters and the notes only: code, name, set, position, quantity and version are the server's", () => {
    expect(Object.keys(zScopeItemPatch.shape).sort()).toEqual(['notes', 'parameters']);
    expect(bundled.components.schemas['ScopeItemPatch']?.additionalProperties).toBe(false);
    expect(bundled.components.schemas['ScopeItemPatch']?.minProperties).toBe(1);
    for (const field of ['code', 'name', 'parameterSetCode', 'position', 'quantity', 'version']) {
      expect(Object.keys(zScopeItem.shape), field).toContain(field);
      expect(Object.keys(zScopeItemPatch.shape), field).not.toContain(field);
    }
    expect(zScopeItemPatch.safeParse({ notes: null }).success).toBe(true);
    expect(zScopeItemPatch.safeParse({ parameters: { cableLengthM: 18 } }).success).toBe(true);
  });

  it('EVM-035 AC5 the list of the scope is bounded by the limit of the scope (50 items); an item carries its own version and the notes', () => {
    expect(bundled.components.schemas['ScopeItemList']?.properties?.['items']).toMatchObject({ maxItems: 50 });
    const item = {
      id: ID,
      position: 1,
      code: 'supply_installation',
      name: 'Instalacja zasilająca',
      parameterSetCode: 'supply_circuit',
      parameters: { dedicatedCircuit: true },
      quantity: 1,
      version: 3,
      notes: 'Uwaga',
    };
    expect(zScopeItem.parse(item)).toEqual(item);
    expect(zScopeItem.safeParse({ ...item, version: undefined }).success).toBe(false);
    expect(zScopeItem.safeParse({ ...item, notes: '' }).success).toBe(false);
    expect(zScopeItemList.safeParse({ items: Array.from({ length: 51 }, () => item) }).success).toBe(false);
    expect(zScopeItemAddition.parse({ item, addedProcedureCodes: ['electrical_installation'] }).addedProcedureCodes).toEqual([
      'electrical_installation',
    ]);
  });

  it('EVM-035 AC1 the header of an order carries the description and the planned date for the form of the edit', () => {
    expect(Object.keys(zWorkOrderDetails.shape)).toEqual(expect.arrayContaining(['description', 'plannedDate']));
    expect(bundled.components.schemas['WorkOrderDetails']?.required).not.toContain('description');
    expect(bundled.components.schemas['WorkOrderDetails']?.required).not.toContain('plannedDate');
  });

  it('EVM-035 AC3 a process names the scope item that brought it', () => {
    expect(Object.keys(zProcedure.shape)).toContain('sourceScopeItemId');
    expect(bundled.components.schemas['Procedure']?.required).not.toContain('sourceScopeItemId');
  });

  it('EVM-035 AC7 the event of the journal can carry the code of an item and the codes of processes, nothing with a value', () => {
    expect(Object.keys(zTimelineEvent.shape)).toEqual(expect.arrayContaining(['itemCode', 'procedureCodes', 'changedFields']));
    const event = {
      code: 'scope_item_added',
      objectType: 'scope_item',
      fromStatus: null,
      toStatus: null,
      waitingOn: null,
      waitingOnParty: null,
      changedFields: [],
      itemCode: 'supply_installation',
      procedureCodes: ['electrical_installation'],
    };
    expect(zTimelineEvent.parse(event)).toEqual(event);
    expect(zTimelineEvent.safeParse({ ...event, procedureCodes: Array.from({ length: 31 }, () => 'a_b') }).success).toBe(false);
  });

  it('EVM-035 AC8 SR-LOG-03 the audit trail knows the change of an order and the three changes of the scope, the removal of an item separately', () => {
    for (const action of ['work_order.updated', 'scope_item.created', 'scope_item.updated', 'scope_item.deleted']) {
      expect(zAuditAction.safeParse(action).success, action).toBe(true);
    }
  });
});
