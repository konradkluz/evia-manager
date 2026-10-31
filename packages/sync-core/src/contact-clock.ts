import type { Clock, MonotonicClock, ReplicaStore } from './ports.ts';
import type { Visibility } from './pull-types.ts';

/**
 * Last contact with the server, resistant to the phone's clock (AC7, SR-MOB-05). The record is a checkpoint:
 * `carried` is the time elapsed since the contact up to the checkpoint `(bootId, mono, wall)`. Within one boot the elapsed time
 * comes from the monotonic clock; after a restart from the wall clock. A clock set back (below the highest observed wall time, below
 * the wall reading at the contact, or a monotonic value lower than stored) is fail-closed: the data are hidden, not wiped.
 */
export interface ContactRecord {
  readonly v: 1;
  /** Server time of the last authenticated 2xx response (epoch ms). */
  readonly serverTime: number;
  /** `serverTime - wall at contact`: lets the check run in the frame of the server even when the phone is minutes off. */
  readonly offset: number;
  readonly bootId: string;
  readonly mono: number;
  readonly wall: number;
  readonly carried: number;
  readonly maxObservedWall: number;
}

const DAY_MS = 86_400_000;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseContactRecord(raw: unknown): ContactRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const { v, serverTime, offset, bootId, mono, wall, carried, maxObservedWall } = r;
  if (v !== 1 || typeof bootId !== 'string' || bootId.length < 1 || bootId.length > 128) return null;
  if (!isNum(serverTime) || !isNum(offset) || !isNum(mono) || !isNum(wall) || !isNum(carried) || !isNum(maxObservedWall)) return null;
  if (carried < 0 || serverTime < 0 || wall < 0) return null;
  return { v: 1, serverTime, offset, bootId, mono, wall, carried, maxObservedWall };
}

export function newContact(serverTime: number, wall: number, mono: number, bootId: string): ContactRecord {
  return { v: 1, serverTime, offset: serverTime - wall, bootId, mono, wall, carried: 0, maxObservedWall: wall };
}

export interface Reading {
  readonly wall: number;
  readonly mono: number;
  readonly bootId: string;
}

export type Evaluation =
  { readonly ok: true; readonly elapsedMs: number; readonly next: ContactRecord } | { readonly ok: false; readonly next: ContactRecord };

/** Pure evaluation; `next` is what must be persisted (the highest wall time is kept on every evaluation, also a failed one). */
export function evaluateContact(record: ContactRecord, now: Reading): Evaluation {
  const maxObservedWall = Math.max(record.maxObservedWall, isNum(now.wall) ? now.wall : record.maxObservedWall);
  const failed: Evaluation = { ok: false, next: { ...record, maxObservedWall } };
  if (!isNum(now.wall) || !isNum(now.mono) || now.bootId.length === 0) return failed;
  if (now.wall < record.maxObservedWall) return failed;
  if (now.wall + record.offset < record.serverTime) return failed;
  let delta: number;
  if (now.bootId === record.bootId) {
    if (now.mono < record.mono) return failed;
    delta = now.mono - record.mono;
  } else {
    delta = now.wall - record.wall;
  }
  const elapsedMs = record.carried + delta;
  if (!Number.isFinite(elapsedMs) || delta < 0 || elapsedMs < 0) return failed;
  return {
    ok: true,
    elapsedMs,
    next: { ...record, bootId: now.bootId, mono: now.mono, wall: now.wall, carried: elapsedMs, maxObservedWall },
  };
}

export const DEFAULT_WINDOW_DAYS = 7;

/** The window may be shortened by the server but never beyond the 7-day baseline (SR-MOB-05). */
export function windowDays(configured: unknown): number {
  return typeof configured === 'number' && Number.isInteger(configured) && configured >= 1 && configured <= DEFAULT_WINDOW_DAYS
    ? configured
    : DEFAULT_WINDOW_DAYS;
}

export class ContactClock {
  readonly #store: Pick<ReplicaStore, 'saveContact'>;
  readonly #clock: Clock;
  readonly #mono: MonotonicClock;

  constructor(store: Pick<ReplicaStore, 'saveContact'>, clock: Clock, mono: MonotonicClock) {
    this.#store = store;
    this.#clock = clock;
    this.#mono = mono;
  }

  #reading(): Reading {
    return { wall: this.#clock.now(), mono: this.#mono.monotonicNow(), bootId: this.#mono.bootId() };
  }

  /** The single place that records a contact: call it only after an authenticated 2xx response with a valid `serverTime`. */
  async record(serverTime: number): Promise<void> {
    const at = this.#reading();
    await this.#store.saveContact(newContact(serverTime, at.wall, at.mono, at.bootId));
  }

  /** Whether the data may be shown. An empty replica has nothing to hide; a non-empty one without a readable record is hidden. */
  async visibility(raw: unknown, hasData: boolean, configuredWindowDays: unknown): Promise<Visibility> {
    const record = parseContactRecord(raw);
    if (record === null) return hasData ? { visible: false, reason: 'no_contact_record' } : { visible: true };
    const result = evaluateContact(record, this.#reading());
    await this.#store.saveContact(result.next);
    if (!result.ok) return { visible: false, reason: 'clock_anomaly' };
    return result.elapsedMs < windowDays(configuredWindowDays) * DAY_MS ? { visible: true } : { visible: false, reason: 'window_elapsed' };
  }
}
