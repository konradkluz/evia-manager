import { zCustomer, zCustomerWritable, zRegisterPasskeyRequest, zSetActivationPasswordRequestWritable } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../src/platform/http/validation.ts';

const errorsOf = (schema: z.ZodType, input: unknown) => {
  try {
    parseInput(schema, input);
  } catch (error) {
    if (error instanceof ProblemException) return { code: error.code, errors: error.extras.errors };
    throw error;
  }
  return undefined;
};

const token = 'A'.repeat(43);
const credential = { id: 'abc', rawId: 'abc', type: 'public-key', response: { clientDataJSON: 'e30', attestationObject: 'e30' } };

describe('input validation at the boundary (EVM-016 AC3; SR-INPUT-01, SR-ERR-02)', () => {
  it('EVM-016 AC3 a valid body is returned as parsed', () => {
    const schema = strictObjects(zSetActivationPasswordRequestWritable);
    expect(parseInput(schema, { token, password: 'a long enough passphrase' })).toEqual({ token, password: 'a long enough passphrase' });
  });

  it('EVM-016 AC3 errors are JSON Pointer + code per field and never contain the value', () => {
    const schema = strictObjects(zSetActivationPasswordRequestWritable);
    const result = errorsOf(schema, { token: 'short', password: 'x'.repeat(300), surplus: 'sekret-wartosc' });
    expect(result?.code).toBe('validation_failed');
    expect(result?.errors).toEqual(
      expect.arrayContaining([
        { pointer: '/token', code: 'too_short' },
        { pointer: '/password', code: 'too_long' },
        { pointer: '/surplus', code: 'unknown_field' },
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(/sekret-wartosc|xxxxxxxx/);
  });

  it.each([
    [undefined, [{ pointer: '', code: 'required' }]],
    [null, [{ pointer: '', code: 'invalid_type' }]],
    ['text', [{ pointer: '', code: 'invalid_type' }]],
    [
      {},
      [
        { pointer: '/token', code: 'required' },
        { pointer: '/password', code: 'required' },
      ],
    ],
    [{ token: 5, password: 'x' }, [{ pointer: '/token', code: 'invalid_type' }]],
    [{ token: '!'.repeat(43), password: 'x' }, [{ pointer: '/token', code: 'invalid_format' }]],
  ])('EVM-016 AC3 body %j gives %j', (body, expected) => {
    const result = errorsOf(strictObjects(zSetActivationPasswordRequestWritable), body);
    expect(result?.errors).toEqual(expect.arrayContaining(expected));
  });

  it('EVM-016 AC4 a body carrying userId or sessionId is rejected, also __proto__ and constructor (CWE-915, CWE-1321)', () => {
    const schema = strictObjects(zRegisterPasskeyRequest);
    expect(errorsOf(schema, { credential })).toBeUndefined();
    for (const extra of ['userId', 'sessionId', 'role']) {
      expect(errorsOf(schema, { credential, [extra]: 'x' })?.errors, extra).toEqual([{ pointer: `/${extra}`, code: 'unknown_field' }]);
    }
    const polluted = JSON.parse(
      `{"credential":${JSON.stringify(credential)},"__proto__":{"admin":true},"constructor":{"prototype":{}}}`,
    ) as unknown;
    expect(errorsOf(schema, polluted)?.errors).toEqual(
      expect.arrayContaining([
        { pointer: '/__proto__', code: 'unknown_field' },
        { pointer: '/constructor', code: 'unknown_field' },
      ]),
    );
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });

  it('EVM-016 AC4 nested objects are closed too, while the open dictionary of extension results stays open', () => {
    const schema = strictObjects(zRegisterPasskeyRequest);
    const surplus = { ...credential, response: { ...credential.response, surplus: 1 } };
    expect(errorsOf(schema, { credential: surplus })?.errors).toEqual([{ pointer: '/credential/response/surplus', code: 'unknown_field' }]);
    expect(
      errorsOf(schema, { credential: { ...credential, clientExtensionResults: { credProps: { rk: true }, largeBlob: {} } } }),
    ).toBeUndefined();
    expect(
      errorsOf(schema, { credential: { ...credential, response: { ...credential.response, transports: ['usb', 'nfc'] } } }),
    ).toBeUndefined();
    expect(
      errorsOf(schema, { credential: { ...credential, response: { ...credential.response, transports: ['telepathy'] } } })?.errors,
    ).toEqual([{ pointer: '/credential/response/transports/0', code: 'invalid_value' }]);
  });

  it('EVM-016 AC3 pointers escape ~ and / and the list of errors is bounded', () => {
    const schema = z.strictObject({ items: z.array(z.string().max(1)) });
    expect(errorsOf(schema, { items: Array.from({ length: 50 }, () => 'xx') })?.errors).toHaveLength(20);
    expect(errorsOf(z.strictObject({ 'a/b~c': z.string() }), { 'a/b~c': 5 })?.errors).toEqual([
      { pointer: '/a~1b~0c', code: 'invalid_type' },
    ]);
    expect(
      errorsOf(
        z.number().refine((value) => value > 5),
        3,
      )?.errors,
    ).toEqual([{ pointer: '', code: 'invalid' }]);
  });

  it('EVM-016 AC4 optional and array wrappers are closed as well as plain objects', () => {
    const schema = strictObjects(z.object({ list: z.array(z.object({ id: z.string() })).optional(), name: z.string().optional() }));
    expect(errorsOf(schema, {})).toBeUndefined();
    expect(errorsOf(schema, { list: [{ id: 'a', extra: 1 }] })?.errors).toEqual([{ pointer: '/list/0/extra', code: 'unknown_field' }]);
    expect(errorsOf(schema, { name: 'x', other: true })?.errors).toEqual([{ pointer: '/other', code: 'unknown_field' }]);
  });

  it('EVM-016 AC4 limits of the contract survive closing the objects (array above maxItems, refinements)', () => {
    const schema = strictObjects(zRegisterPasskeyRequest);
    const transports = Array.from({ length: 5000 }, () => 'usb');
    expect(errorsOf(schema, { credential: { ...credential, response: { ...credential.response, transports } } })?.errors).toEqual([
      { pointer: '/credential/response/transports', code: 'too_long' },
    ]);
    const refined = strictObjects(z.object({ a: z.number() }).refine((value) => value.a > 5));
    expect(errorsOf(refined, { a: 3 })?.errors).toEqual([{ pointer: '', code: 'invalid' }]);
    expect(errorsOf(refined, { a: 9 })).toBeUndefined();
  });

  it('EVM-016 AC4 a request that never went through the session middleware is anonymous (fail closed)', async () => {
    const { authenticationOf, principalOf, ANONYMOUS } = await import('../../src/platform/http/principal.ts');
    expect(authenticationOf({} as never)).toBe(ANONYMOUS);
    expect(principalOf({} as never)).toBeNull();
  });
});

describe('the fields of the server (EVM-020 AC5; SR-AUTHZ-04, CWE-915)', () => {
  const customer = {
    id: '0198b0a0-0000-7000-8000-000000000001',
    kind: 'person',
    firstName: 'Jan',
    lastName: 'Przykładowy',
    phone: '600000001',
  };
  const schema = strictObjects(zCustomerWritable);
  const serverFields = readOnlyKeys(zCustomer, zCustomerWritable);
  const codesOf = (input: unknown, readOnly = serverFields) => {
    try {
      parseInput(schema, input, readOnly);
    } catch (error) {
      if (error instanceof ProblemException) return error.extras.errors;
      throw error;
    }
    return undefined;
  };

  it('EVM-020 AC5 the readOnly keys are what the resource has and its writable variant lacks — derived from the contract, not listed by hand', () => {
    expect([...serverFields].sort()).toEqual(
      [
        'createdAt',
        'createdBy',
        'deletedAt',
        'deletedBy',
        'displayName',
        'searchText',
        'sortName',
        'updatedAt',
        'updatedBy',
        'version',
      ].sort(),
    );
  });

  it('EVM-020 AC5 a field of the server is read_only_field, a field nobody knows is unknown_field; neither value appears', () => {
    const errors = codesOf({
      ...customer,
      searchText: 'sekret-wartosc',
      version: 7,
      createdAt: '2026-10-07T08:00:00Z',
      surplus: 'obca-wartosc',
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        { pointer: '/searchText', code: 'read_only_field' },
        { pointer: '/version', code: 'read_only_field' },
        { pointer: '/createdAt', code: 'read_only_field' },
        { pointer: '/surplus', code: 'unknown_field' },
      ]),
    );
    expect(JSON.stringify(errors)).not.toMatch(/sekret-wartosc|obca-wartosc/);
  });

  it('EVM-020 AC5 only a key at the root can be a field of the server: the same name inside a nested object is an unknown field', () => {
    const errors = codesOf({
      ...customer,
      postalAddress: { street: 'Piotrkowska', buildingNumber: '1', postalCode: '90-001', city: 'Łódź', version: 2 },
    });
    expect(errors).toEqual([{ pointer: '/postalAddress/version', code: 'unknown_field' }]);
  });

  it('EVM-020 AC5 without the set of server fields every unknown key stays unknown_field (the default of the other operations)', () => {
    expect(codesOf({ ...customer, version: 7 }, new Set())).toEqual([{ pointer: '/version', code: 'unknown_field' }]);
  });
});
