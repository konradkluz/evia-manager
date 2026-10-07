import { describe, expect, it } from 'vitest';
import { normalizeNewCustomer, type CustomerInput } from '../../src/modules/customers/domain/customer.ts';
import { normalizeEmail } from '../../src/platform/input/email.ts';
import { normalizePhone } from '../../src/platform/input/phone.ts';
import { plainText } from '../../src/platform/input/plain-text.ts';
import { resolveSearchQuery } from '../../src/modules/customers/domain/search-query.ts';
import { normalizeTaxId } from '../../src/modules/customers/domain/tax-id.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';
const person: CustomerInput = { id: ID, kind: 'person', firstName: 'Jan', lastName: 'Przykładowy', phone: '600 000 001' };
const company: CustomerInput = { id: ID, kind: 'company', companyName: 'Firma Testowa sp. z o.o.', phone: '+48 600 000 002' };

describe('telephone to E.164 (EVM-020 AC2)', () => {
  it.each([
    ['+48 600 000 001', '+48600000001'],
    ['600000001', '+48600000001'],
    ['600-000-001', '+48600000001'],
    ['(600) 000 001', '+48600000001'],
    ['0048 600 000 001', '+48600000001'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('EVM-020 AC2 %s -> %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    '12345',
    '0600000001',
    '+0600000001',
    '+48 600 000 001 ext',
    'abc',
    '+48+600000001',
    '+1234567890123456',
    '6'.repeat(33),
  ])('EVM-020 AC2 "%s" is not a telephone number', (raw) => {
    expect(normalizePhone(raw)).toBeUndefined();
  });
});

describe('NIP and e-mail (EVM-020 AC2)', () => {
  it('EVM-020 AC2 NIP: 10 digits with the control sum, PL prefix, spaces and hyphens accepted', () => {
    expect(normalizeTaxId('5260250274')).toBe('5260250274');
    expect(normalizeTaxId('PL 526-025-02-74')).toBe('5260250274');
    expect(normalizeTaxId('5260250275')).toBeUndefined(); // wrong control digit
    expect(normalizeTaxId('526025027')).toBeUndefined();
    expect(normalizeTaxId('52602502a4')).toBeUndefined();
  });

  it('EVM-020 AC2 e-mail: lower case, trimmed; shapes without an @, a domain dot, or with spaces are refused', () => {
    expect(normalizeEmail('  Jan.Przykladowy@Example.TEST ')).toBe('jan.przykladowy@example.test');
    for (const bad of [
      '',
      'jan',
      'jan@',
      '@example.test',
      'jan@example',
      'jan@@example.test',
      'a b@example.test',
      'jan@example..test',
      `${'a'.repeat(65)}@example.test`,
    ])
      expect(normalizeEmail(bad), bad).toBeUndefined();
    expect(normalizeEmail(`a@${'b'.repeat(260)}.test`)).toBeUndefined();
  });
});

describe('plain text (EVM-020 AC5; SR-INPUT-05)', () => {
  it('EVM-020 AC5 NFC once, trimmed; empty is absent; a control or invisible character is refused; a new line only in a multi-line field', () => {
    expect(plainText('  Zażółć́ ', { maxLength: 50 })).toEqual({ ok: true, value: 'Zażółć́'.normalize('NFC') });
    expect(plainText('   ', { maxLength: 5 })).toEqual({ ok: true, value: undefined });
    expect(plainText(undefined, { maxLength: 5 })).toEqual({ ok: true, value: undefined });
    expect(plainText('a\u0000b', { maxLength: 5 })).toEqual({ ok: false, code: 'invalid_characters' });
    expect(plainText('a‮b', { maxLength: 5 })).toEqual({ ok: false, code: 'invalid_characters' });
    expect(plainText('a\nb', { maxLength: 5 })).toEqual({ ok: false, code: 'invalid_characters' });
    expect(plainText('a\r\nb\rc', { maxLength: 9, multiline: true })).toEqual({ ok: true, value: 'a\nb\nc' });
    expect(plainText('a\tb', { maxLength: 9, multiline: true })).toEqual({ ok: false, code: 'invalid_characters' });
    expect(plainText('abcdef', { maxLength: 5 })).toEqual({ ok: false, code: 'too_long' });
  });
});

describe('a new customer (EVM-020 AC2, AC5)', () => {
  it('EVM-020 AC2 a person: names, E.164 telephone, lower-case e-mail, optional address and notes', () => {
    const result = normalizeNewCustomer({
      ...person,
      email: 'Jan@Example.TEST',
      notes: 'Dzwonić po 16:00',
      postalAddress: { street: 'Piotrkowska', buildingNumber: '1', apartmentNumber: ' 5 ', postalCode: '90-001', city: 'Łódź' },
    });
    expect(result).toEqual({
      ok: true,
      customer: {
        id: ID,
        kind: 'person',
        firstName: 'Jan',
        lastName: 'Przykładowy',
        companyName: null,
        taxId: null,
        contactPersonName: null,
        phone: '+48600000001',
        email: 'jan@example.test',
        address: { street: 'Piotrkowska', buildingNumber: '1', apartmentNumber: '5', postalCode: '90-001', city: 'Łódź' },
        notes: 'Dzwonić po 16:00',
      },
    });
  });

  it('EVM-020 AC2 a company: name, optional NIP and contact person; no address or e-mail is null', () => {
    const result = normalizeNewCustomer({ ...company, taxId: '526-025-02-74', contactPersonName: 'Anna Kontaktowa' });
    expect(result).toMatchObject({
      ok: true,
      customer: {
        kind: 'company',
        companyName: 'Firma Testowa sp. z o.o.',
        taxId: '5260250274',
        contactPersonName: 'Anna Kontaktowa',
        email: null,
        address: null,
        notes: null,
      },
    });
  });

  it('EVM-020 AC2 the errors are JSON Pointers and codes of every wrong field at once, never the values', () => {
    const result = normalizeNewCustomer({
      ...company,
      phone: 'not a number',
      email: 'secret-value',
      taxId: '1234567890',
      notes: 'bad\u0000',
      postalAddress: { street: ' ', buildingNumber: '1', postalCode: '123', city: 'Łódź' },
    });
    expect(result).toEqual({
      ok: false,
      errors: [
        { pointer: '/taxId', code: 'invalid_format' },
        { pointer: '/phone', code: 'invalid_format' },
        { pointer: '/email', code: 'invalid_format' },
        { pointer: '/postalAddress/street', code: 'required' },
        { pointer: '/postalAddress/postalCode', code: 'invalid_format' },
        { pointer: '/notes', code: 'invalid_characters' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('EVM-020 AC2 the rules of the kind: a person needs both names, a company a name; the fields of the other kind are refused', () => {
    expect(normalizeNewCustomer({ id: ID, kind: 'person', phone: '600000001' })).toEqual({
      ok: false,
      errors: [
        { pointer: '/firstName', code: 'required' },
        { pointer: '/lastName', code: 'required' },
      ],
    });
    expect(normalizeNewCustomer({ ...person, companyName: 'X', taxId: '5260250274', contactPersonName: 'Y', phone: '600000001' })).toEqual({
      ok: false,
      errors: [
        { pointer: '/companyName', code: 'not_allowed_for_kind' },
        { pointer: '/taxId', code: 'not_allowed_for_kind' },
        { pointer: '/contactPersonName', code: 'not_allowed_for_kind' },
      ],
    });
    expect(normalizeNewCustomer({ id: ID, kind: 'company', firstName: 'Jan', lastName: 'K', phone: '600000001' })).toEqual({
      ok: false,
      errors: [
        { pointer: '/firstName', code: 'not_allowed_for_kind' },
        { pointer: '/lastName', code: 'not_allowed_for_kind' },
        { pointer: '/companyName', code: 'required' },
      ],
    });
    // an empty text of the other kind counts as absent
    expect(normalizeNewCustomer({ ...person, companyName: '  ', taxId: '' })).toMatchObject({ ok: true });
    expect(normalizeNewCustomer({ ...company, email: ' ', taxId: ' ' })).toMatchObject({
      ok: true,
      customer: { email: null, taxId: null },
    });
  });

  it('EVM-020 AC5 a name over 200 characters and an invisible character are errors of the field', () => {
    expect(normalizeNewCustomer({ ...person, lastName: 'a'.repeat(201) })).toEqual({
      ok: false,
      errors: [{ pointer: '/lastName', code: 'too_long' }],
    });
    expect(normalizeNewCustomer({ ...person, firstName: 'J​an' })).toEqual({
      ok: false,
      errors: [{ pointer: '/firstName', code: 'invalid_characters' }],
    });
  });
});

describe('the search phrase (EVM-020 AC1, AC3; SR-INPUT-03)', () => {
  it('EVM-020 AC1 NFC, trimmed, white space collapsed; 3 to 100 characters', () => {
    expect(resolveSearchQuery('  Lodz ')).toEqual({ ok: true, term: 'Lodz' });
    expect(resolveSearchQuery('Jan\t  Przykl')).toEqual({ ok: true, term: 'Jan Przykl' });
    expect(resolveSearchQuery('Jan   Przykl')).toEqual({ ok: true, term: 'Jan Przykl' });
    expect(resolveSearchQuery('  ab ')).toEqual({ ok: false, errors: [{ pointer: '/query', code: 'too_short' }] });
    expect(resolveSearchQuery('ab')).toEqual({ ok: false, errors: [{ pointer: '/query', code: 'too_short' }] });
    expect(resolveSearchQuery('a'.repeat(100))).toMatchObject({ ok: true });
    expect(resolveSearchQuery('a'.repeat(101))).toEqual({ ok: false, errors: [{ pointer: '/query', code: 'too_long' }] });
    expect(resolveSearchQuery('a\u0000bc')).toEqual({ ok: false, errors: [{ pointer: '/query', code: 'invalid_characters' }] });
  });

  it('EVM-020 AC3 a telephone phrase becomes its digits, with a 00 prefix cut, whatever the way of writing', () => {
    for (const phrase of ['+48 600 000 001', '(48) 600-000-001', '0048600000001'])
      expect(resolveSearchQuery(phrase), phrase).toEqual({ ok: true, term: '48600000001' });
    expect(resolveSearchQuery('600 000 001')).toEqual({ ok: true, term: '600000001' });
    // too few digits or a letter: an ordinary phrase
    expect(resolveSearchQuery('001')).toEqual({ ok: true, term: '001' });
    expect(resolveSearchQuery('+ +')).toEqual({ ok: true, term: '+ +' });
    expect(resolveSearchQuery('3M Polska')).toEqual({ ok: true, term: '3M Polska' });
  });
});
