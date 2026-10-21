import { describe, expect, it } from 'vitest';
import { backoffDelayMs } from '../src/backoff.ts';

describe('EVM-011 AC1 exponential backoff with full jitter', () => {
  it('EVM-011 AC1 grows exponentially up to the cap (rng = 0.999..)', () => {
    const rng = () => 0.9999999;
    const d = [0, 1, 2, 3, 4, 10].map((a) => backoffDelayMs(a, { baseMs: 1000, capMs: 30000 }, rng));
    expect(d[0]).toBeGreaterThanOrEqual(999);
    expect(d[1]).toBeGreaterThanOrEqual(1999);
    expect(d[2]).toBeGreaterThanOrEqual(3999);
    expect(d[3]).toBeGreaterThanOrEqual(7999);
    expect(d[5]).toBeLessThanOrEqual(30000);
    expect(d[5]).toBeGreaterThanOrEqual(29999);
  });

  it('EVM-011 AC1 applies jitter: the delay lies in [0, ceiling] and is 0 for rng = 0', () => {
    expect(backoffDelayMs(3, { baseMs: 1000, capMs: 60000 }, () => 0)).toBe(0);
    for (let i = 0; i < 100; i++) {
      const v = backoffDelayMs(3, { baseMs: 1000, capMs: 60000 });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(8000);
    }
  });

  it('EVM-011 AC1 rejects a negative attempt', () => {
    expect(() => backoffDelayMs(-1)).toThrow();
  });
});
