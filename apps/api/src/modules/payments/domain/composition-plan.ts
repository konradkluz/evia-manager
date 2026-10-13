/**
 * The milestones a new work order gets from the payment plan of its template (EVM-053 AC1; domain-model.md → "Kompozycja zlecenia z
 * szablonu", D1): a COPY — the code, the name, the share and the payment term, numbered again 1..n in the order of the template (the
 * position of the template is not copied), every milestone `planned` and without an amount (the office enters the amounts).
 *
 * Fail closed: a plan that would pass the limit of the API (20 milestones per order) is NOT trimmed — the planner throws, the creation
 * of the order rolls back as a whole, and the cause is the configuration of the template, not the request.
 */
import { MAX_MILESTONES_PER_ORDER } from './milestone-rules.ts';

export interface PlanMilestone {
  readonly sourceTemplateId: string;
  readonly code: string;
  readonly name: string;
  readonly sharePercent: number;
  readonly paymentTermDays: number;
}

export interface PlannedMilestone extends PlanMilestone {
  readonly position: number;
}

export class PaymentPlanLimitError extends Error {
  constructor() {
    super(`the payment plan of the template has more than ${MAX_MILESTONES_PER_ORDER} milestones`);
    this.name = 'PaymentPlanLimitError';
  }
}

export function planMilestones(plan: readonly PlanMilestone[]): PlannedMilestone[] {
  if (plan.length > MAX_MILESTONES_PER_ORDER) throw new PaymentPlanLimitError();
  return plan.map((milestone, index) => ({
    sourceTemplateId: milestone.sourceTemplateId,
    code: milestone.code,
    name: milestone.name,
    sharePercent: milestone.sharePercent,
    paymentTermDays: milestone.paymentTermDays,
    position: index + 1,
  }));
}
