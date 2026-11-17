/**
 * The site survey (EVM-135; ADR-0024): a work order without a customer, in `quoting`, with an explicit deadline - the column `site_survey_expires_at` is the
 * marker AND the deadline. The constants are code, not settings (SR-PRIV-01: the retention of personal data is decided, not configured). Pure, no framework.
 */
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';
import { normalizePhone } from '../../../platform/input/phone.ts';
import type { WorkOrderStatus } from './work-order-status.ts';

/** A survey without a customer is purged this many days after its creation (decision 3; the extensions of EVM-140 add the same again). */
export const SITE_SURVEY_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The title of a survey whose creator named none (decision 8: the name in the interface is "Wizja lokalna"). */
export const SITE_SURVEY_DEFAULT_TITLE = 'Wizja lokalna';

/** A survey is created in "Wycena" (decision 1); the database allows it only in quoting, on_hold and cancelled (CHECK of 0066). */
export const SITE_SURVEY_INITIAL_STATUS: WorkOrderStatus = 'quoting';

/** The deadline of a new survey: an instant (UTC) 90 × 24 hours after the creation - the change of time does not move it. */
export const siteSurveyExpiry = (createdAt: Date): Date => new Date(createdAt.getTime() + SITE_SURVEY_RETENTION_DAYS * DAY_MS);

/** The body of `createSiteSurvey` after the schema of the contract (types and bounds are checked; the rules below are not). */
export interface SiteSurveyRequestInput {
  readonly id: string;
  readonly siteId: string;
  readonly title?: string | undefined;
  readonly requesterPhone?: string | undefined;
  readonly assigneeUserId?: string | undefined;
}

/** The survey of the panel ready for the composer: the title normalised (`null` - the default), the phone in E.164, the coordinator (`null` - nobody). */
export interface NormalizedSiteSurvey {
  readonly id: string;
  readonly siteId: string;
  readonly title: string | null;
  readonly requesterPhone: string | null;
  readonly coordinatorUserId: string | null;
}

export type SiteSurveyRequestResult =
  { readonly ok: true; readonly survey: NormalizedSiteSurvey } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

/**
 * The rules of a survey of the panel (EVM-135 AC2, AC3; W8): the title is plain text (blank = absent, the default applies), the phone of the requester is any common
 * way of writing a number, kept in E.164. The errors are a JSON Pointer and a code - never the value (the phone is personal data, SR-ERR-02).
 */
export function normalizeSiteSurveyRequest(input: SiteSurveyRequestInput): SiteSurveyRequestResult {
  const issues = new Collector();
  const title = issues.text('/title', input.title, { maxLength: 200 });
  const requesterPhone = issues.shaped('/requesterPhone', input.requesterPhone, normalizePhone);
  if (issues.errors.length > 0) return { ok: false, errors: issues.errors };
  return {
    ok: true,
    survey: { id: input.id, siteId: input.siteId, title, requesterPhone, coordinatorUserId: input.assigneeUserId ?? null },
  };
}
