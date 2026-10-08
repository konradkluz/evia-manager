/**
 * The number of a work order (EVM-022 AC5, SR-API-07; D8): `ZL-YYYY-NNNN` — the year of the creation in `Europe/Warsaw` (not in UTC:
 * an order made at 00:30 on 1 January in Warsaw is still 31 December in UTC) and the number in the year, at least four digits and
 * no gaps (the counter is a table row inside the transaction of the creation, see `number-counter.ts`). The fixed width sorts
 * correctly up to 9999 orders a year (0010); a longer number is still valid.
 */
const WARSAW_YEAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric' });

/** The business year of an instant (`Europe/Warsaw`). */
export const businessYear = (instant: Date): number => Number(WARSAW_YEAR.format(instant));

export const formatWorkOrderNumber = (year: number, sequence: number): string => `ZL-${year}-${String(sequence).padStart(4, '0')}`;
