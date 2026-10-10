import { describe, expect, it } from 'vitest';
import { normalizeWaiting, waitingDays, WAITING_SINCE_MIN } from '../../src/modules/procedures/domain/waiting.ts';

const TODAY = '2026-10-03';
const PARTY = '0198b0a0-0000-7000-8000-000000000003';
const refused = (input: Parameters<typeof normalizeWaiting>[0]) => {
  const result = normalizeWaiting(input, TODAY);
  if (result.ok) throw new Error('expected "waiting for" to be refused');
  return result.errors;
};

describe('"Czekamy na…" (EVM-032 AC2, AC3; SR-INPUT-01, SR-INPUT-02)', () => {
  it('EVM-032 AC2 the customer takes no party; "since" is today by default', () => {
    expect(normalizeWaiting({ waitingOn: 'customer' }, TODAY)).toEqual({
      ok: true,
      waiting: { waitingOn: 'customer', waitingOnPartyId: null, waitingSince: TODAY },
    });
  });

  it('EVM-032 AC2 a party needs its identifier; an earlier "since" is kept', () => {
    expect(normalizeWaiting({ waitingOn: 'party', waitingOnPartyId: PARTY, waitingSince: '2026-09-18' }, TODAY)).toEqual({
      ok: true,
      waiting: { waitingOn: 'party', waitingOnPartyId: PARTY, waitingSince: '2026-09-18' },
    });
    expect(refused({ waitingOn: 'party' })).toEqual([{ pointer: '/waitingOnPartyId', code: 'required' }]);
  });

  it('EVM-032 AC2 the customer with a party is refused: not_allowed, never the value', () => {
    expect(refused({ waitingOn: 'customer', waitingOnPartyId: PARTY })).toEqual([{ pointer: '/waitingOnPartyId', code: 'not_allowed' }]);
    expect(JSON.stringify(refused({ waitingOn: 'customer', waitingOnPartyId: PARTY }))).not.toContain(PARTY);
  });

  it('EVM-032 AC3 a partial change (a party or a day without who is waited for) is refused: waitingOn is required', () => {
    expect(refused({ waitingOnPartyId: PARTY })).toEqual([{ pointer: '/waitingOn', code: 'required' }]);
    expect(refused({ waitingSince: TODAY })).toEqual([{ pointer: '/waitingOn', code: 'required' }]);
  });

  it('EVM-032 AC2 "since" is from 2000-01-01 to today, both inclusive: tomorrow and 1999 are out_of_range', () => {
    expect(WAITING_SINCE_MIN).toBe('2000-01-01');
    expect(normalizeWaiting({ waitingOn: 'customer', waitingSince: TODAY }, TODAY).ok).toBe(true);
    expect(normalizeWaiting({ waitingOn: 'customer', waitingSince: WAITING_SINCE_MIN }, TODAY).ok).toBe(true);
    expect(refused({ waitingOn: 'customer', waitingSince: '2026-10-04' })).toEqual([{ pointer: '/waitingSince', code: 'out_of_range' }]);
    expect(refused({ waitingOn: 'customer', waitingSince: '1999-12-31' })).toEqual([{ pointer: '/waitingSince', code: 'out_of_range' }]);
  });

  it('EVM-032 AC8 the days are full calendar days: 2026-09-18 to 2026-10-03 is 15, since today is 0, across a month and a leap day', () => {
    expect(waitingDays('2026-09-18', '2026-10-03')).toBe(15);
    expect(waitingDays('2026-10-03', '2026-10-03')).toBe(0);
    expect(waitingDays('2028-02-28', '2028-03-01')).toBe(2);
    expect(waitingDays('2026-10-04', '2026-10-03')).toBe(0);
  });
});
