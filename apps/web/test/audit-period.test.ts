import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { addDays, checkPeriod, endOfDay, formatDay, formatEventTime, startOfDay, todayIn } from '../src/audit/period.ts';
import { NO_FILTERS, periodOf, quickRangeOf, toQuery } from '../src/audit/filters.ts';
import { lastStepUpAt, resetStepUp, runStepUp, withRotationRetry } from '../src/session/step-up.ts';
import { resetServerClock } from '../src/session/server-clock.ts';

afterEach(() => {
  resetStepUp();
  resetServerClock();
  vi.useRealTimers();
});

describe('days of the period are Warsaw days (EVM-029 AC5; styleguide § 6.3)', () => {
  it('EVM-029 AC5 summer time (CEST, +2): a day starts at 22:00Z of the day before and ends at 21:59:59.999Z', () => {
    expect(startOfDay('2026-10-04')).toBe('2026-10-03T22:00:00.000Z');
    expect(endOfDay('2026-10-04')).toBe('2026-10-04T21:59:59.999Z');
  });

  it('EVM-029 AC5 winter time (CET, +1)', () => {
    expect(startOfDay('2026-12-01')).toBe('2026-11-30T23:00:00.000Z');
    expect(endOfDay('2026-12-01')).toBe('2026-12-01T22:59:59.999Z');
  });

  it('EVM-029 AC5 the day the clocks go back (25.10.2026) is 25 hours long; the day they go forward (29.03.2026) is 23', () => {
    expect(startOfDay('2026-10-25')).toBe('2026-10-24T22:00:00.000Z');
    expect(endOfDay('2026-10-25')).toBe('2026-10-25T22:59:59.999Z');
    expect(startOfDay('2026-03-29')).toBe('2026-03-28T23:00:00.000Z');
    expect(endOfDay('2026-03-29')).toBe('2026-03-29T21:59:59.999Z');
  });

  it('EVM-029 AC5 text that is not a date gives no instant', () => {
    expect(startOfDay('')).toBeNull();
    expect(startOfDay('2026-02-30')).toBeNull();
    expect(endOfDay('04.10.2026')).toBeNull();
    expect(addDays('nonsense', 3)).toBe('nonsense');
    expect(formatDay('nonsense')).toBe('nonsense');
  });

  it('EVM-029 AC5 today is the day in Warsaw, also just after its midnight', () => {
    expect(todayIn(Date.parse('2026-10-04T22:30:00.000Z'))).toBe('2026-10-05');
    expect(todayIn(Date.parse('2026-10-04T21:30:00.000Z'))).toBe('2026-10-04');
  });

  it('EVM-029 AC5 days are added across months, years and the change of the time', () => {
    expect(addDays('2026-10-04', -6)).toBe('2026-09-28');
    expect(addDays('2026-01-02', -3)).toBe('2025-12-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('EVM-029 AC5 dates are shown as DD.MM.YYYY and the time of an event as "04.10.2026, 14:05" in Warsaw', () => {
    expect(formatDay('2026-10-04')).toBe('04.10.2026');
    expect(formatEventTime('2026-10-04T12:05:00.000Z')).toBe('04.10.2026, 14:05');
    expect(formatEventTime('2026-12-01T23:30:00.000Z')).toBe('02.12.2026, 00:30');
    expect(formatEventTime('not a time')).toBe('not a time');
  });

  it('EVM-029 AC5 the period is checked for order and for a length of at most 2 years (730 days) before it is sent', () => {
    expect(checkPeriod('', '')).toBeNull();
    expect(checkPeriod('2026-10-01', '')).toBeNull();
    expect(checkPeriod('2026-10-04', '2026-10-04')).toBeNull();
    expect(checkPeriod('2026-10-04', '2026-10-01')).toBe('order');
    expect(checkPeriod('2024-10-05', '2026-10-04')).toBeNull();
    expect(checkPeriod('2024-10-04', '2026-10-04')).toBe('length');
  });
});

describe('filters of the audit log (EVM-029 AC5)', () => {
  it('EVM-029 AC5 empty filters send only the page size; filled ones send their values; an invalid day is left out', () => {
    expect(toQuery(NO_FILTERS, undefined)).toEqual({ limit: 25 });
    expect(toQuery({ action: 'login.failed', outcome: 'denied', actorUserId: 'u1', from: '2026-10-01', to: '2026-10-04' }, 'CUR')).toEqual({
      limit: 25,
      action: 'login.failed',
      outcome: 'denied',
      actorUserId: 'u1',
      from: '2026-09-30T22:00:00.000Z',
      to: '2026-10-04T21:59:59.999Z',
      cursor: 'CUR',
    });
    expect(toQuery({ ...NO_FILTERS, from: '2026-13-01' }, undefined)).toEqual({ limit: 25 });
  });

  it('EVM-029 AC5 quick ranges set the period and are recognised again', () => {
    const today = '2026-10-04';
    expect(periodOf('today', today)).toEqual({ from: today, to: today });
    expect(periodOf('days7', today)).toEqual({ from: '2026-09-28', to: today });
    expect(periodOf('days30', today)).toEqual({ from: '', to: '' });
    expect(quickRangeOf(NO_FILTERS, today)).toBe('days30');
    expect(quickRangeOf({ ...NO_FILTERS, ...periodOf('today', today) }, today)).toBe('today');
    expect(quickRangeOf({ ...NO_FILTERS, ...periodOf('days7', today) }, today)).toBe('days7');
    expect(quickRangeOf({ ...NO_FILTERS, from: '2026-09-01', to: today }, today)).toBeNull();
    expect(quickRangeOf({ ...NO_FILTERS, from: today, to: '2026-10-03' }, today)).toBeNull();
  });
});

describe('step-up of the tab (EVM-029 AC3; security K9)', () => {
  const revoked = () => new ApiError(401, { code: 'session_revoked' });

  it('EVM-029 AC3 a success remembers the server time of the confirmation, a failure does not; logout forgets it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
    await expect(runStepUp(() => Promise.reject(new Error('refused')))).rejects.toThrow('refused');
    expect(lastStepUpAt()).toBeNull();
    await runStepUp(() => Promise.resolve());
    expect(lastStepUpAt()).toBe(Date.parse('2026-10-04T12:00:00.000Z'));
    resetStepUp();
    expect(lastStepUpAt()).toBeNull();
  });

  it('EVM-029 AC3 401 session_revoked with no step-up in between is not repeated', async () => {
    const call = vi.fn(() => Promise.reject(revoked()));
    await expect(withRotationRetry(call)).rejects.toBeInstanceOf(ApiError);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('EVM-029 AC3 401 session_revoked that came during a step-up is repeated once, after the step-up has finished', async () => {
    let finish: () => void = () => undefined;
    const order: string[] = [];
    const call = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => Promise.reject(revoked()))
      .mockImplementationOnce(() => {
        order.push('repeat');
        return Promise.resolve('data');
      });
    const result = withRotationRetry(call);
    // The step-up begins while the first call is in flight (the cookie of the old session).
    const confirmation = runStepUp(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    order.push('step-up finishes');
    finish();
    await confirmation;
    expect(await result).toBe('data');
    expect(order).toEqual(['step-up finishes', 'repeat']);
  });

  it('EVM-029 AC3 a second 401 session_revoked is not repeated again (no loop)', async () => {
    const call = vi.fn(() => Promise.reject(revoked()));
    const result = withRotationRetry(call);
    // The step-up begins while the first call is in flight.
    const confirmation = runStepUp(() => Promise.resolve());
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await confirmation;
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('EVM-029 AC3 other failures pass through even during a step-up', async () => {
    const call = vi.fn(() => Promise.reject(new ApiError(403, { code: 'forbidden' })));
    const result = withRotationRetry(call);
    const confirmation = runStepUp(() => Promise.resolve());
    await expect(result).rejects.toMatchObject({ code: 'forbidden' });
    await confirmation;
    expect(call).toHaveBeenCalledTimes(1);
  });
});
