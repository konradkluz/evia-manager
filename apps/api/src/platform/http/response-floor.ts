/**
 * A floor under the response time of an operation whose outcome must not show in its duration (EVM-025 AC1; CWE-204, CWE-208): the request
 * for a reset link answers the same for an existing and an unknown account, and takes at least as long for both. The floor is counted from the
 * START of the request on the injected clock; the wait is a port, so a test checks the arithmetic without waiting. It limits a timing side channel
 * — it does not remove it: under a load that pushes the work above the floor the difference is possible (residual risk, Low).
 */
import type { Clock } from '../clock/clock.ts';

export interface Sleeper {
  sleep(milliseconds: number): Promise<void>;
}

export class TimerSleeper implements Sleeper {
  sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

/** Waits for what is left of `floorMs` since `startedAt`; does nothing when the floor has already passed. */
export async function enforceResponseFloor(clock: Clock, sleeper: Sleeper, startedAt: Date, floorMs: number): Promise<void> {
  const remaining = floorMs - (clock.now().getTime() - startedAt.getTime());
  if (remaining > 0) await sleeper.sleep(remaining);
}
