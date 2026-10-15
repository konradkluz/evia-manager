import { AUTHZ_MANIFEST, ROLES } from '@evia/contracts/authz';
import { describe, expect, it } from 'vitest';
import { canReadPayments } from '../../src/modules/authorization/payment-read-policy.ts';
import type { Principal } from '../../src/platform/http/principal.ts';

const principalOf = (role: string): Principal => ({ role }) as Principal;

describe('the right to read payments (EVM-056 AC7; ADR-0017 W4; P6, SR-AUTHZ-04)', () => {
  it('EVM-056 AC7 the Administrator, the Editor and the Read-only role may read payments (P6)', () => {
    for (const role of ['administrator', 'editor', 'read_only']) expect(canReadPayments(principalOf(role)), role).toBe(true);
  });

  it('EVM-056 AC7 one source of truth: the predicate of the list equals the roles of the resource of the milestones (listPaymentMilestones)', () => {
    const roles = AUTHZ_MANIFEST['listPaymentMilestones']?.authz.roles ?? [];
    expect(ROLES.filter((role) => canReadPayments(principalOf(role)))).toEqual([...roles]);
  });

  it('EVM-056 AC7 deny by default: a role the policy does not know may not read payments', () => {
    for (const role of ['installer', '', 'ADMINISTRATOR']) expect(canReadPayments(principalOf(role)), role).toBe(false);
  });
});
