import { describe, expect, it } from 'vitest';
import {
  SITE_SURVEY_DEFAULT_TITLE,
  SITE_SURVEY_INITIAL_STATUS,
  SITE_SURVEY_RETENTION_DAYS,
  siteSurveyExpiry,
} from '../../src/modules/work-orders/domain/site-survey.ts';

describe('the site survey of the domain (EVM-135 AC1; ADR-0024 pt 1, 9; SR-PRIV-01)', () => {
  it('EVM-135 AC1 the deadline is the moment of creation + 90 days - an instant, the same across the change of time of 2027-03-28', () => {
    expect(SITE_SURVEY_RETENTION_DAYS).toBe(90);
    expect(siteSurveyExpiry(new Date('2026-11-16T08:00:00.000Z')).toISOString()).toBe('2027-02-14T08:00:00.000Z');
    expect(siteSurveyExpiry(new Date('2027-01-15T23:30:00.000Z')).toISOString()).toBe('2027-04-15T23:30:00.000Z');
  });

  it('EVM-135 AC1 a survey starts in quoting with the title "Wizja lokalna"', () => {
    expect(SITE_SURVEY_INITIAL_STATUS).toBe('quoting');
    expect(SITE_SURVEY_DEFAULT_TITLE).toBe('Wizja lokalna');
  });
});
