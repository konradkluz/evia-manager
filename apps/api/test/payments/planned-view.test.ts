import { describe, expect, it } from 'vitest';
import { toPlannedItems } from '../../src/modules/payments/application/unpaid-representation.ts';
import {
  compareOrders,
  parsePlannedPosition,
  plannedPositionParts,
  resolveUnpaidQuery,
} from '../../src/modules/payments/domain/unpaid-query.ts';
import type { PlannedRow } from '../../src/modules/payments/infrastructure/unpaid-reader.ts';

const ORDER = '0198b0a0-0000-7000-8000-000000000002';
const CUSTOMER = '0198b0a0-0000-7000-8000-000000000003';
const row = (overrides: Partial<PlannedRow> = {}): PlannedRow => ({
  id: '0198b0a0-0000-7000-8000-000000000001',
  workOrderId: ORDER,
  name: 'Po uzyskaniu zgód',
  sharePercent: 30,
  amountMinor: 540_000,
  position: 2,
  version: 1,
  ...overrides,
});
const refs = new Map([[ORDER, { number: 'ZL-2026-0042', title: 'Garaż', customerId: CUSTOMER, closed: false }]]);

describe('the view "Do wystawienia" (EVM-059 AC1, AC3)', () => {
  it('EVM-059 AC1 the query accepts view=planned without a range of due days and rejects the range (a planned milestone has no due date)', () => {
    expect(resolveUnpaidQuery.safeParse({ view: 'planned' }).success).toBe(true);
    expect(resolveUnpaidQuery.safeParse({ view: 'planned', customerId: CUSTOMER }).success).toBe(true);
    expect(resolveUnpaidQuery.safeParse({ view: 'planned', dueFrom: '2026-10-01' }).success).toBe(false);
    expect(resolveUnpaidQuery.safeParse({ view: 'planned', dueTo: '2026-10-01' }).success).toBe(false);
    expect(resolveUnpaidQuery.safeParse({ view: 'overdue', dueFrom: '2026-10-01' }).success).toBe(true);
  });

  it('EVM-059 AC1 an item has the share, the amount or null, status planned and no invoice; a row of an order the facade did not show is dropped', () => {
    const { items, dropped } = toPlannedItems(
      [row(), row({ amountMinor: null, sharePercent: null }), row({ workOrderId: 'x' })],
      refs,
      new Map([[CUSTOMER, 'Jan Przykładowy']]),
    );
    expect(dropped).toBe(1);
    expect(items[0]).toEqual({
      id: '0198b0a0-0000-7000-8000-000000000001',
      workOrder: { id: ORDER, number: 'ZL-2026-0042', title: 'Garaż' },
      customer: { id: CUSTOMER, displayName: 'Jan Przykładowy' },
      name: 'Po uzyskaniu zgód',
      sharePercent: 30,
      amount: { amountMinor: 540_000, currency: 'PLN' },
      status: 'planned',
      version: 1,
    });
    expect(items[1]).toMatchObject({ sharePercent: null, amount: null });
  });

  it('EVM-059 AC1 the orders are sorted by number, then identifier; the position of the cursor round-trips and rejects a stranger', () => {
    expect(compareOrders({ number: 'ZL-2026-0042', id: 'b' }, { number: 'ZL-2026-0038', id: 'a' })).toBe(1);
    expect(compareOrders({ number: 'ZL-2026-0038', id: 'a' }, { number: 'ZL-2026-0042', id: 'b' })).toBe(-1);
    expect(compareOrders({ number: 'ZL-1', id: 'a' }, { number: 'ZL-1', id: 'b' })).toBe(-1);
    expect(compareOrders({ number: 'ZL-1', id: 'b' }, { number: 'ZL-1', id: 'a' })).toBe(1);
    expect(compareOrders({ number: 'ZL-1', id: 'a' }, { number: 'ZL-1', id: 'a' })).toBe(0);
    const position = { number: 'ZL-2026-0042', workOrderId: ORDER, position: 3 };
    expect(parsePlannedPosition(plannedPositionParts(position))).toEqual(position);
    expect(parsePlannedPosition(['ZL-2026-0042', 'not-a-uuid', '3'])).toBeUndefined();
    expect(parsePlannedPosition(['ZL-2026-0042', ORDER, '21'])).toBeUndefined();
    expect(parsePlannedPosition([])).toBeUndefined();
  });
});
