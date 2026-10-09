import type { Party, Site } from '@evia/contracts';
import { describe, expect, it } from 'vitest';
import { buildPartyPatch, changedPartyFields, currentPartyText, partyFormOf } from '../src/parties/party-edit.ts';
import { buildSitePatch, changedSiteFields, currentSiteText, siteEditOf, type SiteEdit } from '../src/sites/site-edit.ts';

const OSD = {
  id: '01968f3e-0000-7000-8000-00000000c001',
  kind: 'distribution_system_operator',
  legalForm: 'organization',
  displayName: 'Stoen',
} as const;
const MANAGER = {
  id: '01968f3e-0000-7000-8000-00000000c002',
  kind: 'housing_community',
  legalForm: 'organization',
  displayName: 'Wspólnota',
} as const;

const GARAGE: Site = {
  id: '01968f3e-0000-7000-8000-00000000b001',
  siteType: 'multi_family_garage',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
  parkingSpotNumber: '15',
  garageLevel: '-1',
  connectionPowerKw: 11.5,
  meteringPointId: 'PL-TEST-0001',
  distributionSystemOperatorPartyId: OSD.id,
  notes: 'Klucz u administratora.',
  version: 4,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

const edit = (site: Site = GARAGE): SiteEdit => siteEditOf(site, OSD, null);

describe('form of the dialog "Edytuj lokalizację" (EVM-036 AC1, AC2)', () => {
  it('EVM-036 AC1 the form is filled with the site: a Polish comma in the power, absent optional fields are empty', () => {
    const initial = edit();
    expect(initial.form).toMatchObject({
      siteType: 'multi_family_garage',
      street: 'ul. Testowa',
      parkingSpotNumber: '15',
      garageLevel: '-1',
      connectionPowerKw: '11,5',
      meteringPointId: 'PL-TEST-0001',
      apartmentNumber: '',
    });
    expect(initial.osd).toEqual(OSD);
    expect(initial.manager).toBeNull();
  });

  it('EVM-036 AC1 nothing touched is an empty patch and no changed field', () => {
    expect(buildSitePatch(edit(), edit())).toEqual({});
    expect(changedSiteFields(edit(), edit())).toEqual([]);
  });

  it('EVM-036 AC1 only the touched fields travel: the PPE, the power (a number) and the notes', () => {
    const initial = edit();
    const current: SiteEdit = {
      ...initial,
      form: { ...initial.form, meteringPointId: ' PL-TEST-0002 ', connectionPowerKw: '40', notes: 'Nowa notatka.' },
    };
    expect(buildSitePatch(initial, current)).toEqual({ meteringPointId: 'PL-TEST-0002', connectionPowerKw: 40, notes: 'Nowa notatka.' });
    expect(changedSiteFields(initial, current)).toEqual(['connectionPowerKw', 'meteringPointId', 'notes']);
  });

  it('EVM-036 AC1 an emptied optional field is null (cleared), the same power typed with a dot is not a change', () => {
    const initial = edit();
    const current: SiteEdit = {
      ...initial,
      form: { ...initial.form, meteringPointId: '  ', notes: '', connectionPowerKw: '11.5', apartmentNumber: '3' },
    };
    expect(buildSitePatch(initial, current)).toEqual({ meteringPointId: null, notes: null, apartmentNumber: '3' });
    expect(buildSitePatch(initial, { ...initial, form: { ...initial.form, connectionPowerKw: '' } })).toEqual({ connectionPowerKw: null });
  });

  it('EVM-036 AC2 the OSD and the manager travel as identifiers, a removed one as null, a re-chosen one is not a change', () => {
    const initial = edit();
    expect(buildSitePatch(initial, { ...initial, manager: MANAGER })).toEqual({ managerPartyId: MANAGER.id });
    expect(buildSitePatch(initial, { ...initial, osd: null })).toEqual({ distributionSystemOperatorPartyId: null });
    expect(buildSitePatch(initial, { ...initial, osd: { ...OSD } })).toEqual({});
    expect(changedSiteFields(initial, { ...initial, manager: MANAGER, osd: null })).toEqual(['osd', 'manager']);
  });

  it('EVM-036 AC1 a change of the type away from a garage clears the spot and the level in the same patch', () => {
    const initial = edit();
    const current: SiteEdit = { ...initial, form: { ...initial.form, siteType: 'commercial' } };
    expect(buildSitePatch(initial, current)).toEqual({ siteType: 'commercial', parkingSpotNumber: null, garageLevel: null });
  });

  it('EVM-036 AC1 a site that is not a garage never sends a spot or a level; a change to a garage sends them', () => {
    const house = edit({ ...GARAGE, siteType: 'single_family_house', parkingSpotNumber: undefined, garageLevel: undefined });
    expect(buildSitePatch(house, house)).toEqual({});
    const current: SiteEdit = {
      ...house,
      form: { ...house.form, siteType: 'multi_family_garage', parkingSpotNumber: '9', garageLevel: '-2' },
    };
    expect(buildSitePatch(house, current)).toEqual({ siteType: 'multi_family_garage', parkingSpotNumber: '9', garageLevel: '-2' });
  });

  it('EVM-036 AC4 the text of a field as the API holds it (shown as "Aktualnie: …")', () => {
    expect(currentSiteText(GARAGE, 'meteringPointId')).toBe('PL-TEST-0001');
    expect(currentSiteText(GARAGE, 'connectionPowerKw')).toBe('11,5');
    expect(currentSiteText({ ...GARAGE, notes: undefined }, 'notes')).toBe('');
  });
});

const PARTY: Party = {
  id: OSD.id,
  kind: 'distribution_system_operator',
  legalForm: 'organization',
  displayName: 'Stoen Operator',
  contactPersonName: 'Anna Kontakt',
  phone: '+48600000002',
  email: 'przylacza@osd.test',
  notes: 'Wnioski tylko przez portal OSD.',
  version: 2,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

describe('form of the dialog "Edytuj stronę" (EVM-036 AC3)', () => {
  it('EVM-036 AC3 the form is filled with the party and the phone is shown with spaces; nothing touched sends nothing', () => {
    const initial = partyFormOf(PARTY);
    expect(initial).toMatchObject({ kind: 'distribution_system_operator', displayName: 'Stoen Operator', phone: '+48 600 000 002' });
    expect(buildPartyPatch(initial, partyFormOf(PARTY))).toEqual({});
    expect(changedPartyFields(initial, partyFormOf(PARTY))).toEqual([]);
  });

  it('EVM-036 AC3 only the touched fields travel, an emptied optional one is null, the kind never travels', () => {
    const initial = partyFormOf(PARTY);
    const current = { ...initial, displayName: 'Stoen Operator SA', email: '', legalForm: 'natural_person' as const };
    expect(buildPartyPatch(initial, current)).toEqual({ displayName: 'Stoen Operator SA', email: null, legalForm: 'natural_person' });
    expect(Object.keys(buildPartyPatch(initial, { ...current, kind: 'supplier' }))).not.toContain('kind');
    expect(changedPartyFields(initial, current)).toEqual(['displayName', 'email']);
  });

  it('EVM-036 AC4 the text of a field as the API holds it', () => {
    expect(currentPartyText(PARTY, 'phone')).toBe('+48 600 000 002');
    expect(currentPartyText({ ...PARTY, notes: undefined }, 'notes')).toBe('');
  });
});
