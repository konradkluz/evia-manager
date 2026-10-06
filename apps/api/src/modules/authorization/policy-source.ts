/**
 * Where policies come from: the authorization manifest generated from the contract and the allow-list of public
 * operations (both from @evia/contracts). Bound once in AuthorizationModule; the token exists so that tests can
 * exercise protected operations before the contract has any (E1).
 */
import { AUTHZ_MANIFEST, PUBLIC_OPERATIONS, type AuthzManifest } from '@evia/contracts/authz';

export interface PolicySource {
  readonly manifest: AuthzManifest;
  readonly publicOperations: readonly string[];
}

export const POLICY_SOURCE = Symbol('POLICY_SOURCE');

export const CONTRACT_POLICIES: PolicySource = Object.freeze({ manifest: AUTHZ_MANIFEST, publicOperations: PUBLIC_OPERATIONS });
