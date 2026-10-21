/**
 * The policy against guessing passwords (EVM-026; SR-AUTH-05, AB-01, RR-26; ASVS V6.3.1; CWE-307): a pure state machine over ONE row per scope
 * (an account, or a browser the account knows). Nothing here touches a database, a clock or a framework.
 *
 * - The window is FIXED: it starts at the first counted failure and lasts 15 minutes. A new window starts when the old one is over and no lock holds, or
 *   when the counter is back to zero (only a reservation that was released — a correct password — is nothing to count).
 * - A try is RESERVED before it is verified (so parallel tries cannot all pass the check before the counter moves, CWE-367) and then either confirmed as
 *   a failure or released (it was right). The counter holds the confirmed failures AND the tries in flight; the tenth is the last one let through.
 * - From the sixth try the answer is delayed 1, 2, 4, 8 and at most 10 seconds (the caller waits OUTSIDE a transaction and BEFORE the verification, so a
 *   client that drops the connection after the verification gains nothing).
 * - The tenth confirmed failure locks the scope for 15 minutes; a try during the lock changes nothing and does not extend it. A correct password does not
 *   zero the counter (otherwise a thief who knows the password would interleave a right one between wrong codes of the second step, RR-26).
 * - The cause of a lock is `second_step` as soon as one failure of the second step is in the window, otherwise `password`: only a lock whose cause is
 *   the password is lifted by a reset of the password (EVM-026 AC7).
 */

const MINUTE = 60_000;

export const THROTTLE_WINDOW_MS = 15 * MINUTE;
export const THROTTLE_LOCK_MS = 15 * MINUTE;
/** The tenth counted failure locks; no more than ten tries (reserved and failed together) are let through in a window. */
export const MAX_COUNTED_FAILURES = 10;
/** Tries after this many failures are delayed. */
export const DELAY_AFTER_FAILURES = 5;
export const MAX_DELAY_MS = 10_000;
/** A row outlives its window (or lock) by this much, then it is deleted (RODO art. 5(1)(e)). */
export const THROTTLE_RETENTION_MS = 30 * MINUTE;
/** The window of the alert about a flood of failed passwords across all accounts (SR-LOG-07). */
export const SPIKE_WINDOW_MS = 5 * MINUTE;

/** The failures that count (EVM-026 AC1). An expired `loginToken` or an expired window to set up the second step are not guesses. */
export const COUNTED_FAILURES = [
  'bad_password',
  'unknown_user',
  'not_active',
  'totp_failed',
  'recovery_code_failed',
  'passkey_failed',
] as const;
export type CountedFailure = (typeof COUNTED_FAILURES)[number];

export const isCountedFailure = (reason: string): reason is CountedFailure => COUNTED_FAILURES.some((counted) => counted === reason);

/** The failures of the first step — they feed the alert about a flood of failed passwords. */
export const isPasswordFailure = (reason: CountedFailure): boolean =>
  reason === 'bad_password' || reason === 'unknown_user' || reason === 'not_active';

export type LockCause = 'password' | 'second_step';

export interface ThrottleState {
  readonly windowStartedAt: Date;
  /** Confirmed failures plus tries in flight. */
  readonly failures: number;
  /** How many of them were failures of the second step. */
  readonly secondStepFailures: number;
  readonly lockedUntil: Date | null;
  readonly lockCause: LockCause | null;
}

/** What a granted reservation remembers, to settle it later. */
export interface Reserved {
  readonly windowStartedAt: Date;
  /** The failures before this try: it decides the delay. */
  readonly failuresBefore: number;
}

export type Reservation =
  | { readonly granted: true; readonly reserved: Reserved; readonly delayMs: number }
  | { readonly granted: false; readonly retryAfterSeconds: number };

const lockHolds = (state: ThrottleState, now: Date): boolean => state.lockedUntil !== null && state.lockedUntil > now;

