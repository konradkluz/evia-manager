/**
 * Mass-read meter (EVM-017 AC5; SR-API-02, SR-LOG-06, SR-LOG-07; policy P10; RR-13; ASVS V2.4.1; CWE-770): counts the records
 * that lists and searches returned to ONE user in a sliding window of 10 minutes (minute buckets). A user who read 2000 records
 * raises one alert per window; from 10 000 the next read is refused (`429`) until the sum falls below the limit. The check
 * runs BEFORE the query, the count of the returned records is added AFTER it; a refused request adds nothing.
 *
 * The state is held in the memory of the process, like the per-IP limiter: the API runs as one process in v1 and a restart
 * zeroes the counters (accepted residual risk, apps/api/README); with more processes the implementation moves to PostgreSQL
 * behind the same port. The table is bounded (idle users are swept, the oldest is evicted when it is full). The thresholds
 * are injected (production values below) — configuration cannot switch the control off.
 */
import type { Clock } from '../clock/clock.ts';

export interface BulkReadLimits {
  /** records in the window from which an alert is raised */
  readonly alertAt: number;
  /** records in the window from which a read is refused */
  readonly blockAt: number;
}

/** P10: an alert at 2000 records in 10 minutes, a block at 10 000. */
export const BULK_READ_LIMITS: BulkReadLimits = Object.freeze({ alertAt: 2000, blockAt: 10_000 });

/** `alert` is true once per window and user: the caller emits the security alert. */
export type BulkReadDecision =
  | { readonly allowed: true; readonly alert: boolean }
  | { readonly allowed: false; readonly retryAfterSeconds: number; readonly alert: false };

export interface BulkReadMeter {
  /** Asks, before the query, whether the user may read now. */
  check(userId: string): BulkReadDecision;
  /** Adds the number of records the response returned. */
  record(userId: string, count: number): void;
}

export const BULK_READ_WINDOW_MINUTES = 10;
export const MAX_TRACKED_USERS = 10_000;
const MINUTE_MS = 60_000;
const WINDOW_MS = BULK_READ_WINDOW_MINUTES * MINUTE_MS;

interface UserWindow {
  readonly buckets: Map<number, number>;
  alertedAt: number;
}

export class InMemoryBulkReadMeter implements BulkReadMeter {
  readonly #clock: Clock;
  readonly #limits: BulkReadLimits;
  readonly #maxUsers: number;
  readonly #users = new Map<string, UserWindow>();

  constructor(clock: Clock, limits: BulkReadLimits = BULK_READ_LIMITS, maxUsers: number = MAX_TRACKED_USERS) {
    this.#clock = clock;
    this.#limits = limits;
    this.#maxUsers = maxUsers;
  }

  check(userId: string): BulkReadDecision {
    const now = this.#clock.now().getTime();
    const window = this.#users.get(userId);
    if (window === undefined) return { allowed: true, alert: false };
    const live = liveBuckets(window, now);
    const sum = live.reduce((total, [, count]) => total + count, 0);
    if (sum >= this.#limits.blockAt) {
      return { allowed: false, retryAfterSeconds: retryAfter(live, sum, this.#limits.blockAt, now), alert: false };
    }
    if (sum >= this.#limits.alertAt && now - window.alertedAt >= WINDOW_MS) {
      window.alertedAt = now;
      return { allowed: true, alert: true };
    }
    return { allowed: true, alert: false };
  }

  record(userId: string, count: number): void {
    if (count <= 0) return;
    const now = this.#clock.now().getTime();
    const minute = Math.floor(now / MINUTE_MS);
    const window = this.#users.get(userId) ?? this.#open(userId, now);
    window.buckets.set(minute, (window.buckets.get(minute) ?? 0) + count);
  }

  #open(userId: string, now: number): UserWindow {
    if (this.#users.size >= this.#maxUsers) this.#makeRoom(now);
    const window: UserWindow = { buckets: new Map(), alertedAt: Number.NEGATIVE_INFINITY };
    this.#users.set(userId, window);
    return window;
  }

  #makeRoom(now: number): void {
    for (const [userId, window] of this.#users) {
      if (liveBuckets(window, now).length === 0 && now - window.alertedAt >= WINDOW_MS) this.#users.delete(userId);
    }
    if (this.#users.size >= this.#maxUsers) {
      const oldest = this.#users.keys().next();
      if (oldest.done !== true) this.#users.delete(oldest.value);
    }
  }
}

/** Buckets still inside the window, oldest first; expired ones are dropped on the way. */
function liveBuckets(window: UserWindow, now: number): Array<[number, number]> {
  const oldest = Math.floor(now / MINUTE_MS) - BULK_READ_WINDOW_MINUTES + 1;
  for (const minute of window.buckets.keys()) if (minute < oldest) window.buckets.delete(minute);
  return [...window.buckets].sort(([a], [b]) => a - b);
}

/** Seconds until enough of the oldest buckets leave the window for the sum to drop below the limit (at least 1). */
function retryAfter(live: ReadonlyArray<[number, number]>, sum: number, blockAt: number, now: number): number {
  let remaining = sum;
  let lastToLeave = 0;
  for (const [minute, count] of live) {
    lastToLeave = minute;
    remaining -= count;
    if (remaining < blockAt) break;
  }
  return Math.max(1, Math.ceil(((lastToLeave + BULK_READ_WINDOW_MINUTES) * MINUTE_MS - now) / 1000));
}
