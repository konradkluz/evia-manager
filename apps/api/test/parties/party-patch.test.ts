import { zParty, zPartyPatch } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../src/platform/http/validation.ts';
import { normalizeNewParty, type PartyInput } from '../../src/modules/parties/domain/party.ts';
import { mergePartyPatch } from '../../src/modules/parties/domain/party-patch.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';
const party: PartyInput = {
  id: ID,
  kind: 'property_manager',
  legalForm: 'organization',
  displayName: 'Zarządca Testowy',
  contactPersonName: 'Anna Kontaktowa',
  phone: '+48600000001',
  email: 'biuro@example.test',
  notes: 'notatka',
};
const rules = (patch: Parameters<typeof mergePartyPatch>[1]) => {
  const result = normalizeNewParty(mergePartyPatch(party, patch));
  return result.ok ? [] : result.errors;
};

describe('the merge of a patch into a party (EVM-036 AC3; SR-INPUT-01, SR-DATA-02)', () => {
  it('EVM-036 AC3 a field that is absent stays, a field named replaces, the kind is the stored one', () => {
    expect(mergePartyPatch(party, {})).toEqual(party);
    expect(mergePartyPatch(party, { displayName: 'Nowa Nazwa', phone: '600 000 002', legalForm: 'natural_person' })).toMatchObject({
      kind: 'property_manager',
      displayName: 'Nowa Nazwa',
      phone: '600 000 002',
      legalForm: 'natural_person',
      email: 'biuro@example.test',
    });
  });

  it('EVM-036 AC3 null clears an optional field and only the field it names', () => {
    expect(mergePartyPatch(party, { phone: null, email: null, notes: null, contactPersonName: null })).toMatchObject({
      phone: undefined,
      email: undefined,
      notes: undefined,
      contactPersonName: undefined,
      displayName: 'Zarządca Testowy',
    });
  });

  it('EVM-036 AC3 the merged party meets the SAME rules as a new one: telephone E.164, e-mail, name, plain text', () => {
    expect(rules({ phone: '12345' })).toEqual([{ pointer: '/phone', code: 'invalid_format' }]);
    expect(rules({ email: 'not-an-email' })).toEqual([{ pointer: '/email', code: 'invalid_format' }]);
    expect(rules({ displayName: '   ' })).toEqual([{ pointer: '/displayName', code: 'required' }]);
    expect(rules({ phone: '600 000 009', email: 'BIURO@Example.TEST' })).toEqual([]);
  });
});

describe('the body of the patch of a party (EVM-036 AC3, AC7; SR-AUTHZ-04, CWE-915)', () => {
  const schema = strictObjects(zPartyPatch);
  const serverFields = readOnlyKeys(zParty, zPartyPatch);
  const errors = (body: unknown): unknown => {
    try {
      parseInput(schema, body, serverFields);
    } catch (error) {
      return (error as ProblemException).extras.errors;
    }
    return undefined;
  };

  it('EVM-036 AC3 the kind is immutable: naming it is read_only_field, like id and version', () => {
    expect(errors({ kind: 'designer' })).toEqual([{ pointer: '/kind', code: 'read_only_field' }]);
    expect(errors({ id: ID, version: 2 })).toEqual([
      { pointer: '/id', code: 'read_only_field' },
      { pointer: '/version', code: 'read_only_field' },
    ]);
  });

  it('EVM-036 AC7 a stranger is unknown_field; null is for the optional fields only', () => {
    expect(errors({ customerId: ID })).toEqual([{ pointer: '/customerId', code: 'unknown_field' }]);
    expect(errors(JSON.parse('{"__proto__":{"x":1}}'))).toEqual([{ pointer: '/__proto__', code: 'unknown_field' }]);
    expect(errors({ phone: null, notes: null })).toBeUndefined();
    expect(errors({ displayName: null })).toEqual([{ pointer: '/displayName', code: 'invalid_type' }]);
  });
});
