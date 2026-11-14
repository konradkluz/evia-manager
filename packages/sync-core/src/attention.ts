import type { MutationType } from './types.ts';

/** Actions offered for an entry that "needs attention"; the order is the order of importance (flow 16, M-07). */
export type AttentionAction = 'retarget' | 'copy' | 'recreate' | 'discard';

/** Key of the plain-language reason; the host maps it to text (i18n). `unknown` is also what any unrecognised server code becomes. */
export type AttentionReason =
  | 'target_unavailable'
  | 'validation_failed'
  | 'validation_failed_quick'
  | 'id_conflict'
  | 'template_unavailable'
  | 'quota_exceeded'
  | 'unknown';

export interface AttentionPlan {
  readonly reason: AttentionReason;
  readonly actions: readonly AttentionAction[];
}

/**
 * Rejection code -> reason and actions (flow 16, table of rejections). Pure and allow-listed (SR-MOB-10): an unknown code never
 * removes anything - only "copy" and "discard" are offered, and "discard" is always last and always the user's decision.
 */
export function attentionPlan(entry: { readonly type: MutationType; readonly lastCode?: string | undefined }): AttentionPlan {
  const code = entry.lastCode;
  if (entry.type === 'CreateQuickWorkOrder') {
    if (code === 'template_unavailable') return { reason: 'template_unavailable', actions: ['recreate', 'discard'] };
    if (code === 'quota_exceeded') return { reason: 'quota_exceeded', actions: ['recreate', 'discard'] };
    if (code === 'validation_failed') return { reason: 'validation_failed_quick', actions: ['recreate', 'discard'] };
    if (code === 'id_conflict') return { reason: 'id_conflict', actions: ['recreate', 'discard'] };
    return { reason: 'unknown', actions: ['copy', 'discard'] };
  }
  if (code === 'target_unavailable' || code === 'forbidden')
    return { reason: 'target_unavailable', actions: ['retarget', 'copy', 'discard'] };
  if (code === 'validation_failed') return { reason: 'validation_failed', actions: ['copy', 'retarget', 'discard'] };
  if (code === 'id_conflict') return { reason: 'id_conflict', actions: ['recreate', 'discard'] };
  return { reason: 'unknown', actions: ['copy', 'discard'] };
}
