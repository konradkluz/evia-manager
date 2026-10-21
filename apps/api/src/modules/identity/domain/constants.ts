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
/**
 * Failed second steps tolerated for one `loginToken` — a wrong key, a wrong code of the app, a wrong recovery code count together; the fifth ends the
 * attempt (the password has to be entered again; SR-AUTH-05).
 */
export const LOGIN_MAX_FAILED_SECOND_STEPS = 5;
/** Wrong codes of step-up tolerated in one session; the fifth ends the session (a thief of a session has no `loginToken` to run out — ASVS V6.3.1). */
export const STEP_UP_MAX_FAILED_CODES = 5;
/** Expired login attempts are deleted opportunistically, at the latest 24 hours after they expired (RODO art. 5(1)(e)). */
export const LOGIN_ATTEMPT_RETENTION_MS = 24 * HOUR;

/** `pg_advisory_xact_lock` key serialising everything that decides who the administrators are (also EVM-027). */
export const ADMINISTRATOR_LOCK_KEY = 7_016_001;

/**
 * The window to set up a second step that a reset by an Administrator opens (EVM-027 D1; SR-AUTH-13; ASVS V6.4.4): 24 hours from the reset. It ends at
 * once with a new reset, a deactivation, the first successful enrolment and its own deadline. Anyone who knows the password may use it (RR-27) — hence the
 * short time, the single use, the e-mail to the owner and — for an Administrator — a passkey only.
 */
export const SECOND_STEP_SETUP_WINDOW_MS = 24 * HOUR;

export const SESSION_COOKIE_NAME = '__Host-evia_session';

/** Password reset link: valid 30 minutes from the SENDING (SR-AUTH-11; P2) — measured in real time like the activation link. */
export const PASSWORD_RESET_LINK_TTL_MS = 30 * MINUTE;
/** A person can ask for a reset link at most once per minute and five times per hour per account (a flood of one mailbox — K7, D5). */
export const PASSWORD_RESET_MIN_INTERVAL_MS = MINUTE;
export const PASSWORD_RESET_HOURLY_LIMIT = 5;
/** The response of a request for a reset link never comes sooner than this after the start of the request (CWE-208; a floor, not a guarantee). */
export const PASSWORD_RESET_RESPONSE_FLOOR_MS = 250;

/** The cookie of a browser the account signed in from (EVM-026 AC5): `__Host-`, so Secure, Path=/ and no Domain are forced by the browser. */
export const DEVICE_COOKIE_NAME = '__Host-evia_device';
/** A browser is forgotten 30 days after its last use; the cookie is given the same life (RODO art. 5(1)(e)). */
export const DEVICE_RETENTION_MS = 30 * 24 * HOUR;
/** The browsers kept per account: the oldest go first (a colleague cannot swell the register by signing in without the cookie). */
export const MAX_BROWSERS_PER_USER = 20;
/** The e-mail about a lock (e-mail 3) goes at most this many times in 24 hours to one account (SR-AUTH-15). */
export const LOCK_EMAIL_DAILY_LIMIT = 3;

/** The mark of the full re-authentication (EVM-028; SR-AUTH-10): one use, one session, one purpose, valid this long. */
export const REAUTH_TTL_MS = 5 * MINUTE;
/** The sessions of the web channel an account keeps open at once; the sixth sign-in ends the oldest (SR-SESS-04). */
export const MAX_WEB_SESSIONS = 5;
/** A session is deleted this long after it ended (P4; SR-DATA-07; RODO art. 5(1)(e)). */
export const SESSION_RETENTION_MS = 30 * 24 * HOUR;
/** The name a key gets when its owner gives none, and the limit of a name (EVM-028). */
export const DEFAULT_PASSKEY_NAME = 'Klucz dostępu';
export const MAX_PASSKEY_NAME_LENGTH = 60;
