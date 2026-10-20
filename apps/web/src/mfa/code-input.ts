/**
 * Normalisation of the codes typed or pasted by the user (styleguide § 3.2.1). The result is what the API accepts or `null`
 * for an input that cannot be a code (such an input is not sent: it would only burn one of the five attempts of the login).
 * The value of a code is never logged, put in the address, the title or an announcement.
 */

/** "123 456" → "123456"; anything but exactly six digits is not a code of an authenticator app. */
export function normaliseTotpCode(input: string): string | null {
  const code = input.replace(/\s+/g, '');
  return /^[0-9]{6}$/.test(code) ? code : null;
}

/** Spaces, hyphens and the case do not matter; a recovery code is exactly 20 characters of base32 (A–Z, 2–7). */
export function normaliseRecoveryCode(input: string): string | null {
  const code = input.replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z2-7]{20}$/.test(code) ? code : null;
}
