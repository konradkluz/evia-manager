/**
 * Domain events of the `identity` module (EVM-016 W1). Published through the platform event bus inside the transaction
 * of the change; `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event
 * type is the audit action: `<object>.<past tense>`, a closed list. Events carry identifiers and codes only — never an
 * e-mail address, a name, a token or free text (the audit trail is append-only and cannot be erased, RODO art. 17).
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

export const IDENTITY_EVENT_TYPES = [
  'activation_link.issued',
  'account.password_set',
  'passkey.registered',
  'account.activated',
  // EVM-024: an Administrator invited a person / sent the invitation again (no address, no name — the trail cannot be erased).
  'user.invited',
  'invitation.resent',
  // EVM-025: a reset link was asked for / issued by the worker / used to set a new password (no address, no name, no token).
  'password.reset_requested',
  'password_reset_link.issued',
  'password.reset',
  'session.created',
  'session.revoked',
  'session.expired',
  'login.succeeded',
  'login.failed',
  'account.emergency_reset',
  'step_up.succeeded',
  'step_up.failed',
  // EVM-023: a TOTP factor was confirmed / ten recovery codes were made / a recovery code was used to sign in (never the secret, a code or its index).
  'mfa.totp_enrolled',
  'mfa.recovery_codes_generated',
  'login.recovery_code_used',
  // EVM-027: an Administrator changed a role / deactivated or reactivated an account / ended the sessions of a user / reset the second step. Identifiers
  // and codes only (the role before and after as codes) — never a name, an address or a free text.
  'user.role_changed',
  'user.deactivated',
  'user.reactivated',
  'user.sessions_ended',
  'user.second_step_reset',
  // EVM-026: sign-in was locked after ten failed tries — for the browsers the account does not know / for one browser it knows (no address, no key of the counter).
  'account.locked',
  'account.browser_locked',
] as const;

export type IdentityEventType = (typeof IDENTITY_EVENT_TYPES)[number];

/** Closed list of reason codes the audit trail accepts (no free text — Q3). */
export const REASON_CODES = [
  'logout',
  'rotated',
  'emergency_reset',
  'link_superseded',
  'lost_device',
  'lost_credentials',
  'suspected_compromise',
  'other',
  'verification_failed',
  // Why a sign-in failed (EVM-067): the first step (password) and the second (key). Never shown to the client (SR-AUTH-05).
  'bad_password',
  'unknown_user',
  'not_active',
  'passkey_failed',
  'login_expired',
  // A session ran out of idle time or of its absolute lifetime (SR-SESS-03).
  'expired',
  // The deletion of a work order that needed a fresh step-up (EVM-060): the audit record says it was there, never why or what.
  'step_up_verified',
  // Every session of the account ended because the password was reset (EVM-025 AC5; SR-AUTH-15).
  'password_reset',
  // EVM-023: a wrong code of the authenticator app / a wrong recovery code (sign-in, step-up, confirmation). Never shown to the client beyond the 401/400.
  'totp_failed',
  'recovery_code_failed',
  // EVM-027: why a session ended by an Administrator's operation, and how the Administrator verified the identity before a reset of the second step.
  'role_changed',
  'account_deactivated',
  'sessions_ended',
  'second_step_reset',
  'identity_verified_in_person',
  'identity_verified_video_call',
  // The correct password of an account whose window to set up a second step is over, or never was open (EVM-027 D2).
  'mfa_setup_expired',
  // EVM-026: what a lock of the sign-in was caused by — failures of the password only, or at least one of the second step in the window.
  'password',
  'second_step',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/** Reasons the operator can give for the emergency reset (a subset of the codes above). */
export const EMERGENCY_REASONS = ['lost_device', 'lost_credentials', 'suspected_compromise', 'other'] as const;

export type EmergencyReason = (typeof EMERGENCY_REASONS)[number];

export type EventActor =
  | { readonly type: 'user'; readonly userId: string }
  | { readonly type: 'system' }
  /** A holder of a one-time link that is not yet signed in. */
  | { readonly type: 'anonymous' };

export interface IdentityEvent extends DomainEvent {
  readonly type: IdentityEventType;
  readonly actor: EventActor;
  readonly outcome: 'success' | 'denied' | 'failed';
  readonly reasonCode?: ReasonCode;
  /** The role before and after a change (`user.role_changed` only; both together, EVM-027) — codes of the closed list of roles. */
  readonly fromCode?: string;
  readonly toCode?: string;
  readonly objectType: 'user' | 'session' | 'passkey';
  /** Absent when the event has no object to point at (a sign-in with an unknown e-mail address). */
  readonly objectId?: string;
}
