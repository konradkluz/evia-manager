import { zRegisterPasskeyRequest, zSetActivationPasswordRequestWritable } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { parseInput, strictObjects } from '../../src/platform/http/validation.ts';

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
});
