import { describe, expect, it } from 'vitest';
import { backoffDelay, parseRetryAfter, unitRandom, utf8Length } from '../src/util.ts';
import { seededRandom } from './helpers.ts';

describe('utilities (EVM-091 AC2, AC4)', () => {
  it('EVM-091 AC2: counts UTF-8 bytes like TextEncoder, including surrogate pairs and lone surrogates', () => {
    const samples = ['', 'abc', 'zażółć gęślą jaźń', '€', '😀 emoji', '\ud800', 'a\udc00b'];
    for (const text of samples) expect(utf8Length(text), text).toBe(new TextEncoder().encode(text).length);
  });

  it('EVM-091 AC4: Retry-After as seconds, HTTP-date or number is clamped to [1 s, max]; garbage is ignored', () => {
    const now = Date.UTC(2026, 9, 29, 8, 0, 0);
    const max = 3_600_000;
    expect(parseRetryAfter('30', now, max)).toBe(30_000);
    expect(parseRetryAfter(12, now, max)).toBe(12_000);
    expect(parseRetryAfter('0', now, max)).toBe(1000);
    expect(parseRetryAfter('999999999', now, max)).toBe(max);
    expect(parseRetryAfter('Thu, 29 Oct 2026 08:02:00 GMT', now, max)).toBe(120_000);
    expect(parseRetryAfter('Thu, 29 Oct 2026 07:00:00 GMT', now, max)).toBe(1000);
    for (const bad of ['-5', 'abc', '', '1e9', 'NaN', 'x'.repeat(100), undefined])
      expect(parseRetryAfter(bad, now, max), String(bad)).toBeUndefined();
    expect(parseRetryAfter(-3, now, max)).toBe(1000);
    expect(parseRetryAfter(Number.NaN, now, max)).toBeUndefined();
    expect(parseRetryAfter(Number.POSITIVE_INFINITY, now, max)).toBeUndefined();
    expect(parseRetryAfter('Someday soon', now, max)).toBeUndefined();
  });

  it('EVM-091 AC4: backoff grows exponentially up to the cap with jitter and never drops below one second', () => {
    const random = seededRandom(5);
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      const delay = backoffDelay(attempt, random, 2000, 300_000);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(Math.min(300_000, 2000 * 2 ** Math.min(attempt - 1, 30)));
    }
    const samples = new Set(Array.from({ length: 30 }, () => backoffDelay(10, random, 2000, 300_000)));
    expect(samples.size).toBeGreaterThan(20);
    expect(backoffDelay(0, random, 2000, 300_000)).toBeLessThanOrEqual(2000);
    expect(unitRandom({ getRandomValues: (b) => b.fill(255) })).toBeLessThan(1);
  });
});
