/**
 * The decision of the assignment of a customer to a site survey (EVM-136 AC1, AC2; ADR-0024 pt 3). A pure function of the locked row and of the command — no
 * database, no framework. The order of the questions is the contract:
 *   1. the same customer is already set: nothing to do (`noop`, answer 200) - BEFORE the version, because the retry of a success carries the version of
 *      before it, so a stale version there is the same command, not a conflict;
 *   2. the order has a customer (another one, or an ordinary order): `customer_already_set` - the customer is set once ("empty -> X", v1);
 *   3. the survey is cancelled: `invalid_state_transition` - only the Administrator (with a step-up) brings it back, so an Editor cannot use the
 *      assignment to leave "Anulowane" or to escape the 14-day deadline of the rejection (paths do not bypass roles, EVM-030 AC7);
 *   4. a stale version: `version_conflict` (412, like every other command of the panel).
 * By the CHECKs of 0066 an order without a customer is always a survey, so the first two questions cover "not a survey".
 */
import type { WorkOrderStatus } from './work-order-status.ts';

export interface AssignableOrder {
  readonly customerId: string | null;
  /** The marker and the deadline of an open survey (`IS NOT NULL` <=> a survey, ADR-0024 pt 1). */
  readonly siteSurveyExpiresAt: Date | null;
  readonly status: WorkOrderStatus;
  readonly version: number;
}

export interface AssignmentCommand {
  readonly customerId: string;
  readonly version: number;
}

export type AssignmentRefusal = 'customer_already_set' | 'invalid_state_transition' | 'version_conflict';
export type AssignmentDecision =
  { readonly kind: 'noop' } | { readonly kind: 'assign' } | { readonly kind: 'refuse'; readonly code: AssignmentRefusal };

export function decideAssignment(command: AssignmentCommand, order: AssignableOrder): AssignmentDecision {
  if (order.customerId === command.customerId) return { kind: 'noop' };
  if (order.customerId !== null || order.siteSurveyExpiresAt === null) return { kind: 'refuse', code: 'customer_already_set' };
  if (order.status === 'cancelled') return { kind: 'refuse', code: 'invalid_state_transition' };
  if (order.version !== command.version) return { kind: 'refuse', code: 'version_conflict' };
  return { kind: 'assign' };
}
