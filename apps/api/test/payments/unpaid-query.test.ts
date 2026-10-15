import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  filterPartsOf,
  overdueDaysOf,
  parsePosition,
  positionParts,
  resolveUnpaidQuery,
} from '../../src/modules/payments/domain/unpaid-query.ts';

const parse = (query: Record<string, string>) => resolveUnpaidQuery.safeParse(query);
const ok = (query: Record<string, string>) => {
  const result = parse(query);
  if (!result.success) throw new Error(`expected a valid query: ${JSON.stringify(query)}`);
  return result.data;
};

describe('the query of the summary of unpaid invoices (EVM-055 AC4; SR-INPUT-01, SR-API-04)', () => {
  it('EVM-055 AC4 an empty query takes the defaults: every issued milestone, 25 per page, no filter, no cursor', () => {
    expect(ok({})).toEqual({
      view: 'unpaid',
      dueFrom: undefined,
      dueTo: undefined,
      customerId: undefined,
      limit: DEFAULT_LIMIT,
      cursor: undefined,
    });
  });

  it('EVM-055 AC4 the view, the range of days, the customer and the limit are accepted together', () => {
    const customerId = randomUUID();
    expect(ok({ view: 'overdue', dueFrom: '2000-01-01', dueTo: '2100-12-31', customerId, limit: '100', cursor: 'abc_-9' })).toEqual({
      view: 'overdue',
      dueFrom: '2000-01-01',
      dueTo: '2100-12-31',
      customerId,
      limit: 100,
      cursor: 'abc_-9',
    });
    expect(ok({ dueFrom: '2026-10-03', dueTo: '2026-10-03' }).dueFrom).toBe('2026-10-03');
  });

  it('EVM-055 AC4 a value outside the lists is a validation error: view, days outside 2000-2100 or not on the calendar, customer, limit, cursor', () => {
    const invalid: Record<string, string>[] = [
      { view: 'to_invoice' },
      { view: '' },
      { dueFrom: '1999-12-31' },
      { dueTo: '2101-01-01' },
      { dueFrom: '2026-02-30' },
      { dueFrom: '2026-1-1' },
      { dueTo: 'tomorrow' },
      { customerId: 'not-a-uuid' },
      { limit: '0' },
      { limit: '101' },
      { limit: '1.5' },
      { limit: '-1' },
      { cursor: 'a b' },
      { cursor: 'a'.repeat(513) },
      { sort: '-dueDate' },
      { unknown: '1' },
    ];
    for (const query of invalid) {
      expect(parse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  it('EVM-055 AC4 dueFrom after dueTo is one error on /dueTo, without an echo of the value', () => {
    const result = parse({ dueFrom: '2026-10-04', dueTo: '2026-10-03' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['dueTo']]);
    expect(JSON.stringify(result.error.issues)).not.toContain('2026-10-04');
  });

  it('EVM-055 AC4 the filters of a cursor are the normalised view, the range and the customer — limit and cursor are not part of it', () => {
    const customerId = randomUUID();
    expect(filterPartsOf(ok({ view: 'overdue', dueFrom: '2026-01-01', customerId, limit: '5' }))).toEqual([
      'overdue',
      '2026-01-01',
      '',
      customerId,
    ]);
    expect(filterPartsOf(ok({}))).toEqual(['unpaid', '', '', '']);
  });
});

describe('the position of a cursor (EVM-055 AC1; SR-API-04)', () => {
  it('EVM-055 AC1 a position is a day and an identifier and survives the way through the parts', () => {
    const id = randomUUID();
    expect(parsePosition(positionParts({ dueDate: '2026-09-28', id }))).toEqual({ dueDate: '2026-09-28', id });
  });

  it('EVM-055 AC1 parts that do not fit are no position: a wrong count, a day that is not a date, an identifier that is not a UUID', () => {
    const id = randomUUID();
    expect(parsePosition([])).toBeUndefined();
    expect(parsePosition(['2026-09-28'])).toBeUndefined();
    expect(parsePosition(['2026-09-28', id, 'x'])).toBeUndefined();
    expect(parsePosition(['2026-02-30', id])).toBeUndefined();
    expect(parsePosition(['2026-09-28', 'x'])).toBeUndefined();
  });
});

describe('the days after the due date (EVM-055 AC2)', () => {
  it('EVM-055 AC2 2026-09-28 is 5 days overdue on 2026-10-03; the due day itself and a later one are not overdue', () => {
    expect(overdueDaysOf('2026-09-28', '2026-10-03')).toBe(5);
    expect(overdueDaysOf('2026-10-03', '2026-10-03')).toBeNull();
    expect(overdueDaysOf('2026-10-04', '2026-10-03')).toBeNull();
  });

  it('EVM-055 AC2 the day before is one day; the change of the clock of 2026-10-25 and a leap year do not move a calendar difference', () => {
    expect(overdueDaysOf('2026-10-02', '2026-10-03')).toBe(1);
    expect(overdueDaysOf('2026-10-24', '2026-10-26')).toBe(2);
    expect(overdueDaysOf('2028-02-28', '2028-03-01')).toBe(2);
    expect(overdueDaysOf('2026-09-12', '2026-10-03')).toBe(21);
  });
});
