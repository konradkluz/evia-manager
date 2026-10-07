/**
 * Where policies come from: the authorization manifest generated from the contract and the allow-lists of public and
 * enrolment operations (all from @evia/contracts). Bound once in AuthorizationModule; the token exists so that tests
 * can exercise protected operations with their own policies.
 */
import { AUTHZ_MANIFEST, MFA_ENROLLMENT_OPERATIONS, PUBLIC_OPERATIONS, type AuthzManifest } from '@evia/contracts/authz';

export interface PolicySource {
  readonly manifest: AuthzManifest;
  readonly publicOperations: readonly string[];
  /** Operations a session in the `mfa_enrollment` state may call (together with `allowDuringMfaEnrollment` in the contract). */
  readonly mfaEnrollmentOperations: readonly string[];
  /** Operations with the sign-in and MFA limit of 20 requests/min/IP (P10). */
  readonly authenticationOperations: readonly string[];
  /** Operations that do not count as activity of the session (EVM-067; SR-WEB-05): reading must not keep it alive. */
  readonly passiveOperations: readonly string[];
}

export const POLICY_SOURCE = Symbol('POLICY_SOURCE');

/**
 * The sign-in (both steps), the activation password and the passkey ceremony are guessing targets: the stricter limit
 * (SR-API-02), shared by all of them and counted before any database access.
 */
export const AUTHENTICATION_OPERATIONS: readonly string[] = Object.freeze([
  'login',
  'getLoginPasskeyOptions',
  'verifyLoginPasskey',
  'setActivationPassword',
  'getPasskeyRegistrationOptions',
  'registerPasskey',
  'getStepUpPasskeyOptions',
  'stepUp',
]);

/**
 * The warning of P-11 reads the session to know the deadlines, and `extendSession` moves them itself: neither is activity
 * that moves the idle deadline implicitly.
 */
export const PASSIVE_OPERATIONS: readonly string[] = Object.freeze(['getCurrentSession', 'extendSession']);

export const CONTRACT_POLICIES: PolicySource = Object.freeze({
  manifest: AUTHZ_MANIFEST,
  publicOperations: PUBLIC_OPERATIONS,
  mfaEnrollmentOperations: MFA_ENROLLMENT_OPERATIONS,
  authenticationOperations: AUTHENTICATION_OPERATIONS,
  passiveOperations: PASSIVE_OPERATIONS,
});