/** The row as it stands NOW: a window that is over (with no lock), or one with nothing counted, starts anew. */
export function currentState(state: ThrottleState | undefined, now: Date): ThrottleState {
  const fresh: ThrottleState = { windowStartedAt: now, failures: 0, secondStepFailures: 0, lockedUntil: null, lockCause: null };
  if (state === undefined || lockHolds(state, now)) return state ?? fresh;
  const over = state.windowStartedAt.getTime() + THROTTLE_WINDOW_MS <= now.getTime();
  return over || state.failures === 0 ? fresh : state;
}

/** 1, 2, 4, 8 s, then 10 s — after five failures; none before. */
export function delayAfter(failures: number): number {
  if (failures < DELAY_AFTER_FAILURES) return 0;
  return Math.min(MAX_DELAY_MS, 1000 * 2 ** (failures - DELAY_AFTER_FAILURES));
}

export function retryAfterSeconds(state: ThrottleState, now: Date): number {
  const until = state.lockedUntil?.getTime() ?? now.getTime() + THROTTLE_LOCK_MS;
  return Math.max(1, Math.ceil((until - now.getTime()) / 1000));
}

/** @returns the row to save and the decision; a refusal changes nothing. */
export function reserve(stored: ThrottleState | undefined, now: Date): { state: ThrottleState; reservation: Reservation } {
  const state = currentState(stored, now);
  if (lockHolds(state, now) || state.failures >= MAX_COUNTED_FAILURES) {
    return { state, reservation: { granted: false, retryAfterSeconds: retryAfterSeconds(state, now) } };
  }
  const reserved: Reserved = { windowStartedAt: state.windowStartedAt, failuresBefore: state.failures };
  return {
    state: { ...state, failures: state.failures + 1 },
    reservation: { granted: true, reserved, delayMs: delayAfter(state.failures) },
  };
}

/** The delay a try would be given now, without reserving anything (for the wait before the second step). */
export function pendingDelay(stored: ThrottleState | undefined, now: Date): number {
  return delayAfter(currentState(stored, now).failures);
}

/** A reservation that turned out right is nothing to count. A reservation of a window that ended meanwhile is not the new window's. */
export function release(stored: ThrottleState | undefined, reserved: Reserved, now: Date): ThrottleState {
  const state = currentState(stored, now);
  if (state.windowStartedAt.getTime() !== reserved.windowStartedAt.getTime() || state.failures === 0) return state;
  return { ...state, failures: state.failures - 1 };
}

export const lockCauseOf = (state: ThrottleState): LockCause => (state.secondStepFailures > 0 ? 'second_step' : 'password');

export interface Confirmation {
  readonly state: ThrottleState;
  /** The failure that brought the lock: exactly one per lock, the caller does the consequences (e-mail, audit, alert). */
  readonly locked: LockCause | null;
  /** The failure of the second step that reached `secondStepAlertAt` in this window (one alert per crossing). */
  readonly secondStepFailures: number;
}

/** A reservation becomes a failure. A try whose window ended meanwhile is counted afresh in the new one (the conservative side). */
export function confirm(stored: ThrottleState | undefined, reserved: Reserved | undefined, cause: LockCause, now: Date): Confirmation {
  const state = currentState(stored, now);
  const sameWindow = reserved !== undefined && state.windowStartedAt.getTime() === reserved.windowStartedAt.getTime();
  const counted: ThrottleState = {
    ...state,
    failures: sameWindow ? state.failures : state.failures + 1,
    secondStepFailures: state.secondStepFailures + (cause === 'second_step' ? 1 : 0),
  };
  if (counted.failures >= MAX_COUNTED_FAILURES && !lockHolds(counted, now)) {
    const lockCause = lockCauseOf(counted);
    const locked: ThrottleState = { ...counted, lockedUntil: new Date(now.getTime() + THROTTLE_LOCK_MS), lockCause };
    return { state: locked, locked: lockCause, secondStepFailures: locked.secondStepFailures };
  }
  return { state: counted, locked: null, secondStepFailures: counted.secondStepFailures };
}

/** When the row may be deleted: well after both the window and the lock are over. */
export function expiryOf(state: ThrottleState): Date {
  const end = Math.max(state.windowStartedAt.getTime() + THROTTLE_WINDOW_MS, state.lockedUntil?.getTime() ?? 0);
  return new Date(end + THROTTLE_RETENTION_MS);
}
