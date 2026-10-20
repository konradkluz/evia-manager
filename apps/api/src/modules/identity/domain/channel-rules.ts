/**
 * Role × channel rule (SR-AUTHZ-06; EVM-016): the mobile channel is for field work, so the read-only role has no
 * `mobile` sessions. The rule belongs to `identity` (the owner of roles and sessions); the guard asks it on every
 * request, so a mobile session of a read-only user (e.g. created by mistake) is still denied.
 */
import type { Channel, UserRole } from '@evia/contracts';

export function channelAllowedForRole(role: UserRole, channel: Channel): boolean {
  return channel === 'web' || role !== 'read_only';
}

/**
 * May this role use a code from an authenticator app in this channel (P1; EVM-023 AC3)? The Administrator's second step in the panel is a passkey
 * only — a code is phishable (TM-90), and the Administrator is the account worth phishing. Their TOTP is for the mobile app (M2).
 */
export function totpAllowedForRole(role: UserRole, channel: Channel): boolean {
  return !(role === 'administrator' && channel === 'web');
}
