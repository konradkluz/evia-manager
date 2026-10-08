import { describe, expect, it } from 'vitest';
import { businessYear, formatWorkOrderNumber } from '../../src/modules/work-orders/domain/work-order-number.ts';

describe('the number of a work order (EVM-022 AC5; SR-API-07)', () => {
  it('EVM-022 AC5 the number is ZL-YYYY-NNNN: at least four digits, longer when the year has more orders', () => {
    expect(formatWorkOrderNumber(2026, 1)).toBe('ZL-2026-0001');
    expect(formatWorkOrderNumber(2026, 42)).toBe('ZL-2026-0042');
    expect(formatWorkOrderNumber(2027, 9999)).toBe('ZL-2027-9999');
    expect(formatWorkOrderNumber(2027, 12345)).toBe('ZL-2027-12345');
  });

  it('EVM-022 AC5 the year is the year in Europe/Warsaw: 2026-12-31T23:30:00Z is already 2027 there, 22:30Z is not', () => {
    expect(businessYear(new Date('2026-12-31T23:30:00Z'))).toBe(2027);
    expect(businessYear(new Date('2026-12-31T22:59:59Z'))).toBe(2026);
    expect(businessYear(new Date('2027-01-01T00:00:00Z'))).toBe(2027);
  });

  it('EVM-022 AC5 summer time does not move the turn of the year: 2026-06-30T22:00:00Z (CEST) is still 2026, and the turn of the year in winter is at 23:00Z', () => {
    expect(businessYear(new Date('2026-06-30T22:00:00Z'))).toBe(2026);
    expect(businessYear(new Date('2027-12-31T23:00:00Z'))).toBe(2028);
    expect(businessYear(new Date('2027-12-31T22:59:59.999Z'))).toBe(2027);
  });
});
