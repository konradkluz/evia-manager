import { describe, expect, it } from 'vitest';
import {
  deadlineAfterRejection,
  deadlineAfterRestoration,
  deadlineAfterTransition,
} from '../../src/modules/work-orders/domain/site-survey-deadline.ts';
import { findTransition, type ResolvedTransition } from '../../src/modules/work-orders/domain/work-order-transitions.ts';

const DAY = 86_400_000;
const at = (iso: string): Date => new Date(iso);
const NOW = at('2027-01-10T09:00:00.000Z');
const CREATED = at('2026-11-17T08:00:00.000Z');
const plusDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY);

describe('the deadlines of a rejected and of a restored site survey (EVM-136 AC5; ADR-0024 pt 9)', () => {
  it('EVM-136 AC5 the rejection sets the smaller of the current deadline and now + 14 days', () => {
    expect(deadlineAfterRejection(plusDays(NOW, 60), NOW)).toEqual(plusDays(NOW, 14));
    expect(deadlineAfterRejection(plusDays(NOW, 14), NOW)).toEqual(plusDays(NOW, 14));
    expect(deadlineAfterRejection(plusDays(NOW, 3), NOW)).toEqual(plusDays(NOW, 3));
  });

  it('EVM-136 AC5 a deadline that has passed already stays in the past (P4: the smaller one, literally)', () => {
    const past = plusDays(NOW, -2);
    expect(deadlineAfterRejection(past, NOW)).toEqual(past);
  });

  it('EVM-136 AC5 the restoration sets the greater of creation + 90 days x (1 + extensions) and now + 14 days', () => {
    const shortly = plusDays(CREATED, 90 + 0); // 2027-02-15
    expect(deadlineAfterRestoration(CREATED, 0, at('2026-12-01T08:00:00.000Z'))).toEqual(shortly);
    expect(deadlineAfterRestoration(CREATED, 1, at('2027-03-01T08:00:00.000Z'))).toEqual(plusDays(CREATED, 180));
    expect(deadlineAfterRestoration(CREATED, 2, at('2027-03-01T08:00:00.000Z'))).toEqual(plusDays(CREATED, 270));
  });

  it('EVM-136 AC5 after the original deadline the restoration gives now + 14 days; before it, the original', () => {
    const late = plusDays(CREATED, 120);
    expect(deadlineAfterRestoration(CREATED, 0, late)).toEqual(plusDays(late, 14));
    const early = plusDays(CREATED, 10);
    expect(deadlineAfterRestoration(CREATED, 0, early)).toEqual(plusDays(CREATED, 90));
  });

  it('EVM-136 AC5 the dates are UTC instants of 24 hours, also across the change of the clock of 2027-03-28', () => {
    const created = at('2027-01-05T08:00:00.000Z');
    expect(deadlineAfterRestoration(created, 0, created)).toEqual(new Date(created.getTime() + 90 * 86_400_000));
  });

  const row = (from: Parameters<typeof findTransition>[0]['status'], to: Parameters<typeof findTransition>[1]): ResolvedTransition => {
    const found = findTransition({ status: from, resumeStatus: from === 'on_hold' ? 'quoting' : null }, to);
    if (found === undefined) throw new Error(`no row ${from} > ${to}`);
    return found;
  };
  const survey = { expiresAt: plusDays(NOW, 40), createdAt: CREATED, extensions: 1 };

  it('EVM-136 AC5 only the cancellation and the restoration touch the deadline - and only of a survey; an ordinary order never gets one', () => {
    expect(deadlineAfterTransition(row('quoting', 'cancelled'), survey, NOW)).toEqual(plusDays(NOW, 14));
    expect(deadlineAfterTransition(row('on_hold', 'cancelled'), survey, NOW)).toEqual(plusDays(NOW, 14));
    expect(deadlineAfterTransition(row('cancelled', 'on_hold'), survey, NOW)).toEqual(
      new Date(Math.max(plusDays(CREATED, 180).getTime(), plusDays(NOW, 14).getTime())),
    );
    expect(deadlineAfterTransition(row('quoting', 'on_hold'), survey, NOW)).toBeUndefined();
    expect(deadlineAfterTransition(row('on_hold', 'quoting'), survey, NOW)).toBeUndefined();
    expect(deadlineAfterTransition(row('quoting', 'cancelled'), null, NOW)).toBeUndefined();
    expect(deadlineAfterTransition(row('cancelled', 'on_hold'), null, NOW)).toBeUndefined();
  });
});
