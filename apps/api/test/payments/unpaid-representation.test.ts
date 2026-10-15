import { zUnpaidPaymentMilestoneList } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import { customerOf, toSummary, toUnpaidItems } from '../../src/modules/payments/application/unpaid-representation.ts';
import { amountOfSum, type UnpaidRow, type UnpaidSummaryRow } from '../../src/modules/payments/infrastructure/unpaid-reader.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';
const ORDER = '0198b0a0-0000-7000-8000-000000000002';
const CUSTOMER = '0198b0a0-0000-7000-8000-000000000003';
const row = (overrides: Partial<UnpaidRow> = {}): UnpaidRow => ({
  id: ID,
  workOrderId: ORDER,
  name: 'Zaliczka',
  invoiceNumber: 'FV/1/2026',
  amountMinor: 360_000,
  dueDate: '2026-09-28',
  version: 2,
  ...overrides,
});
const refs = new Map([[ORDER, { number: 'ZL-2026-0031', title: 'Wallbox', customerId: CUSTOMER }]]);
const names = new Map([[CUSTOMER, 'Jan Przykładowy']]);

describe('the items of the summary of unpaid invoices (EVM-055 AC1, AC2; SR-DATA-03)', () => {
  it('EVM-055 AC2 an item has the days after the due date and the flag from the day of the page: 5 days on 2026-10-03, none on the due day', () => {
    const { items } = toUnpaidItems([row(), row({ dueDate: '2026-10-03' })], refs, names, '2026-10-03');
    expect(items.map((item) => [item.isOverdue, item.overdueDays])).toEqual([
      [true, 5],
      [false, null],
    ]);
    expect(items[0]).toEqual({
      id: ID,
      workOrder: { id: ORDER, number: 'ZL-2026-0031', title: 'Wallbox' },
      customer: { id: CUSTOMER, displayName: 'Jan Przykładowy' },
      name: 'Zaliczka',
      invoiceNumber: 'FV/1/2026',
      amount: { amountMinor: 360_000, currency: 'PLN' },
      dueDate: '2026-09-28',
      status: 'invoiced',
      isOverdue: true,
      overdueDays: 5,
      version: 2,
    });
  });

  it('EVM-055 AC3 a row whose order the facade did not show is dropped and counted, never shown without its number (defence in depth)', () => {
    const { items, dropped } = toUnpaidItems(
      [row(), row({ workOrderId: '0198b0a0-0000-7000-8000-0000000000ff' })],
      refs,
      names,
      '2026-10-03',
    );
    expect(items).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it('EVM-055 AC1 a row without the invoice number or the amount (which the CHECKs of the table forbid) is dropped, never shown with a hole', () => {
    expect(toUnpaidItems([row({ invoiceNumber: null }), row({ amountMinor: null })], refs, names, '2026-10-03')).toEqual({
      items: [],
      dropped: 2,
    });
  });

  it('EVM-055 AC1 the customer: none, {id, displayName}, and {deleted: true} for one that the caller may not see — no name, no identifier', () => {
    expect(customerOf(null, names)).toBeNull();
    expect(customerOf(CUSTOMER, names)).toEqual({ id: CUSTOMER, displayName: 'Jan Przykładowy' });
    expect(customerOf(CUSTOMER, new Map())).toEqual({ deleted: true });
  });
});

describe('the tiles of the summary (EVM-055 AC3)', () => {
  const summary: UnpaidSummaryRow = {
    unpaid: { count: 12, totalMinor: 4_830_000 },
    overdue: { count: 4, totalMinor: 1_520_000 },
    filtered: { count: 2, totalMinor: 10 },
  };

  it('EVM-055 AC3 the money is MoneyTotal, the longest overdue has the days from the day of the page and the number of the order', () => {
    const tiles = toSummary(summary, { workOrderId: ORDER, dueDate: '2026-09-12' }, refs, '2026-10-03');
    expect(tiles).toEqual({
      unpaid: { count: 12, total: { amountMinor: 4_830_000, currency: 'PLN' } },
      overdue: { count: 4, total: { amountMinor: 1_520_000, currency: 'PLN' } },
      longestOverdue: { days: 21, workOrder: { id: ORDER, number: 'ZL-2026-0031' } },
      filtered: { count: 2, total: { amountMinor: 10, currency: 'PLN' } },
    });
    expect(zUnpaidPaymentMilestoneList.safeParse({ items: [], nextCursor: null, asOf: '2026-10-03', summary: tiles }).success).toBe(true);
  });

  it('EVM-055 AC3 nothing overdue (or an order that is not in the visible set) is no longest overdue — never a guess', () => {
    expect(toSummary(summary, undefined, refs, '2026-10-03').longestOverdue).toBeNull();
    expect(toSummary(summary, { workOrderId: 'x', dueDate: '2026-09-12' }, refs, '2026-10-03').longestOverdue).toBeNull();
    expect(toSummary(summary, { workOrderId: ORDER, dueDate: '2026-10-03' }, refs, '2026-10-03').longestOverdue).toBeNull();
  });
});

describe('the sums of the database (EVM-055 AC3; SR-INPUT-01)', () => {
  it('EVM-055 AC3 a sum is TEXT of a numeric and becomes a safe integer', () => {
    expect(amountOfSum('0')).toBe(0);
    expect(amountOfSum('4830000')).toBe(4_830_000);
    expect(amountOfSum('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('EVM-055 AC3 a sum outside the safe integers, a fraction and a missing sum are errors, never a rounded number', () => {
    expect(() => amountOfSum('9007199254740993')).toThrow(RangeError);
    expect(() => amountOfSum('123456789012345678901234567890')).toThrow(RangeError);
    expect(() => amountOfSum('1.5')).toThrow(RangeError);
    expect(() => amountOfSum('not a number')).toThrow(RangeError);
  });
});
