/** Entry point `@evia/contracts/authz`: the authorization manifest and the operation allow-lists. */
import { AUTHZ_MANIFEST } from '../generated/authz.gen.ts';
import type { AuthzManifest } from './manifest.ts';

export { AUTHZ_MANIFEST };
export type { AuthzManifest, AuthzPolicy, OperationAuthz } from './manifest.ts';
export { CHANNELS, operationChannels, RESTRICTING_POLICIES, ROLES } from './manifest.ts';
export { MFA_ENROLLMENT_OPERATIONS, MOBILE_OPERATIONS, PUBLIC_OPERATIONS } from './public-operations.ts';

/** Ids of the operations that have a route (everything but `x-evia-planned: true`). */
export function implementedOperations(manifest: AuthzManifest = AUTHZ_MANIFEST): string[] {
  return Object.entries(manifest)
    .filter(([, operation]) => operation.planned !== true)
    .map(([id]) => id);
}

/** Ids of the operations marked `x-evia-planned: true` — in the contract, without a route until their story implements them. */
export function plannedOperations(manifest: AuthzManifest = AUTHZ_MANIFEST): string[] {
  return Object.entries(manifest)
    .filter(([, operation]) => operation.planned === true)
    .map(([id]) => id);
}

/**
 * The manifest without planned operations: the ONE way a test that iterates the manifest (role matrix, router completeness) skips
 * operations that have no route yet. When a story removes the marker, its operation joins the matrix automatically.
 */
export function implementedManifest(manifest: AuthzManifest = AUTHZ_MANIFEST): AuthzManifest {
  return Object.fromEntries(Object.entries(manifest).filter(([, operation]) => operation.planned !== true));
}
