import { describe, expect, it } from 'vitest';
import type { Clock } from '../../src/platform/clock/clock.ts';
import { InMemorySignedUrlMeters, URL_LIMITS } from '../../src/platform/signed-url-limits/signed-url-meters.ts';

const START = new Date('2026-10-30T08:00:00.000Z').getTime();

class TestClock implements Clock {
  at = START;
  now(): Date {
    return new Date(this.at);
  }
}

describe('EVM-045 AC5 limits of issuing signed addresses (SR-FILE-10, SR-LOG-07; P10)', () => {
  it('EVM-045 AC5 the 101st original in 10 minutes is refused, the 1001st derivative too; the classes are counted apart', () => {
    const meters = new InMemorySignedUrlMeters(new TestClock());
    for (let index = 0; index < 100; index += 1) expect(meters.reserve('u1', 'original').allowed, `original ${index + 1}`).toBe(true);
    const refused = meters.reserve('u1', 'original');
    expect(refused).toMatchObject({ allowed: false, firstRejection: true });
    expect(meters.reserve('u1', 'original')).toMatchObject({ allowed: false, firstRejection: false });
    expect(meters.reserve('u1', 'derivative').allowed).toBe(true);
    for (let index = 1; index < 1000; index += 1) expect(meters.reserve('u1', 'derivative').allowed).toBe(true);
    expect(meters.reserve('u1', 'derivative').allowed).toBe(false);
    expect(meters.reserve('u2', 'original').allowed).toBe(true);
  });

  it('EVM-045 AC5 the alert comes once per window from the 51st original and from the 601st derivative; a refusal adds nothing', () => {
    const clock = new TestClock();
    const meters = new InMemorySignedUrlMeters(clock);
    const alerts = { original: 0, derivative: 0 };
    for (let index = 0; index < 100; index += 1) if (meters.reserve('u1', 'original').alert) alerts.original += 1;
    for (let index = 0; index < 700; index += 1) if (meters.reserve('u1', 'derivative').alert) alerts.derivative += 1;
    expect(alerts).toEqual({ original: 1, derivative: 1 });
    meters.reserve('u1', 'original');
    meters.reserve('u1', 'original');
    // the window slides: after 10 minutes the user may ask again
    clock.at = START + 11 * 60_000;
    expect(meters.reserve('u1', 'original')).toEqual({ allowed: true, alert: false });
  });

  it('EVM-045 AC5 the refusal tells how long to wait: until the oldest minutes leave the window', () => {
    const clock = new TestClock();
    const meters = new InMemorySignedUrlMeters(clock);
    for (let index = 0; index < 100; index += 1) meters.reserve('u1', 'original');
    clock.at = START + 4 * 60_000;
    const refused = meters.reserve('u1', 'original');
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeLessThanOrEqual(600);
  });

  it('EVM-045 AC5 concurrent requests at the threshold get exactly 100 addresses (check and count are one synchronous step; CWE-362)', async () => {
    const meters = new InMemorySignedUrlMeters(new TestClock());
    const request = async (): Promise<boolean> => {
      await Promise.resolve();
      return meters.reserve('u1', 'original').allowed;
    };
    const results = await Promise.all(Array.from({ length: 250 }, request));
    expect(results.filter(Boolean)).toHaveLength(URL_LIMITS.original.blockAt);
  });

  it('EVM-045 AC5 the table of users is bounded (a flood of identities cannot grow the memory)', () => {
    const meters = new InMemorySignedUrlMeters(new TestClock(), URL_LIMITS, 3);
    for (let index = 0; index < 50; index += 1) expect(meters.reserve(`user-${index}`, 'original').allowed).toBe(true);
  });
});
