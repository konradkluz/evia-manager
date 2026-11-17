// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { daysLeft, expiryDate, expiryOf, inDays, isRejectedSurvey, isSurvey } from '../src/work-orders/site-survey.ts';

const SURVEY = { expiresAt: '2027-02-14T10:00:00.000Z', extensionCount: 0, requesterPhone: null };
const at = (iso: string): number => Date.parse(iso);

describe('site survey logic (EVM-138 AC1, AC3, AC5; styleguide § 4.4, § 6.3)', () => {
  it('EVM-138 AC3 a survey is the order with the marker, not the one without a customer; "Odrzucona" is a survey in "Anulowane"', () => {
    expect(isSurvey({ status: 'quoting', siteSurvey: SURVEY })).toBe(true);
    expect(isSurvey({ status: 'quoting', siteSurvey: null })).toBe(false);
    expect(isSurvey({ status: 'quoting' })).toBe(false);
    expect(isRejectedSurvey({ status: 'cancelled', siteSurvey: SURVEY })).toBe(true);
    expect(isRejectedSurvey({ status: 'on_hold', siteSurvey: SURVEY })).toBe(false);
    expect(isRejectedSurvey({ status: 'cancelled', siteSurvey: null })).toBe(false);
  });

  it('EVM-138 AC1 days are whole calendar days of Europe/Warsaw: 14, 15 and 16 days, today and the day after', () => {
    const now = at('2027-01-30T09:00:00.000Z');
    expect(daysLeft('2027-02-14T10:00:00.000Z', now)).toBe(15);
    expect(daysLeft('2027-02-13T10:00:00.000Z', now)).toBe(14);
    expect(daysLeft('2027-02-15T10:00:00.000Z', now)).toBe(16);
    expect(daysLeft('2027-01-30T20:00:00.000Z', now)).toBe(0);
    expect(daysLeft('2027-01-29T10:00:00.000Z', now)).toBe(-1);
    // 23:30 UTC is already the next day in Warsaw (winter time, UTC+1)
    expect(daysLeft('2027-01-30T23:30:00.000Z', now)).toBe(1);
    expect(daysLeft('not a date', now)).toBe(0);
  });

  it('EVM-138 AC1 days across the change to summer time stay whole days', () => {
    // 2027-03-28 is the change of time (02:00 → 03:00); a deadline after it is not a day short
    expect(daysLeft('2027-03-29T10:00:00.000Z', at('2027-03-27T10:00:00.000Z'))).toBe(2);
    expect(daysLeft('2027-03-28T21:30:00.000Z', at('2027-03-27T10:00:00.000Z'))).toBe(1);
    expect(daysLeft('2027-03-28T22:30:00.000Z', at('2027-03-27T10:00:00.000Z'))).toBe(2);
  });

  it('EVM-138 AC1 the warning starts at 15 days; today and a passed deadline are warnings too', () => {
    const now = at('2027-01-30T09:00:00.000Z');
    expect(expiryOf({ expiresAt: '2027-02-14T10:00:00.000Z' }, now)).toEqual({ kind: 'days', days: 15, warning: true });
    expect(expiryOf({ expiresAt: '2027-02-15T10:00:00.000Z' }, now)).toEqual({ kind: 'days', days: 16, warning: false });
    expect(expiryOf({ expiresAt: '2027-01-30T12:00:00.000Z' }, now)).toEqual({ kind: 'today', days: 0, warning: true });
    expect(expiryOf({ expiresAt: '2027-01-28T12:00:00.000Z' }, now)).toEqual({ kind: 'passed', days: -2, warning: true });
  });

  it('EVM-138 AC3 the date is DD.MM.RRRR in the business zone and the days have the Polish plural', () => {
    expect(expiryDate('2027-02-14T10:00:00.000Z')).toBe('14.02.2027');
    expect(expiryDate('2027-02-14T23:30:00.000Z')).toBe('15.02.2027');
    expect([0, 1, 2, 5, 12, 22, 80].map(inDays)).toEqual([
      'dziś',
      'za 1 dzień',
      'za 2 dni',
      'za 5 dni',
      'za 12 dni',
      'za 22 dni',
      'za 80 dni',
    ]);
  });
});
