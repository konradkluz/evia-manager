import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  COUNTED_FAILURES,
  MAX_COUNTED_FAILURES,
  THROTTLE_LOCK_MS,
  THROTTLE_RETENTION_MS,
  THROTTLE_WINDOW_MS,
  confirm,
  currentState,
  delayAfter,
  expiryOf,
  isCountedFailure,
  isPasswordFailure,
  pendingDelay,
  release,
  reserve,
  retryAfterSeconds,
  type Reserved,
  type ThrottleState,
} from '../../src/modules/identity/domain/throttle-policy.ts';
import { accountKey, browserKey, spikeKey } from '../../src/modules/identity/domain/throttle-keys.ts';

const T0 = new Date('2026-10-05T07:00:00.000Z'); // 09:00 Europe/Warsaw
const minutes = (count: number): Date => new Date(T0.getTime() + count * 60_000);

/** One failed try at `now`: reserve, then confirm. */
function failOnce(stored: ThrottleState | undefined, now: Date, cause: 'password' | 'second_step' = 'password') {
  const { state, reservation } = reserve(stored, now);
  if (!reservation.granted) return { state, locked: null, refused: reservation.retryAfterSeconds };
  const confirmation = confirm(state, reservation.reserved, cause, now);
  return { state: confirmation.state, locked: confirmation.locked, refused: undefined };
}

describe('the counted failures (EVM-026 AC1)', () => {
  it('EVM-026 AC1 counts the six failures of guessing and nothing else', () => {
    expect([...COUNTED_FAILURES]).toEqual([
      'bad_password',
      'unknown_user',
      'not_active',
      'totp_failed',
      'recovery_code_failed',
      'passkey_failed',
    ]);
    for (const reason of COUNTED_FAILURES) expect(isCountedFailure(reason), reason).toBe(true);
    for (const reason of ['login_expired', 'mfa_setup_expired', 'anything']) expect(isCountedFailure(reason), reason).toBe(false);
  });

  it('EVM-026 AC6 tells the failures of the first step (the alert about a flood) from those of the second', () => {
    expect(COUNTED_FAILURES.filter(isPasswordFailure)).toEqual(['bad_password', 'unknown_user', 'not_active']);
  });
});

describe('the delay (EVM-026 AC1)', () => {
  it('EVM-026 AC1 is none up to four failures, then 1, 2, 4, 8 seconds and at most 10', () => {
    expect([0, 1, 2, 3, 4].map(delayAfter)).toEqual([0, 0, 0, 0, 0]);
    expect([5, 6, 7, 8, 9, 10, 40].map(delayAfter)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000, 10_000]);
  });

  it('EVM-026 AC1 the sixth try is the first to wait, the tenth is the last one let through (waits 10 s)', () => {
    let state: ThrottleState | undefined;
    const delays: number[] = [];
    for (let attempt = 1; attempt <= MAX_COUNTED_FAILURES; attempt += 1) {
      const decision = reserve(state, minutes(0));
      expect(decision.reservation.granted, `try ${attempt}`).toBe(true);
      if (decision.reservation.granted) delays.push(decision.reservation.delayMs);
      state = confirm(
        decision.state,
        decision.reservation.granted ? decision.reservation.reserved : undefined,
        'password',
        minutes(0),
      ).state;
    }
    expect(delays).toEqual([0, 0, 0, 0, 0, 1000, 2000, 4000, 8000, 10_000]);
  });

  it('EVM-026 AC1 a wait that is only looked up (before the second step) reserves nothing', () => {
    const state: ThrottleState = { windowStartedAt: T0, failures: 6, secondStepFailures: 0, lockedUntil: null, lockCause: null };
    expect(pendingDelay(state, minutes(1))).toBe(2000);
    expect(pendingDelay(undefined, minutes(1))).toBe(0);
    expect(pendingDelay(state, minutes(15))).toBe(0);
  });
});

