/**
 * Opaque secrets of the identity module (SR-CRYPTO-01, SR-CRYPTO-03, SR-SESS-01; EVM-016 W6): activation tokens and
 * session tokens are 256 bits from the CSPRNG; the database holds only their SHA-256 (the entropy makes a fast hash
 * sufficient — there is nothing to brute-force). The CSRF token is not stored at all: it is derived from the session
 * token with HMAC-SHA-256 and a fixed label, so it rotates with the session and cannot leak from the database.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_BYTES = 32;
/** base64url of 32 bytes: 43 characters, the shape the contract accepts for an activation token. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const CSRF_LABEL = 'evia-csrf-v1';

export const newToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

/** @returns the 32-byte SHA-256 of the token text (the value stored in `token_hash`) */
export const hashToken = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();

/** The CSRF token the session with this session token expects (43 characters). */
export const deriveCsrfToken = (sessionToken: string): string =>
  createHmac('sha256', sessionToken).update(CSRF_LABEL).digest().toString('base64url');

/** Constant-time comparison; a missing token never matches. */
export function csrfMatches(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) return false;
  return timingSafeEqual(hashToken(expected), hashToken(provided));
}
