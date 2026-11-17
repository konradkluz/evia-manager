/**
 * The extension of an open site survey (EVM-140 AC2, AC3; ADR-0024 pt 9; SR-PRIV-01). Pure functions of data - no database, no framework, no clock of its own.
 * The constants are code, not settings: the retention of personal data is decided, not configured. A survey lives 90 days and is extended by 90 days at most twice
 * (270 days in all); the new deadline is counted from the CURRENT one, so the time that is left is never lost.
 *
 * The order of the questions of {@link decideExtension} is the contract:
 *   1. the order is no open survey (it has a customer, so `site_survey_expires_at` is `NULL` - an ordinary order, or a survey that was claimed): `invalid_state_transition`;
 *   2. the survey is cancelled: `invalid_state_transition` - an Administrator with a step-up restores it first (EVM-136), the Editor cannot buy time for a survey
 *      that was rejected;
 *   3. the limit of two extensions: `extension_limit_reached`;
 *   4. a stale version: `version_conflict` (412, like every other command of the panel).
 */
import { SITE_SURVEY_RETENTION_DAYS } from './site-survey.ts';
import type { WorkOrderStatus } from './work-order-status.ts';

/** The reasons of an extension: a closed list, no free text (the audit trail and the journal keep the code only). */
export const SITE_SURVEY_EXTENSION_REASONS = ['awaiting_client_decision', 'awaiting_community_decision', 'second_visit_needed'] as const;
export type SiteSurveyExtensionReason = (typeof SITE_SURVEY_EXTENSION_REASONS)[number];

/** How many times a survey may be extended, and by how many days. */
export const SITE_SURVEY_MAX_EXTENSIONS = 2;
export const SITE_SURVEY_EXTENSION_DAYS = SITE_SURVEY_RETENTION_DAYS;
/** The reminder is sent when the deadline is this many days away or nearer (AC1). */
export const SITE_SURVEY_REMINDER_DAYS = 15;

const DAY_MS = 86_400_000;

/** The deadline after an extension: the current one + 90 days (24 hours of an instant of UTC, as the first deadline - the change of the clock moves nothing). */
export const deadlineAfterExtension = (current: Date): Date => new Date(current.getTime() + SITE_SURVEY_EXTENSION_DAYS * DAY_MS);

/** The latest deadline that is reminded of at `now`: `now` + 15 days (a survey whose deadline is not later than this is due). */
export const reminderHorizon = (now: Date): Date => new Date(now.getTime() + SITE_SURVEY_REMINDER_DAYS * DAY_MS);

/** What the decision needs of the LOCKED row. */
export interface ExtendableOrder {
  readonly customerId: string | null;
  /** The marker and the deadline of an open survey (`IS NOT NULL` <=> a survey, ADR-0024 pt 1). */
  readonly siteSurveyExpiresAt: Date | null;
  readonly extensions: number;
  readonly status: WorkOrderStatus;
  readonly version: number;
}

export type ExtensionRefusal = 'invalid_state_transition' | 'extension_limit_reached' | 'version_conflict';
export type ExtensionDecision =
  | { readonly kind: 'extend'; readonly expiresAt: Date; readonly extensions: number }
  | { readonly kind: 'refuse'; readonly code: ExtensionRefusal };

export function decideExtension(expectedVersion: number, order: ExtendableOrder): ExtensionDecision {
  if (order.customerId !== null || order.siteSurveyExpiresAt === null) return { kind: 'refuse', code: 'invalid_state_transition' };
  if (order.status === 'cancelled') return { kind: 'refuse', code: 'invalid_state_transition' };
  if (order.extensions >= SITE_SURVEY_MAX_EXTENSIONS) return { kind: 'refuse', code: 'extension_limit_reached' };
  if (order.version !== expectedVersion) return { kind: 'refuse', code: 'version_conflict' };
  return { kind: 'extend', expiresAt: deadlineAfterExtension(order.siteSurveyExpiresAt), extensions: order.extensions + 1 };
}
