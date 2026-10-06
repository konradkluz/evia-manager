/**
 * Per-IP request limits (SR-API-02, P10; ASVS V2.4.1): fixed windows of one minute held in memory — the API runs as one
 * instance in v1, the counters reset on restart (accepted residual risk R6). The map is bounded: expired windows are
 * swept periodically and, when the table is still full, the oldest entry is evicted, so a flood of addresses cannot
 * exhaust memory (CWE-770). IPv6 clients share a bucket per /64 (a single host owns the whole prefix).
 */
import type { Clock } from '../clock/clock.ts';
import { ipPrefix } from '../net/ip.ts';

export interface RateDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Counts one request of `address` in the bucket; `limit` requests per minute are allowed. */
  consume(bucket: string, address: string | undefined, limit: number): RateDecision;
}

export const RATE_LIMITER = Symbol('RATE_LIMITER');

/** Limits per client address and minute (api-guidelines.md → Limity; P10). */
export const RATE_LIMITS = Object.freeze({
  /** every request */
  global: 1200,
  /** anonymous operations */
  anonymous: 60,
  /** sign-in and MFA operations */
  authentication: 20,
});

export type RateBucket = keyof typeof RATE_LIMITS;

interface Window {
  readonly startedAt: number;
  count: number;
}

export const WINDOW_MS = 60_000;
export const MAX_TRACKED_KEYS = 50_000;

export class InMemoryRateLimiter implements RateLimiter {
  readonly #clock: Clock;
  readonly #maxKeys: number;
  readonly #windows = new Map<string, Window>();
  #nextSweepAt = 0;

  constructor(clock: Clock, maxKeys: number = MAX_TRACKED_KEYS) {
    this.#clock = clock;
    this.#maxKeys = maxKeys;
  }

  consume(bucket: string, address: string | undefined, limit: number): RateDecision {
    const now = this.#clock.now().getTime();
    const key = `${bucket}|${(address === undefined ? null : ipPrefix(address, 32, 64)) ?? 'unknown'}`;
    let window = this.#windows.get(key);
    if (window === undefined || now - window.startedAt >= WINDOW_MS) {
      this.#makeRoom(now);
      window = { startedAt: now, count: 0 };
      this.#windows.delete(key);
      this.#windows.set(key, window);
    }
    window.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((window.startedAt + WINDOW_MS - now) / 1000));
    return { allowed: window.count <= limit, retryAfterSeconds };
  }

  #makeRoom(now: number): void {
    if (this.#windows.size < this.#maxKeys) return;
    if (now >= this.#nextSweepAt) {
      this.#nextSweepAt = now + WINDOW_MS;
      for (const [key, window] of this.#windows) {
        if (now - window.startedAt >= WINDOW_MS) this.#windows.delete(key);
      }
    }
    if (this.#windows.size >= this.#maxKeys) {
      const oldest = this.#windows.keys().next();
      if (oldest.done !== true) this.#windows.delete(oldest.value);
    }
  }
}
