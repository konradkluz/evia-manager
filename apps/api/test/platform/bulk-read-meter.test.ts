import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BULK_READ_LIMITS, InMemoryBulkReadMeter } from '../../src/platform/bulk-read/bulk-read-meter.ts';
import { FixedClock, MINUTE } from '../support/clock.ts';

// 2026-10-07 10:00:00 Europe/Warsaw (CEST) — the start of a minute, so the buckets are easy to follow
const START = '2026-10-07T08:00:00.000Z';

function harness(limits = BULK_READ_LIMITS, maxUsers?: number) {
  const clock = new FixedClock(START);
  return { clock, meter: new InMemoryBulkReadMeter(clock, limits, maxUsers), user: randomUUID() };
}

describe('mass-read meter (EVM-017 AC5; SR-API-02, P10, RR-13)', () => {
  it('EVM-017 AC5 the production limits are 2000 (alert) and 10 000 (block) records in 10 minutes', () => {
    expect(BULK_READ_LIMITS).toEqual({ alertAt: 2000, blockAt: 10_000 });
  });

  it('EVM-017 AC5 a user with no reads, or fewer than 2000 in the window, is allowed with no alert', () => {
    const { meter, user } = harness();
    expect(meter.check(user)).toEqual({ allowed: true, alert: false });
    meter.record(user, 1999);
    expect(meter.check(user)).toEqual({ allowed: true, alert: false });
  });

  it('EVM-017 AC5 at 2000 records the next read is allowed and raises the alert ONCE per window and user', () => {
    const { meter, clock, user } = harness();
    meter.record(user, 1999);
    meter.record(user, 1);
    expect(meter.check(user)).toEqual({ allowed: true, alert: true });
    expect(meter.check(user)).toEqual({ allowed: true, alert: false });
    clock.advance(9 * MINUTE);
    expect(meter.check(user)).toEqual({ allowed: true, alert: false });
  });

  it('EVM-017 AC5 a new alert needs a new window: 10 minutes after the last one, while the sum is still above the threshold', () => {
    const { meter, clock, user } = harness();
    meter.record(user, 2000);
    expect(meter.check(user).alert).toBe(true);
    clock.advance(9 * MINUTE);
    meter.record(user, 2000); // the bucket of minute 9 keeps the sum above 2000 when the first one leaves
    clock.advance(MINUTE);
    expect(meter.check(user).alert).toBe(true);
  });

  it('EVM-017 AC5 at 10 000 records the read is refused with Retry-After until the sum drops below the limit; nothing is counted for the refusal', () => {
    const { meter, clock, user } = harness();
    meter.record(user, 6000);
    clock.advance(MINUTE);
    meter.record(user, 4000); // 10 000 in the window
    clock.advance(30_000); // 10:01:30
    expect(meter.check(user)).toEqual({ allowed: false, retryAfterSeconds: 510, alert: false, firstRejection: true }); // minute 0 leaves at 10:10:00
    expect(meter.check(user)).toEqual({ allowed: false, retryAfterSeconds: 510, alert: false, firstRejection: false });
    clock.advance(510_000 - 1000);
    expect(meter.check(user)).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    clock.advance(1000);
    expect(meter.check(user).allowed).toBe(true);
  });

  it('EVM-017 AC5 Retry-After waits for as many of the oldest buckets as needed, never less than one second', () => {
    const { meter, clock, user } = harness({ alertAt: 10, blockAt: 100 });
    meter.record(user, 40); // minute 0
    clock.advance(MINUTE);
    meter.record(user, 40); // minute 1
    clock.advance(MINUTE);
    meter.record(user, 40); // minute 2: 120 in the window; once minute 0 leaves, 80 remain, below the limit
    clock.advance(MINUTE - 1);
    expect(meter.check(user)).toEqual({ allowed: false, retryAfterSeconds: 7 * 60 + 1, alert: false, firstRejection: true }); // minute 0 leaves after 7 min 0.001 s
  });

  it('EVM-017 AC5 the window slides: records older than 10 minutes do not count', () => {
    const { meter, clock, user } = harness({ alertAt: 100, blockAt: 200 });
    meter.record(user, 250);
    expect(meter.check(user).allowed).toBe(false);
    clock.advance(10 * MINUTE);
    expect(meter.check(user)).toEqual({ allowed: true, alert: false });
  });

  it('EVM-017 AC5 each user has their own window', () => {
    const { meter } = harness({ alertAt: 100, blockAt: 200 });
    const [first, second] = [randomUUID(), randomUUID()];
    meter.record(first, 500);
    expect(meter.check(first).allowed).toBe(false);
    expect(meter.check(second)).toEqual({ allowed: true, alert: false });
  });

  it('EVM-017 AC5 recording zero records changes nothing (an empty page does not open a window)', () => {
    const { meter, user } = harness();
    meter.record(user, 0);
    meter.record(user, -5);
    expect(meter.check(user)).toEqual({ allowed: true, alert: false });
  });

  it('EVM-017 AC5 the table of users is bounded: idle users are swept, then the oldest is evicted (CWE-770)', () => {
    const { meter, clock } = harness({ alertAt: 10, blockAt: 20 }, 3);
    const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const user of users.slice(0, 3)) meter.record(user, 25);
    clock.advance(11 * MINUTE); // all three are idle
    meter.record(users[3] ?? '', 25);
    expect(meter.check(users[3] ?? '').allowed).toBe(false);
    meter.record(users[0] ?? '', 25);
    meter.record(users[1] ?? '', 25);
    meter.record(randomUUID(), 25); // full of active users: the oldest (users[3]) is evicted
    expect(meter.check(users[3] ?? '')).toEqual({ allowed: true, alert: false });
    expect(meter.check(users[1] ?? '').allowed).toBe(false);
  });
});
