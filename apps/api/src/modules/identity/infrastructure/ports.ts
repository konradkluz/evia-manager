/**
 * Ports of the `identity` module towards slow or external capabilities (hexagonal: the use cases depend on these
 * interfaces, adapters live next to them; tests inject fakes). Explicit injection tokens, no decorator metadata.
 */
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

export interface PasswordHasher {
  /** Argon2id (ADR-0005) through the asynchronous API only — it never blocks the event loop. @returns a PHC string */
  hash(password: string): Promise<string>;
}
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

/** `unavailable`: timeout, network error, an unexpected answer — the caller falls back to the local checks. */
export type BreachResult = 'breached' | 'clean' | 'unavailable';

export interface BreachedPasswordCheck {
  /** k-anonymity only: just the first five characters of the SHA-1 leave the process (SR-API-13, ASVS V6.2.12). */
  check(password: string): Promise<BreachResult>;
}
export const BREACHED_PASSWORD_CHECK = Symbol('BREACHED_PASSWORD_CHECK');

export interface RegistrationOptionsInput {
  readonly userHandle: Buffer;
  readonly email: string;
  readonly displayName: string;
  readonly excludeCredentialIds: readonly string[];
}

export interface VerifiedPasskey {
  readonly credentialId: string;
  readonly publicKey: Buffer;
  readonly counter: number;
  readonly transports: readonly string[];
  readonly deviceType: 'single_device' | 'multi_device';
  readonly backedUp: boolean;
}

export interface PasskeyVerifier {
  registrationOptions(input: RegistrationOptionsInput): Promise<PublicKeyCredentialCreationOptionsJSON>;
  /** @returns the verified credential, or null when the response is invalid for any reason (origin, RP ID, user verification …) */
  verifyRegistration(response: RegistrationResponseJSON, expectedChallenge: string): Promise<VerifiedPasskey | null>;
}
export const PASSKEY_VERIFIER = Symbol('PASSKEY_VERIFIER');