describe('the window and the lock (EVM-026 AC2)', () => {
  it('EVM-026 AC2 the tenth failure locks for 15 minutes, the eleventh try is refused and changes nothing', () => {
    let state: ThrottleState | undefined;
    let lock: unknown = null;
    for (let attempt = 1; attempt <= MAX_COUNTED_FAILURES; attempt += 1) {
      const result = failOnce(state, minutes(attempt - 1)); // 09:00 ... 09:09
      state = result.state;
      lock = result.locked;
    }
    expect(lock).toBe('password');
    expect(state?.lockedUntil).toEqual(new Date(minutes(9).getTime() + THROTTLE_LOCK_MS));
    const refused = reserve(state, minutes(12)); // 09:12
    expect(refused.reservation).toEqual({ granted: false, retryAfterSeconds: 12 * 60 });
    expect(refused.state).toEqual(state);
  });

  it('EVM-026 AC2 the lock ends on time: a try at 09:26 starts a new window', () => {
    let state: ThrottleState | undefined;
    for (let attempt = 1; attempt <= MAX_COUNTED_FAILURES; attempt += 1) state = failOnce(state, minutes(attempt - 1)).state;
    const later = reserve(state, minutes(26));
    expect(later.reservation.granted).toBe(true);
    expect(later.state).toMatchObject({
      failures: 1,
      secondStepFailures: 0,
      lockedUntil: null,
      lockCause: null,
      windowStartedAt: minutes(26),
    });
  });

  it('EVM-026 AC2 a try during the lock does not extend it', () => {
    let state: ThrottleState | undefined;
    for (let attempt = 1; attempt <= MAX_COUNTED_FAILURES; attempt += 1) state = failOnce(state, minutes(0)).state;
    const until = state?.lockedUntil;
    expect(failOnce(state, minutes(10)).state.lockedUntil).toEqual(until);
    expect(confirm(state, undefined, 'password', minutes(10)).locked).toBeNull();
  });

  it('EVM-026 AC2 a window of fewer than ten failures is over after 15 minutes, counted from the first failure', () => {
    let state: ThrottleState | undefined = failOnce(undefined, minutes(0)).state;
    state = failOnce(state, minutes(14)).state;
    expect(state.failures).toBe(2);
    expect(currentState(state, minutes(15)).failures).toBe(0);
    expect(reserve(state, new Date(minutes(15).getTime() - 1)).state.failures).toBe(3);
  });

  it('EVM-026 AC2 no more than ten tries are let through in a window, however many are in flight (CWE-367)', () => {
    let state: ThrottleState | undefined;
    let granted = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const decision = reserve(state, minutes(0)); // 20 reservations before any is settled
      state = decision.state;
      if (decision.reservation.granted) granted += 1;
    }
    expect(granted).toBe(MAX_COUNTED_FAILURES);
    const retry = reserve(state, minutes(0)).reservation;
    expect(retry).toEqual({ granted: false, retryAfterSeconds: THROTTLE_LOCK_MS / 1000 });
  });

  it('EVM-026 AC2 of ten failures in flight exactly one confirmation brings the lock', () => {
    let state: ThrottleState | undefined;
    const reservedList: Reserved[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const decision = reserve(state, minutes(0));
      state = decision.state;
      if (decision.reservation.granted) reservedList.push(decision.reservation.reserved);
    }
    const locks = reservedList.map((reserved) => {
      const confirmation = confirm(state, reserved, 'password', minutes(0));
      state = confirmation.state;
      return confirmation.locked;
    });
    // the counter holds the tries in flight too, so the first confirmation finds ten and brings the lock; the others find it held
    expect(locks.filter((lock) => lock !== null)).toEqual(['password']);
    expect(locks[0]).toBe('password');
  });

  it('EVM-026 AC2 a correct password does not zero the counter, it only gives its own reservation back', () => {
    let state: ThrottleState | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) state = failOnce(state, minutes(attempt)).state;
    const decision = reserve(state, minutes(5));
    if (!decision.reservation.granted) throw new Error('refused');
    const after = release(decision.state, decision.reservation.reserved, minutes(5));
    expect(after.failures).toBe(4);
    expect(after.windowStartedAt).toEqual(T0);
  });

  it('EVM-026 AC2 a window that holds nothing is not a window: it starts again at the next failure', () => {
    const decision = reserve(undefined, minutes(0));
    if (!decision.reservation.granted) throw new Error('refused');
    const released = release(decision.state, decision.reservation.reserved, minutes(0));
    expect(released.failures).toBe(0);
    expect(failOnce(released, minutes(14)).state.windowStartedAt).toEqual(minutes(14));
  });

  it('EVM-026 AC2 a reservation of a window that ended is not given back to the next one, and its failure is counted in the new one', () => {
    const first = reserve(undefined, minutes(0));
    if (!first.reservation.granted) throw new Error('refused');
    const lateRelease = release(first.state, first.reservation.reserved, minutes(16));
    expect(lateRelease.failures).toBe(0);
    const lateConfirm = confirm(first.state, first.reservation.reserved, 'password', minutes(16));
    expect(lateConfirm.state).toMatchObject({ failures: 1, windowStartedAt: minutes(16) });
  });
});

