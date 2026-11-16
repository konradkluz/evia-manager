/**
 * Role × channel rule (SR-AUTHZ-06; EVM-016): the mobile channel is for field work, so the read-only role has no
 * `mobile` sessions. The rule belongs to `identity` (the owner of roles and sessions); the guard asks it on every
 * request, so a mobile session of a read-only user (e.g. created by mistake) is still denied.
 */
import type { Channel, UserRole } from '@evia/contracts';

export function channelAllowedForRole(role: UserRole, channel: Channel): boolean {
  return channel === 'web' || role !== 'read_only';
}
