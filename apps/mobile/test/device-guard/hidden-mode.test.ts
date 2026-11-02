import { contactView, contactWarning, hiddenReason, UNKNOWN_CONTACT, DAY_MS } from '../../src/device-guard/hidden-mode';
import { addMonths, patchBanner, parsePatch, warsawDate } from '../../src/device-guard/patch-level';

const ok = (days: number, windowDays = 7) => contactView({ visible: true, elapsedMs: days * DAY_MS }, windowDays);

describe('hidden-data mode and the warning of days 5 and 6 (EVM-101 AC1, AC2)', () => {
  it.each([
    [0, null],
    [4, null],
    [4.99, null],
    [5, 2],
    [5.5, 2],
    [6, 1],
    [6.99, 1],
  ])('EVM-101 AC2: %s days without contact with the 7-day window -> warning %s days left', (days, left) => {
    expect(contactWarning(ok(days))?.daysLeft ?? null).toBe(left);
  });

  it.each([
    [3, 1, 2],
    [2, 0, 1],
  ])('EVM-101 AC2: thresholds follow the window (window %s days: "window - 2" and "window - 1")', (windowDays) => {
    expect(contactWarning(ok(windowDays - 2, windowDays))?.daysLeft).toBe(2);
    expect(contactWarning(ok(windowDays - 1, windowDays))?.daysLeft).toBe(1);
    expect(contactWarning(ok(windowDays - 3, windowDays))).toBeNull();
  });

  it('EVM-101 AC2: no elapsed time, an expired window, an anomaly or an unknown state give no warning', () => {
    expect(contactWarning(contactView(null, 7))).toBeNull();
    expect(contactWarning(contactView({ visible: true, elapsedMs: null }, 7))).toBeNull();
    expect(contactWarning(contactView({ visible: false, reason: 'window_elapsed', elapsedMs: 8 * DAY_MS }, 7))).toBeNull();
    expect(contactWarning(UNKNOWN_CONTACT)).toBeNull();
  });

  it.each([
    ['no_contact_record', 'anomaly'],
    ['clock_anomaly', 'anomaly'],
    ['window_elapsed', 'expired'],
  ] as const)('EVM-101 AC2: the reason %s of sync-core is hidden (fail-closed) as %s', (reason, kind) => {
    expect(contactView({ visible: false, reason, elapsedMs: null }, 7).kind).toBe(kind);
  });

  it('EVM-101 AC1, AC2, AC4: the order of reasons; a missing fact is "checking", never "visible"', () => {
    const contact = ok(1);
    const base = { screenSecure: true, contact, wiping: false };
    expect(hiddenReason(base)).toBeNull();
    expect(hiddenReason({ ...base, screenSecure: false })).toBe('screen_lock_off');
    expect(hiddenReason({ ...base, screenSecure: null })).toBe('checking');
    expect(hiddenReason({ ...base, contact: UNKNOWN_CONTACT })).toBe('checking');
    expect(hiddenReason({ ...base, contact: contactView({ visible: false, reason: 'window_elapsed', elapsedMs: 0 }, 7) })).toBe(
      'contact_expired',
    );
    expect(hiddenReason({ ...base, contact: contactView({ visible: false, reason: 'clock_anomaly', elapsedMs: null }, 7) })).toBe(
      'clock_anomaly',
    );
    expect(hiddenReason({ ...base, screenSecure: false, wiping: true })).toBe('wipe_in_progress');
  });
});

describe('age of the system patch (EVM-101 AC6; P7, ADR-0005)', () => {
  const NOW = Date.UTC(2026, 10, 2, 12, 0, 0); // 2026-11-02 Warsaw

  it.each([
    ['2026-10-02', 'none'],
    ['2026-05-02', 'none'], // exactly 6 months: not older than 6
    ['2026-05-01', 'notice'], // 6 months and 1 day
    ['2025-11-02', 'notice'], // exactly 12 months: not older than 12
    ['2025-11-01', 'strong'],
    ['2024-01-05', 'strong'],
    ['2026-11-02', 'none'],
  ])('EVM-101 AC6: patch %s on 2026-11-02 -> %s', (patch, banner) => {
    expect(patchBanner(patch, NOW)).toEqual({ banner, readable: true });
  });

  it('EVM-101 AC6: the day is computed in Europe/Warsaw (23:30 UTC on 1 Nov is already 2 Nov there)', () => {
    expect(warsawDate(Date.UTC(2026, 10, 1, 23, 30, 0))).toEqual({ y: 2026, m: 11, d: 2 });
    expect(patchBanner('2026-05-02', Date.UTC(2026, 10, 1, 23, 30, 0))).toEqual({ banner: 'none', readable: true });
    expect(patchBanner('2026-05-02', Date.UTC(2026, 10, 1, 22, 0, 0))).toEqual({ banner: 'none', readable: true });
  });

  it.each([null, '', '2026-13-01', '2026-02-30', 'abc', '2026-1-1'])(
    'EVM-101 AC6: %s is unreadable -> no banner, noted without data',
    (patch) => {
      expect(parsePatch(patch)).toBeNull();
      expect(patchBanner(patch, NOW)).toEqual({ banner: 'none', readable: false });
    },
  );

  it('EVM-101 AC6: calendar months are added with the day clamped to the target month', () => {
    expect(addMonths({ y: 2026, m: 1, d: 31 }, 1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(addMonths({ y: 2026, m: 11, d: 15 }, 12)).toEqual({ y: 2027, m: 11, d: 15 });
    expect(addMonths({ y: 2026, m: 12, d: 1 }, 1)).toEqual({ y: 2027, m: 1, d: 1 });
  });
});
