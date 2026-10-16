/**
 * The rules of the code from an authenticator app (EVM-023 AC1, AC2; SR-AUTH-07; RFC 6238, ASVS V6.5.1, V6.5.5): a 6-digit code every 30 seconds, one step of
 * tolerance either way, a secret of at least 160 bits. The arithmetic itself is the library's (`otpauth`, behind the port `TotpEngine`).
 */

export const TOTP_PERIOD_SECONDS = 30;
/** Steps of tolerance either way (±1: a clock that is off by up to 30 seconds still works, one that is off by 60 does not). */
export const TOTP_WINDOW = 1;
export const TOTP_DIGITS = 6;
/** 160 bits, the length RFC 4226 recommends and the minimum of the story. */
export const TOTP_SECRET_BYTES = 20;
export const TOTP_ISSUER = 'EVia Manager';

/** Exactly six digits — no spaces, no sign, no other digits (the same pattern as the contract). */
export const TOTP_CODE_PATTERN = /^[0-9]{6}$/;

/** What the sealed secret of an account belongs to: it does not open for any other account (authenticated data of the envelope). */
export const totpSecretContext = (userId: string): string => `totp:${userId}`;
