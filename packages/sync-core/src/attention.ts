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
  // site survey (EVM-137): the survey itself and what waits behind it; the texts carry no address and no phone number
  | 'validation_failed_survey'
  | 'id_conflict_survey'
  | 'feature_disabled'
  | 'quota_exceeded_survey'
  | 'site_survey_limit'
  | 'survey_unavailable'
  | 'survey_photo_unavailable'
  | 'survey_video_unavailable'
  | 'survey_entry_unavailable'
  | 'unknown_survey'
  | 'unknown';

export interface AttentionPlan {
  readonly reason: AttentionReason;
  readonly actions: readonly AttentionAction[];
}

/** What the host knows about the order an entry belongs to. */
export interface AttentionContext {
  /** Orders that are (or were) site surveys: ids from the queue, the replica and the durable marks of the host. */
  readonly surveyOrderIds?: ReadonlySet<string> | undefined;
}

const SURVEY_REASONS: Readonly<Record<string, AttentionReason>> = {
  validation_failed: 'validation_failed_survey',
  id_conflict: 'id_conflict_survey',
  feature_disabled: 'feature_disabled',
  quota_exceeded: 'quota_exceeded_survey',
  // EVM-140 AC4: the limit of open site surveys (a known code since the contract of EVM-140)
  site_survey_limit_exceeded: 'site_survey_limit',
  target_unavailable: 'survey_unavailable',
  forbidden: 'survey_unavailable',
};

/**
 * Rejection code -> reason and actions (flow 16, table of rejections). Pure and allow-listed (SR-MOB-10): an unknown code never
 * removes anything - only "copy" and "discard" are offered, and "discard" is always last and always the user's decision.
 */
export function attentionPlan(
  entry: {
    readonly type: MutationType;
    readonly lastCode?: string | undefined;
    readonly orderingKey?: string | undefined;
    readonly payload?: Readonly<Record<string, unknown>> | undefined;
  },
  context: AttentionContext = {},
): AttentionPlan {
  const code = entry.lastCode;
  // EVM-137 (W10, flow 17): a site survey and what belongs to it is never moved to another order (IDOR) and never copied (the data
  // name a place): the only way out is "Usuń z telefonu"
  if (entry.type === 'CreateSiteSurvey') {
    const reason = SURVEY_REASONS[code ?? ''] ?? 'unknown_survey';
    return { reason, actions: ['discard'] };
  }
  if (entry.orderingKey !== undefined && context.surveyOrderIds?.has(entry.orderingKey) === true) {
    if (code === 'target_unavailable' || code === 'forbidden') {
      const reason: AttentionReason =
        entry.type === 'CreateMediaAsset'
          ? entry.payload?.['mediaType'] === 'video'
            ? 'survey_video_unavailable'
            : 'survey_photo_unavailable'
          : 'survey_entry_unavailable';
      return { reason, actions: ['discard'] };
    }
    const plan = attentionPlan(entry);
    return { reason: plan.reason, actions: plan.actions.filter((action) => action !== 'retarget') };
  }
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
