import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { fieldErrorText } from '../src/forms/field-error-text.ts';
import { describeFailure, refusesAttempt } from '../src/forms/save-failure.ts';
import { createI18n } from '../src/i18n/i18n.ts';
import {
  buildPartyBody,
  emptyPartyForm,
  firstInvalidParty,
  MANAGER_KINDS,
  missingPartyFields,
  OSD_KINDS,
  partyFieldOf,
  partyFingerprint,
} from '../src/parties/party-form.ts';
import { formatAddress, formatSiteDetails } from '../src/sites/format.ts';
import {
  buildSiteBody,
  EMPTY_SITE_FORM,
  firstInvalidSite,
  invalidFields,
  parsePower,
  siteFieldOf,
  siteFingerprint,
  siteStarted,
  type SiteForm,
} from '../src/sites/site-form.ts';

const ID = '01968f3e-0000-7000-8000-000000000001';
const PARTY = {
  id: '01968f3e-0000-7000-8000-000000000002',
  kind: 'distribution_system_operator',
  legalForm: 'organization',
  displayName: 'Operator',
} as const;
const house: SiteForm = {
  ...EMPTY_SITE_FORM,
  siteType: 'single_family_house',
  street: ' ul. Testowa ',
  buildingNumber: '7',
  postalCode: ' 00-001 ',
  city: 'Warszawa',
};

describe('form of a new site (EVM-021 AC2)', () => {
  it('EVM-021 AC2 the required fields and the shapes the panel can check are named by code, the rest is left to the server', () => {
    expect(invalidFields(EMPTY_SITE_FORM)).toEqual({
      siteType: 'required',
      street: 'required',
      buildingNumber: 'required',
      city: 'required',
      postalCode: 'required',
    });
    expect(invalidFields({ ...house, postalCode: '00001', connectionPowerKw: 'dużo' })).toEqual({
      postalCode: 'invalid_format',
      connectionPowerKw: 'invalid_format',
    });
    expect(invalidFields({ ...house, connectionPowerKw: '1000000' })).toEqual({});
    expect(invalidFields(house)).toEqual({});
  });

  it('EVM-021 AC2 the power is a number with a point or a comma and nothing else', () => {
    expect(parsePower('11')).toBe(11);
    expect(parsePower(' 11,5 ')).toBe(11.5);
    expect(parsePower('0.75')).toBe(0.75);
    for (const text of ['', 'abc', '-1', '1e3', '1,2,3', '11 kW', '1.']) expect(parsePower(text)).toBeUndefined();
  });

  it('EVM-021 AC2 the body has the trimmed required fields, only the filled optional ones and no customer', () => {
    expect(buildSiteBody(house, ID, null, null)).toEqual({
      id: ID,
      siteType: 'single_family_house',
      street: 'ul. Testowa',
      buildingNumber: '7',
      postalCode: '00-001',
      city: 'Warszawa',
    });
    const full = buildSiteBody(
      {
        ...house,
        siteType: 'multi_family_garage',
        apartmentNumber: ' 3 ',
        parkingSpotNumber: '15',
        garageLevel: '-1',
        connectionPowerKw: '11,5',
        meteringPointId: 'PPE-1',
        notes: 'Notatka',
      },
      ID,
      PARTY,
      null,
    );
    expect(full).toEqual({
      id: ID,
      siteType: 'multi_family_garage',
      street: 'ul. Testowa',
      buildingNumber: '7',
      apartmentNumber: '3',
      postalCode: '00-001',
      city: 'Warszawa',
      parkingSpotNumber: '15',
      garageLevel: '-1',
      connectionPowerKw: 11.5,
      meteringPointId: 'PPE-1',
      distributionSystemOperatorPartyId: PARTY.id,
      notes: 'Notatka',
    });
    expect('customerId' in full).toBe(false);
    expect(buildSiteBody({ ...house, parkingSpotNumber: '15', garageLevel: '-1' }, ID, null, null)).not.toHaveProperty('parkingSpotNumber');
  });

  it('EVM-021 AC2 the same content (everything but the id) is the same request and a party changes the content', () => {
    expect(siteFingerprint(buildSiteBody(house, ID, null, null))).toBe(siteFingerprint(buildSiteBody(house, '', null, null)));
    expect(siteFingerprint(buildSiteBody(house, ID, PARTY, null))).not.toBe(siteFingerprint(buildSiteBody(house, ID, null, null)));
  });

  it('EVM-021 AC2 a site is started by any typed text or chosen party; the empty form is not', () => {
    expect(siteStarted(EMPTY_SITE_FORM, null, null)).toBe(false);
    expect(siteStarted({ ...EMPTY_SITE_FORM, city: ' ' }, null, null)).toBe(false);
    expect(siteStarted({ ...EMPTY_SITE_FORM, city: 'Łódź' }, null, null)).toBe(true);
    expect(siteStarted({ ...EMPTY_SITE_FORM, siteType: 'other' }, null, null)).toBe(true);
    expect(siteStarted(EMPTY_SITE_FORM, PARTY, null)).toBe(true);
    expect(siteStarted(EMPTY_SITE_FORM, null, PARTY)).toBe(true);
  });

  it('EVM-021 AC5 a pointer of the server finds its field, the first invalid field follows the order of the section', () => {
    expect(siteFieldOf({ pointer: '/connectionPowerKw', code: 'out_of_range' })).toBe('connectionPowerKw');
    expect(siteFieldOf({ pointer: '/distributionSystemOperatorPartyId', code: 'wrong_party_kind' })).toBe('osd');
    expect(siteFieldOf({ pointer: '/managerPartyId', code: 'unknown_party' })).toBe('manager');
    expect(siteFieldOf({ pointer: '/id', code: 'read_only_field' })).toBeUndefined();
    expect(firstInvalidSite({ notes: 'x', city: 'x' })).toBe('city');
    expect(firstInvalidSite({})).toBeUndefined();
  });
});

