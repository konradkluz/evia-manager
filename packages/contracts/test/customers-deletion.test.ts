import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zAnonymizeCustomerHeaders,
  zCustomer,
  zCustomerCard,
  zCustomerSearchRequest,
  zDeleteCustomerHeaders,
  zListCustomersQuery,
  zRestoreCustomerHeaders,
} from '../src/zod.ts';

interface Operation {
  responses: Record<string, { $ref?: string }>;
}
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, { properties: Record<string, unknown>; required?: string[] }> };
};
const V7 = '0198b0a0-0000-7000-8000-000000000001';

describe('deletion, restoration and anonymization of a customer (EVM-041; SR-AUTHZ-05, SR-DATA-08, SR-PRIV-04, SR-LOG-03)', () => {
  it('EVM-041 AC7 the three operations are Administrator-only on the web channel with audit; only the anonymization has a step-up', () => {
    expect(AUTHZ_MANIFEST['deleteCustomer']).toMatchObject({
      method: 'delete',
      path: '/api/v1/customers/{customerId}',
      authz: { roles: ['administrator'], channels: ['web'], audit: true, stepUp: false },
    });
    expect(AUTHZ_MANIFEST['restoreCustomer']).toMatchObject({
      method: 'post',
      path: '/api/v1/customers/{customerId}/restore',
      authz: { roles: ['administrator'], channels: ['web'], audit: true, stepUp: false },
    });
    expect(AUTHZ_MANIFEST['anonymizeCustomer']).toMatchObject({
      method: 'post',
      path: '/api/v1/customers/{customerId}/anonymize',
      authz: { roles: ['administrator'], channels: ['web'], audit: true, stepUp: true },
    });
  });

  it('EVM-041 AC2 AC5 the refusals are in the contract: 409 with the count, 412, 428, and 503 (the register for the anonymization)', () => {
    const paths = bundled.paths;
    const remove = paths['/api/v1/customers/{customerId}']?.['delete'];
    const anonymize = paths['/api/v1/customers/{customerId}/anonymize']?.['post'];
    const restore = paths['/api/v1/customers/{customerId}/restore']?.['post'];
    for (const operation of [remove, anonymize, restore]) {
      expect(Object.keys(operation?.responses ?? {})).toEqual(
        expect.arrayContaining(['400', '401', '403', '404', '409', '412', '428', '429']),
      );
    }
    expect(Object.keys(anonymize?.responses ?? {})).toContain('503');
    expect(Object.keys(remove?.responses ?? {})).toContain('503');
    expect(JSON.stringify(remove?.responses['503'])).not.toContain('DeletionRegisterUnavailable');
    expect(JSON.stringify(anonymize?.responses['503'])).toContain('DeletionRegisterUnavailable');
    expect(JSON.stringify(remove?.responses['409'])).toContain('CustomerHasActiveDependents');
    expect(JSON.stringify(anonymize?.responses['409'])).toContain('CustomerHasActiveDependents');
  });

  it('EVM-041 AC2 the problem carries the count of open work orders and nothing else about them', () => {
    const problem = bundled.components.schemas['Problem'];
    expect(Object.keys(problem?.properties ?? {})).toContain('openWorkOrders');
    expect(JSON.stringify(problem?.properties['openWorkOrders'])).toContain('integer');
  });

  it('EVM-041 AC7 the deletion and the restoration take If-Match and an optional UUIDv7 Idempotency-Key; the anonymization has no key', () => {
    const header = { 'If-Match': '"3"' };
    expect(zDeleteCustomerHeaders.safeParse({ ...header }).success).toBe(true);
    expect(zDeleteCustomerHeaders.safeParse({ ...header, 'Idempotency-Key': V7 }).success).toBe(true);
    expect(zDeleteCustomerHeaders.safeParse({ ...header, 'Idempotency-Key': 'not-a-key' }).success).toBe(false);
    expect(zRestoreCustomerHeaders.safeParse({ ...header, 'Idempotency-Key': V7 }).success).toBe(true);
    expect(zDeleteCustomerHeaders.safeParse({}).success).toBe(false);
    expect(Object.keys(zAnonymizeCustomerHeaders.shape)).toEqual(['If-Match']);
    expect(zAnonymizeCustomerHeaders.safeParse({ 'If-Match': '*' }).success).toBe(false);
  });

  it('EVM-041 AC1 the list and the search take the filter `deleted` (boolean in the body)', () => {
    expect(zListCustomersQuery.shape).toHaveProperty('deleted');
    expect(zCustomerSearchRequest.safeParse({ query: 'Jan', deleted: true }).success).toBe(true);
    expect(zCustomerSearchRequest.safeParse({ query: 'Jan', deleted: 'yes' }).success).toBe(false);
  });

  it('EVM-041 AC4 the customer has deletedAt and anonymizedAt as required nullable fields; the card of a work order has `anonymized`', () => {
    expect(bundled.components.schemas['Customer']?.required).toEqual(expect.arrayContaining(['deletedAt', 'anonymizedAt']));
    expect(Object.keys(zCustomer.shape)).toEqual(expect.arrayContaining(['deletedAt', 'anonymizedAt']));
    expect(Object.keys(zCustomerCard.shape)).toContain('anonymized');
  });
});
