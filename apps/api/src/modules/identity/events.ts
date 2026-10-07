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
  'session.created',
  'session.revoked',
  'session.expired',
  'login.succeeded',
  'login.failed',
  'account.emergency_reset',
  'step_up.succeeded',
  'step_up.failed',
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
  readonly objectType: 'user' | 'session' | 'passkey';
  /** Absent when the event has no object to point at (a sign-in with an unknown e-mail address). */
  readonly objectId?: string;
}
