import { describe, expect, it } from 'vitest';
import { formatSiteLine } from '../src/sites/format.ts';
import { formatClock, formatDate } from '../src/work-orders/format.ts';
import {
  DEFAULT_SORT,
  isFiltered,
  moreFiltersCount,
  NO_FILTERS,
  noFiltersFor,
  parseWaitingDays,
  searchOf,
  sortsFor,
  statusesOf,
  toQuery,
  toSearchBody,
  validateSearch,
  viewOf,
  waitingDaysOf,
  waitingOnOf,
} from '../src/work-orders/filters.ts';

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
    expect(toQuery({ ...NO_FILTERS, view: 'all', statuses: ['new'], coordinatorId: 'c', sort: 'number' }, 'k')).toEqual({
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

describe('filters "Czekamy na" and the address (EVM-034 AC2, AC3)', () => {
  it('EVM-034 AC2 X is a whole number 1–365; anything else is not a value', () => {
    expect(parseWaitingDays('1')).toBe(1);
    expect(parseWaitingDays(' 365 ')).toBe(365);
    for (const bad of ['0', '366', '14a', '', '-1', '1.5', '1e2', '0014x', '1000']) expect(parseWaitingDays(bad)).toBeUndefined();
    expect(waitingDaysOf({})).toBe(14);
    expect(waitingDaysOf({ waitingDays: 30 })).toBe(30);
    expect(waitingDaysOf({ waitingDays: 999 })).toBe(14);
  });

  it('EVM-034 AC2 the address keeps a string kind and a number X; a text of digits is read as a number; the rest is dropped', () => {
    expect(validateSearch({ waitingOn: 'distribution_system_operator', waitingDays: 14, partyId: 'x' })).toEqual({
      waitingOn: 'distribution_system_operator',
      waitingDays: 14,
    });
    expect(validateSearch({ waitingOn: 'customer', waitingDays: '30' })).toEqual({ waitingOn: 'customer', waitingDays: 30 });
    expect(validateSearch({ waitingOn: 5, waitingDays: 'abc' })).toEqual({});
    expect(waitingOnOf({ waitingOn: 'customer' })).toBe('customer');
    expect(waitingOnOf({ waitingOn: 'party' })).toBe('party');
    expect(waitingOnOf({ waitingOn: 'housing_community' })).toBe('housing_community');
    expect(waitingOnOf({ waitingOn: 'Jan Przykładowy' })).toBe('');
    expect(waitingOnOf({})).toBe('');
  });

  it('EVM-034 AC2 the address of the filter has the kind and X only, and none of them without the filter', () => {
    expect(searchOf({ ...NO_FILTERS, waitingOn: 'distribution_system_operator', waitingDays: 15 })).toEqual({
      waitingOn: 'distribution_system_operator',
      waitingDays: 15,
    });
    expect(searchOf({ ...NO_FILTERS, waitingDays: 15 })).toEqual({});
    expect(isFiltered({ ...NO_FILTERS, waitingOn: 'customer' })).toBe(true);
  });

  it('EVM-034 AC2 the query: customer, any party, a kind of party with X; the view of AC3 goes as it is', () => {
    expect(toQuery({ ...NO_FILTERS, waitingOn: 'customer', waitingDays: 3 }, undefined)).toMatchObject({
      waitingOn: 'customer',
      waitingLongerThanDays: 3,
    });
    const party = toQuery({ ...NO_FILTERS, waitingOn: 'party' }, undefined);
    expect(party).toMatchObject({ waitingOn: 'party', waitingLongerThanDays: 14 });
    expect(party).not.toHaveProperty('waitingOnPartyKind');
    expect(toQuery({ ...NO_FILTERS, waitingOn: 'distribution_system_operator', waitingDays: 15 }, undefined)).toMatchObject({
      waitingOn: 'party',
      waitingOnPartyKind: 'distribution_system_operator',
      waitingLongerThanDays: 15,
    });
    expect(toQuery({ ...NO_FILTERS, view: 'waiting_on_dso_over_14_days' }, undefined)).toMatchObject({
      view: 'waiting_on_dso_over_14_days',
    });
    expect(toQuery(NO_FILTERS, undefined)).not.toHaveProperty('waitingOn');
    expect(viewOf({ view: 'waiting_on_dso_over_14_days' })).toBe('waiting_on_dso_over_14_days');
    expect(searchOf({ ...NO_FILTERS, view: 'waiting_on_dso_over_14_days' })).toEqual({ view: 'waiting_on_dso_over_14_days' });
  });
});

describe('search, "Więcej filtrów" and the address (EVM-072 AC2, AC3, AC4)', () => {
  const TEMPLATE = '55555555-5555-4555-8555-555555555555';

  it('EVM-072 AC4 type of object and template go to the query of the list and never to the address', () => {
    const filters = { ...NO_FILTERS, siteType: 'commercial' as const, templateId: TEMPLATE };
    expect(toQuery(filters, undefined)).toMatchObject({ siteType: 'commercial', templateId: TEMPLATE });
    expect(toQuery(NO_FILTERS, undefined)).not.toHaveProperty('siteType');
    expect(toQuery(NO_FILTERS, undefined)).not.toHaveProperty('templateId');
    expect(searchOf(filters)).toEqual({});
    expect(isFiltered(filters)).toBe(true);
    expect(moreFiltersCount(filters)).toBe(2);
    expect(moreFiltersCount({ ...NO_FILTERS, templateId: TEMPLATE })).toBe(1);
    expect(moreFiltersCount(NO_FILTERS)).toBe(0);
  });

  it('EVM-072 AC2 a typed phrase makes the list filtered, and the query of the list never carries it', () => {
    const filters = { ...NO_FILTERS, phrase: 'Przy' };
    expect(isFiltered(filters)).toBe(true);
    expect(searchOf(filters)).toEqual({});
    expect(JSON.stringify(toQuery(filters, undefined))).not.toContain('Przy');
  });

  it('EVM-072 AC3 the body of the search has the phrase, the filters of the list as arrays and values, and the cursor', () => {
    expect(toSearchBody(NO_FILTERS, 'Lodz', undefined)).toEqual({ query: 'Lodz', limit: 25, sort: DEFAULT_SORT, view: 'all_open' });
    const full = toSearchBody(
      {
        ...NO_FILTERS,
        view: 'mine',
        statuses: ['new', 'quoting'],
        coordinatorId: 'c',
        sort: 'number',
        siteType: 'other',
        templateId: TEMPLATE,
        waitingOn: 'distribution_system_operator',
        waitingDays: 15,
      },
      'Przy',
      'k',
    );
    expect(full).toEqual({
      query: 'Przy',
      limit: 25,
      sort: 'number',
      view: 'mine',
      status: ['new', 'quoting'],
      coordinatorId: 'c',
      siteType: 'other',
      templateId: TEMPLATE,
      waitingOn: 'party',
      waitingOnPartyKind: 'distribution_system_operator',
      waitingLongerThanDays: 15,
      cursor: 'k',
    });
    expect(toSearchBody({ ...NO_FILTERS, view: 'all' }, 'abc', undefined)).not.toHaveProperty('view');
    expect(toSearchBody({ ...NO_FILTERS, waitingOn: 'customer', waitingDays: 3 }, 'abc', undefined)).toMatchObject({
      waitingOn: 'customer',
      waitingLongerThanDays: 3,
    });
  });

  it('EVM-072 AC1 the location line is the street with the number and the city, without the postal code', () => {
    expect(formatSiteLine({ street: 'ul. Testowa', buildingNumber: '7', city: 'Warszawa' })).toBe('ul. Testowa 7, Warszawa');
  });
});

describe('the payment views and "Najpilniejsze" (EVM-056 AC2, AC3, AC7)', () => {
  it('EVM-056 AC2 "Po terminie" and "Nieopłacone" are views of the address only for a role that reads payments; otherwise "unknown"', () => {
    expect(viewOf({ view: 'overdue_payments' }, true)).toBe('overdue_payments');
    expect(viewOf({ view: 'unpaid' }, true)).toBe('unpaid');
    expect(viewOf({ view: 'overdue_payments' })).toBe('unknown');
    expect(viewOf({ view: 'unpaid' }, false)).toBe('unknown');
    expect(viewOf({ view: 'mine' }, false)).toBe('mine');
  });

  it('EVM-056 AC2 the address carries only the identifier of the view; the query and the body of the search send it', () => {
    const filters = { ...NO_FILTERS, view: 'overdue_payments' as const };
    expect(searchOf(filters)).toEqual({ view: 'overdue_payments' });
    expect(searchOf({ ...NO_FILTERS, view: 'unpaid' })).toEqual({ view: 'unpaid' });
    expect(toQuery(filters, undefined)).toEqual({ limit: 25, sort: 'urgency', view: 'overdue_payments' });
    expect(toSearchBody({ ...NO_FILTERS, view: 'unpaid' }, 'Lodz', undefined)).toEqual({
      query: 'Lodz',
      limit: 25,
      sort: 'urgency',
      view: 'unpaid',
    });
    expect(isFiltered({ ...NO_FILTERS, view: 'unpaid' })).toBe(true);
  });

  it('EVM-056 AC3 "Najpilniejsze" is the default sort and the first option, then "Najdłużej czekamy", "Termin" and the numbers', () => {
    expect(DEFAULT_SORT).toBe('urgency');
    expect(NO_FILTERS.sort).toBe('urgency');
    expect(sortsFor(true)).toEqual(['urgency', 'longestWaitingSince', 'nextDueDate', '-number', 'number', '-createdAt', 'createdAt']);
    expect(noFiltersFor(true)).toBe(NO_FILTERS);
  });

  it('EVM-056 AC7 a role without the right to read payments has no "Najpilniejsze": its default is the newest number', () => {
    expect(sortsFor(false)).not.toContain('urgency');
    expect(sortsFor(false)[0]).toBe('longestWaitingSince');
    expect(noFiltersFor(false)).toEqual({ ...NO_FILTERS, sort: '-number' });
  });
});

describe('the view "Usunięte" (EVM-060 AC4, AC6)', () => {
  it('EVM-060 AC6 the view exists only for the Administrator: for everyone else a link to it is "unknown" (deny by default)', () => {
    expect(viewOf({ view: 'deleted' }, true, true)).toBe('deleted');
    expect(viewOf({ view: 'deleted' }, true, false)).toBe('unknown');
    expect(viewOf({ view: 'deleted' })).toBe('unknown');
  });

  it('EVM-060 AC4 the address carries `view=deleted` and the API gets `view=deleted`', () => {
    expect(searchOf({ view: 'deleted', statuses: [] })).toEqual({ view: 'deleted' });
    expect(toQuery({ ...NO_FILTERS, view: 'deleted' }, undefined)).toMatchObject({ view: 'deleted' });
  });
});
