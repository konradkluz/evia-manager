import { describe, expect, it } from 'vitest';
import {
  EXPIRING_VIEW,
  expiringSurveys,
  isFiltered,
  NO_FILTERS,
  searchOf,
  shapeSurveyRows,
  sortsFor,
  statusesOf,
  surveyOf,
  surveyScoped,
  toQuery,
  toSearchBody,
  validateSearch,
  viewOf,
  withSurveySort,
  type WorkOrderFilters,
} from '../src/work-orders/filters.ts';
import { expiringViewLabel, toResolveText } from '../src/work-orders/survey-list-labels.ts';

// EVM-138 AC1, AC6: the filters of W-10 for site surveys — the address, the query of the API, the search, the sorts, "Wygasające wizje".
const NOW = Date.parse('2027-01-30T09:00:00.000Z');
const survey = (expiresAt: string) => ({ expiresAt, extensionCount: 0, requesterPhone: null });
const row = (status: string, expiresAt: string | null) => ({ status, siteSurvey: expiresAt === null ? null : survey(expiresAt) });
const filters = (over: Partial<WorkOrderFilters> = {}): WorkOrderFilters => ({ ...NO_FILTERS, ...over });

describe('the address and the roles (EVM-138 AC1, AC6)', () => {
  it('EVM-138 AC1 the address carries siteSurvey=only|exclude and nothing else of the survey filter; the other values are dropped', () => {
    expect(validateSearch({ siteSurvey: 'only' })).toEqual({ siteSurvey: 'only' });
    expect(validateSearch({ siteSurvey: 'exclude', view: EXPIRING_VIEW })).toEqual({ siteSurvey: 'exclude', view: EXPIRING_VIEW });
    expect(validateSearch({ siteSurvey: 'all' })).toEqual({});
    expect(validateSearch({ siteSurvey: 1 })).toEqual({});
    expect(searchOf(filters({ survey: 'only' }))).toEqual({ siteSurvey: 'only' });
    expect(searchOf(filters({ survey: 'exclude' }))).toEqual({ siteSurvey: 'exclude' });
    expect(searchOf(filters())).toEqual({});
    // the view is a survey filter itself: the address says it once
    expect(searchOf(filters({ view: EXPIRING_VIEW, survey: 'only' }))).toEqual({ view: EXPIRING_VIEW });
  });

  it('EVM-138 AC6 Tylko odczyt has no survey filter and no view "Wygasające wizje" (the link is "Nie znaleziono widoku")', () => {
    expect(surveyOf({ siteSurvey: 'only' }, false)).toBe('all');
    expect(surveyOf({ siteSurvey: 'only' }, true)).toBe('only');
    expect(surveyOf({ siteSurvey: 'exclude' }, true)).toBe('exclude');
    expect(surveyOf({}, true)).toBe('all');
    expect(viewOf({ view: EXPIRING_VIEW }, false, false, false)).toBe('unknown');
    expect(viewOf({ view: EXPIRING_VIEW }, false, false, true)).toBe(EXPIRING_VIEW);
    expect(statusesOf({ status: 'quoting' })).toEqual(['quoting']);
  });

  it('EVM-138 AC1 a survey filter makes the list "filtered" (Wyczyść filtry has something to clear)', () => {
    expect(isFiltered(filters())).toBe(false);
    expect(isFiltered(filters({ survey: 'only' }))).toBe(true);
    expect(isFiltered(filters({ survey: 'exclude' }))).toBe(true);
  });
});

