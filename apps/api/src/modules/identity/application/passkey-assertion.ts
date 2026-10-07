/**
 * The check of a passkey assertion shared by the second step of the sign-in and by the step-up (SR-AUTH-09, SR-SESS-08;
 * ASVS V6.3.3, V7.5.3; CWE-287, CWE-294): one implementation, so the two ceremonies cannot drift apart.
 *
 * Only a key of THE account the caller already proved (the account of the `loginToken`, the user of the session) can
 * pass — the credential id alone is not an identity — and only for a challenge that was open for this very ceremony and is
 * named in the `clientDataJSON`; a `userHandle` that arrives must be the account's. The cryptographic part (origin and RP
 * ID from the configuration, user verification required, signature, signature counter) is the verifier's.
 */
import type { AuthenticationCredential } from '@evia/contracts';
import { hashToken } from '../domain/tokens.ts';
import { claimedChallenge, toAuthenticationResponse } from '../domain/webauthn-input.ts';
import type { PasskeyVerifier } from '../infrastructure/ports.ts';
import type { findPasskeyOfUser } from '../infrastructure/queries.ts';

export type StoredKey = Awaited<ReturnType<typeof findPasskeyOfUser>>;

export interface AssertionCheck {
  readonly credential: AuthenticationCredential;
  /** The key of the account with this credential id, or undefined when the account has none. */
  readonly key: StoredKey;
  /** The `webauthn_user_handle` of the account. */
  readonly userHandle: Buffer;
  /** Hashes of the challenges that were open for this ceremony (and were spent by reading them). */
  readonly open: readonly Buffer[];
}

export interface VerifiedAssertionOfKey {
  readonly passkeyId: string;
  readonly newCounter: number;
}

/** @returns the key and the new counter, or null for any reason (no key, wrong user handle, unknown challenge, bad signature …) */
export async function verifyAssertionOfKey(
  verifier: PasskeyVerifier,
  { credential, key, userHandle, open }: AssertionCheck,
): Promise<VerifiedAssertionOfKey | null> {
  const claimed = claimedChallenge(credential.response.clientDataJSON);
  if (key === undefined || claimed === undefined) return null;
  const handle = credential.response.userHandle;
  if (handle !== undefined && handle !== userHandle.toString('base64url')) return null;
  const claimedHash = hashToken(claimed);
  if (!open.some((hash) => hash.equals(claimedHash))) return null;
  const verified = await verifier.verifyAuthentication(toAuthenticationResponse(credential), claimed, {
    credentialId: key.credential_id,
    publicKey: key.public_key,
    counter: Number(key.counter),
    transports: key.transports,
  });
  return verified === null ? null : { passkeyId: key.id, newCounter: verified.newCounter };
}
