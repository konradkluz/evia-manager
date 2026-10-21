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
 * The sign-in (both steps, whatever the method — a key, a code of the app, a recovery code), the activation password, the passkey ceremony and
 * the setup of a code of the app are guessing targets: the stricter limit (SR-API-02), ONE bucket shared by all of them (a second bucket would double
 * the budget of an attacker, EVM-023 B6) and counted before any database access. Since EVM-028 so are the full re-authentication and the change of the
 * password (they verify the password and the second step too — ASVS V6.3.1).
 */
export const AUTHENTICATION_OPERATIONS: readonly string[] = Object.freeze([
  'login',
  'getLoginPasskeyOptions',
  'verifyLoginPasskey',
  'loginTotp',
  'loginRecoveryCode',
  'setActivationPassword',
  'getPasskeyRegistrationOptions',
  'registerPasskey',
  'startTotpEnrolment',
  'confirmTotp',
  'getStepUpPasskeyOptions',
  'stepUp',
  'reauthenticate',
  'changePassword',
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