describe('form of the dialog "Dodaj stronę" (EVM-021 AC4)', () => {
  it('EVM-021 AC3 each field accepts its kinds: one for the OSD, three for the manager', () => {
    expect(OSD_KINDS).toEqual(['distribution_system_operator']);
    expect(MANAGER_KINDS).toEqual(['building_administration', 'property_manager', 'housing_community']);
  });

  it('EVM-021 AC4 only the name is required and the body has the filled fields only', () => {
    const empty = emptyPartyForm('distribution_system_operator');
    expect(missingPartyFields(empty)).toEqual(['displayName']);
    expect(missingPartyFields({ ...empty, displayName: ' ' })).toEqual(['displayName']);
    const form = { ...empty, displayName: ' Operator ' };
    expect(missingPartyFields(form)).toEqual([]);
    expect(buildPartyBody(form, ID)).toEqual({
      id: ID,
      kind: 'distribution_system_operator',
      legalForm: 'organization',
      displayName: 'Operator',
    });
    expect(
      buildPartyBody(
        { ...form, legalForm: 'natural_person', contactPersonName: 'A', phone: ' 600 ', email: 'a@example.test', notes: 'n' },
        ID,
      ),
    ).toEqual({
      id: ID,
      kind: 'distribution_system_operator',
      legalForm: 'natural_person',
      displayName: 'Operator',
      contactPersonName: 'A',
      phone: '600',
      email: 'a@example.test',
      notes: 'n',
    });
    expect(partyFingerprint(buildPartyBody(form, ID))).toBe(partyFingerprint(buildPartyBody(form, '')));
  });

  it('EVM-021 AC5 a pointer of the server finds its field and the first invalid field follows the order of the dialog', () => {
    expect(partyFieldOf({ pointer: '/phone', code: 'invalid_format' })).toBe('phone');
    expect(partyFieldOf({ pointer: '/kind', code: 'required' })).toBeUndefined();
    expect(firstInvalidParty({ notes: 'x', email: 'x' })).toBe('email');
    expect(firstInvalidParty({})).toBeUndefined();
  });
});

