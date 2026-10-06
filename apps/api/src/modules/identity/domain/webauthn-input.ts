/**
 * The parts of a WebAuthn request that need no database (EVM-016 AC4, EVM-067 AC4): reading the challenge the browser
 * claims to have signed, and mapping the bodies of the contract onto the library's response types.
 */
import type { AuthenticationCredential, RegisterPasskeyRequest } from '@evia/contracts';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

/** The challenge the authenticator signed, read from `clientDataJSON` (only a hint: the stored challenge decides). */
export function claimedChallenge(clientDataJson: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(clientDataJson, 'base64url').toString('utf8'));
    const challenge = typeof parsed === 'object' && parsed !== null ? (parsed as { challenge?: unknown }).challenge : undefined;
    return typeof challenge === 'string' && CHALLENGE_PATTERN.test(challenge) ? challenge : undefined;
  } catch {
    return undefined;
  }
}

/** The contract body (already schema-checked) as the library's `RegistrationResponseJSON`. */
export function toRegistrationResponse({ credential }: RegisterPasskeyRequest): RegistrationResponseJSON {
  const { response } = credential;
  return {
    id: credential.id,
    rawId: credential.rawId,
    type: 'public-key',
    clientExtensionResults: credential.clientExtensionResults ?? {},
    ...(credential.authenticatorAttachment === undefined ? {} : { authenticatorAttachment: credential.authenticatorAttachment }),
    response: {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
      ...(response.authenticatorData === undefined ? {} : { authenticatorData: response.authenticatorData }),
      ...(response.publicKey === undefined ? {} : { publicKey: response.publicKey }),
      ...(response.publicKeyAlgorithm === undefined ? {} : { publicKeyAlgorithm: response.publicKeyAlgorithm }),
      ...(response.transports === undefined ? {} : { transports: response.transports }),
    },
  };
}

/** The contract body of a sign-in (already schema-checked) as the library's `AuthenticationResponseJSON`. */
export function toAuthenticationResponse(credential: AuthenticationCredential): AuthenticationResponseJSON {
  const { response } = credential;
  return {
    id: credential.id,
    rawId: credential.rawId,
    type: 'public-key',
    clientExtensionResults: credential.clientExtensionResults ?? {},
    ...(credential.authenticatorAttachment === undefined ? {} : { authenticatorAttachment: credential.authenticatorAttachment }),
    response: {
      clientDataJSON: response.clientDataJSON,
      authenticatorData: response.authenticatorData,
      signature: response.signature,
      ...(response.userHandle === undefined ? {} : { userHandle: response.userHandle }),
    },
  };
}
