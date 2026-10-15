import { AUTHZ_MANIFEST, ROLES } from '@evia/contracts/authz';
import type { UserRole } from '@evia/contracts';
import { describe, expect, it } from 'vitest';
import { canReadPayments } from '../src/payments/payment-access.ts';
import { PAYMENT_SORTS, PAYMENT_VIEWS } from '../src/work-orders/filters.ts';

// W4 of ADR-0017 in the panel (EVM-056 AC7): the column "Płatność", the views and "Najpilniejsze" exist only for a role that may read
// the payments. The panel's predicate and its list of restricted values follow the contract — the server decides all the same.
describe('the right to read payments in the panel (EVM-056 AC7)', () => {
  it('EVM-056 AC7 A, E and R read payments — the same roles as listPaymentMilestones; anything else is denied', () => {
    const allowed: readonly string[] = AUTHZ_MANIFEST['listPaymentMilestones']?.authz.roles ?? [];
    expect(allowed.length).toBeGreaterThan(0);
    for (const role of ROLES) expect(canReadPayments(role)).toBe(allowed.includes(role));
    expect((['administrator', 'editor', 'read_only'] as const).every((role) => canReadPayments(role))).toBe(true);
    expect(canReadPayments(undefined)).toBe(false);
    expect(canReadPayments('auditor_of_a_newer_api' as UserRole)).toBe(false);
  });

  it('EVM-056 AC7 the views and the sort the panel hides without the right are exactly the restricted values of the contract', () => {
    for (const operation of ['listWorkOrders', 'searchWorkOrders'] as const) {
      const restricted = AUTHZ_MANIFEST[operation]?.authz.restrictedParams?.['paymentMilestone.read'];
      expect(restricted?.params).toEqual({ view: [...PAYMENT_VIEWS], sort: [...PAYMENT_SORTS] });
      expect(restricted?.fields).toEqual(['payment']);
    }
  });
});
