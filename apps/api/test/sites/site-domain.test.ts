import { describe, expect, it } from 'vitest';
import { checkPartyKinds, namedParties, normalizeNewSite, PARTY_FIELD_KINDS, type SiteInput } from '../../src/modules/sites/domain/site.ts';
import type { PartyKind } from '../../src/modules/parties/index.ts';

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
};
const garage: SiteInput = { ...house, siteType: 'multi_family_garage', parkingSpotNumber: '15', garageLevel: '-1' };
const errorsOf = (input: SiteInput) => {
  const result = normalizeNewSite(input);
  return result.ok ? [] : result.errors;
};

describe('a new site (EVM-021 AC2, AC5; SR-INPUT-01, SR-INPUT-05)', () => {
  it('EVM-021 AC2 a house: the address only; everything else is absent (null)', () => {
    expect(normalizeNewSite(house)).toEqual({
      ok: true,
      site: {
        id: ID,
        siteType: 'single_family_house',
        street: 'ul. Testowa',
        buildingNumber: '7',
        apartmentNumber: null,
        postalCode: '00-001',
        city: 'Warszawa',
        parkingSpotNumber: null,
        garageLevel: null,
        connectionPowerKw: null,
        meteringPointId: null,
        distributionSystemOperatorPartyId: null,
        managerPartyId: null,
        notes: null,
      },
    });
  });

  it('EVM-021 AC2 a garage with the spot 15 and the level -1, the apartment, the power, the PPE, the parties and the notes', () => {
    const result = normalizeNewSite({
      ...garage,
      apartmentNumber: ' 5 ',
      connectionPowerKw: 11.5,
      meteringPointId: ' PL0000000000000001 ',
      distributionSystemOperatorPartyId: OSD,
      managerPartyId: MANAGER,
      notes: ' Wjazd od ul. Bocznej\r\n ',
    });
    expect(result).toMatchObject({
      ok: true,
      site: {
        siteType: 'multi_family_garage',
        apartmentNumber: '5',
        parkingSpotNumber: '15',
        garageLevel: '-1',
        connectionPowerKw: 11.5,
        meteringPointId: 'PL0000000000000001',
        distributionSystemOperatorPartyId: OSD,
        managerPartyId: MANAGER,
        notes: 'Wjazd od ul. Bocznej',
      },
    });
  });

  it('EVM-021 AC2 the spot and the level only for a garage in a multi-family building: any other type is not_allowed_for_site_type', () => {
    for (const siteType of ['single_family_house', 'commercial', 'other'] as const) {
      expect(errorsOf({ ...garage, siteType })).toEqual([
        { pointer: '/parkingSpotNumber', code: 'not_allowed_for_site_type' },
        { pointer: '/garageLevel', code: 'not_allowed_for_site_type' },
      ]);
    }
    expect(errorsOf({ ...house, garageLevel: '-1' })).toEqual([{ pointer: '/garageLevel', code: 'not_allowed_for_site_type' }]);
    expect(errorsOf({ ...house, parkingSpotNumber: '  ', garageLevel: '' })).toEqual([]); // an empty text counts as absent
    expect(errorsOf(garage)).toEqual([]);
  });

  it('EVM-021 AC2 the postal code is NN-NNN (after NFC and trim)', () => {
    expect(normalizeNewSite({ ...house, postalCode: ' 00-001 ' })).toMatchObject({ ok: true, site: { postalCode: '00-001' } });
    for (const postalCode of ['00001', '0-0001', '00-00a', '00-0011', '٠٠-٠٠١']) {
      expect(errorsOf({ ...house, postalCode }), postalCode).toEqual([{ pointer: '/postalCode', code: 'invalid_format' }]);
    }
  });

  it('EVM-021 AC2 the connection power has at most two decimals (checked in the domain, not by multipleOf on a float)', () => {
    for (const connectionPowerKw of [0.01, 7.4, 11, 11.25, 999.99, 1000])
      expect(errorsOf({ ...house, connectionPowerKw }), String(connectionPowerKw)).toEqual([]);
    for (const connectionPowerKw of [7.123, 0.001, 11.255])
      expect(errorsOf({ ...house, connectionPowerKw }), String(connectionPowerKw)).toEqual([
        { pointer: '/connectionPowerKw', code: 'invalid_format' },
      ]);
  });

  it('EVM-021 AC5 the PPE at most 40 characters, a name over its limit, a control character: pointers and codes, never the values', () => {
    expect(errorsOf({ ...house, meteringPointId: 'P'.repeat(41) })).toEqual([{ pointer: '/meteringPointId', code: 'too_long' }]);
    expect(errorsOf({ ...house, meteringPointId: 'P'.repeat(40) })).toEqual([]);
    const result = normalizeNewSite({ ...house, street: '   ', city: 'c'.repeat(101), notes: 'sekret\u0007znak' });
    expect(result).toEqual({
      ok: false,
      errors: [
        { pointer: '/street', code: 'required' },
        { pointer: '/city', code: 'too_long' },
        { pointer: '/notes', code: 'invalid_characters' },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/sekret/);
  });
});

describe('the parties of a site (EVM-021 AC3; SR-INPUT-02)', () => {
  const site = { distributionSystemOperatorPartyId: OSD, managerPartyId: MANAGER };
  const kinds = (osd: PartyKind, manager: PartyKind): ReadonlyMap<string, PartyKind> =>
    new Map<string, PartyKind>([
      [OSD, osd],
      [MANAGER, manager],
    ]);

  it('EVM-021 AC3 the OSD field takes the OSD kind, the manager field the administration, the property manager and the housing community', () => {
    expect(PARTY_FIELD_KINDS.distributionSystemOperatorPartyId).toEqual(['distribution_system_operator']);
    expect(PARTY_FIELD_KINDS.managerPartyId).toEqual(['building_administration', 'property_manager', 'housing_community']);
    for (const manager of ['building_administration', 'property_manager', 'housing_community'] as const)
      expect(checkPartyKinds(site, kinds('distribution_system_operator', manager))).toEqual([]);
  });

  it('EVM-021 AC3 a party of another kind is wrong_party_kind with the pointer of its field — and the kind that was found is not named', () => {
    const issues = checkPartyKinds(site, kinds('property_manager', 'distribution_system_operator'));
    expect(issues).toEqual([
      { pointer: '/distributionSystemOperatorPartyId', code: 'wrong_party_kind' },
      { pointer: '/managerPartyId', code: 'wrong_party_kind' },
    ]);
    expect(JSON.stringify(issues)).not.toMatch(/property_manager|distribution_system_operator/);
    expect(checkPartyKinds(site, kinds('supplier', 'property_manager'))).toEqual([
      { pointer: '/distributionSystemOperatorPartyId', code: 'wrong_party_kind' },
    ]);
  });

  it('EVM-021 AC3 a party that is not among the visible ones (it never existed or is deleted: the same answer) is unknown_party', () => {
    expect(checkPartyKinds(site, new Map())).toEqual([
      { pointer: '/distributionSystemOperatorPartyId', code: 'unknown_party' },
      { pointer: '/managerPartyId', code: 'unknown_party' },
    ]);
  });

  it('EVM-021 AC3 a site without a party has nothing to check', () => {
    const none = { distributionSystemOperatorPartyId: null, managerPartyId: null };
    expect(namedParties(none)).toEqual([]);
    expect(checkPartyKinds(none, new Map())).toEqual([]);
    expect(namedParties({ distributionSystemOperatorPartyId: null, managerPartyId: MANAGER })).toEqual([['managerPartyId', MANAGER]]);
  });
});