describe('the query of the API (EVM-138 AC1)', () => {
  it('EVM-138 AC1 "Tylko wizje" and "Bez wizji" are siteSurvey=only|exclude; without the filter the parameter is absent', () => {
    expect(toQuery(filters({ survey: 'only' }), undefined)).toMatchObject({ siteSurvey: 'only', limit: 25 });
    expect(toQuery(filters({ survey: 'exclude' }), undefined)).toMatchObject({ siteSurvey: 'exclude' });
    expect(toQuery(filters(), undefined)).not.toHaveProperty('siteSurvey');
  });

  it('EVM-138 AC1 "Wygasające wizje" asks for siteSurvey=only sorted by the deadline, 100 rows, and sends no view of its own', () => {
    const query = toQuery(filters({ view: EXPIRING_VIEW, sort: 'siteSurveyExpiresAt' }), undefined);
    expect(query).toMatchObject({ siteSurvey: 'only', sort: 'siteSurveyExpiresAt', limit: 100 });
    expect(query).not.toHaveProperty('view');
    // the sort is the deadline whatever the memory of the tab held
    expect(toQuery(filters({ view: EXPIRING_VIEW, sort: 'urgency' }), undefined)).toMatchObject({ sort: 'siteSurveyExpiresAt' });
  });

  it('EVM-138 AC1 the search has no siteSurvey and no sort by the deadline (the API answers 400 on /sort) — the rows are shaped by the panel', () => {
    const body = toSearchBody(filters({ survey: 'only', sort: 'siteSurveyExpiresAt' }), 'testowa', undefined);
    expect(body).not.toHaveProperty('siteSurvey');
    expect(body).not.toHaveProperty('sort');
    expect(body.limit).toBe(100);
    const expiring = toSearchBody(filters({ view: EXPIRING_VIEW }), 'testowa', undefined);
    expect(expiring).not.toHaveProperty('view');
    expect(expiring).not.toHaveProperty('sort');
    expect(toSearchBody(filters({ sort: 'urgency' }), 'testowa', undefined)).toMatchObject({ sort: 'urgency', limit: 25 });
  });
});

describe('the sort "Termin wygaśnięcia" (EVM-138 AC1)', () => {
  it('EVM-138 AC1 it is offered only with "Tylko wizje" and in "Wygasające wizje"', () => {
    expect(sortsFor(true)).not.toContain('siteSurveyExpiresAt');
    expect(sortsFor(true, true)).toContain('siteSurveyExpiresAt');
    expect(surveyScoped(filters({ survey: 'only' }))).toBe(true);
    expect(surveyScoped(filters({ view: EXPIRING_VIEW }))).toBe(true);
    expect(surveyScoped(filters({ survey: 'exclude' }))).toBe(false);
    expect(surveyScoped(filters())).toBe(false);
  });

  it('EVM-138 AC1 "Wygasające wizje" is sorted by the deadline; the sort goes back to the default when the survey scope is left', () => {
    expect(withSurveySort(filters({ view: EXPIRING_VIEW, sort: 'urgency' }), '-number').sort).toBe('siteSurveyExpiresAt');
    expect(withSurveySort(filters({ survey: 'only', sort: 'siteSurveyExpiresAt' }), '-number').sort).toBe('siteSurveyExpiresAt');
    expect(withSurveySort(filters({ survey: 'exclude', sort: 'siteSurveyExpiresAt' }), '-number').sort).toBe('-number');
    expect(withSurveySort(filters({ sort: 'siteSurveyExpiresAt' }), 'urgency').sort).toBe('urgency');
    expect(withSurveySort(filters({ sort: 'number' }), 'urgency').sort).toBe('number');
  });
});

