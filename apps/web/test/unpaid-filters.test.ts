import { describe, expect, it } from 'vitest';
import {
  dayProblem,
  isFiltered,
  isNarrowed,
  NO_FILTERS,
  rangeProblem,
  searchOf,
  toQuery,
  validateSearch,
  viewOf,
} from '../src/payments/unpaid-filters.ts';

describe('the filters of W-11 (EVM-055 AC4)', () => {
  it('EVM-055 AC4 the address carries only the view: "Po terminie" is `view=overdue`, anything else is dropped', () => {
    expect(validateSearch({ view: 'overdue' })).toEqual({ view: 'overdue' });
    expect(validateSearch({ view: 'unpaid', customerId: 'x', dueFrom: '2026-10-01', cursor: 'abc' })).toEqual({});
    expect(validateSearch({ view: 7 })).toEqual({});
    expect(viewOf({ view: 'overdue' })).toBe('overdue');
    expect(viewOf({})).toBe('unpaid');
    expect(searchOf('overdue')).toEqual({ view: 'overdue' });
    expect(searchOf('unpaid')).toEqual({});
  });

  it('EVM-055 AC4 the request has only what is set; the view "all" is the default of the API and is not sent', () => {
    expect(toQuery(NO_FILTERS, undefined, 25)).toEqual({ limit: 25 });
    expect(
      toQuery(
        { view: 'overdue', dueFrom: '2026-09-01', dueTo: '2026-10-03', customerId: '0198c1f2-0000-7000-8000-000000000001' },
        'c1',
        50,
      ),
    ).toEqual({
      view: 'overdue',
      dueFrom: '2026-09-01',
      dueTo: '2026-10-03',
      customerId: '0198c1f2-0000-7000-8000-000000000001',
      limit: 50,
      cursor: 'c1',
    });
  });

  it('EVM-055 AC4 a filter is in force when any of them is set', () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, view: 'overdue' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, dueFrom: '2026-10-01' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, dueTo: '2026-10-01' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, customerId: 'x' })).toBe(true);
  });

  it('EVM-055 AC4 the range: both ends in 2000–2100 and "od" not after "do" (the API says 400 otherwise)', () => {
    expect(rangeProblem(NO_FILTERS)).toBeUndefined();
    expect(rangeProblem({ dueFrom: '2026-10-01', dueTo: '' })).toBeUndefined();
    expect(rangeProblem({ dueFrom: '2026-10-01', dueTo: '2026-10-01' })).toBeUndefined();
    expect(rangeProblem({ dueFrom: '2026-10-02', dueTo: '2026-10-01' })).toBe('order');
    expect(rangeProblem({ dueFrom: '1999-12-31', dueTo: '' })).toBe('range');
    expect(rangeProblem({ dueFrom: '', dueTo: '2101-01-01' })).toBe('range');
    expect(dayProblem('')).toBeUndefined();
    expect(dayProblem('2026-10-01')).toBeUndefined();
    expect(dayProblem('0001-01-01')).toBe('range');
  });
});

describe('the view "Do wystawienia" (EVM-059 AC1)', () => {
  it('EVM-059 AC1 the address carries `view=planned`; the request sends the view without the range of the due dates', () => {
    expect(validateSearch({ view: 'planned', customerId: 'x' })).toEqual({ view: 'planned' });
    expect(viewOf({ view: 'planned' })).toBe('planned');
    expect(searchOf('planned')).toEqual({ view: 'planned' });
    expect(toQuery({ view: 'planned', dueFrom: '2026-09-01', dueTo: '2026-10-03', customerId: 'c' }, undefined, 25)).toEqual({
      view: 'planned',
      customerId: 'c',
      limit: 25,
    });
  });

  it('EVM-059 AC1 the range cannot be a problem there, and the view alone does not narrow the list', () => {
    expect(rangeProblem({ view: 'planned', dueFrom: '2026-10-02', dueTo: '2026-10-01' })).toBeUndefined();
    expect(isNarrowed({ ...NO_FILTERS, view: 'planned' })).toBe(false);
    expect(isNarrowed({ ...NO_FILTERS, view: 'planned', dueFrom: '2026-10-01' })).toBe(false);
    expect(isNarrowed({ ...NO_FILTERS, view: 'planned', customerId: 'x' })).toBe(true);
    expect(isNarrowed({ ...NO_FILTERS, dueTo: '2026-10-01' })).toBe(true);
  });
});
