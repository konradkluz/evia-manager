import type { Clock } from '../../src/platform/clock/clock.ts';

/**
 * A controllable clock (ADR-0014): tests set the instant and move it explicitly, nothing sleeps. Instants are UTC; the
 * comments of the tests name the Europe/Warsaw wall-clock time they stand for (CEST = UTC+2 until 2026-10-25 03:00,
 * then CET = UTC+1).
 */
export class FixedClock implements Clock {
  #now: Date;

  constructor(now: Date | string) {
    this.#now = new Date(now);
  }

  now(): Date {
    return new Date(this.#now);
  }

  set(now: Date | string): void {
    this.#now = new Date(now);
  }

  advance(milliseconds: number): void {
    this.#now = new Date(this.#now.getTime() + milliseconds);
  }
}

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
