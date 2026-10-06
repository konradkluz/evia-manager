/** Time limits and fixed keys of the identity module (ADR-0005; P1, P2, P9). Durations in milliseconds. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Activation link: valid 72 hours from issue (AC1); measured in real time, so a clock change does not shift it. */
export const ACTIVATION_LINK_TTL_MS = 72 * HOUR;
/** WebAuthn registration challenge (SR-AUTH-09). */
export const CHALLENGE_TTL_MS = 5 * MINUTE;
/** Session lifetimes are stored now and enforced by EVM-067 (decision D4): 60 minutes idle, 12 hours absolute (P1). */
export const SESSION_IDLE_MS = 60 * MINUTE;
export const SESSION_ABSOLUTE_MS = 12 * HOUR;

/** `pg_advisory_xact_lock` key serialising everything that decides who the administrators are (also EVM-027). */
export const ADMINISTRATOR_LOCK_KEY = 7_016_001;

export const SESSION_COOKIE_NAME = '__Host-evia_session';
