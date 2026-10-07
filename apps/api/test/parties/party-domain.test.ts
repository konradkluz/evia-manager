import { describe, expect, it } from 'vitest';
import { normalizeNewParty, PARTY_KINDS, type PartyInput } from '../../src/modules/parties/domain/party.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';
const operator: PartyInput = { id: ID, kind: 'distribution_system_operator', legalForm: 'organization', displayName: 'Operator Testowy' };

describe('a new party (EVM-021 AC4, AC5; SR-INPUT-01, SR-INPUT-05)', () => {
  it('EVM-021 AC4 the minimum is the kind, the form and the name; everything else is absent (null)', () => {
    expect(normalizeNewParty(operator)).toEqual({
      ok: true,
      party: {
        id: ID,
        kind: 'distribution_system_operator',
        legalForm: 'organization',
        displayName: 'Operator Testowy',
        contactPersonName: null,
        phone: null,
        email: null,
        notes: null,
      },
    });
  });

  it('EVM-021 AC4 the telephone becomes E.164, the e-mail lower case, the texts NFC and trimmed; empty optional texts are absent', () => {
    const result = normalizeNewParty({
      ...operator,
      displayName: '  Stoeń Operator ',
      contactPersonName: ' Anna Kontaktowa ',
      phone: '600 000 002',
      email: ' Biuro@Example.TEST ',
      notes: 'Linia 1\r\nLinia 2',
    });
    expect(result).toMatchObject({
      ok: true,
      party: {
        displayName: 'Stoeń Operator',
        contactPersonName: 'Anna Kontaktowa',
        phone: '+48600000002',
        email: 'biuro@example.test',
        notes: 'Linia 1\nLinia 2',
      },
    });
    expect(normalizeNewParty({ ...operator, contactPersonName: '  ', phone: '', email: ' ', notes: '\n' })).toMatchObject({
      ok: true,
      party: { contactPersonName: null, phone: null, email: null, notes: null },
    });
  });

  it('EVM-021 AC5 every wrong field at once: pointers and codes, never the values', () => {
    const result = normalizeNewParty({
      ...operator,
      displayName: '   ',
      contactPersonName: 'x'.repeat(201),
      phone: 'sekretny-telefon',
      email: 'sekretny-email',
      notes: 'zły\u0000znak',
    });
    expect(result).toEqual({
      ok: false,
      errors: [
        { pointer: '/displayName', code: 'required' },
        { pointer: '/contactPersonName', code: 'too_long' },
        { pointer: '/phone', code: 'invalid_format' },
        { pointer: '/email', code: 'invalid_format' },
        { pointer: '/notes', code: 'invalid_characters' },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/sekretny|zły/);
  });

  it('EVM-021 AC3 the dictionary has the ten kinds of the model, the OSD among them', () => {
    expect(PARTY_KINDS).toHaveLength(10);
    expect(PARTY_KINDS).toContain('distribution_system_operator');
  });
});
