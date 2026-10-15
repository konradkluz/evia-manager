import { randomUUID } from 'node:crypto';
import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_FIELDS,
  PAYMENT_SORTS,
  PAYMENT_VIEWS,
  compareUrgency,
  paymentStateOf,
  urgencyOf,
  type UrgencyInput,
} from '../../src/modules/overview/domain/payment-signals.ts';
import { SORT_RULES, parsePosition, positionParts } from '../../src/modules/overview/domain/work-order-list-query.ts';

const TODAY = '2026-10-08';
const none = { invoicedCount: 0, paidCount: 0, earliestInvoicedDueDate: null };

describe('the column "Płatność" (EVM-056 AC1; ADR-0017 D8)', () => {
  it('EVM-056 AC1 the first state that holds: overdue, then unpaid (n), then paid, then none', () => {
    expect(paymentStateOf({ invoicedCount: 2, paidCount: 1, earliestInvoicedDueDate: '2026-10-07' }, TODAY)).toBe('overdue');
    expect(paymentStateOf({ invoicedCount: 1, paidCount: 3, earliestInvoicedDueDate: '2026-10-20' }, TODAY)).toBe('unpaid');
    expect(paymentStateOf({ invoicedCount: 0, paidCount: 4, earliestInvoicedDueDate: null }, TODAY)).toBe('paid');
    expect(paymentStateOf(none, TODAY)).toBe('none');
  });

  it('EVM-056 AC5 a due date of 2026-10-07 is overdue only from 2026-10-08 (7 < 7 is false): the state is computed from the day, never stored', () => {
    const signals = { invoicedCount: 1, paidCount: 0, earliestInvoicedDueDate: '2026-10-07' };
    expect(paymentStateOf(signals, '2026-10-07')).toBe('unpaid');
    expect(paymentStateOf(signals, '2026-10-08')).toBe('overdue');
  });
});

