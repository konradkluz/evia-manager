/**
 * Domain events of the `payments` module (EVM-053, EVM-054). Published through the platform event bus inside the transaction of the
 * change; `audit` and `timeline` subscribe to them (the dependencies point from those modules to this file, never back). The event
 * type of the audit trail is the action: `<object>.<past tense>`. The object is the milestone; its order is named as well. An event
 * carries identifiers, the codes of the status before and after a transition (EVM-054) and — the exception of the audit trail for
 * payments (domain-model.md → AuditEvent, SR-LOG-03) — the amount before and after in grosze (PLN). NEVER the name of the milestone,
 * the invoice number or the reason of a cancellation (free text that may name a person; the trail and the journal are append-only,
 * RODO art. 17) and no names or values of fields.
 * The milestones copied from a template are a part of `work_order.created`, not events of their own.
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';
import type { PaymentMilestoneStatus } from './domain/money.ts';

export const PAYMENT_MILESTONE_EVENT_TYPES = [
  'payment_milestone.created',
  'payment_milestone.amount_changed',
  'payment_milestone.cancelled',
  'payment_milestone.invoiced',
  'payment_milestone.paid',
  'payment_milestone.details_changed',
] as const;

export interface PaymentMilestoneEvent extends DomainEvent {
  readonly type: (typeof PAYMENT_MILESTONE_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'payment_milestone';
  /** The milestone. */
  readonly objectId: string;
  /** The order the milestone belongs to. */
  readonly workOrderId: string;
  /** The amount before the change in grosze (PLN), `null` when there was none (a creation, an amount entered the first time). */
  readonly amountBeforeMinor: number | null;
  /** The amount after the change in grosze (PLN), `null` when there is none (a milestone cancelled before it was priced). */
  readonly amountAfterMinor: number | null;
  /** The status before a transition (EVM-054), `null` when the event does not change the status. */
  readonly fromCode: PaymentMilestoneStatus | null;
  /** The status after a transition (EVM-054), `null` together with `fromCode`. */
  readonly toCode: PaymentMilestoneStatus | null;
}

/**
 * The change of the status of a milestone for the JOURNAL of its order (EVM-054 AC3; EVM-038), published inside the transaction of
 * the change — by the command of a transition and by the effect of the cancellation of an order. NOT in
 * `PAYMENT_MILESTONE_EVENT_TYPES`: `audit` does not subscribe to it. The two status codes and nothing else — no amount (SR-DATA-01).
 */
export const PAYMENT_MILESTONE_JOURNAL_EVENT_TYPES = ['payment_milestone.status_changed'] as const;

export interface PaymentMilestoneStatusChangedEvent extends DomainEvent {
  readonly type: (typeof PAYMENT_MILESTONE_JOURNAL_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'payment_milestone';
  readonly objectId: string;
  readonly workOrderId: string;
  readonly fromStatus: PaymentMilestoneStatus;
  readonly toStatus: PaymentMilestoneStatus;
}
