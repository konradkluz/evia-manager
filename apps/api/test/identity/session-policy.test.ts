import { describe, expect, it } from 'vitest';
import { deadlinesAt, isExpired, slidIdleDeadline, stepUpFresh, touchDue } from '../../src/modules/identity/domain/session-policy.ts';

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

describe('the step-up window (EVM-029 AC1, AC2; SR-SESS-08, ADR-0005)', () => {
  const authenticated = at('2026-10-07T08:00:00.000Z');

  it('EVM-029 AC2 a passkey authentication 14 minutes ago is fresh, 16 minutes ago is not (AC1)', () => {
    expect(stepUpFresh(authenticated, at('2026-10-07T08:14:00.000Z'))).toBe(true);
    expect(stepUpFresh(authenticated, at('2026-10-07T08:16:00.000Z'))).toBe(false);
  });

  it('EVM-029 AC2 the boundary: one millisecond before 15:00 is fresh, exactly 15:00 already needs a step-up', () => {
    expect(stepUpFresh(authenticated, at('2026-10-07T08:14:59.999Z'))).toBe(true);
    expect(stepUpFresh(authenticated, at('2026-10-07T08:15:00.000Z'))).toBe(false);
  });

  it('EVM-029 AC2 no passkey authentication at all (password, activation, recovery code) is never fresh — fail closed', () => {
    expect(stepUpFresh(null, authenticated)).toBe(false);
  });

  it('EVM-029 AC2 a time in the future (a clock that went back) is not fresh either', () => {
    expect(stepUpFresh(at('2026-10-07T08:00:00.001Z'), authenticated)).toBe(false);
  });
});
