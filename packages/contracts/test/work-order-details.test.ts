import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zCustomerCard,
  zGetWorkOrderPath,
  zListWorkOrderScopeItemsPath,
  zScopeItemList,
  zSiteCard,
  zWorkOrderDetails,
} from '../src/zod.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';
const OPERATIONS = ['getWorkOrder', 'listWorkOrderScopeItems', 'getWorkOrderCustomer', 'getWorkOrderSite'] as const;

interface BundledOperation {
  readonly responses: Record<string, unknown>;
  readonly parameters?: ReadonlyArray<{ readonly name: string; readonly schema?: { readonly format?: string } }>;
}
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, BundledOperation>>;
  components: { schemas: Record<string, { additionalProperties?: unknown; properties?: Record<string, unknown> }> };
};

describe('work order detail contract (EVM-018 AC1-AC6; SR-AUTHZ-01, SR-AUTHZ-12, SR-DATA-03)', () => {
  it('EVM-018 AC6 the four reads are GETs anchored in the order for the three roles on the web channel only, with no audit', () => {
    for (const operationId of OPERATIONS) {
      const operation = AUTHZ_MANIFEST[operationId];
      expect(operation?.method, operationId).toBe('get');
      expect(operation?.path, operationId).toContain('/api/v1/work-orders/{workOrderId}');
      expect(operation?.authz.roles, operationId).toEqual(['administrator', 'editor', 'read_only']);
      expect(operation?.authz.channels, operationId).toEqual(['web']);
      expect(operation?.authz.audit, operationId).toBeUndefined();
      expect(operation?.query, operationId).toEqual([]);
    }
  });

  it('EVM-018 AC3 the identifier is a UUID in the path, a malformed one is refused at the boundary and 404/400 are documented', () => {
    expect(zGetWorkOrderPath.safeParse({ workOrderId: ID }).success).toBe(true);
    expect(zListWorkOrderScopeItemsPath.safeParse({ workOrderId: 'not-a-uuid' }).success).toBe(false);
    for (const path of ['/api/v1/work-orders/{workOrderId}', '/api/v1/work-orders/{workOrderId}/customer']) {
      const responses = bundled.paths[path]?.['get']?.responses ?? {};
      expect(Object.keys(responses)).toEqual(expect.arrayContaining(['200', '400', '401', '403', '404']));
    }
  });

  it('EVM-018 AC5 every response schema is closed (additionalProperties false)', () => {
    for (const name of [
      'WorkOrderDetails',
      'ScopeItemList',
      'ScopeItem',
      'CustomerCard',
      'SiteCard',
      'SitePartyRef',
      'SiteSearchItem',
      'WorkOrderCoordinator',
      'WorkOrderCustomer',
    ]) {
      expect(bundled.components.schemas[name]?.additionalProperties, name).toBe(false);
    }
  });

  it('EVM-018 AC5 the customer card has the name, the telephone and the e-mail only; the parties of a site are {id, displayName}', () => {
    expect(Object.keys(zCustomerCard.shape).sort()).toEqual(['displayName', 'email', 'phone']);
    expect(Object.keys(bundled.components.schemas['SitePartyRef']?.properties ?? {}).sort()).toEqual(['displayName', 'id']);
    expect(zCustomerCard.safeParse({ displayName: 'Jan Przykładowy', phone: '+48600000001', email: null }).success).toBe(true);
    expect(zCustomerCard.safeParse({ displayName: 'Jan Przykładowy', phone: '+48600000001' }).success).toBe(false);
  });

  it('EVM-018 AC1 the site card carries the PPE, the power, the notes and the parties; the header carries none of them', () => {
    expect(Object.keys(zSiteCard.shape)).toEqual(
      expect.arrayContaining(['meteringPointId', 'connectionPowerKw', 'notes', 'distributionSystemOperator', 'manager']),
    );
    for (const secret of ['meteringPointId', 'connectionPowerKw', 'notes', 'phone', 'email', 'scopeItems']) {
      expect(Object.keys(zWorkOrderDetails.shape), secret).not.toContain(secret);
    }
  });

  it('EVM-018 AC2 the scope parameters are a flat bounded map of scalars (no free-form JSON)', () => {
    const parameters = bundled.components.schemas['DefaultParameters'] as {
      maxProperties?: number;
      additionalProperties?: { oneOf?: unknown[] };
    };
    expect(parameters.maxProperties).toBe(20);
    expect(parameters.additionalProperties?.oneOf).toHaveLength(3);
    expect(zScopeItemList.safeParse({ items: [] }).success).toBe(true);
  });
});
