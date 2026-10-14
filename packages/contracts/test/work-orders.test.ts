import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import { zListWorkOrdersQuery, zWorkOrderList, zWorkOrderSearchRequest, zWorkOrderStatus } from '../src/zod.ts';

interface BundledParameter {
  readonly name: string;
  readonly in: string;
  readonly required?: boolean;
  readonly schema?: { readonly maxLength?: number; readonly pattern?: string };
}
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, { parameters?: BundledParameter[] }>>;
  components?: { schemas?: Record<string, unknown> };
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

  it('EVM-017 AC2 the query declares status, view, coordinatorId, customerId (EVM-039), sort, limit and cursor and no parameter that names a user for `mine`', () => {
    expect([...(AUTHZ_MANIFEST['listWorkOrders']?.query ?? [])].sort()).toEqual(
      [
        'coordinatorId',
        'cursor',
        'customerId',
        'limit',
        // "Więcej filtrów" (EVM-072, additive)
        'siteType',
        'sort',
        'status',
        'templateId',
        'view',
        // "Czekamy na…" (EVM-034, additive)
        'waitingLongerThanDays',
        'waitingOn',
        'waitingOnPartyKind',
      ].sort(),
    );
  });

  it('EVM-034 AC2 the filters of "Czekamy na…" are optional codes and a number of 1..365 — no identifier of a party, no name', () => {
    const parameters = bundled.paths['/api/v1/work-orders']?.['get']?.parameters ?? [];
    for (const name of ['waitingOn', 'waitingOnPartyKind', 'waitingLongerThanDays']) {
      expect(parameters.find((parameter) => parameter.name === name)?.required, name).toBe(false);
    }
    expect(zListWorkOrdersQuery.safeParse({ waitingLongerThanDays: 14 }).success).toBe(true);
    for (const waitingLongerThanDays of [0, 366, 1.5]) {
      expect(zListWorkOrdersQuery.safeParse({ waitingLongerThanDays }).success, String(waitingLongerThanDays)).toBe(false);
    }
    expect(zListWorkOrdersQuery.safeParse({ waitingOn: 'party', waitingOnPartyKind: 'distribution_system_operator' }).success).toBe(true);
    for (const query of [{ waitingOn: 'osd' }, { waitingOnPartyKind: 'Stoen Operator' }]) {
      expect(zListWorkOrdersQuery.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  it('EVM-034 AC4 the sorts "Najdłużej czekamy" and "Termin" and the view "Czekamy na OSD > 14 dni" are values of the enums (additive)', () => {
    for (const sort of ['longestWaitingSince', 'nextDueDate']) expect(zListWorkOrdersQuery.safeParse({ sort }).success, sort).toBe(true);
    expect(zListWorkOrdersQuery.safeParse({ view: 'waiting_on_dso_over_14_days' }).success).toBe(true);
    expect(zListWorkOrdersQuery.safeParse({ sort: '-nextDueDate' }).success).toBe(false);
  });

  it('EVM-034 AC1 the enums of the answer are extensible (x-extensible-enum, not enum): a new kind of party is no breaking change', () => {
    const schemas = bundled.components?.schemas ?? {};
    for (const name of ['WorkOrderWaitingOn', 'WorkOrderWaitingPartyKind']) {
      const schema = schemas[name] as Record<string, unknown> | undefined;
      expect(schema?.['x-extensible-enum'], name).toBeInstanceOf(Array);
      expect(schema, name).not.toHaveProperty('enum');
    }
    // the request enum of the kind stays a plain enum — the answer does not reuse it
    expect(schemas['PartyKind']).toHaveProperty('enum');
  });

  it('EVM-034 AC1 the new fields of an item are read-only and optional (added additively): waiting, nextDueDate, hasOverdueStage', () => {
    const item = bundled.components?.schemas?.['WorkOrderListItem'] as
      { required?: string[]; properties?: Record<string, unknown> } | undefined;
    for (const name of ['waiting', 'nextDueDate', 'hasOverdueStage']) {
      expect(item?.properties, name).toHaveProperty(name);
      expect(item?.required ?? [], name).not.toContain(name);
    }
    expect(item?.required).toEqual(['id', 'number', 'title', 'status', 'coordinator', 'createdAt']);
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

  it('EVM-072 AC1 the new fields of an item are read-only and optional: customer {id, displayName} | {deleted} | null, site without postal code', () => {
    const item = bundled.components?.schemas?.['WorkOrderListItem'] as
      { required?: string[]; properties?: Record<string, unknown> } | undefined;
    for (const name of ['customer', 'site']) {
      expect(item?.properties, name).toHaveProperty(name);
      expect(item?.required ?? [], name).not.toContain(name);
    }
    const site = bundled.components?.schemas?.['WorkOrderListSite'] as { properties?: Record<string, unknown> } | undefined;
    expect(Object.keys(site?.properties ?? {}).sort()).toEqual(['buildingNumber', 'city', 'id', 'siteType', 'street']);
    const base = {
      id: '0198b0a0-0000-7000-8000-000000000001',
      number: 'ZL-2026-0001',
      title: 'Montaż wallboxa',
      status: 'new',
      coordinator: null,
      createdAt: '2026-10-01T08:00:00.000Z',
    };
    const customer = { id: '0198b0a0-0000-7000-8000-000000000003', displayName: 'Jan Przykładowy' };
    const place = {
      id: '0198b0a0-0000-7000-8000-000000000004',
      siteType: 'single_family_house',
      city: 'Łódź',
      street: 'ul. Żółkiewskiego',
      buildingNumber: '12',
    };
    for (const value of [customer, { deleted: true }, null])
      expect(zWorkOrderList.safeParse({ items: [{ ...base, customer: value, site: place }], nextCursor: null }).success).toBe(true);
    expect(zWorkOrderList.safeParse({ items: [{ ...base, customer: { deleted: false } }], nextCursor: null }).success).toBe(false);
  });

  it('EVM-043 AC1 the site of an item carries the type from the dictionary (required), still without postal code or apartment', () => {
    const site = bundled.components?.schemas?.['WorkOrderListSite'] as
      { required?: string[]; properties?: Record<string, unknown> } | undefined;
    expect(site?.required).toContain('siteType');
    expect(site?.properties).not.toHaveProperty('postalCode');
    expect(site?.properties).not.toHaveProperty('apartmentNumber');
    const base = {
      id: '0198b0a0-0000-7000-8000-000000000001',
      number: 'ZL-2026-0001',
      title: 'Montaż wallboxa',
      status: 'new',
      coordinator: null,
      createdAt: '2026-10-01T08:00:00.000Z',
    };
    const place = {
      id: '0198b0a0-0000-7000-8000-000000000004',
      siteType: 'single_family_house',
      city: 'Łódź',
      street: 'ul. Żółkiewskiego',
      buildingNumber: '12',
    };
    const parse = (value: unknown) => zWorkOrderList.safeParse({ items: [{ ...base, site: value }], nextCursor: null }).success;
    expect(parse(place)).toBe(true);
    expect(parse(null)).toBe(true);
    const withoutType: Partial<typeof place> = { ...place };
    delete withoutType.siteType;
    expect(parse(withoutType)).toBe(false);
    expect(parse({ ...place, siteType: 'castle' })).toBe(false);
  });

  it('EVM-072 AC2 the search body is a phrase plus the filters of the list; the manifest has the operation for the three roles on the web channel', () => {
    expect(bundled.paths['/api/v1/work-orders/search']).toHaveProperty('post');
    expect(AUTHZ_MANIFEST['searchWorkOrders']).toMatchObject({
      method: 'post',
      path: '/api/v1/work-orders/search',
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'] },
    });
    expect(AUTHZ_MANIFEST['searchWorkOrders']?.authz.stepUp).not.toBe(true);
    const ok = { query: '0042', status: ['new'], view: 'mine', siteType: 'commercial', limit: 10 };
    expect(zWorkOrderSearchRequest.safeParse(ok).success).toBe(true);
    expect(zWorkOrderSearchRequest.safeParse({}).success).toBe(false);
    expect(zWorkOrderSearchRequest.safeParse({ query: 'x', status: ['nope'] }).success).toBe(false);
  });
});
