import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter, RATE_LIMITS, WINDOW_MS } from '../../src/platform/http/rate-limiter.ts';
import { FixedClock } from '../support/clock.ts';

const limiter = (maxKeys?: number) => {
  const clock = new FixedClock('2026-10-01T08:00:00Z');
  return { clock, limiter: new InMemoryRateLimiter(clock, maxKeys) };
};

describe('per-IP rate limits (EVM-016 AC4, AC5; SR-API-02, P10)', () => {
  it('EVM-016 AC5 the limits are the ones of the guidelines: 1200 per minute overall, 60 anonymous, 20 for sign-in and MFA, 60 searches per user', () => {
    expect(RATE_LIMITS).toEqual({ global: 1200, anonymous: 60, authentication: 20, search: 60 });
  });

  it('EVM-016 AC5 the 21st request of a minute is denied with the seconds left, the next window starts clean', () => {
    const { clock, limiter: target } = limiter();
    for (let index = 0; index < 20; index += 1) expect(target.consume('authentication', '192.0.2.10', 20).allowed).toBe(true);
    clock.advance(12_000);
    expect(target.consume('authentication', '192.0.2.10', 20)).toEqual({ allowed: false, retryAfterSeconds: 48 });
    clock.advance(WINDOW_MS - 12_000);
    expect(target.consume('authentication', '192.0.2.10', 20)).toEqual({ allowed: true, retryAfterSeconds: 60 });
  });

  it('EVM-016 AC5 buckets and clients are counted separately; a client without an address shares one bucket', () => {
    const { limiter: target } = limiter();
    expect(target.consume('anonymous', '192.0.2.10', 1).allowed).toBe(true);
    expect(target.consume('anonymous', '192.0.2.10', 1).allowed).toBe(false);
    expect(target.consume('global', '192.0.2.10', 1).allowed).toBe(true);
    expect(target.consume('anonymous', '192.0.2.11', 1).allowed).toBe(true);
    expect(target.consume('anonymous', undefined, 1).allowed).toBe(true);
    expect(target.consume('anonymous', 'not an address', 1).allowed).toBe(false);
  });

  it('EVM-016 AC5 an IPv6 client cannot escape the limit by changing the lower 64 bits (the bucket is the /64)', () => {
    const { limiter: target } = limiter();
    expect(target.consume('anonymous', '2001:db8:1:2::1', 1).allowed).toBe(true);
    expect(target.consume('anonymous', '2001:db8:1:2:dead:beef:0:2', 1).allowed).toBe(false);
    expect(target.consume('anonymous', '2001:db8:1:3::1', 1).allowed).toBe(true);
  });

  it('EVM-016 AC5 the table is bounded: a flood of addresses evicts the oldest entries instead of growing', () => {
    const { clock, limiter: target } = limiter(3);
    for (const last of [1, 2, 3, 4]) target.consume('anonymous', `192.0.2.${last}`, 1);
    // 192.0.2.1 was evicted to make room, so it starts a fresh window; the newest entry is still counted
    expect(target.consume('anonymous', '192.0.2.1', 1).allowed).toBe(true);
    expect(target.consume('anonymous', '192.0.2.4', 1).allowed).toBe(false);
    // expired windows are swept first when the table is full
    clock.advance(WINDOW_MS + 1);
    for (const last of [5, 6, 7]) expect(target.consume('anonymous', `192.0.2.${last}`, 1).allowed).toBe(true);
    expect(target.consume('anonymous', '192.0.2.7', 1).allowed).toBe(false);
  });

  it('EVM-016 AC5 a limiter that may track no key at all still answers (nothing to evict, nothing counted across requests)', () => {
    const { limiter: target } = limiter(0);
    expect(target.consume('anonymous', '192.0.2.1', 1).allowed).toBe(true);
    expect(target.consume('anonymous', '192.0.2.1', 1).allowed).toBe(false);
  });
});

describe('per-subject rate limits (EVM-020 AC6; SR-API-02, P10, CWE-770)', () => {
  const alice = '0198b0a0-0000-7000-8000-00000000a001';
  const bob = '0198b0a0-0000-7000-8000-00000000a002';

  it('EVM-020 AC6 the 61st search of a user in a minute is denied with the seconds left and the next window starts clean', () => {
    const { clock, limiter: target } = limiter();
    for (let index = 0; index < RATE_LIMITS.search; index += 1)
      expect(target.consumeSubject('search', alice, RATE_LIMITS.search).allowed).toBe(true);
    clock.advance(20_000);
    expect(target.consumeSubject('search', alice, RATE_LIMITS.search)).toEqual({ allowed: false, retryAfterSeconds: 40 });
    clock.advance(WINDOW_MS - 20_000);
    expect(target.consumeSubject('search', alice, RATE_LIMITS.search).allowed).toBe(true);
  });

  it('EVM-020 AC6 another user is not blocked: the subject is the key, not an address (an identifier would fall into one shared bucket)', () => {
    const { limiter: target } = limiter();
    expect(target.consumeSubject('search', alice, 1).allowed).toBe(true);
    expect(target.consumeSubject('search', alice, 1).allowed).toBe(false);
    expect(target.consumeSubject('search', bob, 1).allowed).toBe(true);
    expect(target.consumeSubject('search', bob, 1).allowed).toBe(false);
  });

  it('EVM-020 AC6 a subject bucket does not touch the address buckets or the buckets of other operations', () => {
    const { limiter: target } = limiter();
    expect(target.consumeSubject('search', alice, 1).allowed).toBe(true);
    expect(target.consume('search', alice, 1).allowed).toBe(true); // an "address" that is no address: its own bucket
    expect(target.consumeSubject('export', alice, 1).allowed).toBe(true);
  });
});