describe('"Najpilniejsze" (EVM-056 AC3; ADR-0017 D9)', () => {
  const open = (row: Partial<UrgencyInput>): UrgencyInput => ({
    status: 'in_progress',
    earliestInvoicedDueDate: null,
    nextDueDate: null,
    longestWaitingSince: null,
    ...row,
  });

  it('EVM-056 AC3 group 1: an open order with a milestone or a stage past its due date — the key is the OLDEST of the two past dates', () => {
    expect(urgencyOf(open({ earliestInvoicedDueDate: '2026-10-01', nextDueDate: '2026-10-05' }), TODAY, true)).toEqual({
      group: 1,
      day: '2026-10-01',
    });
    expect(urgencyOf(open({ earliestInvoicedDueDate: '2026-10-06', nextDueDate: '2026-09-30' }), TODAY, true)).toEqual({
      group: 1,
      day: '2026-09-30',
    });
    // a date that is not past does not count in the key (LEAST of the past ones only)
    expect(urgencyOf(open({ earliestInvoicedDueDate: '2026-10-07', nextDueDate: '2026-10-09' }), TODAY, true)).toEqual({
      group: 1,
      day: '2026-10-07',
    });
    expect(urgencyOf(open({ earliestInvoicedDueDate: '2026-10-08', nextDueDate: '2026-10-01' }), TODAY, true)).toEqual({
      group: 1,
      day: '2026-10-01',
    });
  });

  it('EVM-056 AC3 group 2: open and waiting for MORE than 14 days (today − 15), the key is the day the wait began; 14 days is not enough', () => {
    expect(urgencyOf(open({ longestWaitingSince: '2026-09-23' }), TODAY, true)).toEqual({ group: 2, day: '2026-09-23' });
    expect(urgencyOf(open({ longestWaitingSince: '2026-09-24' }), TODAY, true)).toEqual({ group: 4, day: 'infinity' });
    expect(urgencyOf(open({ longestWaitingSince: '2026-09-24', nextDueDate: '2026-10-08' }), TODAY, true)).toEqual({
      group: 3,
      day: '2026-10-08',
    });
  });

  it('EVM-056 AC3 group 3: open with the nearest stage due today or later; group 4: the rest and every closed order, key infinity', () => {
    expect(urgencyOf(open({ nextDueDate: TODAY }), TODAY, true)).toEqual({ group: 3, day: TODAY });
    expect(urgencyOf(open({}), TODAY, true)).toEqual({ group: 4, day: 'infinity' });
    for (const status of ['settled', 'cancelled'] as const)
      expect(urgencyOf(open({ status, earliestInvoicedDueDate: '2026-01-01', nextDueDate: '2026-01-01' }), TODAY, true)).toEqual({
        group: 4,
        day: 'infinity',
      });
  });

  it('EVM-056 AC7 W4 without the right to read payments group 1 comes from the stages only: an overdue milestone says nothing', () => {
    expect(urgencyOf(open({ earliestInvoicedDueDate: '2026-10-01' }), TODAY, false)).toEqual({ group: 4, day: 'infinity' });
    expect(urgencyOf(open({ earliestInvoicedDueDate: '2026-10-01', nextDueDate: '2026-10-05' }), TODAY, false)).toEqual({
      group: 1,
      day: '2026-10-05',
    });
  });

  it('EVM-056 AC5 a change of the clock (2026-10-25) does not move the threshold: it is a difference of dates', () => {
    expect(urgencyOf(open({ longestWaitingSince: '2026-10-10' }), '2026-10-25', true)).toEqual({ group: 2, day: '2026-10-10' });
    expect(urgencyOf(open({ longestWaitingSince: '2026-10-11' }), '2026-10-25', true)).toEqual({ group: 4, day: 'infinity' });
  });

  it('EVM-056 AC3 the order in memory is the group, the day with infinity last, then the id', () => {
    const [a, b] = [randomUUID(), randomUUID()].sort();
    const items = [
      { group: 4 as const, day: 'infinity', id: a ?? '' },
      { group: 3 as const, day: '2026-10-09', id: b ?? '' },
      { group: 1 as const, day: '2026-10-02', id: b ?? '' },
      { group: 1 as const, day: '2026-10-02', id: a ?? '' },
      { group: 1 as const, day: '2026-09-02', id: b ?? '' },
      { group: 4 as const, day: 'infinity', id: b ?? '' },
    ];
    expect([...items].sort(compareUrgency)).toEqual([items[4], items[3], items[2], items[1], items[0], items[5]]);
    expect(compareUrgency({ group: 2, day: 'infinity', id: a ?? '' }, { group: 2, day: '2026-10-01', id: a ?? '' })).toBe(1);
    expect(compareUrgency({ group: 2, day: '2026-10-01', id: a ?? '' }, { group: 2, day: 'infinity', id: a ?? '' })).toBe(-1);
  });

  it('EVM-056 AC3 the sort is ascending only and its position is [group 1..4, day or infinity, id]; anything else is no position (invalid_cursor)', () => {
    expect(SORT_RULES.urgency).toEqual({ key: 'urgency', direction: 'asc' });
    const id = randomUUID();
    const item = {
      id,
      number: 'ZL-2026-0001',
      createdAt: new Date('2026-10-01T08:30:00.000Z'),
      longestWaitingSince: null,
      nextDueDate: null,
    };
    expect(positionParts('urgency', { ...item, urgency: { group: 1, day: '2026-10-01' } })).toEqual(['1', '2026-10-01', id]);
    expect(positionParts('urgency', { ...item, urgency: { group: 4, day: 'infinity' } })).toEqual(['4', 'infinity', id]);
    expect(() => positionParts('urgency', item)).toThrow(/urgency/);
    expect(parsePosition('urgency', ['2', '2026-09-18', id])).toEqual({ group: 2, day: '2026-09-18', id });
    expect(parsePosition('urgency', ['4', 'infinity', id])).toEqual({ group: 4, day: 'infinity', id });
    for (const parts of [
      [],
      ['0', '2026-09-18', id],
      ['5', '2026-09-18', id],
      ['01', '2026-09-18', id],
      ['1.0', '2026-09-18', id],
      ['1', 'yesterday', id],
      ['1', '2026-13-45', id],
      ['1', '2026-09-18', 'not-an-id'],
      ['1', '2026-09-18'],
      ['1', '2026-09-18', id, 'x'],
      ['2026-09-18', id],
    ])
      expect(parsePosition('urgency', parts), JSON.stringify(parts)).toBeUndefined();
  });
});

describe('the declaration of the rule W4 and the code that applies it (EVM-056 AC7; ADR-0017 W4)', () => {
  it('EVM-056 AC7 the restricted values and fields of the code are exactly the `restrictedParams` of the list and of the search in the contract', () => {
    for (const operation of ['listWorkOrders', 'searchWorkOrders']) {
      const rule = AUTHZ_MANIFEST[operation]?.authz.restrictedParams?.['paymentMilestone.read'];
      expect(rule?.params, operation).toEqual({ view: [...PAYMENT_VIEWS], sort: [...PAYMENT_SORTS] });
      expect(rule?.fields, operation).toEqual([...PAYMENT_FIELDS]);
    }
  });
});
