/**
 * WebAuthn through @simplewebauthn/server (ADR-0005; SR-AUTH-09; ASVS V6.3.3, V11.6.1). The relying party id and the
 * expected origin come from the configuration — never from the request (CWE-346). User verification is required both
 * when asking the authenticator and when verifying the result; attestation is `none` (no FIDO MDS, SR-API-13). The
 * user handle is the random value stored with the account, not the e-mail address.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { PasskeyVerifier, RegistrationOptionsInput, StoredPasskey, VerifiedAssertion, VerifiedPasskey } from './ports.ts';

/** EdDSA, ES256, RS256 — fixed on both sides of the ceremony (the library default adds post-quantum algorithms at runtime). */
const SUPPORTED_ALGORITHMS = [-8, -7, -257];
export const CEREMONY_TIMEOUT_MS = 300_000;

export interface PasskeyConfig {
  readonly rpId: string;
  readonly rpName: string;
  readonly origin: string;
}

export class SimpleWebAuthnPasskeys implements PasskeyVerifier {
  readonly #config: PasskeyConfig;

  constructor(config: PasskeyConfig) {
    this.#config = config;
  }

  registrationOptions(input: RegistrationOptionsInput): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
      rpName: this.#config.rpName,
      rpID: this.#config.rpId,
      userName: input.email,
      userDisplayName: input.displayName,
      userID: new Uint8Array(input.userHandle),
      timeout: CEREMONY_TIMEOUT_MS,
      attestationType: 'none',
      excludeCredentials: input.excludeCredentialIds.map((id) => ({ id })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
    });
  }

  authenticationOptions(
    credentials: readonly Pick<StoredPasskey, 'credentialId' | 'transports'>[],
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
      rpID: this.#config.rpId,
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: 'required',
      allowCredentials: credentials.map(({ credentialId, transports }) => ({ id: credentialId, transports: [...transports] })),
    });
  }

  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    key: StoredPasskey,
  ): Promise<VerifiedAssertion | null> {
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.#config.origin,
        expectedRPID: this.#config.rpId,
        requireUserVerification: true,
        credential: {
          id: key.credentialId,
          publicKey: new Uint8Array(key.publicKey),
          counter: key.counter,
          transports: [...key.transports] as AuthenticatorTransport[],
        },
      });
      return result.verified ? { newCounter: result.authenticationInfo.newCounter } : null;
    } catch {
      return null;
    }
  }

  async verifyRegistration(response: RegistrationResponseJSON, expectedChallenge: string): Promise<VerifiedPasskey | null> {
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.#config.origin,
        expectedRPID: this.#config.rpId,
        requireUserPresence: true,
        requireUserVerification: true,
        supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
      });
      if (!result.verified) return null;
      const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
      return {
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType === 'multiDevice' ? 'multi_device' : 'single_device',
        backedUp: credentialBackedUp,
      };
    } catch {
      return null;
    }
  }
}
