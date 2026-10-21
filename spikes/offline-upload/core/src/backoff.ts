// Exponential backoff with full jitter (offline-sync.md, ADR-0008).
export interface BackoffOptions {
  baseMs: number;
  capMs: number;
}

export function backoffDelayMs(
  attempt: number,
  options: BackoffOptions = { baseMs: 1000, capMs: 60_000 },
  rng: () => number = Math.random,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error('attempt must be a non-negative integer');
  const ceiling = Math.min(options.capMs, options.baseMs * 2 ** attempt);
  return Math.floor(rng() * ceiling);
}
