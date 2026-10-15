/**
 * The right to read payments (EVM-056; ADR-0017 W4; P6, SR-AUTHZ-04, ASVS V8.2.3): the ONE predicate that says whether a caller may see
 * the signals of payments outside the resource of the milestones — the payment views and the payment component of "Najpilniejsze" on
 * the list of work orders, the field `payment` of its items and the totals of the facade of `payments`. It is the rule
 * `restrictedParams.paymentMilestone.read` of `x-evia-authz` evaluated in code, and it equals the roles of `listPaymentMilestones`
 * (a test compares them), so the list never shows what the resource would refuse.
 *
 * v1: every signed-in role (P6). The switch over the role is exhaustive: a role added later (the installer of M4) does not compile until
 * this policy names it; a value outside the roles is `false` (deny by default).
 */
import type { UserRole } from '@evia/contracts';
import type { Principal } from '../../platform/http/principal.ts';

export function canReadPayments(principal: Principal): boolean {
  // a value outside the roles cannot be typed, only received: it falls through the switch and is refused
  return readsPayments(principal.role) ?? false;
}

/** Exhaustive (`noImplicitReturns`): a role added to the contract does not compile until it is named here. */
function readsPayments(role: UserRole): boolean | undefined {
  switch (role) {
    case 'administrator':
    case 'editor':
    case 'read_only':
      return true;
  }
}

/** The injection token of the predicate (a unit test gives a stub that refuses — W4 has no role that triggers it in v1). */
export const PAYMENT_READ_POLICY = Symbol('PAYMENT_READ_POLICY');
export type PaymentReadPolicy = (principal: Principal) => boolean;
