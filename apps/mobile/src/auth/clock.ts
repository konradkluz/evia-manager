/**
 * Clocks of the session owner (EVM-100 AC4, AC5): the wall clock, and a monotonic clock that the user cannot set back within one
 * process (`performance.now`). The process id stands for the boot id: after a restart the clock checkpoints fall back to the wall
 * clock with the anomaly checks of sync-core `evaluateContact` (a clock set back never counts as "expired"). The native boot clock
 * (elapsedRealtime) arrives with the native owner of EVM-109.
 */
import type { SessionClock } from './ports';

const PROCESS_ID = `process-${String(Date.now())}`;

export const systemClock: SessionClock = {
  now: () => Date.now(),
  monotonicNow: () => performance.now(),
  bootId: () => PROCESS_ID,
};
