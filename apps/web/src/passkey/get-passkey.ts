/**
 * Signs in with a passkey using the native WebAuthn JSON helpers (architect W11, no `@simplewebauthn/browser`):
 * `PublicKeyCredential.parseRequestOptionsFromJSON()` (Chrome 129+, Edge, Firefox 119+) and `toJSON()`. Verification of
 * origin, RP ID, user verification and of the key belonging to the account is the server's job (SR-AUTH-09).
 */
import type { AuthenticationCredential, PasskeyAuthenticationOptions } from '@evia/contracts';
import { PasskeyUnavailableError } from './create-passkey.ts';

export async function getPasskey(options: PasskeyAuthenticationOptions): Promise<AuthenticationCredential> {
  if (typeof PublicKeyCredential === 'undefined' || typeof PublicKeyCredential.parseRequestOptionsFromJSON !== 'function') {
    throw new PasskeyUnavailableError();
  }
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options);
  const credential = await navigator.credentials.get({ publicKey });
  if (!(credential instanceof PublicKeyCredential)) throw new PasskeyUnavailableError();
  return credential.toJSON() as unknown as AuthenticationCredential;
}
