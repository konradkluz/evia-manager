import { describe, expect, it } from 'vitest';
import { canonicalJson, requestHash } from '../../src/platform/idempotency/canonical-json.ts';

describe('the identity of a request body (EVM-020 AC4; SR-API-05)', () => {
  it('EVM-020 AC4 keys are sorted at every depth, arrays keep their order, undefined members are dropped', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null }, e: undefined })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson(null)).toBe('null');
  });

  it('EVM-020 AC4 the same content in another key order has the same hash; other content has another; the hash is 64 hex digits', () => {
    const one = requestHash({ id: '1', phone: '600000001', postalAddress: { city: 'Łódź', street: 'Piotrkowska' } });
    const two = requestHash({ postalAddress: { street: 'Piotrkowska', city: 'Łódź' }, phone: '600000001', id: '1' });
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(requestHash({ id: '1', phone: '600000002' })).not.toBe(requestHash({ id: '1', phone: '600000001' }));
    expect(requestHash({ a: [1, 2] })).not.toBe(requestHash({ a: [2, 1] }));
  });
});
