/**
 * Operation allow-lists of the contract (EVM-008, EVM-016). Each list is checked twice (defence in depth): by the
 * contract lint (redocly-plugin.ts) and at runtime by the API authorization guard. Changing a list needs a
 * security-engineer review.
 */

/**
 * Operations reachable without a session (`x-evia-authz: { public: true }`). Mutations among them are protected by
 * Origin + Sec-Fetch-Site checks and per-IP limits instead of a session.
 */
export const PUBLIC_OPERATIONS: readonly string[] = Object.freeze([
  'getHealth',
  'checkActivationLink',
  'setActivationPassword',
  'login',
  'getLoginPasskeyOptions',
  'verifyLoginPasskey',
]);

/**
 * Operations a session in the `mfa_enrollment` state may call (`x-evia-authz.allowDuringMfaEnrollment: true`): the
 * passkey enrolment itself, reading the session (the panel recovers its CSRF token after a reload) and logging out.
 * Everything else answers `403 mfa_enrollment_required` (AC4).
 */
export const MFA_ENROLLMENT_OPERATIONS: readonly string[] = Object.freeze([
  'getCurrentSession',
  'getPasskeyRegistrationOptions',
  'registerPasskey',
  'extendSession',
  'logout',
]);

/**
 * Operations that may list the `mobile` channel in `x-evia-authz.channels` (SR-AUTHZ-12). Empty in M1: the mobile
 * channel starts with E9 — a `mobile` entry anywhere else fails the contract lint. Never with `stepUp: true`.
 */
export const MOBILE_OPERATIONS: readonly string[] = Object.freeze([]);
