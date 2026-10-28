import { AUTHZ_MANIFEST, ROLES } from '@evia/contracts/authz';
import { describe, expect, it } from 'vitest';
import { canManageQuarantine } from '../../src/modules/authorization/media-quarantine-policy.ts';
import type { Principal } from '../../src/platform/http/principal.ts';

const principalOf = (role: string): Principal => ({ role }) as Principal;

describe('the right to manage the quarantine of media (EVM-049 AC1, AC8; P5, SR-AUTHZ-04)', () => {
  it('EVM-049 AC1 only the Administrator manages the quarantine', () => {
    expect(canManageQuarantine(principalOf('administrator'))).toBe(true);
    for (const role of ['editor', 'read_only']) expect(canManageQuarantine(principalOf(role)), role).toBe(false);
  });

  it('EVM-049 AC8 one source of truth: the predicate equals the roles of the action (rescanMediaAsset)', () => {
    const roles = AUTHZ_MANIFEST['rescanMediaAsset']?.authz.roles ?? [];
    expect(ROLES.filter((role) => canManageQuarantine(principalOf(role)))).toEqual([...roles]);
  });

  it('EVM-049 AC1 the list declares the policy for the field of the reason (the declaration matches the code)', () => {
    const rule = AUTHZ_MANIFEST['listMediaAssets']?.authz.restrictedParams?.['mediaQuarantine.manage'];
    expect(rule?.fields).toEqual(['quarantineReasonCode']);
  });

  it('EVM-049 AC1 deny by default: a role the policy does not know manages nothing', () => {
    for (const role of ['installer', '', 'ADMINISTRATOR']) expect(canManageQuarantine(principalOf(role)), role).toBe(false);
  });
});
