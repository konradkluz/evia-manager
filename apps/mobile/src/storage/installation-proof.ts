/**
 * Proof of this installation for the first step of the sign-in (EVM-100 AC1; contract EVM-090 `MobileLoginRequest`: the pair
 * `deviceId` + installation secret travels in the BODY before the password is checked, so the server can answer
 * `401 device_wipe_required` to a stolen phone). The value is opaque on purpose (security W3): it has no readable field, it serialises
 * to a constant, and only the HTTP adapter of the sign-in (`src/auth/http-auth-client.ts`, rule of dependency-cruiser) unwraps it into
 * the request body. It never names the owner of the local store and never reveals whether the owner matches the account.
 */
import type { InstallationIdentity } from './ports';

const REDACTED = '[installation-proof]';
const values = new WeakMap<InstallationProof, InstallationIdentity>();

export class InstallationProof {
  private constructor() {
    Object.freeze(this);
  }

  /** @internal Created by the local store only (`LocalDataHost.installationProof`). */
  static of(identity: InstallationIdentity): InstallationProof {
    const proof = new InstallationProof();
    values.set(proof, { deviceId: identity.deviceId, secret: identity.secret });
    return proof;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }
}

/** The two body fields of `mobileLogin`; for the HTTP adapter of the sign-in only. */
export function proofFields(proof: InstallationProof): { readonly deviceId: string; readonly installationSecret: string } | null {
  const identity = values.get(proof);
  return identity === undefined ? null : { deviceId: identity.deviceId, installationSecret: identity.secret };
}
