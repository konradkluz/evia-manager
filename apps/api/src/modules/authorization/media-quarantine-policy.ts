/**
 * The right to manage the quarantine of media files (EVM-049; P5; SR-AUTHZ-04, ASVS V8.2.3): the ONE predicate that says whether a caller
 * may see the REASON a file was stopped by the scan and ask for a new scan. It is the rule `restrictedParams.mediaQuarantine.manage` of
 * `x-evia-authz` evaluated in code, and it equals the roles of `rescanMediaAsset` (a test compares them), so the list never shows a reason
 * to a role the action would refuse.
 *
 * v1: the Administrator only. The switch over the role is exhaustive: a role added later does not compile until this policy names it; a
 * value outside the roles is `false` (deny by default).
 */
import type { UserRole } from '@evia/contracts';
import type { Principal } from '../../platform/http/principal.ts';

export function canManageQuarantine(principal: Principal): boolean {
  // a value outside the roles cannot be typed, only received: it falls through the switch and is refused
  return managesQuarantine(principal.role) ?? false;
}

/** Exhaustive (`noImplicitReturns`): a role added to the contract does not compile until it is named here. */
function managesQuarantine(role: UserRole): boolean | undefined {
  switch (role) {
    case 'administrator':
      return true;
    case 'editor':
    case 'read_only':
      return false;
  }
}
