import { UPLOAD_LIMITS } from './types.ts';

/**
 * Full jitter with integer ceilings (identical in TypeScript and Kotlin): the ceiling is `min(cap, base * 2^attempt)` and the delay is
 * `floor(rng * (ceiling + 1))`, `rng` in [0, 1). `attempt` counts from 0.
 */
export function backoffDelayMs(attempt: number, rng: number): number {
  const exponent = Math.min(Math.max(attempt, 0), 20);
  const ceiling = Math.min(UPLOAD_LIMITS.capDelayMs, UPLOAD_LIMITS.baseDelayMs * 2 ** exponent);
  return Math.floor(rng * (ceiling + 1));
}
