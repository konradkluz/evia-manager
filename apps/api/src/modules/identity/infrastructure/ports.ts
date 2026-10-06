/**
 * Ports of the `identity` module towards slow or external capabilities (hexagonal: the use cases depend on these
 * interfaces, adapters live next to them; tests inject fakes). Explicit injection tokens, no decorator metadata.
 */
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

export interface PasswordHasher {
  /** Argon2id (ADR-0005) through the asynchronous API only — it never blocks the event loop. @returns a PHC string */
  hash(password: string): Promise<string>;
  /** The same asynchronous path for every verification. @returns false for a wrong password and for a malformed hash */
  verify(hash: string, password: string): Promise<boolean>;
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

/** A key of the account as stored: what the verification of an assertion needs. */
export interface StoredPasskey {
  readonly credentialId: string;
  readonly publicKey: Buffer;
  readonly counter: number;
  readonly transports: readonly string[];
}

export interface VerifiedAssertion {
  readonly newCounter: number;
}

export interface PasskeyVerifier {
  registrationOptions(input: RegistrationOptionsInput): Promise<PublicKeyCredentialCreationOptionsJSON>;
  /** @returns the verified credential, or null when the response is invalid for any reason (origin, RP ID, user verification …) */
  verifyRegistration(response: RegistrationResponseJSON, expectedChallenge: string): Promise<VerifiedPasskey | null>;
  /** Options of a sign-in ceremony restricted to the keys of one account (user verification required). */
  authenticationOptions(
    credentials: readonly Pick<StoredPasskey, 'credentialId' | 'transports'>[],
  ): Promise<PublicKeyCredentialRequestOptionsJSON>;
  /** @returns the new signature counter, or null when the assertion is invalid for any reason (origin, RP ID, user verification, signature, counter …) */
  verifyAuthentication(
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    key: StoredPasskey,
  ): Promise<VerifiedAssertion | null>;
}
export const PASSKEY_VERIFIER = Symbol('PASSKEY_VERIFIER');
