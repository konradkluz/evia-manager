import type { Page } from '@playwright/test';
import type { MockApi } from './mock-api.ts';

/**
 * One way to set the time of a spec (EVM-129): the clock of the tab and the "now" of the synthetic journal are frozen at the same
 * instant, so a result never depends on the hour the suite really runs. The instants are in the past of the real clock, so the
 * synthetic session (which counts from the real clock) never looks expired to the frozen tab.
 */
export interface ClockCase {
  /** The local time in `Europe/Warsaw` that the case stands for (the name of the test). */
  readonly label: string;
  readonly iso: string;
}

/**
 * The window around the local midnight of `Europe/Warsaw`, in winter (UTC+1) and in summer (UTC+2): the UTC date differs from the
 * local date for the whole hour 00:00–01:00 (winter) and 00:00–02:00 (summer), and the boundary itself.
 */
export const MIDNIGHT_WINDOW: readonly ClockCase[] = [
  { label: 'winter 23:59:59', iso: '2026-03-10T23:59:59+01:00' },
  { label: 'winter 00:00:00', iso: '2026-03-10T00:00:00+01:00' },
  { label: 'winter 00:01', iso: '2026-03-10T00:01:00+01:00' },
  { label: 'winter 00:20', iso: '2026-03-10T00:20:00+01:00' },
  { label: 'winter 00:40', iso: '2026-03-10T00:40:00+01:00' },
  { label: 'winter 00:59', iso: '2026-03-10T00:59:00+01:00' },
  { label: 'summer 00:01', iso: '2026-07-14T00:01:00+02:00' },
  { label: 'summer 00:40', iso: '2026-07-14T00:40:00+02:00' },
  { label: 'summer 23:59:59', iso: '2026-07-14T23:59:59+02:00' },
];

/** Freezes the tab and the synthetic journal at the instant (call before the first `goto`). */
export async function freezeClock(page: Page, api: MockApi, iso: string): Promise<number> {
  const instant = new Date(iso).getTime();
  api.journal.now = instant;
  await page.clock.setFixedTime(instant);
  return instant;
}
