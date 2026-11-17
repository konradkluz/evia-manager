/**
 * The automatic purge of site surveys (EVM-139; ADR-0024 pt 9; SR-PRIV-11, SR-PRIV-01). Pure functions of data - no database, no framework, no clock of its own. The
 * periods are code, not settings (the retention of personal data is decided, not configured): the survey lives 90 days after its creation (`SITE_SURVEY_RETENTION_DAYS`),
 * each of two extensions adds 90 (`SITE_SURVEY_EXTENSION_DAYS`) and a rejected or cancelled survey keeps 14 days (`SITE_SURVEY_REJECTED_DAYS`) - all of them move the
 * DEADLINE `site_survey_expires_at`, so the job itself knows no period: it asks about the deadline only. What this file owns: the mode, the three conditions of a
 * candidate, the limit of one run and the neutral values of the tombstone.
 */
import { SITE_SURVEY_DEFAULT_TITLE } from './site-survey.ts';

/** `report` counts the candidates and erases nothing; `enforce` erases them. The deployment says which (`SITE_SURVEY_PURGE_MODE`); the default is `report`. */
export const SITE_SURVEY_PURGE_MODES = ['report', 'enforce'] as const;
export type SiteSurveyPurgeMode = (typeof SITE_SURVEY_PURGE_MODES)[number];
export const DEFAULT_SITE_SURVEY_PURGE_MODE: SiteSurveyPurgeMode = 'report';

/** The most surveys ONE run erases (the limit of open surveys is 100 in all; a bug in the selection can never empty the table in one pass). The rest waits for the next run. */
export const SITE_SURVEY_PURGE_LIMIT_PER_RUN = 50;

const HOUR_MS = 3_600_000;
/**
 * The location of a survey was MADE FOR it when the same person made it at most this long before the survey (the survey names an existing location, so the location is
 * older): the panel makes the location and then the survey within minutes, the phone does both in one request. A location older than that is a place the company knows
 * and is never anonymized by the purge.
 */
export const SITE_MADE_FOR_SURVEY_WINDOW_MS = 24 * HOUR_MS;

/** The neutral title of a tombstone: the default title of a survey (the title is free text and may name a person - it goes). */
export const SITE_SURVEY_TOMBSTONE_TITLE = SITE_SURVEY_DEFAULT_TITLE;

/** What a survey is to the job: the three columns of the selection. */
export interface PurgeableOrder {
  readonly siteSurveyExpiresAt: Date | null;
  readonly customerId: string | null;
  readonly siteSurveyPurgedAt: Date | null;
}

/**
 * The three conditions of a candidate (the same as the SQL of the job - the test of the boundary runs both): the deadline has passed (STRICTLY: at the instant of the
 * deadline the survey still lives), no customer was ever assigned, the survey is not purged yet. A survey with a customer is never a candidate.
 */
export function isPurgeCandidate(order: PurgeableOrder, now: Date): boolean {
  return (
    order.siteSurveyExpiresAt !== null &&
    order.siteSurveyExpiresAt.getTime() < now.getTime() &&
    order.customerId === null &&
    order.siteSurveyPurgedAt === null
  );
}

/** The window in which the location must have been created to count as made for the survey created at `surveyCreatedAt`. */
export function siteMadeForSurveyWindow(surveyCreatedAt: Date): { readonly notBefore: Date; readonly notAfter: Date } {
  return { notBefore: new Date(surveyCreatedAt.getTime() - SITE_MADE_FOR_SURVEY_WINDOW_MS), notAfter: surveyCreatedAt };
}
