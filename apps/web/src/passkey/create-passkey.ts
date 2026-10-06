/**
 * Creates a passkey with the native WebAuthn JSON helpers (architect W11, no `@simplewebauthn/browser`):
 * `PublicKeyCredential.parseCreationOptionsFromJSON()` (Chrome 129+, Edge, Firefox 119+) and `toJSON()`.
 * Verification of origin, RP ID and user verification is the server's job (SR-AUTH-09).
 */
import type { PasskeyRegistrationOptions, RegistrationCredential } from '@evia/contracts';

/** The browser has no WebAuthn JSON helpers or the ceremony returned no public-key credential. */
export class PasskeyUnavailableError extends Error {
  constructor() {
    super('WebAuthn is not available');
    this.name = 'PasskeyUnavailableError';
  }
}

export async function createPasskey(options: PasskeyRegistrationOptions): Promise<RegistrationCredential> {
  if (typeof PublicKeyCredential === 'undefined' || typeof PublicKeyCredential.parseCreationOptionsFromJSON !== 'function') {
    throw new PasskeyUnavailableError();
  }
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(options as unknown as PublicKeyCredentialCreationOptionsJSON);
  const credential = await navigator.credentials.create({ publicKey });
  if (!(credential instanceof PublicKeyCredential)) throw new PasskeyUnavailableError();
  return credential.toJSON() as unknown as RegistrationCredential;
}
