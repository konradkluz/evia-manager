import { formatClock, formatDateTime } from '../src/i18n/format';

describe('times for the technician (EVM-107 AC3, AC4)', () => {
  it('EVM-107 AC3: the clock is in the business zone (Europe/Warsaw), without a leading zero of the hour', () => {
    expect(formatClock(Date.UTC(2026, 10, 2, 13, 5))).toBe('14:05');
    expect(formatClock(Date.UTC(2026, 6, 2, 7, 9))).toBe('9:09');
  });

  it('EVM-107 AC4: the date of an entry reads like "02.11.2026, 9:12"', () => {
    expect(formatDateTime(Date.UTC(2026, 10, 2, 8, 12))).toBe('02.11.2026, 9:12');
  });
});
