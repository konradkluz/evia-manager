import { describe, expect, it } from 'vitest';
import {
  SITE_SURVEY_DEFAULT_TITLE,
  SITE_SURVEY_INITIAL_STATUS,
  SITE_SURVEY_RETENTION_DAYS,
  normalizeSiteSurveyRequest,
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

describe('the survey of the panel (EVM-135 AC2, AC3; W8)', () => {
  const ID = '0193a000-0000-7000-8000-000000000135';
  const SITE = '0193a000-0000-7000-8000-000000000136';

  it('EVM-135 AC2 no title, no phone and no coordinator: the default title, no phone, nobody as the coordinator', () => {
    expect(normalizeSiteSurveyRequest({ id: ID, siteId: SITE })).toEqual({
      ok: true,
      survey: { id: ID, siteId: SITE, title: null, requesterPhone: null, coordinatorUserId: null },
    });
  });

  it('EVM-135 AC2 the title is plain text (trimmed, blank = absent), the phone any common way of writing a number kept in E.164, the coordinator as named', () => {
    const result = normalizeSiteSurveyRequest({
      id: ID,
      siteId: SITE,
      title: '  Garaż  ',
      requesterPhone: '600 700-800',
      assigneeUserId: SITE,
    });
    expect(result).toEqual({
      ok: true,
      survey: { id: ID, siteId: SITE, title: 'Garaż', requesterPhone: '+48600700800', coordinatorUserId: SITE },
    });
    expect(normalizeSiteSurveyRequest({ id: ID, siteId: SITE, title: '   ', requesterPhone: '  ' })).toMatchObject({
      ok: true,
      survey: { title: null, requesterPhone: null },
    });
  });

  it('EVM-135 AC3 a phone that is no number and a title with a control character are errors with a pointer and a code - never the value', () => {
    const result = normalizeSiteSurveyRequest({ id: ID, siteId: SITE, title: 'ab', requesterPhone: '12 34 56 78' });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([
      { pointer: '/title', code: 'invalid_characters' },
      { pointer: '/requesterPhone', code: 'invalid_format' },
    ]);
    expect(JSON.stringify(result)).not.toContain('12 34');
  });
});
