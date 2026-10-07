/**
 * Deny-by-default access decision (ADR-0001, ADR-0004; SR-AUTHZ-01, SR-AUTHZ-12, SR-SESS-10, SR-ERR-01), independent of
 * the framework. The order is fixed (api-guidelines.md → Autoryzacja) and is the same one the role matrix expects:
 * 1. a handler without operationId, or an operation without a policy in the manifest → 403 forbidden;
 * 2. a public operation (on the allow-list, checked again here): for a mutation first Origin + Sec-Fetch-Site
 *    (403 csrf_failed), then the per-IP limit (429); then allowed;
 * 3. no principal → 401 unauthenticated, 401 session_revoked for a recognised but revoked session, or 401 session_expired
 *    for one that ran out of idle time or of its absolute lifetime (EVM-067);
 * 4. a mutation: CSRF — Origin, Sec-Fetch-Site and X-CSRF-Token (403 csrf_failed);
 * 5. the per-IP limit of sign-in and MFA operations (429);
 * 6. a session in `mfa_enrollment` may call only the operations on the enrolment list that also declare it
 *    (403 mfa_enrollment_required);
 * 7. channel, then role (403 forbidden). A channel outside the policy is forbidden too — there is no separate code;
 * 8. step-up (EVM-029; SR-SESS-08): an operation with `stepUp: true` needs a passkey authentication of the session within
 *    the last 15 minutes (403 step_up_required). Last on purpose: a role that may not call the operation at all is
 *    forbidden and never learns that the operation exists and is protected (SR-AUTHZ-11);
 * 9. object policies are decided by the use case (404) — never here.
 * A policy without roles or channels is forbidden (fail closed).
 */
import type { Channel, UserRole } from '@evia/contracts';
import type { AuthzManifest } from '@evia/contracts/authz';
import type { Authentication, Principal } from '../../platform/http/principal.ts';
import type { RateDecision } from '../../platform/http/rate-limiter.ts';

export type DenyCode =
  | 'unauthenticated'
  | 'session_revoked'
  | 'session_expired'
  | 'forbidden'
  | 'csrf_failed'
  | 'mfa_enrollment_required'
  | 'step_up_required'
  | 'rate_limited';

export type AccessDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly code: DenyCode; readonly retryAfterSeconds?: number };

export interface AccessRequest {
  readonly operationId: string | undefined;
  readonly manifest: AuthzManifest;
  readonly publicOperations: readonly string[];
  readonly mfaEnrollmentOperations: readonly string[];
  /** Operations with the stricter "sign-in and MFA" limit (20/min/IP); other public operations get the anonymous limit. */
  readonly authenticationOperations: readonly string[];
  readonly mutating: boolean;
  readonly origin: string | undefined;
  readonly secFetchSite: string | undefined;
  readonly panelOrigin: string;
  /** Called only for non-public operations. */
  readonly authentication: () => Authentication;
  /** True when the X-CSRF-Token of the request equals the token the session expects. */
  readonly csrfMatches: (principal: Principal) => boolean;
  readonly rateLimit: (bucket: 'anonymous' | 'authentication') => RateDecision;
  /** Role × channel rule of `identity` (SR-AUTHZ-06). */
  readonly channelAllowed: (role: UserRole, channel: Channel) => boolean;
  /** Does the passkey authentication of the session still open the step-up window at the (injected) clock's now? */
  readonly stepUpFresh: (principal: Principal) => boolean;
}

const UNAUTHENTICATED_CODES = {
  anonymous: 'unauthenticated',
  revoked: 'session_revoked',
  expired: 'session_expired',
} as const satisfies Record<string, DenyCode>;

const ALLOW: AccessDecision = Object.freeze({ allowed: true });
const deny = (code: DenyCode): AccessDecision => ({ allowed: false, code });
const limited = ({ allowed, retryAfterSeconds }: RateDecision): AccessDecision | undefined =>
  allowed ? undefined : { allowed: false, code: 'rate_limited', retryAfterSeconds };

/** Origin of the panel and a same-origin fetch: the two signals browsers add and scripts of other sites cannot forge. */
const sameOrigin = (request: AccessRequest): boolean => request.origin === request.panelOrigin && request.secFetchSite === 'same-origin';

export function decideAccess(request: AccessRequest): AccessDecision {
  const { operationId, manifest } = request;
  if (operationId === undefined || !Object.hasOwn(manifest, operationId)) return deny('forbidden');
  const policy = manifest[operationId]?.authz;
  if (policy === undefined) return deny('forbidden');

  if (policy.public === true) {
    if (!request.publicOperations.includes(operationId)) return deny('forbidden');
    if (request.mutating && !sameOrigin(request)) return deny('csrf_failed');
    return limited(request.rateLimit(request.authenticationOperations.includes(operationId) ? 'authentication' : 'anonymous')) ?? ALLOW;
  }

  const authentication = request.authentication();
  const { principal } = authentication;
  if (principal === null) return deny(UNAUTHENTICATED_CODES[authentication.reason]);

  if (request.mutating && !(sameOrigin(request) && request.csrfMatches(principal))) return deny('csrf_failed');
  if (request.authenticationOperations.includes(operationId)) {
    const decision = limited(request.rateLimit('authentication'));
    if (decision !== undefined) return decision;
  }

  if (principal.state === 'mfa_enrollment') {
    const permitted = request.mfaEnrollmentOperations.includes(operationId) && policy.allowDuringMfaEnrollment === true;
    if (!permitted) return deny('mfa_enrollment_required');
  }

  const { roles, channels } = policy;
  if (channels?.includes(principal.channel) !== true || !request.channelAllowed(principal.role, principal.channel))
    return deny('forbidden');
  if (roles?.includes(principal.role) !== true) return deny('forbidden');
  if (policy.stepUp === true && !request.stepUpFresh(principal)) return deny('step_up_required');
  return ALLOW;
}
