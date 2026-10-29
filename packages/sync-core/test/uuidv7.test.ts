import { describe, expect, it } from 'vitest';
import { CLIENT_ID_PATTERN, createUuidV7 } from '../src/index.ts';
import { FakeClock, seededRandom } from './helpers.ts';

describe('UUIDv7 generator (EVM-091 AC1; RFC 9562, SR-CRYPTO-03)', () => {
  it('EVM-091 AC1: sets version 7 and variant 10, matches the contract SyncClientId pattern and encodes the millisecond timestamp', () => {
    const clock = new FakeClock(Date.UTC(2026, 9, 29, 8, 0, 0));
    const next = createUuidV7(clock, seededRandom(3));
    for (let i = 0; i < 200; i += 1) {
      clock.advance(1);
      const id = next();
      expect(id).toMatch(CLIENT_ID_PATTERN);
      expect(id[14]).toBe('7');
      expect('89ab').toContain(id[19]);
      expect(Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)).toBe(clock.now());
    }
  });

  it('EVM-091 AC1: is strictly increasing within one millisecond, also across a counter overflow and a clock going backwards', () => {
    const clock = new FakeClock();
    const next = createUuidV7(clock, seededRandom(11));
    const ids = Array.from({ length: 10_000 }, () => next());
    clock.ms -= 5_000;
    ids.push(next(), next());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('EVM-091 AC1: takes its random bits from the injected source (different sources give different ids)', () => {
    const a = createUuidV7(new FakeClock(), seededRandom(1))();
    const b = createUuidV7(new FakeClock(), seededRandom(2))();
    expect(a).not.toBe(b);
    expect(a.slice(0, 13)).toBe(b.slice(0, 13));
  });
});
