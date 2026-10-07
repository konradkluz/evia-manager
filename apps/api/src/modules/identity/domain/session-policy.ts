/**
 * Session lifetime rules (SR-SESS-03; ASVS V7.3.1, V7.3.2; P1, P2) as pure functions of instants — the clock is the
 * caller's: a session lives 60 minutes from its last activity and never longer than 12 hours from the sign-in. At the
 * very deadline the session is already over (`now >= deadline`), which is the same boundary the SQL conditions use
 * (`deadline > now`).
 */
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, SESSION_TOUCH_INTERVAL_MS, STEP_UP_WINDOW_MS } from './constants.ts';

export interface SessionDeadlines {
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

/** Deadlines of a session that starts at `now`. */
export function deadlinesAt(now: Date): SessionDeadlines {
  return {
    idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
  };
}

/** Over by idle time or by the absolute limit. */
export function isExpired({ idleExpiresAt, absoluteExpiresAt }: SessionDeadlines, now: Date): boolean {
  return now >= idleExpiresAt || now >= absoluteExpiresAt;
}

/** The idle deadline after activity at `now`: 60 minutes on, but never past the absolute deadline. */
export function slidIdleDeadline(now: Date, absoluteExpiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absoluteExpiresAt.getTime()));
}

/** Is a write of the activity due (the last one is at least the touch interval ago)? */
export function touchDue(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS;
}

/**
 * Does the last authentication with a passkey still open the step-up window (SR-SESS-08)? Exactly 15 minutes after it
 * the window is closed (elapsed >= window); no passkey authentication (null — password, activation, recovery code) and a
 * time in the future never count (fail closed).
 */
export function stepUpFresh(passkeyAuthenticatedAt: Date | null, now: Date): boolean {
  if (passkeyAuthenticatedAt === null) return false;
  const elapsed = now.getTime() - passkeyAuthenticatedAt.getTime();
  return elapsed >= 0 && elapsed < STEP_UP_WINDOW_MS;
}
