/**
 * Recovery codes (EVM-023 AC4, AC5; SR-AUTH-08, SR-AUTH-15; ASVS V6.5.1–V6.5.4): ten codes of 20 characters of base32 (100 bits each) from the CSPRNG,
 * shown once, stored only as Argon2id hashes. A person types a code the way they copied or printed it, so the input is normalised (upper case, spaces and
 * hyphens removed) before it is checked — a malformed input is refused before any hash is computed.
 */
import { randomBytes } from 'node:crypto';

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 20;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SHAPE = /^[A-Z2-7]{20}$/;

/** One code: 20 characters of the RFC 4648 base32 alphabet. 256 is a multiple of 32, so taking five bits of a random byte has no bias. */
export function newRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += ALPHABET.charAt(byte & 31);
  return code;
}

/** The ten codes of a new generation, all different. */
export function newRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(newRecoveryCode());
  return [...codes];
}

/** @returns the canonical code, or undefined when the input cannot be a code (so no hash is worth computing) */
export function normalizeRecoveryCode(input: string): string | undefined {
  // ASCII letters only: `toUpperCase()` would also fold characters like the dotless i into the alphabet.
  const canonical = input.replaceAll(/[\s-]/g, '').replaceAll(/[a-z]/g, (letter) => letter.toUpperCase());
  return SHAPE.test(canonical) ? canonical : undefined;
}
