/**
 * What the payment milestones of an order say about a transition of the order (EVM-053 AC6, EVM-054 AC6; domain-model.md → "Zlecenie";
 * SR-AUTHZ-10, SR-API-06): pure functions of the statuses of the LIVE milestones, read by the participant under the lock of the order.
 * - `completed → settled`: every milestone is `paid` or `cancelled`, otherwise `unpaid_milestones` (EVM-053);
 * - `→ cancelled`: no milestone is `invoiced`, otherwise `invoiced_milestones` (EVM-054) — a cancellation would hide an issued invoice
 *   in a closed order, the effect reserved for the correction of the Administrator with a step-up (EVM-057);
 * - the effect of a cancellation: every `planned` milestone becomes `cancelled` (EVM-053).
 * A code of a reason, never an amount or a name.
 */
import { SETTLED_STATUSES } from './milestone-rules.ts';
import type { PaymentMilestoneStatus } from './money.ts';

export const UNPAID_MILESTONES = 'unpaid_milestones';
export const INVOICED_MILESTONES = 'invoiced_milestones';

/** @returns the code of the unmet condition, or `undefined` */
export function orderTransitionCondition(to: string, statuses: readonly PaymentMilestoneStatus[]): string | undefined {
  if (to === 'settled') return statuses.every((status) => SETTLED_STATUSES.includes(status)) ? undefined : UNPAID_MILESTONES;
  if (to === 'cancelled') return statuses.includes('invoiced') ? INVOICED_MILESTONES : undefined;
  return undefined;
}

/** The statuses after the effect of the transition of the order (a cancellation cancels the planned milestones; nothing else changes). */
export const orderTransitionEffect = (to: string, statuses: readonly PaymentMilestoneStatus[]): PaymentMilestoneStatus[] =>
  to === 'cancelled' ? statuses.map((status) => (status === 'planned' ? 'cancelled' : status)) : [...statuses];
