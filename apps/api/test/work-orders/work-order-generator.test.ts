import { describe, expect, it } from 'vitest';
import { assertSyntheticDataAllowed, numberOf, syntheticSpecs } from '../support/work-order-fixtures.ts';

describe('the generator of synthetic work orders (EVM-017 AC4; SR-INFRA-08)', () => {
  it('EVM-017 AC4 it refuses to run when NODE_ENV is production and runs in every other environment', () => {
    expect(() => {
      assertSyntheticDataAllowed({ NODE_ENV: 'production' });
    }).toThrow('NODE_ENV=production');
    for (const env of [{ NODE_ENV: 'test' }, { NODE_ENV: 'development' }, {}])
      expect(() => {
        assertSyntheticDataAllowed(env);
      }).not.toThrow();
  });

  it('EVM-017 AC4 10 000 orders are deterministic, have unique numbers of fixed width (at most 9999 a year) and cover every status', () => {
    const first = syntheticSpecs(10_000, ['a', 'b', 'c']);
    expect(syntheticSpecs(10_000, ['a', 'b', 'c'])).toEqual(first);
    expect(new Set(first.map((spec) => spec.number)).size).toBe(10_000);
    expect(first.every((spec) => /^ZL-20[0-9]{2}-[0-9]{4}$/.test(spec.number))).toBe(true);
    expect(new Set(first.map((spec) => spec.status)).size).toBe(8);
    const perYear = new Map<string, number>();
    for (const spec of first) perYear.set(spec.number.slice(3, 7), (perYear.get(spec.number.slice(3, 7)) ?? 0) + 1);
    expect(Math.max(...perYear.values())).toBeLessThanOrEqual(9999);
    expect(first.some((spec) => spec.coordinatorId === undefined)).toBe(true);
    expect(syntheticSpecs(3, []).every((spec) => spec.coordinatorId === undefined)).toBe(true);
  });

  it('EVM-017 AC4 titles are made of a fixed word list and a counter: nothing that looks like a person or an address', () => {
    for (const spec of syntheticSpecs(50, [])) expect(spec.title).toMatch(/^[^@\d]+ — [^@\d]+ #\d+$/);
    expect(numberOf(2026, 7)).toBe('ZL-2026-0007');
  });
});
