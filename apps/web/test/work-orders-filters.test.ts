import { describe, expect, it } from 'vitest';
import { formatClock, formatDate } from '../src/work-orders/format.ts';
import { DEFAULT_SORT, isFiltered, NO_FILTERS, searchOf, statusesOf, toQuery, validateSearch, viewOf } from '../src/work-orders/filters.ts';

describe('filters of W-10 and the address (EVM-017 AC2)', () => {
  it('EVM-017 AC2 the address keeps only strings for `status` and `view`; everything else is dropped', () => {
    expect(validateSearch({ status: 'new,quoting', view: 'mine', coordinatorId: 'x', cursor: 'y', q: 'Jan' })).toEqual({
      status: 'new,quoting',
      view: 'mine',
    });
    expect(validateSearch({ status: 5, view: ['mine'] })).toEqual({});
    expect(validateSearch({ status: '', view: '' })).toEqual({});
  });

  it('EVM-017 AC2 statuses of the address are known codes, each once, in the order of the filter; a view is known or "unknown"', () => {
    expect(statusesOf({ status: 'on_hold,new,new,drop table' })).toEqual(['new', 'on_hold']);
    expect(statusesOf({})).toEqual([]);
    expect(viewOf({})).toBe('all_open');
    expect(viewOf({ view: 'all_open' })).toBe('all_open');
    expect(viewOf({ view: 'mine' })).toBe('mine');
    expect(viewOf({ view: 'all' })).toBe('all');
    expect(viewOf({ view: 'po_terminie' })).toBe('unknown');
  });

  it('EVM-017 AC2 the address of the filters has no coordinator, no sort and no default view', () => {
    expect(searchOf(NO_FILTERS)).toEqual({});
    expect(searchOf({ view: 'mine', statuses: ['new', 'settled'] })).toEqual({ status: 'new,settled', view: 'mine' });
    expect(searchOf({ view: 'unknown', statuses: [] })).toEqual({});
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, coordinatorId: 'a' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, sort: 'createdAt' })).toBe(false);
  });

  it('EVM-017 AC2 the query leaves empty filters out; the view "all" sends no view', () => {
    expect(toQuery(NO_FILTERS, undefined)).toEqual({ limit: 25, sort: DEFAULT_SORT, view: 'all_open' });
    expect(toQuery({ view: 'all', statuses: ['new'], coordinatorId: 'c', sort: 'number' }, 'k')).toEqual({
      limit: 25,
      sort: 'number',
      status: 'new',
      coordinatorId: 'c',
      cursor: 'k',
    });
  });

  it('EVM-017 AC1 dates are days in Warsaw (DD.MM.RRRR) and the clock is 24 h; text that is not a date stays as it came', () => {
    expect(formatDate('2026-10-05T22:30:00.000Z')).toBe('06.10.2026');
    expect(formatDate('2026-01-15T23:30:00.000Z')).toBe('16.01.2026');
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatClock(Date.parse('2026-10-07T12:05:00.000Z'))).toBe('14:05');
    expect(formatClock(Date.parse('2026-01-07T12:05:00.000Z'))).toBe('13:05');
  });
});
