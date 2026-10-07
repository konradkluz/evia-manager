import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import { zCreateCustomerHeaders, zCustomer, zCustomerSearchResult, zCustomerWritable } from '../src/zod.ts';

const V7 = '0198b0a0-0000-7000-8000-000000000001';
const person = { id: V7, kind: 'person', firstName: 'Jan', lastName: 'Przykładowy', phone: '600 000 001' };

describe('customers contract (EVM-020 AC1, AC2, AC5, AC7; SR-API-04, SR-AUTHZ-04, SR-AUTHZ-05)', () => {
  it('EVM-020 AC7 searchCustomers is a POST for the three roles on the web channel, createCustomer one for Administrator and Editor with audit', () => {
    expect(AUTHZ_MANIFEST['searchCustomers']).toMatchObject({
      method: 'post',
      path: '/api/v1/customers/search',
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'], audit: false },
    });
    expect(AUTHZ_MANIFEST['createCustomer']).toMatchObject({
      method: 'post',
      path: '/api/v1/customers',
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
  });

  it('EVM-020 AC1 the search phrase is not a parameter of the URL: the operation declares no query parameter', () => {
    expect(AUTHZ_MANIFEST['searchCustomers']?.query).toEqual([]);
    expect(AUTHZ_MANIFEST['createCustomer']?.query).toEqual([]);
  });

  it('EVM-020 AC5 the fields of the server are readOnly: they are in the resource and not in the input (the list the validation uses)', () => {
    const readOnly = Object.keys(zCustomer.shape).filter((key) => !(key in zCustomerWritable.shape));
    expect(readOnly.sort()).toEqual(
      [
        'createdAt',
        'createdBy',
        'deletedAt',
        'deletedBy',
        'displayName',
        'searchText',
        'sortName',
        'updatedAt',
        'updatedBy',
        'version',
      ].sort(),
    );
  });

  it('EVM-020 AC4 the id and the Idempotency-Key are UUIDv7 (another version is refused at the boundary, not by a CHECK of the database)', () => {
    expect(zCustomerWritable.safeParse(person).success).toBe(true);
    expect(zCustomerWritable.safeParse({ ...person, id: '0198b0a0-0000-4000-8000-000000000001' }).success).toBe(false);
    expect(zCreateCustomerHeaders.safeParse({ 'Idempotency-Key': V7 }).success).toBe(true);
    expect(zCreateCustomerHeaders.safeParse({}).success).toBe(true);
    expect(zCreateCustomerHeaders.safeParse({ 'Idempotency-Key': '0198b0a0-0000-4000-8000-000000000001' }).success).toBe(false);
  });

  it('EVM-020 AC2 the postal address needs street, building number, postal code (00-000) and city together', () => {
    const address = { street: 'Piotrkowska', buildingNumber: '1', postalCode: '90-001', city: 'Łódź' };
    expect(zCustomerWritable.safeParse({ ...person, postalAddress: address }).success).toBe(true);
    expect(zCustomerWritable.safeParse({ ...person, postalAddress: { ...address, postalCode: '90001' } }).success).toBe(false);
    expect(zCustomerWritable.safeParse({ ...person, postalAddress: { street: 'Piotrkowska' } }).success).toBe(false);
  });

  it('EVM-020 AC5 every text is bounded: a name over 200 characters is refused', () => {
    expect(zCustomerWritable.safeParse({ ...person, lastName: 'a'.repeat(201) }).success).toBe(false);
    expect(zCustomerWritable.safeParse({ ...person, notes: 'a'.repeat(2001) }).success).toBe(false);
  });

  it('EVM-020 AC1 the search result is a list envelope with a null cursor and at most 20 items', () => {
    expect(zCustomerSearchResult.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(zCustomerSearchResult.safeParse([]).success).toBe(false);
    const item = { id: V7, displayName: 'Jan Przykładowy', phone: '+48600000001' };
    expect(zCustomerSearchResult.safeParse({ items: Array.from({ length: 21 }, () => item), nextCursor: null }).success).toBe(false);
  });
});