describe('"Wygasające wizje": 15 days in Europe/Warsaw (EVM-138 AC1)', () => {
  const at = (iso: string) => expiringSurveys([row('quoting', iso)], NOW).length;

  it('EVM-138 AC1 the boundary: 14 and 15 days are in, 16 days is out (calendar days of the business zone, not hours)', () => {
    expect(at('2027-02-13T10:00:00.000Z')).toBe(1);
    expect(at('2027-02-14T10:00:00.000Z')).toBe(1);
    expect(at('2027-02-15T10:00:00.000Z')).toBe(0);
    // 22:59 UTC on the 14th is 23:59 in Warsaw (winter): still the 14th = 15 days; 23:30 UTC is already the 15th in Warsaw = 16 days
    expect(at('2027-02-14T22:59:00.000Z')).toBe(1);
    expect(at('2027-02-14T23:30:00.000Z')).toBe(0);
  });

  it('EVM-138 AC1 today and a passed deadline need a decision too; a survey of another status than "Anulowane" counts, a rejected one does not', () => {
    expect(at('2027-01-30T20:00:00.000Z')).toBe(1);
    expect(at('2027-01-29T10:00:00.000Z')).toBe(1);
    expect(expiringSurveys([row('on_hold', '2027-02-01T10:00:00.000Z'), row('quoting', '2027-02-01T10:00:00.000Z')], NOW)).toHaveLength(2);
    expect(expiringSurveys([row('cancelled', '2027-02-01T10:00:00.000Z')], NOW)).toHaveLength(0);
    // an ordinary order is never a survey
    expect(expiringSurveys([row('in_progress', null)], NOW)).toHaveLength(0);
    expect(expiringSurveys([{ status: 'quoting' }], NOW)).toHaveLength(0);
  });

  it('EVM-138 AC1 the change of the time (the night of 28.03.2027) does not move the boundary by a day', () => {
    const before = Date.parse('2027-03-27T10:00:00.000Z');
    // 15 days later, 12.04.2027 at 10:00 UTC (summer time) is the 12th in Warsaw: 16 days from the 27th — out; the 11th is in
    expect(expiringSurveys([row('quoting', '2027-04-11T10:00:00.000Z')], before)).toHaveLength(1);
    expect(expiringSurveys([row('quoting', '2027-04-12T10:00:00.000Z')], before)).toHaveLength(0);
  });

  it('EVM-138 AC1 the order of the API (by the deadline) is kept', () => {
    const items = [
      row('quoting', '2027-02-01T10:00:00.000Z'),
      row('quoting', '2027-02-05T10:00:00.000Z'),
      row('quoting', '2027-04-05T10:00:00.000Z'),
    ];
    expect(expiringSurveys(items, NOW)).toEqual([items[0], items[1]]);
  });

  it('EVM-138 AC1 the count says "1 wizja", "2 wizje", "5 wizji", "22 wizje" and the view label carries (n)', () => {
    expect(toResolveText(1)).toBe('1 wizja do rozstrzygnięcia — wygasają w ciągu 15 dni');
    expect(toResolveText(3)).toBe('3 wizje do rozstrzygnięcia — wygasają w ciągu 15 dni');
    expect(toResolveText(5)).toBe('5 wizji do rozstrzygnięcia — wygasają w ciągu 15 dni');
    expect(toResolveText(12)).toBe('12 wizji do rozstrzygnięcia — wygasają w ciągu 15 dni');
    expect(toResolveText(22)).toBe('22 wizje do rozstrzygnięcia — wygasają w ciągu 15 dni');
    expect(expiringViewLabel(3)).toBe('Wygasające wizje (3)');
    expect(expiringViewLabel(0)).toBe('Wygasające wizje (0)');
    expect(expiringViewLabel(undefined)).toBe('Wygasające wizje');
  });
});

describe('the rows of a search (EVM-138 AC1)', () => {
  const survey1 = row('quoting', '2027-04-10T10:00:00.000Z');
  const survey2 = row('quoting', '2027-02-10T10:00:00.000Z');
  const plain = row('in_progress', null);

  it('EVM-138 AC1 without a phrase the rows are the answer of the server (the API did the filter); with one "Tylko wizje" / "Bez wizji" cut them', () => {
    const all = [survey1, plain, survey2];
    expect(shapeSurveyRows(all, filters({ survey: 'only' }), false, NOW)).toEqual(all);
    expect(shapeSurveyRows(all, filters({ survey: 'only' }), true, NOW)).toEqual([survey1, survey2]);
    expect(shapeSurveyRows(all, filters({ survey: 'exclude' }), true, NOW)).toEqual([plain]);
    expect(shapeSurveyRows(all, filters(), true, NOW)).toEqual(all);
  });

  it('EVM-138 AC1 a search sorted by "Termin wygaśnięcia" is ordered by the panel: the soonest first', () => {
    const sorted = shapeSurveyRows([survey1, survey2], filters({ survey: 'only', sort: 'siteSurveyExpiresAt' }), true, NOW);
    expect(sorted).toEqual([survey2, survey1]);
  });

  it('EVM-138 AC1 "Wygasające wizje" with a phrase keeps the open ones that expire within 15 days', () => {
    expect(shapeSurveyRows([survey1, plain, survey2], filters({ view: EXPIRING_VIEW }), true, NOW)).toEqual([survey2]);
  });
});
