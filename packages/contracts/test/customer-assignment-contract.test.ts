import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zAssignWorkOrderCustomerHeaders,
  zAssignWorkOrderCustomerPath,
  zAssignWorkOrderCustomerRequest,
  zAuditAction,
} from '../src/zod.ts';

/**
 * The assignment of a customer to a site survey in the contract (EVM-136; ADR-0024 pt 3; SR-AUTHZ-05, SR-API-05). Synthetic identifiers only.
 */
const CUSTOMER = '0198b0a0-0000-4000-8000-000000000136';
const KEY = '0198b0a0-0000-7000-8000-000000000136';

interface Answer {
  readonly $ref?: string;
  readonly content?: Record<string, { readonly example?: { readonly code?: string } }>;
}
interface BundledOperation {
  readonly description?: string;
  readonly responses: Record<string, Answer>;
}
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, BundledOperation>>;
  components: { responses: Record<string, Answer> };
};
const assignment = bundled.paths['/api/v1/work-orders/{workOrderId}/customer']?.['put'];
const problemOf = (status: string): string | undefined => {
  const ref = assignment?.responses[status]?.$ref?.split('/').pop() ?? '';
  return bundled.components.responses[ref]?.content?.['application/problem+json']?.example?.code;
};

describe('the assignment of a customer in the contract (EVM-136 AC1-AC3)', () => {
  it('EVM-136 AC3 assignWorkOrderCustomer is for the Administrator and the Editor on the web channel, with audit, and shares the path with the read of the card', () => {
    expect(AUTHZ_MANIFEST['assignWorkOrderCustomer']).toEqual({
      method: 'put',
      path: '/api/v1/work-orders/{workOrderId}/customer',
      query: [],
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
    expect(AUTHZ_MANIFEST['getWorkOrderCustomer']?.path).toBe('/api/v1/work-orders/{workOrderId}/customer');
  });

  it('EVM-136 AC1 the request is exactly customerId (UUID) and version (an integer from 1); strictness against a field of the server belongs to the service (the integration test)', () => {
    expect(zAssignWorkOrderCustomerRequest.safeParse({ customerId: CUSTOMER, version: 3 }).success).toBe(true);
    for (const body of [
      { customerId: CUSTOMER },
      { version: 3 },
      { customerId: 'not-a-uuid', version: 3 },
      { customerId: CUSTOMER, version: 0 },
      { customerId: CUSTOMER, version: 1.5 },
    ]) {
      expect(zAssignWorkOrderCustomerRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(zAssignWorkOrderCustomerPath.safeParse({ workOrderId: CUSTOMER }).success).toBe(true);
  });

  it('EVM-136 AC2 the version is in the body, so there is no If-Match; the Idempotency-Key is an optional UUIDv7', () => {
    expect(JSON.stringify(bundled.paths['/api/v1/work-orders/{workOrderId}/customer']?.['put'])).not.toContain('IfMatchHeader');
    expect(zAssignWorkOrderCustomerHeaders.safeParse({}).success).toBe(true);
    expect(zAssignWorkOrderCustomerHeaders.safeParse({ 'Idempotency-Key': KEY }).success).toBe(true);
    expect(zAssignWorkOrderCustomerHeaders.safeParse({ 'Idempotency-Key': 'x' }).success).toBe(false);
  });

  it('EVM-136 AC2 AC3 the answers declare 409 customer_already_set, 412 version_conflict and 422 customer_unavailable, and the description fixes the order of the checks', () => {
    expect(problemOf('409')).toBe('customer_already_set');
    expect(problemOf('412')).toBe('version_conflict');
    expect(problemOf('422')).toBe('customer_unavailable');
    for (const status of ['200', '400', '401', '403', '404', '413', '415', '429'])
      expect(assignment?.responses[status], status).toBeDefined();
    const text = assignment?.description ?? '';
    for (const word of [
      'FOR KEY SHARE',
      'customer_already_set',
      'invalid_state_transition',
      '412 version_conflict',
      'customer_unavailable',
      'PRZED wersją',
    ]) {
      expect(text, word).toContain(word);
    }
  });

  it('EVM-136 AC1 the audit trail knows the action work_order.customer_assigned', () => {
    expect(zAuditAction.safeParse('work_order.customer_assigned').success).toBe(true);
  });
});
