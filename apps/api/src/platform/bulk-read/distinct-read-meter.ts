/**
 * Meter of DISTINCT objects read by one user (EVM-039 AC5; SR-API-02, SR-LOG-06, SR-LOG-07; policy P10; RR-13; ASVS V2.4.1;
 * CWE-770): P10 asks for an alert when a user reads more than 300 different customers within an hour. The record meter next to this
 * one counts records (the same customer twice is two records); this one counts identifiers, so a user who pages through the list of
 * 301 customers is noticed long before the 2000 records of the record meter.
 *
 * A sliding window of 60 minutes per user: every identifier remembers when it was read last, an identifier read again moves to
 * the end, one not read for an hour drops out. The alert is raised ONCE per window and user, when the user's count passes the
 * threshold (the 301st different customer). The counting is per USER, not per session — more sessions cannot be a way round it.
 *
 * Memory is bounded twice. Per user: at most threshold + 1 identifiers — once the count is above the threshold, older identifiers can
 * go without changing the answer (the count stays above it). Per process: at most {@link MAX_TRACKED_DISTINCT_USERS} users; when the
 * table is full the users with nothing left in the window are swept, and if it is still full the user who was LEAST RECENTLY active
 * is evicted — an active user is never the one who loses the counter. The state is in the memory of the process (as the record meter:
 * a restart zeroes it, the accepted residual risk of apps/api/README).
 */
import type { Clock } from '../clock/clock.ts';
import type { BulkReadObjectType } from './bulk-read-event.ts';

/** The alert is raised when more than this many different objects were read in the window (the 301st). */
export const DISTINCT_READ_ALERT_ABOVE = 300;
export const DISTINCT_READ_WINDOW_MINUTES = 60;
export const MAX_TRACKED_DISTINCT_USERS = 10_000;

const WINDOW_MS = DISTINCT_READ_WINDOW_MINUTES * 60_000;

export interface DistinctReadLimits {
  readonly alertAbove: number;
}

export const DISTINCT_READ_LIMITS: DistinctReadLimits = Object.freeze({ alertAbove: DISTINCT_READ_ALERT_ABOVE });

export interface DistinctReadMeter {
  /** Notes that the user was served these objects; @returns true ONCE per window and user: the caller raises the alert */
  record(userId: string, objectType: BulkReadObjectType, ids: readonly string[]): boolean;
}

interface UserWindow {
  /** identifier → when it was read last (milliseconds); a read again moves the entry to the end */
  readonly seen: Map<string, number>;
  alertedAt: number;
}

export class InMemoryDistinctReadMeter implements DistinctReadMeter {
  readonly #clock: Clock;
  readonly #limits: DistinctReadLimits;
  readonly #maxUsers: number;
  /** In the order of the last activity: the first entry is the least recently active user. */
  readonly #users = new Map<string, UserWindow>();

  constructor(clock: Clock, limits: DistinctReadLimits = DISTINCT_READ_LIMITS, maxUsers: number = MAX_TRACKED_DISTINCT_USERS) {
    this.#clock = clock;
    this.#limits = limits;
    this.#maxUsers = maxUsers;
  }

  record(userId: string, objectType: BulkReadObjectType, ids: readonly string[]): boolean {
    if (ids.length === 0) return false;
    const now = this.#clock.now().getTime();
    const window = this.#touch(`${objectType}|${userId}`, now);
    for (const [id, readAt] of window.seen) if (now - readAt >= WINDOW_MS) window.seen.delete(id);
    for (const id of ids) {
      window.seen.delete(id);
      window.seen.set(id, now);
    }
    const keep = this.#limits.alertAbove + 1;
    for (const id of window.seen.keys()) {
      if (window.seen.size <= keep) break;
      window.seen.delete(id);
    }
    if (window.seen.size <= this.#limits.alertAbove || now - window.alertedAt < WINDOW_MS) return false;
    window.alertedAt = now;
    return true;
  }

  /** The window of the user, moved to the end of the order of activity (opened when it is new). */
  #touch(key: string, now: number): UserWindow {
    const existing = this.#users.get(key);
    if (existing !== undefined) this.#users.delete(key);
    const window = existing ?? this.#open(now);
    this.#users.set(key, window);
    return window;
  }

  #open(now: number): UserWindow {
    if (this.#users.size >= this.#maxUsers) this.#makeRoom(now);
    return { seen: new Map(), alertedAt: Number.NEGATIVE_INFINITY };
  }

  #makeRoom(now: number): void {
    for (const [key, window] of this.#users) {
      const idle = [...window.seen.values()].every((readAt) => now - readAt >= WINDOW_MS);
      if (idle) this.#users.delete(key);
    }
    if (this.#users.size >= this.#maxUsers) {
      const leastRecent = this.#users.keys().next();
      if (leastRecent.done !== true) this.#users.delete(leastRecent.value);
    }
  }
}
