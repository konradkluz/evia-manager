/**
 * Domain events of the `payments` module (EVM-053). Published through the platform event bus inside the transaction of the change;
 * `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit action:
 * `<object>.<past tense>`. The object is the milestone; its order is named as well. An event carries identifiers and — the exception
 * of the audit trail for payments (domain-model.md → AuditEvent, SR-LOG-03) — the amount before and after in grosze (PLN). NEVER the
 * name of the milestone (free text that may name a person; the trail is append-only, RODO art. 17) and no names of fields.
 * The milestones copied from a template are a part of `work_order.created`, not events of their own.
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

export const PAYMENT_MILESTONE_EVENT_TYPES = [
  'payment_milestone.created',
  'payment_milestone.amount_changed',
  'payment_milestone.cancelled',
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
}
