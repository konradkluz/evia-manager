/**
 * The site survey (EVM-135; ADR-0024): a work order without a customer, in `quoting`, with an explicit deadline - the column `site_survey_expires_at` is the
 * marker AND the deadline. The constants are code, not settings (SR-PRIV-01: the retention of personal data is decided, not configured). Pure, no framework.
 */
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
