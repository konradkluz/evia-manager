import { describe, expect, it } from 'vitest';
import { normalizeQuickCustomer, splitPersonName } from '../../src/modules/customers/domain/quick-customer.ts';
import { uuidv7 } from '../support/uuid.ts';

const person = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  kind: 'person' as const,
  displayName: 'Jan Przykładowy',
  phone: '600 000 001',
  ...overrides,
});

describe('the new customer of a quick work order (EVM-099 AC2)', () => {
  it('EVM-099 AC2 a person is split at the LAST space: everything before it is the first name, the last word the surname', () => {
    expect(splitPersonName('Jan Maria Przykładowy')).toEqual(['Jan Maria', 'Przykładowy']);
    expect(splitPersonName('  Jan   Przykładowy ')).toEqual(['Jan', 'Przykładowy']);
    const result = normalizeQuickCustomer(person({ displayName: 'Jan Maria Przykładowy' }));
    expect(result.ok && [result.customer.firstName, result.customer.lastName]).toEqual(['Jan Maria', 'Przykładowy']);
  });

  it('EVM-099 AC2 a single word as the name of a person is refused with a pointer and a code (no value)', () => {
    const result = normalizeQuickCustomer(person({ displayName: 'Przykładowy' }));
    expect(result).toEqual({ ok: false, errors: [{ pointer: '/newCustomer/displayName', code: 'single_word_name' }] });
    expect(JSON.stringify(result)).not.toContain('Przykładowy');
  });

  it('EVM-099 AC2 a company keeps its name whole; the other fields stay empty', () => {
    const result = normalizeQuickCustomer(person({ kind: 'company', displayName: 'Firma Fikcyjna' }));
    expect(result.ok && result.customer).toMatchObject({
      kind: 'company',
      companyName: 'Firma Fikcyjna',
      firstName: null,
      lastName: null,
      taxId: null,
      email: null,
      address: null,
      notes: null,
      contactPersonName: null,
    });
  });

  it.each(['600000001', '600 000 001', '600-000-001', '+48 600 000 001', '0048600000001'])(
    'EVM-099 AC2 the telephone %s is normalised to E.164 like in the panel',
    (phone) => {
      const result = normalizeQuickCustomer(person({ phone }));
      expect(result.ok && result.customer.phone).toBe('+48600000001');
    },
  );

  it('EVM-099 AC5 a bad telephone is invalid_format at /newCustomer/phone and the value is not in the answer', () => {
    const result = normalizeQuickCustomer(person({ phone: '12345' }));
    expect(result).toEqual({ ok: false, errors: [{ pointer: '/newCustomer/phone', code: 'invalid_format' }] });
    expect(JSON.stringify(result)).not.toContain('12345');
  });

  it('EVM-099 AC5 control characters in the name are refused at the pointer of the display name', () => {
    const result = normalizeQuickCustomer(person({ displayName: 'Jan\u0007 Przykładowy' }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.every((error) => error.pointer === '/newCustomer/displayName')).toBe(true);
  });
});
