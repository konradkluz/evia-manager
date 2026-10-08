import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import { zAssignableUserList, zCreateWorkOrderHeaders, zCreateWorkOrderRequest, zWorkOrder } from '../src/zod.ts';

const V7 = '0198b0a0-0000-7000-8000-000000000001';
const ANY = '0198b0a0-0000-4000-8000-000000000002';
const request = { id: V7, customerId: ANY, siteId: ANY, templateId: ANY };

describe('work order creation contract (EVM-022 AC1-AC7; SR-AUTHZ-01, SR-AUTHZ-04, SR-INPUT-01, SR-API-05, SR-DATA-03)', () => {
  it('EVM-022 AC7 createWorkOrder is a POST for Administrator and Editor with audit, and listAssignableUsers a GET for the same roles — both on the web channel only', () => {
    expect(AUTHZ_MANIFEST['createWorkOrder']).toMatchObject({
      method: 'post',
      path: '/api/v1/work-orders',
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
    expect(AUTHZ_MANIFEST['listAssignableUsers']).toMatchObject({
      method: 'get',
      path: '/api/v1/users/assignable',
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: false },
    });
    expect(AUTHZ_MANIFEST['listAssignableUsers']?.query).toEqual([]);
  });

  it('EVM-022 AC5 the fields of the server are in the work order and not in the request (the list the validation uses)', () => {
    expect(
      Object.keys(zWorkOrder.shape)
        .filter((key) => !(key in zCreateWorkOrderRequest.shape))
        .sort(),
    ).toEqual(['coordinator', 'createdAt', 'customer', 'number', 'scopeItems', 'site', 'status', 'version']);
  });

  it('EVM-022 AC1 the request names no scope item: the server copies them from the template', () => {
    expect('scopeItems' in zCreateWorkOrderRequest.shape).toBe(false);
    expect(Object.keys(zCreateWorkOrderRequest.shape).sort()).toEqual(
      ['assigneeUserId', 'customerId', 'description', 'id', 'plannedDate', 'siteId', 'templateId', 'title'].sort(),
    );
  });

  it('EVM-022 AC2 AC3 customer, site and the template choice are required; the template is a UUID or null (an empty order)', () => {
    expect(zCreateWorkOrderRequest.safeParse(request).success).toBe(true);
    expect(zCreateWorkOrderRequest.safeParse({ ...request, templateId: null }).success).toBe(true);
    for (const missing of ['customerId', 'siteId', 'templateId']) {
      const rest = Object.fromEntries(Object.entries(request).filter(([key]) => key !== missing));
      expect(zCreateWorkOrderRequest.safeParse(rest).success, missing).toBe(false);
    }
  });

  it('EVM-022 AC4 the id and the Idempotency-Key are UUIDv7 (another version is refused at the boundary)', () => {
    expect(zCreateWorkOrderRequest.safeParse({ ...request, id: ANY }).success).toBe(false);
    expect(zCreateWorkOrderHeaders.safeParse({ 'Idempotency-Key': V7 }).success).toBe(true);
    expect(zCreateWorkOrderHeaders.safeParse({}).success).toBe(true);
    expect(zCreateWorkOrderHeaders.safeParse({ 'Idempotency-Key': ANY }).success).toBe(false);
  });

  it('EVM-022 AC1 the limits are those of the guidelines: title 200, description 2000, a date and not a date-time', () => {
    expect(zCreateWorkOrderRequest.safeParse({ ...request, title: 'T'.repeat(200) }).success).toBe(true);
    expect(zCreateWorkOrderRequest.safeParse({ ...request, title: 'T'.repeat(201) }).success).toBe(false);
    expect(zCreateWorkOrderRequest.safeParse({ ...request, description: 'D'.repeat(2000) }).success).toBe(true);
    expect(zCreateWorkOrderRequest.safeParse({ ...request, description: 'D'.repeat(2001) }).success).toBe(false);
    expect(zCreateWorkOrderRequest.safeParse({ ...request, plannedDate: '2026-12-31' }).success).toBe(true);
    expect(zCreateWorkOrderRequest.safeParse({ ...request, plannedDate: '2026-12-31T10:00:00Z' }).success).toBe(false);
    expect(zCreateWorkOrderRequest.safeParse({ ...request, plannedDate: '2026-02-30' }).success).toBe(false);
  });

  it('EVM-022 AC7 the list of assignable users has id and displayName only and at most 100 items (SR-DATA-03)', () => {
    const user = { id: ANY, displayName: 'Anna Testowa' };
    expect(zAssignableUserList.safeParse({ items: [user], nextCursor: null }).success).toBe(true);
    expect(zAssignableUserList.safeParse({ items: Array.from({ length: 101 }, () => user), nextCursor: null }).success).toBe(false);
    const shaped = zAssignableUserList.parse({ items: [{ ...user, email: 'a@example.invalid', role: 'editor' }], nextCursor: null });
    expect(shaped.items[0]).toEqual(user);
  });
});
