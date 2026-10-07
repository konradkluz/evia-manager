/** Time limits and fixed keys of the identity module (ADR-0005; P1, P2, P9). Durations in milliseconds. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Activation link: valid 72 hours from issue (AC1); measured in real time, so a clock change does not shift it. */
export const ACTIVATION_LINK_TTL_MS = 72 * HOUR;
/** WebAuthn registration challenge (SR-AUTH-09). */
export const CHALLENGE_TTL_MS = 5 * MINUTE;
/** Session lifetimes (P1, P2; enforced since EVM-067): 60 minutes without activity, 12 hours from the sign-in. */
export const SESSION_IDLE_MS = 60 * MINUTE;
export const SESSION_ABSOLUTE_MS = 12 * HOUR;
/** A passkey authentication opens the window of step-up operations for 15 minutes (ADR-0005, P2; SR-SESS-08). */
export const STEP_UP_WINDOW_MS = 15 * MINUTE;
/** An authenticated request moves the idle deadline, but is written at most this often (the cost of a write per request). */
export const SESSION_TOUCH_INTERVAL_MS = 30_000;

/** The first step of the sign-in (`loginToken`) is valid for 5 minutes and single-use (EVM-067 AC4; SR-AUTH-09). */
export const LOGIN_ATTEMPT_TTL_MS = 5 * MINUTE;
/** Failed keys tolerated for one `loginToken`; the fifth ends the attempt (the password has to be entered again). */
export const LOGIN_MAX_FAILED_PASSKEYS = 5;
/** Expired login attempts are deleted opportunistically, at the latest 24 hours after they expired (RODO art. 5(1)(e)). */
export const LOGIN_ATTEMPT_RETENTION_MS = 24 * HOUR;

/** `pg_advisory_xact_lock` key serialising everything that decides who the administrators are (also EVM-027). */
export const ADMINISTRATOR_LOCK_KEY = 7_016_001;

export const SESSION_COOKIE_NAME = '__Host-evia_session';
