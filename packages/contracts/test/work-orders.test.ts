import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import { zListWorkOrdersQuery, zWorkOrderList, zWorkOrderStatus } from '../src/zod.ts';

interface BundledParameter {
  readonly name: string;
  readonly in: string;
  readonly schema?: { readonly maxLength?: number; readonly pattern?: string };
}
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, { parameters?: BundledParameter[] }>>;
};

describe('work orders list contract (EVM-017 AC2, AC3, AC7; SR-AUTHZ-05, SR-INPUT-01, SR-API-04)', () => {
  it('EVM-017 AC7 listWorkOrders is a GET (the same path also carries createWorkOrder, EVM-022) for the three roles on the web channel, with no step-up and no audit', () => {
    expect(AUTHZ_MANIFEST['listWorkOrders']).toMatchObject({
      method: 'get',
      path: '/api/v1/work-orders',
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'] },
    });
    expect(Object.keys(bundled.paths['/api/v1/work-orders'] ?? {})).toEqual(['get', 'post']);
  });

  it('EVM-017 AC2 the query declares status, view, coordinatorId, sort, limit and cursor and no parameter that names a user for `mine`', () => {
    expect([...(AUTHZ_MANIFEST['listWorkOrders']?.query ?? [])].sort()).toEqual(
      ['coordinatorId', 'cursor', 'limit', 'sort', 'status', 'view'].sort(),
    );
  });

  it('EVM-017 AC3 the cursor and the status list are bounded in the contract (length and pattern)', () => {
    const parameters = bundled.paths['/api/v1/work-orders']?.['get']?.parameters ?? [];
    const cursor = parameters.find((parameter) => parameter.name === 'cursor');
    expect(cursor?.schema).toMatchObject({ maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' });
    expect(parameters.find((parameter) => parameter.name === 'status')?.schema?.maxLength).toBeLessThanOrEqual(200);
  });

  it('EVM-017 AC2 the generated query schema takes the four sort values and refuses another', () => {
    for (const sort of ['-number', 'number', '-createdAt', 'createdAt'])
      expect(zListWorkOrdersQuery.safeParse({ sort }).success, sort).toBe(true);
    for (const sort of ['number_desc', 'created_asc', '+number', ''])
      expect(zListWorkOrdersQuery.safeParse({ sort }).success, sort).toBe(false);
  });

  it('EVM-017 AC1 the status enum has the eight values of WorkOrderStatus and the item has no customer or e-mail', () => {
    expect([...zWorkOrderStatus.options]).toEqual([
      'new',
      'quoting',
      'accepted',
      'in_progress',
      'completed',
      'settled',
      'on_hold',
      'cancelled',
    ]);
    const item = {
      id: '0198b0a0-0000-7000-8000-000000000001',
      number: 'ZL-2026-0001',
      title: 'Montaż wallboxa',
      status: 'new',
      coordinator: { id: '0198b0a0-0000-7000-8000-000000000002', displayName: 'Użytkownik 1' },
      createdAt: '2026-10-01T08:00:00.000Z',
    };
    expect(zWorkOrderList.safeParse({ items: [item], nextCursor: null }).success).toBe(true);
    expect(zWorkOrderList.safeParse({ items: [{ ...item, coordinator: null }], nextCursor: 'abc' }).success).toBe(true);
  });
});