describe('texts for the answers of the server (EVM-021 AC5, AC7)', () => {
  const { t } = createI18n();

  it('EVM-021 AC5 a code becomes a sentence without any value; the name of the field picks the sentence for invalid_format and out_of_range', () => {
    const text = (field: string, code: string) => fieldErrorText(t, field, code);
    expect(text('city', 'required')).toBe('Uzupełnij to pole.');
    expect(text('city', 'too_long')).toBe('Wpisano za dużo znaków.');
    expect(text('notes', 'invalid_characters')).toBe('Usuń niedozwolone znaki.');
    expect(text('connectionPowerKw', 'out_of_range')).toContain('1000 kW');
    expect(text('street', 'out_of_range')).toBe('Sprawdź wartość w tym polu.');
    expect(text('parkingSpotNumber', 'not_allowed_for_site_type')).toBe('To pole dotyczy tylko garażu w budynku wielorodzinnym.');
    expect(text('osd', 'wrong_party_kind')).toBe('Ta strona nie pasuje do tego pola. Wybierz inną albo dodaj nową.');
    expect(text('manager', 'unknown_party')).toBe('Nie znaleziono wybranej strony. Wybierz ją ponownie.');
    expect(text('phone', 'invalid_format')).toContain('telefonu');
    expect(text('email', 'invalid_format')).toContain('e-mail');
    expect(text('postalCode', 'invalid_format')).toContain('00-000');
    expect(text('connectionPowerKw', 'invalid_format')).toContain('1000 kW');
    expect(text('street', 'invalid_format')).toBe('Sprawdź wartość w tym polu.');
    expect(text('street', 'brand_new_code')).toBe('Sprawdź wartość w tym polu.');
  });

  it('EVM-021 AC7 a failure is told by what it is: network, fields, rights, waiting, limit or an unknown answer', () => {
    const problem = (status: number, code: string, retry?: number) => new ApiError(status, { code, traceId: 'abcdef0123456789' }, retry);
    expect(describeFailure(new TypeError('x'), false)).toEqual({ kind: 'network' });
    expect(describeFailure(new ApiError(0, undefined), false)).toEqual({ kind: 'network' });
    expect(describeFailure(problem(503, 'unavailable'), false)).toEqual({ kind: 'network' });
    expect(describeFailure(problem(400, 'validation_failed'), true)).toEqual({ kind: 'fields' });
    expect(describeFailure(problem(400, 'validation_failed'), false)).toEqual({ kind: 'server', code: 'abcdef01' });
    expect(describeFailure(problem(403, 'forbidden'), false)).toEqual({ kind: 'forbidden' });
    expect(describeFailure(problem(409, 'idempotency_in_progress'), false)).toEqual({ kind: 'inProgress' });
    expect(describeFailure(problem(429, 'rate_limited', 20), false)).toEqual({ kind: 'rate', seconds: 20 });
    expect(describeFailure(problem(429, 'rate_limited'), false)).toEqual({ kind: 'rate', seconds: 60 });
    expect(describeFailure(problem(409, 'id_conflict'), false)).toEqual({ kind: 'network' });
    expect(describeFailure(problem(422, 'idempotency_mismatch'), false)).toEqual({ kind: 'network' });
    expect(describeFailure(new ApiError(418, { code: 'teapot' }), false)).toEqual({ kind: 'server', code: 'teapot' });
    expect(refusesAttempt(problem(409, 'id_conflict'))).toBe(true);
    expect(refusesAttempt(problem(422, 'idempotency_mismatch'))).toBe(true);
    expect(refusesAttempt(problem(500, 'x'))).toBe(false);
    expect(refusesAttempt(new TypeError('x'))).toBe(false);
  });
});

describe('a site as it is read (EVM-021 AC1)', () => {
  const { t } = createI18n();
  const base = {
    id: ID,
    siteType: 'single_family_house',
    street: 'ul. Testowa',
    buildingNumber: '7',
    postalCode: '00-001',
    city: 'Warszawa',
  } as const;

  it('EVM-021 AC1 the address has the apartment after a slash and the details name the type and, for a garage, the spot and the level', () => {
    expect(formatAddress(base)).toBe('ul. Testowa 7, 00-001 Warszawa');
    expect(formatAddress({ ...base, apartmentNumber: '3' })).toBe('ul. Testowa 7/3, 00-001 Warszawa');
    expect(formatSiteDetails(t, base)).toBe('Dom jednorodzinny');
    const garage = { ...base, siteType: 'multi_family_garage' } as const;
    expect(formatSiteDetails(t, { ...garage, parkingSpotNumber: '15', garageLevel: '-1' })).toBe(
      'Garaż w budynku wielorodzinnym · miejsce 15, poziom -1',
    );
    expect(formatSiteDetails(t, { ...garage, parkingSpotNumber: '15' })).toBe('Garaż w budynku wielorodzinnym · miejsce 15');
    expect(formatSiteDetails(t, { ...garage, garageLevel: '2' })).toBe('Garaż w budynku wielorodzinnym · poziom 2');
    expect(formatSiteDetails(t, garage)).toBe('Garaż w budynku wielorodzinnym');
  });
});
