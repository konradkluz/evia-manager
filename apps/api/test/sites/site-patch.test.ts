import { zSite, zSitePatch } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../src/platform/http/validation.ts';
import { normalizeNewSite, type SiteInput } from '../../src/modules/sites/domain/site.ts';
import { mergeSitePatch, partiesNamedByPatch } from '../../src/modules/sites/domain/site-patch.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';
const OSD = '0198b0a0-0000-7000-8000-0000000000a1';
const MANAGER = '0198b0a0-0000-7000-8000-0000000000a2';
const house: SiteInput = {
  id: ID,
  siteType: 'single_family_house',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
  meteringPointId: 'PL0000000000000001',
  connectionPowerKw: 11,
  notes: 'notatka',
  distributionSystemOperatorPartyId: OSD,
};
const garage: SiteInput = { ...house, siteType: 'multi_family_garage', parkingSpotNumber: '15', garageLevel: '-1' };
const rules = (patch: Parameters<typeof mergeSitePatch>[1], from: SiteInput = house) => {
  const result = normalizeNewSite(mergeSitePatch(from, patch));
  return result.ok ? [] : result.errors;
};

describe('the merge of a patch into a site (EVM-036 AC1, AC2; SR-INPUT-01, SR-INPUT-02)', () => {
  it('EVM-036 AC1 a field that is absent stays, a field named replaces', () => {
    expect(mergeSitePatch(house, {})).toMatchObject({ ...house, parkingSpotNumber: undefined });
    expect(mergeSitePatch(house, { meteringPointId: 'PL1', connectionPowerKw: 17.5, notes: 'nowa' })).toMatchObject({
      meteringPointId: 'PL1',
      connectionPowerKw: 17.5,
      notes: 'nowa',
      street: 'ul. Testowa',
      distributionSystemOperatorPartyId: OSD,
    });
  });

  it('EVM-036 AC1 null clears an optional field and only the field it names', () => {
    const merged = mergeSitePatch(house, {
      meteringPointId: null,
      connectionPowerKw: null,
      notes: null,
      distributionSystemOperatorPartyId: null,
    });
    expect(merged).toMatchObject({
      meteringPointId: undefined,
      connectionPowerKw: undefined,
      notes: undefined,
      distributionSystemOperatorPartyId: undefined,
      street: 'ul. Testowa',
    });
  });

  it('EVM-036 AC1 the merged site meets the SAME rules as a new one: the postal code, the scale of the power, the text', () => {
    expect(rules({ postalCode: '00001' })).toEqual([{ pointer: '/postalCode', code: 'invalid_format' }]);
    expect(rules({ connectionPowerKw: 11.123 })).toEqual([{ pointer: '/connectionPowerKw', code: 'invalid_format' }]);
    expect(rules({ street: '   ' })).toEqual([{ pointer: '/street', code: 'required' }]);
    expect(rules({ notes: 'ok\u0000' })).toHaveLength(1);
    expect(rules({ postalCode: '90-001', connectionPowerKw: 22.5, apartmentNumber: ' 4 ' })).toEqual([]);
  });

  it('EVM-036 AC1 the garage rule: the spot and the level only for a garage; leaving a garage must clear them in the same patch', () => {
    expect(rules({ siteType: 'commercial' }, garage)).toEqual([
      { pointer: '/parkingSpotNumber', code: 'not_allowed_for_site_type' },
      { pointer: '/garageLevel', code: 'not_allowed_for_site_type' },
    ]);
    expect(rules({ siteType: 'commercial', parkingSpotNumber: null, garageLevel: null }, garage)).toEqual([]);
    expect(rules({ parkingSpotNumber: '12' })).toEqual([{ pointer: '/parkingSpotNumber', code: 'not_allowed_for_site_type' }]);
    expect(rules({ siteType: 'multi_family_garage', parkingSpotNumber: '12', garageLevel: '-2' })).toEqual([]);
  });

  it('EVM-036 AC2 only the parties the patch names are checked: an untouched one is not asked about again', () => {
    const merged = normalizeNewSite(mergeSitePatch({ ...house, managerPartyId: MANAGER }, { notes: 'x' }));
    if (!merged.ok) throw new Error('unexpected');
    expect(partiesNamedByPatch({ notes: 'x' }, merged.site)).toEqual({ distributionSystemOperatorPartyId: null, managerPartyId: null });
    expect(partiesNamedByPatch({ managerPartyId: MANAGER }, merged.site)).toEqual({
      distributionSystemOperatorPartyId: null,
      managerPartyId: MANAGER,
    });
    expect(partiesNamedByPatch({ managerPartyId: null }, merged.site)).toEqual({
      distributionSystemOperatorPartyId: null,
      managerPartyId: MANAGER,
    });
  });
});

describe('the body of the patch of a site (EVM-036 AC7; SR-AUTHZ-04, CWE-915, CWE-1321)', () => {
  const schema = strictObjects(zSitePatch);
  const serverFields = readOnlyKeys(zSite, zSitePatch);
  const errors = (body: unknown): unknown => {
    try {
      parseInput(schema, body, serverFields);
    } catch (error) {
      return (error as ProblemException).extras.errors;
    }
    return undefined;
  };

  it('EVM-036 AC7 the fields of the server are read_only_field, a stranger (customerId, __proto__) is unknown_field', () => {
    expect(errors({ id: ID })).toEqual([{ pointer: '/id', code: 'read_only_field' }]);
    expect(errors({ version: 3 })).toEqual([{ pointer: '/version', code: 'read_only_field' }]);
    expect(errors({ createdAt: '2026-10-07T08:00:00Z', updatedAt: '2026-10-07T08:00:00Z' })).toEqual([
      { pointer: '/createdAt', code: 'read_only_field' },
      { pointer: '/updatedAt', code: 'read_only_field' },
    ]);
    expect(errors({ customerId: ID })).toEqual([{ pointer: '/customerId', code: 'unknown_field' }]);
    expect(errors({ constructor: { prototype: {} } })).toEqual([{ pointer: '/constructor', code: 'unknown_field' }]);
    expect(errors(JSON.parse('{"__proto__":{"isAdmin":true}}'))).toEqual([{ pointer: '/__proto__', code: 'unknown_field' }]);
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
  });

  it('EVM-036 AC7 null is allowed for an optional field only; a required one is refused', () => {
    expect(errors({ notes: null, managerPartyId: null })).toBeUndefined();
    expect(errors({ street: null })).toEqual([{ pointer: '/street', code: 'invalid_type' }]);
    expect(errors({ siteType: null })).toBeDefined();
  });
});
