/**
 * The rule of the deletion of a work order (EVM-060 AC1–AC3; SR-AUTHZ-10, SR-SESS-08, SR-ERR-01; AB-17; domain-model.md → "Zlecenie"):
 * a pure function of what the modules that hold dependents of the order say about them. A soft delete must never be a way to hide
 * a receivable, so the answer depends on the state of the payment milestones — which the guard cannot know — and is decided here,
 * under the lock of the order, not by the role alone.
 * - a participant says whether its dependents BLOCK the deletion (`invoiced` milestone: `409 has_active_dependents`) or REQUIRE a
 *   fresh step-up (`paid`); the block comes first, so an order with both is `blocked` whatever the freshness of the step-up;
 * - fail closed: no answer at all is `blocked`, never `allow` (a registry that is empty is a defect, not a permission).
 */
export interface DeletionAssessment {
  /** The dependents of the participant forbid the deletion (the answer is `409 has_active_dependents`). */
  readonly blocked: boolean;
  /** The dependents allow the deletion only with a fresh step-up (the answer without it is `403 step_up_required`). */
  readonly stepUpRequired: boolean;
}

export type DeletionDecision = 'allow' | 'blocked' | 'step_up_required';

export function decideDeletion(assessments: readonly DeletionAssessment[], stepUpIsFresh: boolean): DeletionDecision {
  if (assessments.length === 0) return 'blocked';
  if (assessments.some((assessment) => assessment.blocked)) return 'blocked';
  if (assessments.some((assessment) => assessment.stepUpRequired) && !stepUpIsFresh) return 'step_up_required';
  return 'allow';
}
