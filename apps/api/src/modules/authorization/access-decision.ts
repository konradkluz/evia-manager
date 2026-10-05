/**
 * Deny-by-default access decision (ADR-0001, ADR-0004; SR-AUTHZ-01, SR-ERR-01), independent of the framework:
 * 1. a handler without operationId, or an operation without a policy in the contract manifest → 403 forbidden;
 * 2. `public: true` → allowed, but only for operations on the PUBLIC_OPERATIONS allow-list (checked again at runtime);
 * 3. no principal → 401 unauthenticated;
 * 4. a principal — roles and object policies arrive with E1; until then → 403 forbidden (fail closed).
 */
import type { AuthzManifest } from '@evia/contracts/authz';
import type { Principal } from '../../platform/http/principal.ts';

export type AccessDecision = { readonly allowed: true } | { readonly allowed: false; readonly code: 'unauthenticated' | 'forbidden' };

export interface AccessRequest {
  readonly operationId: string | undefined;
  readonly manifest: AuthzManifest;
  readonly publicOperations: readonly string[];
  /** Called only for non-public operations. */
  readonly principal: () => Principal | null;
}

const ALLOW: AccessDecision = Object.freeze({ allowed: true });
const deny = (code: 'unauthenticated' | 'forbidden'): AccessDecision => ({ allowed: false, code });

export function decideAccess({ operationId, manifest, publicOperations, principal }: AccessRequest): AccessDecision {
  if (operationId === undefined || !Object.hasOwn(manifest, operationId)) return deny('forbidden');
  const policy = manifest[operationId]?.authz;
  if (policy?.public === true) return publicOperations.includes(operationId) ? ALLOW : deny('forbidden');
  if (principal() === null) return deny('unauthenticated');
  return deny('forbidden');
}
