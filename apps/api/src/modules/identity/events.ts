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
  'account.emergency_reset',
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
  readonly objectId: string;
}