describe('the cause of a lock (EVM-026 AC3, AC7)', () => {
  it('EVM-026 AC3 is the second step as soon as one failure of the second step is in the window', () => {
    let state: ThrottleState | undefined;
    let last: ReturnType<typeof failOnce> | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) state = failOnce(state, minutes(0), 'password').state;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      last = failOnce(state, minutes(0), 'second_step');
      state = last.state;
    }
    expect(last?.locked).toBe('second_step');
    expect(state).toMatchObject({ failures: 10, secondStepFailures: 4, lockCause: 'second_step' });
  });

  it('EVM-026 AC7 is the password when no failure of the second step is in the window', () => {
    let state: ThrottleState | undefined;
    let last: ReturnType<typeof failOnce> | undefined;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      last = failOnce(state, minutes(0), 'password');
      state = last.state;
    }
    expect(last?.locked).toBe('password');
    expect(state?.lockCause).toBe('password');
  });

  it('EVM-026 AC6 reports how many failures of the second step the window holds, to alert once at the threshold', () => {
    let state: ThrottleState | undefined;
    const counts: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const decision = reserve(state, minutes(0));
      if (!decision.reservation.granted) throw new Error('refused');
      const confirmation = confirm(decision.state, decision.reservation.reserved, 'second_step', minutes(0));
      state = confirmation.state;
      counts.push(confirmation.secondStepFailures);
    }
    expect(counts).toEqual([1, 2, 3, 4]);
  });
});

describe('the retention and the retry (EVM-026 AC1)', () => {
  it('EVM-026 AC1 a row lives 30 minutes after the end of its window, or of its lock when that is later', () => {
    const window: ThrottleState = { windowStartedAt: T0, failures: 2, secondStepFailures: 0, lockedUntil: null, lockCause: null };
    expect(expiryOf(window)).toEqual(new Date(T0.getTime() + THROTTLE_WINDOW_MS + THROTTLE_RETENTION_MS));
    const locked: ThrottleState = { ...window, failures: 10, lockedUntil: minutes(24), lockCause: 'password' };
    expect(expiryOf(locked)).toEqual(new Date(minutes(24).getTime() + THROTTLE_RETENTION_MS));
  });

  it('EVM-026 AC2 tells a client to come back in at least a second', () => {
    const locked: ThrottleState = {
      windowStartedAt: T0,
      failures: 10,
      secondStepFailures: 0,
      lockedUntil: minutes(15),
      lockCause: 'password',
    };
    expect(retryAfterSeconds(locked, new Date(minutes(15).getTime() - 100))).toBe(1);
  });
});

describe('the keys of the counters (EVM-026 AC1; ASVS V11)', () => {
  const key = randomBytes(32);

  it('EVM-026 AC1 an address in another case, with spaces or in another Unicode form is one counter', () => {
    const canonical = accountKey(key, 'zoë.nowak@evia.invalid');
    expect(accountKey(key, '  ZOË.Nowak@EVIA.invalid ').equals(canonical)).toBe(true);
    expect(accountKey(key, 'zoë.nowak@evia.invalid').equals(canonical)).toBe(true);
    expect(accountKey(key, 'other@evia.invalid').equals(canonical)).toBe(false);
  });

  it('EVM-026 AC1 is a 32-byte HMAC that depends on the key of the server, with a separate domain for every kind of counter', () => {
    const value = 'same-value';
    const keys = [accountKey(key, value), browserKey(key, value)];
    expect(keys.every((item) => item.length === 32)).toBe(true);
    expect(keys[0]?.equals(keys[1] as Buffer)).toBe(false);
    expect(accountKey(randomBytes(32), value).equals(keys[0] as Buffer)).toBe(false);
    expect(spikeKey(key).length).toBe(32);
    expect(spikeKey(key).equals(accountKey(key, 'password'))).toBe(false);
  });
});
