/**
 * What the live payment milestones of an order say about the deletion of the order (EVM-060 AC2, AC3; SR-AUTHZ-10, SR-ERR-01; AB-17;
 * domain-model.md → "Zlecenie"): a pure function of their statuses, read by the participant under the lock of the order.
 * - `invoiced` (an issued invoice, a receivable): the deletion is BLOCKED — it would hide the receivable;
 * - `paid`: only with a fresh step-up (the same protection the correction of a payment has);
 * - `planned` and `cancelled` (and no milestone): nothing to protect.
 * The table is exhaustive over the statuses of the contract, and a status it does not know — a value the database should not hold —
 * blocks the deletion (fail closed): a new status added later does not compile until this rule says what it means.
 */
import type { DeletionAssessment } from '../../work-orders/index.ts';
import type { PaymentMilestoneStatus } from './money.ts';

const NOTHING: DeletionAssessment = { blocked: false, stepUpRequired: false };
const STEP_UP: DeletionAssessment = { blocked: false, stepUpRequired: true };
const BLOCKED: DeletionAssessment = { blocked: true, stepUpRequired: false };

/** Exhaustive over the statuses (a new one does not compile until it is listed here). */
const ASSESSMENTS: Readonly<Record<PaymentMilestoneStatus, DeletionAssessment>> = Object.freeze({
  planned: NOTHING,
  cancelled: NOTHING,
  paid: STEP_UP,
  invoiced: BLOCKED,
});

/** A status outside the closed list — a value the database should not hold, or a key of the prototype — is blocked. */
const assessStatus = (status: PaymentMilestoneStatus): DeletionAssessment =>
  Object.hasOwn(ASSESSMENTS, status) ? ASSESSMENTS[status] : BLOCKED;

export function assessMilestonesForDeletion(statuses: readonly PaymentMilestoneStatus[]): DeletionAssessment {
  const assessments = statuses.map(assessStatus);
  return {
    blocked: assessments.some((assessment) => assessment.blocked),
    stepUpRequired: assessments.some((assessment) => assessment.stepUpRequired),
  };
}
