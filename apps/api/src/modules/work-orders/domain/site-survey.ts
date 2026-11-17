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

/**
 * The limit of OPEN surveys (EVM-140 AC4; ADR-0024 pt 10; W7): a survey without a customer that is not cancelled (and not purged). 20 per creator and 100 in all -
 * constants in code, like the retention. A creator who has 20 cannot make the 21st; nobody can make the 101st. The assignment of a customer and the
 * cancellation free a place, the deletion of an unclaimed survey too.
 */
export const SITE_SURVEY_LIMIT_PER_CREATOR = 20;
export const SITE_SURVEY_LIMIT_TOTAL = 100;

/** What the limit needs: the open surveys of the creator and all the open surveys, counted under the lock of the creation. */
export interface OpenSurveyCounts {
  readonly ofCreator: number;
  readonly total: number;
}

/** Is a new survey over the limit? The counts are those BEFORE the new one: the 20th is allowed, the 21st is not. */
export const surveyLimitExceeded = (counts: OpenSurveyCounts): boolean =>
  counts.ofCreator >= SITE_SURVEY_LIMIT_PER_CREATOR || counts.total >= SITE_SURVEY_LIMIT_TOTAL;

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

/**
 * Does the order wait for its customer (EVM-135 AC7; ADR-0024 pt 4)? An order without a customer is an open site survey (CHECK of 0066): its payment plan, its
 * documents and the ZIP export of its media are `409 customer_required` until the customer is assigned.
 */
export const awaitsCustomer = (order: { readonly customerId: string | null }): boolean => order.customerId === null;
