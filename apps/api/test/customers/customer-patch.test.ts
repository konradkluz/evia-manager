import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeNewCustomer, type CustomerInput } from '../../src/modules/customers/domain/customer.ts';
import { mergeCustomerPatch } from '../../src/modules/customers/domain/customer-patch.ts';
import {
  customerListQuerySchema,
  DEFAULT_LIMIT,
  parsePosition,
  positionParts,
  resolveCustomerListQuery,
} from '../../src/modules/customers/domain/customer-list-query.ts';
import { parseInput, strictObjects } from '../../src/platform/http/validation.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';
const person: CustomerInput = {
  id: ID,
  kind: 'person',
  firstName: 'Jan',
  lastName: 'Przykładowy',
  phone: '+48600000001',
  email: 'jan@example.test',
  notes: 'notatka',
  postalAddress: { street: 'Piotrkowska', buildingNumber: '1', postalCode: '90-001', city: 'Łódź' },
};
const company: CustomerInput = {
  id: ID,
  kind: 'company',
  companyName: 'Firma Testowa sp. z o.o.',
  taxId: '5260250274',
  contactPersonName: 'Anna Kontaktowa',
  phone: '+48600000002',
};

describe('the merge of a patch into a customer (EVM-039 AC3; SR-INPUT-01)', () => {
  it('EVM-039 AC3 a field that is absent stays, a field named replaces', () => {
    expect(mergeCustomerPatch(person, {})).toEqual({ ...person, taxId: undefined, companyName: undefined, contactPersonName: undefined });
    expect(mergeCustomerPatch(person, { phone: '600 000 002', lastName: 'Nowak' })).toMatchObject({
      phone: '600 000 002',
      lastName: 'Nowak',
      firstName: 'Jan',
      email: 'jan@example.test',
    });
  });

  it('EVM-039 AC3 null clears an optional field and only the field it names', () => {
    const merged = mergeCustomerPatch(person, { email: null, notes: null, postalAddress: null });
    expect(merged).toMatchObject({ email: undefined, notes: undefined, postalAddress: undefined, phone: '+48600000001', firstName: 'Jan' });
    const cleared = mergeCustomerPatch(company, { taxId: null, contactPersonName: null });
    expect(cleared).toMatchObject({ taxId: undefined, contactPersonName: undefined, companyName: 'Firma Testowa sp. z o.o.' });
  });

  it('EVM-039 AC3 a change of kind drops the fields of the previous kind and keeps the common ones', () => {
    const toCompany = mergeCustomerPatch(person, { kind: 'company', companyName: 'Firma Nowa' });
    expect(toCompany).toMatchObject({
      kind: 'company',
      companyName: 'Firma Nowa',
      firstName: undefined,
      lastName: undefined,
      phone: '+48600000001',
      email: 'jan@example.test',
      notes: 'notatka',
    });
    expect(mergeCustomerPatch(company, { kind: 'person', firstName: 'Ewa', lastName: 'Nowak' })).toMatchObject({
      kind: 'person',
      companyName: undefined,
      taxId: undefined,
      contactPersonName: undefined,
      firstName: 'Ewa',
    });
    expect(mergeCustomerPatch(person, { kind: 'person' })).toMatchObject({ firstName: 'Jan' }); // the same kind is no change
  });

  it('EVM-039 AC3 the merged customer meets the SAME rules as a new one: a missing name of the new kind, a field of the old kind, a bad NIP', () => {
    const rules = (patch: Parameters<typeof mergeCustomerPatch>[1], from: CustomerInput = person) => {
      const result = normalizeNewCustomer(mergeCustomerPatch(from, patch));
      return result.ok ? [] : result.errors;
    };
    expect(rules({ kind: 'company' })).toEqual([{ pointer: '/companyName', code: 'required' }]);
    expect(rules({ kind: 'company', companyName: 'Firma', firstName: 'Jan' })).toEqual([
      { pointer: '/firstName', code: 'not_allowed_for_kind' },
    ]);
    expect(rules({ taxId: '1234567890' }, company)).toEqual([{ pointer: '/taxId', code: 'invalid_format' }]);
    expect(rules({ phone: '12345' })).toEqual([{ pointer: '/phone', code: 'invalid_format' }]);
    expect(rules({ phone: '600 000 009', email: 'JAN@Example.TEST' })).toEqual([]);
  });
});

describe('the query of the list of customers (EVM-039 AC1; SR-INPUT-01, SR-INPUT-03)', () => {
  const parse = (query: unknown) => customerListQuerySchema.safeParse(query);

  it('EVM-039 AC1 an empty query takes the default page of 25 and no cursor', () => {
    expect(parseInput(resolveCustomerListQuery, {})).toEqual({ limit: DEFAULT_LIMIT, cursor: undefined });
    expect(DEFAULT_LIMIT).toBe(25);
  });

  it('EVM-039 AC1 limit is 1..100 in digits; any other value, an unknown key (a phrase, a sort) and a bad cursor are refused', () => {
    expect(parseInput(resolveCustomerListQuery, { limit: '100' }).limit).toBe(100);
    for (const limit of ['0', '101', '-1', '1.5', 'abc', '', '0001x']) expect(parse({ limit }).success, limit).toBe(false);
    for (const key of ['q', 'query', 'sort', 'search']) expect(parse({ [key]: 'x' }).success, key).toBe(false);
    expect(parse({ cursor: 'abc_-123' }).success).toBe(true);
    for (const cursor of ['a b', 'a+b', 'a=b', 'x'.repeat(513)]) expect(parse({ cursor }).success, cursor).toBe(false);
  });

  it('EVM-039 AC1 A1 the position of a cursor is the identifier alone — no name, and a position that is not one identifier is nothing', () => {
    expect(positionParts(ID)).toEqual([ID]);
    expect(parsePosition([ID])).toBe(ID);
    for (const parts of [[], ['abc'], [ID, ID], [ID, 'Testowy Łukasz'], ['Testowy Łukasz']])
      expect(parsePosition(parts), JSON.stringify(parts)).toBeUndefined();
  });
});

describe('strict objects close the nested ones through a nullable too (EVM-039 AC4; CWE-915)', () => {
  const schema = strictObjects(z.object({ address: z.object({ street: z.string() }).nullish() }));

  it('EVM-039 AC4 a field the nested object does not declare is unknown_field, a null address is fine', () => {
    expect(parseInput(schema, { address: null })).toEqual({ address: null });
    expect(parseInput(schema, { address: { street: 'A' } })).toEqual({ address: { street: 'A' } });
    try {
      parseInput(schema, { address: { street: 'A', extra: 1 } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).extras.errors).toEqual([{ pointer: '/address/extra', code: 'unknown_field' }]);
    }
  });
});
