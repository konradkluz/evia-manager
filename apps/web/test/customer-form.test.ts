import { describe, expect, it } from 'vitest';
import {
  buildBody,
  EMPTY_FORM,
  fieldOf,
  fingerprint,
  firstInvalid,
  missingFields,
  type CustomerForm,
} from '../src/customers/customer-form.ts';
import { formatPhone } from '../src/customers/format.ts';
import { uuidv7 } from '../src/customers/uuid.ts';

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID = '01968f3e-0000-7000-8000-000000000001';

const person: CustomerForm = { ...EMPTY_FORM, firstName: ' Jan ', lastName: 'Przykładowy', phone: ' +48 600 000 001 ' };

describe('identifier of a new customer (EVM-020 AC4)', () => {
  it('EVM-020 AC4 uuidv7 makes a UUID version 7 with the time in the first 48 bits, different every time', () => {
    const at = Date.UTC(2026, 9, 7, 12, 0, 0);
    const first = uuidv7(at);
    expect(first).toMatch(UUIDV7);
    expect(Number.parseInt(first.replaceAll('-', '').slice(0, 12), 16)).toBe(at);
    expect(uuidv7(at)).not.toBe(first);
    expect(uuidv7()).toMatch(UUIDV7);
  });
});

describe('form of the dialog "Dodaj klienta" (EVM-020 AC2)', () => {
  it('EVM-020 AC2 a person needs the name, the surname and the phone; a company needs its name and the phone', () => {
    expect(missingFields(EMPTY_FORM)).toEqual(['firstName', 'lastName', 'phone']);
    expect(missingFields({ ...EMPTY_FORM, kind: 'company' })).toEqual(['companyName', 'phone']);
    expect(missingFields({ ...person })).toEqual([]);
    expect(missingFields({ ...person, firstName: '   ' })).toEqual(['firstName']);
  });

  it('EVM-020 AC2 once any part of the address is typed the street, the building, the postal code and the city are required', () => {
    expect(missingFields({ ...person, apartmentNumber: '5' })).toEqual(['street', 'buildingNumber', 'postalCode', 'city']);
    expect(missingFields({ ...person, street: 'ul. Testowa', city: 'Łódź' })).toEqual(['buildingNumber', 'postalCode']);
  });

  it('EVM-020 AC2 the body of a person holds only filled fields of that kind, trimmed, with the phone as typed and no address', () => {
    expect(buildBody({ ...person, companyName: 'Zostaje w formularzu', taxId: '123' }, ID)).toEqual({
      id: ID,
      kind: 'person',
      firstName: 'Jan',
      lastName: 'Przykładowy',
      phone: '+48 600 000 001',
    });
  });

  it('EVM-020 AC2 the body of a company holds the NIP and the contact person only when filled, with e-mail and notes', () => {
    const company: CustomerForm = {
      ...EMPTY_FORM,
      kind: 'company',
      companyName: ' Firma Testowa sp. z o.o. ',
      taxId: '',
      contactPersonName: 'Anna Testowa',
      firstName: 'Nie wysyłamy',
      phone: '600000001',
      email: ' Biuro@Example.test ',
      notes: ' Notatka ',
    };
    expect(buildBody(company, ID)).toEqual({
      id: ID,
      kind: 'company',
      companyName: 'Firma Testowa sp. z o.o.',
      contactPersonName: 'Anna Testowa',
      phone: '600000001',
      email: 'Biuro@Example.test',
      notes: 'Notatka',
    });
  });

  it('EVM-020 AC2 the postal address is sent as one object, the apartment number only when filled', () => {
    const address = { ...person, street: ' ul. Testowa ', buildingNumber: '7', postalCode: '00-001', city: 'Warszawa' };
    expect(buildBody(address, ID).postalAddress).toEqual({
      street: 'ul. Testowa',
      buildingNumber: '7',
      postalCode: '00-001',
      city: 'Warszawa',
    });
    expect(buildBody({ ...address, apartmentNumber: '12' }, ID).postalAddress).toMatchObject({ apartmentNumber: '12' });
  });

  it('EVM-020 AC4 the same content is the same request whatever the identifier; changed content is another one', () => {
    expect(fingerprint(buildBody(person, ID))).toBe(fingerprint(buildBody(person, '01968f3e-0000-7000-8000-000000000002')));
    expect(fingerprint(buildBody(person, ID))).not.toBe(fingerprint(buildBody({ ...person, lastName: 'Inny' }, ID)));
  });

  it('EVM-020 AC5 errors of the server are matched to fields by the JSON Pointer; an unknown pointer matches none', () => {
    expect(fieldOf({ pointer: '/phone', code: 'invalid_format' })).toBe('phone');
    expect(fieldOf({ pointer: '/postalAddress/postalCode', code: 'invalid_format' })).toBe('postalCode');
    expect(fieldOf({ pointer: '/kind', code: 'required' })).toBeUndefined();
    expect(firstInvalid({ phone: 'x', lastName: 'y' })).toBe('lastName');
    expect(firstInvalid({})).toBeUndefined();
  });
});

describe('phone for the eye (EVM-020 AC1, AC3; styleguide § 6.3)', () => {
  it('EVM-020 AC1 a Polish E.164 number is grouped as +48 600 123 456 and any other text is shown as it came', () => {
    expect(formatPhone('+48600123456')).toBe('+48 600 123 456');
    expect(formatPhone('+4930123456')).toBe('+4930123456');
    expect(formatPhone('600123456')).toBe('600123456');
  });
});
