import { ApiError } from '../api/client.ts';
import { serverNow } from './server-clock.ts';

/**
 * State of the step-up of this tab (EVM-029; SR-SESS-08, SR-SESS-02). Only what the tab needs to behave well — whether
 * a step-up is needed is the server's decision, never remembered here (EVM-015, S4): the time of the last confirmation
 * serves only to hide the loaded audit log when the 15 minutes end, and the rotation counter lets a request that was
 * sent with the old cookie try once more (K9).
 */
/** The window after the last passkey authentication (ADR-0005); the server counts it, the tab only mirrors it for hiding data. */
export const STEP_UP_WINDOW_MS = 15 * 60_000;

let rotations = 0;
let confirmedAt: number | null = null;
let inFlight: Promise<unknown> | null = null;

/**
 * Runs the confirmation of identity. The rotation counter moves at the start: the server rotates the session before it
 * answers, so a request of this tab that fails with `session_revoked` meanwhile belongs to the old cookie, not to a
 * session that was really ended. A success remembers the (server) time of the confirmation.
 */
export async function runStepUp<T>(confirm: () => Promise<T>): Promise<T> {
  rotations += 1;
  const pending = confirm();
  inFlight = pending;
  try {
    const result = await pending;
    confirmedAt = serverNow();
    return result;
  } finally {
    if (inFlight === pending) inFlight = null;
  }
}

/**
 * Calls the operation; `401 session_revoked` that came after a step-up began (the request left with the cookie of the
 * rotated session) is repeated once with the new cookie — it neither logs the person out nor loops (K9). Any other
 * failure, and a second failure, go on as they are.
 */
export async function withRotationRetry<T>(call: () => Promise<T>): Promise<T> {
  const started = rotations;
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401 && error.code === 'session_revoked' && rotations !== started)) throw error;
    // The new cookie is set when the answer of the step-up arrives; the repeat must not leave before that.
    await inFlight?.catch(() => undefined);
    return call();
  }
}

/** Server time of the last confirmation in this tab, or `null` (no step-up here: the window, if open, came from the login). */
export function lastStepUpAt(): number | null {
  return confirmedAt;
}

/** Logout and the end of a session: nothing of the confirmation outlives the session (SR-SESS-05). */
export function resetStepUp(): void {
  confirmedAt = null;
  inFlight = null;
}
