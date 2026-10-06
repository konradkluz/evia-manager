import { describe, expect, it } from 'vitest';
import { deadlinesAt, isExpired, slidIdleDeadline, touchDue } from '../../src/modules/identity/domain/session-policy.ts';

const at = (iso: string): Date => new Date(iso);
// 2026-10-05 08:00 UTC = 10:00 Europe/Warsaw (CEST); the clock is an argument, nothing sleeps.
const START = at('2026-10-05T08:00:00.000Z');

describe('session lifetime rules (EVM-067 AC5; SR-SESS-03, P1, P2)', () => {
  it('EVM-067 AC5 a session starting at 08:00 is idle until 09:00 and absolute until 20:00', () => {
    expect(deadlinesAt(START)).toEqual({
      idleExpiresAt: at('2026-10-05T09:00:00.000Z'),
      absoluteExpiresAt: at('2026-10-05T20:00:00.000Z'),
    });
  });

  it('EVM-067 AC5 the boundaries: alive one millisecond before a deadline, over at it (the SQL conditions use the same strict comparison)', () => {
    const deadlines = deadlinesAt(START);
    expect(isExpired(deadlines, at('2026-10-05T08:59:59.999Z'))).toBe(false);
    expect(isExpired(deadlines, at('2026-10-05T09:00:00.000Z'))).toBe(true);
    const slid = { idleExpiresAt: at('2026-10-05T21:00:00.000Z'), absoluteExpiresAt: deadlines.absoluteExpiresAt };
    expect(isExpired(slid, at('2026-10-05T19:59:59.999Z'))).toBe(false);
    expect(isExpired(slid, at('2026-10-05T20:00:00.000Z'))).toBe(true);
  });

  it('EVM-067 AC5 activity moves the idle deadline 60 minutes on but never past the absolute one', () => {
    const absolute = at('2026-10-05T20:00:00.000Z');
    expect(slidIdleDeadline(at('2026-10-05T08:30:00.000Z'), absolute)).toEqual(at('2026-10-05T09:30:00.000Z'));
    expect(slidIdleDeadline(at('2026-10-05T19:00:00.000Z'), absolute)).toEqual(at('2026-10-05T20:00:00.000Z'));
    expect(slidIdleDeadline(at('2026-10-05T19:30:00.000Z'), absolute)).toEqual(at('2026-10-05T20:00:00.000Z'));
  });

  it('EVM-067 AC5 the activity is recorded at most every 30 seconds', () => {
    expect(touchDue(START, at('2026-10-05T08:00:29.999Z'))).toBe(false);
    expect(touchDue(START, at('2026-10-05T08:00:30.000Z'))).toBe(true);
    expect(touchDue(START, at('2026-10-05T08:10:00.000Z'))).toBe(true);
  });
});
