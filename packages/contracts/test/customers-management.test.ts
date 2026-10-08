import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zCustomer,
  zCustomerList,
  zCustomerPatch,
  zCustomerSearchRequest,
  zListCustomersQuery,
  zListWorkOrdersQuery,
  zUpdateCustomerHeaders,
  zUpdateCustomerPath,
} from '../src/zod.ts';

const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  components: { schemas: Record<string, { properties: Record<string, { description?: string }> }> };
};
const V7 = '0198b0a0-0000-7000-8000-000000000001';
const item = { id: V7, kind: 'person', displayName: 'Jan Przykładowy', sortName: 'Przykładowy Jan', phone: '+48600000001', email: null };

describe('customers list, detail and edit contract (EVM-039; SR-API-04, SR-AUTHZ-04, SR-AUTHZ-05, SR-DATA-03)', () => {
  it('EVM-039 AC7 the three operations are in the manifest: list and detail for the three roles, the edit for Administrator and Editor with audit', () => {
    expect(AUTHZ_MANIFEST['listCustomers']).toMatchObject({
      method: 'get',
      path: '/api/v1/customers',
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'], audit: false },
    });
    expect(AUTHZ_MANIFEST['getCustomer']).toMatchObject({
      method: 'get',
      path: '/api/v1/customers/{customerId}',
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'], audit: false },
    });
    expect(AUTHZ_MANIFEST['updateCustomer']).toMatchObject({
      method: 'patch',
      path: '/api/v1/customers/{customerId}',
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
  });

  it('EVM-039 AC1 the list takes limit and cursor only (no phrase, no sort in the URL); the search takes them in the body', () => {
    expect([...(AUTHZ_MANIFEST['listCustomers']?.query ?? [])].sort()).toEqual(['cursor', 'limit']);
    expect(zListCustomersQuery.safeParse({ limit: 100 }).success).toBe(true);
    expect(zListCustomersQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(zCustomerSearchRequest.safeParse({ query: 'lodz' }).data?.limit).toBe(25);
    expect(zCustomerSearchRequest.safeParse({ query: 'lodz', cursor: 'abc_-', limit: 5 }).success).toBe(true);
    expect(zCustomerSearchRequest.safeParse({ query: 'lodz', cursor: 'a b' }).success).toBe(false);
  });

  it('EVM-039 AC1 the list item has the columns of W-14 and nothing else of the customer; the cursor is an opaque string or null', () => {
    expect(zCustomerList.safeParse({ items: [item], nextCursor: null }).success).toBe(true);
    expect(zCustomerList.safeParse({ items: [{ ...item, email: 'jan@example.test' }], nextCursor: 'x'.repeat(512) }).success).toBe(true);
    expect(zCustomerList.safeParse({ items: [item], nextCursor: 'x'.repeat(513) }).success).toBe(false);
    expect(zCustomerList.safeParse({ items: [{ ...item, kind: 'robot' }], nextCursor: null }).success).toBe(false);
    expect(Object.keys(zCustomerList.shape.items.element.shape).sort()).toEqual([
      'displayName',
      'email',
      'id',
      'kind',
      'phone',
      'sortName',
    ]);
  });

  it('EVM-039 AC3 the edit needs If-Match (a strong tag) and takes an optional Idempotency-Key UUIDv7; the path is a UUID', () => {
    expect(zUpdateCustomerHeaders.safeParse({ 'If-Match': '"3"' }).success).toBe(true);
    expect(zUpdateCustomerHeaders.safeParse({}).success).toBe(false);
    expect(zUpdateCustomerHeaders.safeParse({ 'If-Match': 'W/"3"' }).success).toBe(false);
    expect(zUpdateCustomerHeaders.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': '0198b0a0-0000-4000-8000-000000000001' }).success).toBe(
      false,
    );
    expect(zUpdateCustomerPath.safeParse({ customerId: V7 }).success).toBe(true);
    expect(zUpdateCustomerPath.safeParse({ customerId: 'abc' }).success).toBe(false);
  });

  it('EVM-039 AC3 the patch is a merge-patch: every field optional, the optional ones of the customer clearable with null, the telephone not', () => {
    expect(zCustomerPatch.safeParse({}).success).toBe(true);
    expect(
      zCustomerPatch.safeParse({
        phone: '600 000 002',
        email: null,
        notes: null,
        taxId: null,
        contactPersonName: null,
        postalAddress: null,
      }).success,
    ).toBe(true);
    expect(zCustomerPatch.safeParse({ phone: null }).success).toBe(false);
    expect(zCustomerPatch.safeParse({ lastName: null }).success).toBe(false);
    expect(zCustomerPatch.safeParse({ notes: 'a'.repeat(2001) }).success).toBe(false);
    const address = { street: 'Piotrkowska', buildingNumber: '1', postalCode: '90-001', city: 'Łódź' };
    expect(zCustomerPatch.safeParse({ postalAddress: address }).success).toBe(true);
    expect(zCustomerPatch.safeParse({ postalAddress: { street: 'Piotrkowska' } }).success).toBe(false);
  });

  it('EVM-039 AC4 the fields of the server are in the customer and not in the patch (the list the validation derives, `id` included)', () => {
    const readOnly = Object.keys(zCustomer.shape).filter((key) => !(key in zCustomerPatch.shape));
    expect(readOnly.sort()).toEqual(
      [
        'createdAt',
        'createdBy',
        'deletedAt',
        'deletedBy',
        'displayName',
        'id',
        'searchText',
        'sortName',
        'updatedAt',
        'updatedBy',
        'version',
      ].sort(),
    );
  });

  it('EVM-039 AC4 the notes of the contract carry the warning not to write a PESEL', () => {
    expect(bundled.components.schemas['Customer']?.properties['notes']?.description ?? '').toMatch(/PESEL/);
    expect(bundled.components.schemas['CustomerPatch']?.properties['notes']?.description ?? '').toMatch(/PESEL/);
  });

  it('EVM-039 AC2 the list of work orders takes customerId (a UUID) for the history of a customer', () => {
    expect(zListWorkOrdersQuery.safeParse({ customerId: V7 }).success).toBe(true);
    expect(zListWorkOrdersQuery.safeParse({ customerId: 'abc' }).success).toBe(false);
  });
});
