import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zParty,
  zPartyPatch,
  zSite,
  zSiteCard,
  zSiteOrders,
  zSitePatch,
  zUpdatePartyHeaders,
  zUpdatePartyPath,
  zUpdateSiteHeaders,
  zUpdateSitePath,
} from '../src/zod.ts';

const V7 = '0198b0a0-0000-7000-8000-000000000001';
const order = { id: V7, number: 'ZL-2026-0017', title: 'Montaż', status: 'settled', closedAt: '2026-09-01T10:00:00.000Z' };

describe('site and party editing contract (EVM-036; SR-AUTHZ-01, SR-AUTHZ-04, SR-AUTHZ-08, SR-API-07)', () => {
  it('EVM-036 AC7 reading is open to the three roles, the edits to Administrator and Editor with audit — all on the web channel only', () => {
    for (const [operation, path] of [
      ['getSite', '/api/v1/sites/{siteId}'],
      ['getParty', '/api/v1/parties/{partyId}'],
    ] as const)
      expect(AUTHZ_MANIFEST[operation], operation).toMatchObject({
        method: 'get',
        path,
        authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'], audit: false },
      });
    for (const [operation, path] of [
      ['updateSite', '/api/v1/sites/{siteId}'],
      ['updateParty', '/api/v1/parties/{partyId}'],
    ] as const)
      expect(AUTHZ_MANIFEST[operation], operation).toMatchObject({
        method: 'patch',
        path,
        authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
      });
  });

  it('EVM-036 AC5 AC6 the other orders of a site are a read of the order: no siteId anywhere in the path or the query, panel only', () => {
    expect(AUTHZ_MANIFEST['listWorkOrderSiteOrders']).toMatchObject({
      method: 'get',
      path: '/api/v1/work-orders/{workOrderId}/site-orders',
      query: [],
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'] },
    });
    const paths = [...new Set(Object.values(AUTHZ_MANIFEST).map((operation) => operation.path))];
    expect(paths.filter((path) => /\{siteId\}\/(media|documents|work-orders|customers|orders)/.test(path))).toEqual([]);
    expect(paths.filter((path) => path.includes('{siteId}'))).toEqual(['/api/v1/sites/{siteId}']);
  });

  it('EVM-036 AC7 the edits need If-Match as a strong tag and take an optional UUIDv7 Idempotency-Key', () => {
    for (const headers of [zUpdateSiteHeaders, zUpdatePartyHeaders]) {
      expect(headers.safeParse({ 'If-Match': '"3"' }).success).toBe(true);
      expect(headers.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': V7 }).success).toBe(true);
      expect(headers.safeParse({}).success).toBe(false);
      expect(headers.safeParse({ 'If-Match': 'W/"3"' }).success).toBe(false);
      expect(headers.safeParse({ 'If-Match': '*' }).success).toBe(false);
      expect(headers.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': 'abc' }).success).toBe(false);
    }
    expect(zUpdateSitePath.safeParse({ siteId: V7 }).success).toBe(true);
    expect(zUpdateSitePath.safeParse({ siteId: 'x' }).success).toBe(false);
    expect(zUpdatePartyPath.safeParse({ partyId: V7 }).success).toBe(true);
    expect(zUpdatePartyPath.safeParse({ partyId: 'x' }).success).toBe(false);
  });

  it('EVM-036 AC7 the patch of a site: optional fields take null, required ones do not; the bounds are those of the creation', () => {
    expect(zSitePatch.safeParse({}).success).toBe(true);
    expect(zSitePatch.safeParse({ meteringPointId: null, connectionPowerKw: null, notes: null, managerPartyId: null }).success).toBe(true);
    for (const field of ['siteType', 'street', 'buildingNumber', 'postalCode', 'city'])
      expect(zSitePatch.safeParse({ [field]: null }).success, field).toBe(false);
    expect(zSitePatch.safeParse({ postalCode: '00001' }).success).toBe(false);
    expect(zSitePatch.safeParse({ connectionPowerKw: 0 }).success).toBe(false);
    expect(zSitePatch.safeParse({ connectionPowerKw: 1000.01 }).success).toBe(false);
    expect(zSitePatch.safeParse({ meteringPointId: 'P'.repeat(41) }).success).toBe(false);
    expect(zSitePatch.safeParse({ notes: 'n'.repeat(2001) }).success).toBe(false);
    expect(zSitePatch.safeParse({ managerPartyId: 'not-a-uuid' }).success).toBe(false);
  });

  it('EVM-036 AC7 the fields of the server are not in the patches, so naming one is read_only_field (the list the validation derives)', () => {
    expect(Object.keys(zSite.shape).filter((key) => !(key in zSitePatch.shape))).toEqual(
      expect.arrayContaining(['id', 'version', 'createdAt', 'updatedAt', 'searchText']),
    );
    expect(Object.keys(zParty.shape).filter((key) => !(key in zPartyPatch.shape))).toEqual(
      expect.arrayContaining(['id', 'kind', 'version', 'createdAt', 'updatedAt', 'searchText']),
    );
    expect('customerId' in zSitePatch.shape).toBe(false);
  });

  it('EVM-036 AC3 the patch of a party: the kind is immutable, optional contacts take null, the name does not', () => {
    expect('kind' in zPartyPatch.shape).toBe(false);
    expect(zPartyPatch.safeParse({ phone: null, email: null, notes: null, contactPersonName: null }).success).toBe(true);
    expect(zPartyPatch.safeParse({ displayName: null }).success).toBe(false);
    expect(zPartyPatch.safeParse({ legalForm: null }).success).toBe(false);
    expect(zPartyPatch.safeParse({ legalForm: 'person' }).success).toBe(false);
    expect(zPartyPatch.safeParse({ displayName: 'a'.repeat(201) }).success).toBe(false);
    expect(zPartyPatch.safeParse({ phone: '1'.repeat(33) }).success).toBe(false);
  });

  it('EVM-036 AC5 the other orders carry only id, number, title, status and closedAt — at most 20 of them, and nothing else', () => {
    expect(zSiteOrders.safeParse({ total: 0, items: [] }).success).toBe(true);
    expect(zSiteOrders.safeParse({ total: 1, items: [order] }).success).toBe(true);
    expect(zSiteOrders.safeParse({ total: 1, items: [{ id: V7, number: 'ZL-2026-0017', title: 'x', status: 'new' }] }).success).toBe(true);
    expect(zSiteOrders.safeParse({ total: 25, items: Array.from({ length: 21 }, () => order) }).success).toBe(false);
    expect(zSiteOrders.safeParse({ total: -1, items: [] }).success).toBe(false);
    expect(Object.keys(zSiteOrders.shape.items.element.shape).sort()).toEqual(['closedAt', 'id', 'number', 'status', 'title']);
    expect(Object.keys(zSiteOrders.shape).sort()).toEqual(['items', 'total']);
  });

  it('EVM-036 AC1 the card of the site names the site: its siteId is required', () => {
    const card = {
      siteId: V7,
      siteType: 'other',
      street: 'ul. Testowa',
      buildingNumber: '7',
      postalCode: '00-001',
      city: 'Warszawa',
      distributionSystemOperator: null,
      manager: null,
    };
    expect(zSiteCard.safeParse(card).success).toBe(true);
    expect(zSiteCard.safeParse({ ...card, siteId: undefined }).success).toBe(false);
  });
});
