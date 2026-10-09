/** The calendar day of an instant in the business zone `Europe/Warsaw`, as `YYYY-MM-DD` (D8: stored in UTC, the day is Warsaw's). */
const WARSAW_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });

export const businessDate = (instant: Date): string => WARSAW_DAY.format(instant);
