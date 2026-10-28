/**
 * Bounds the writes to the register of deletions (EVM-040 AC3; CWE-400, RR-NOC-T2-4). A redaction writes the object while it holds the lock of
 * the entry and a connection of the pool, and the storage may answer for about five seconds; unbounded, a burst of redactions would take the
 * whole pool (ten connections) from every other request. At most `limit` writes run at once; one that does not get a place within `waitMs` is
 * refused as unavailable (`busy`) WITHOUT asking the register, so the redaction does not start (fail closed) and the caller can retry.
 */
import type { Counter } from '../metrics/metrics.ts';
import { DeletionRegisterUnavailable, type DeletionReceipt, type DeletionRecord, type DeletionRegister } from './deletion-register.ts';

export interface RegisterWriteLimits {
  readonly limit: number;
  readonly waitMs: number;
}

/** Three writes at once, and a wait for a place shorter than the statement timeout of the database (two seconds). */
export const REGISTER_WRITE_LIMITS: RegisterWriteLimits = Object.freeze({ limit: 3, waitMs: 1500 });

export class BoundedDeletionRegister implements DeletionRegister {
  readonly #inner: DeletionRegister;
  readonly #limits: RegisterWriteLimits;
  readonly #failures: Counter;
  readonly #waiting: Array<() => void> = [];
  #running = 0;

  constructor(inner: DeletionRegister, limits: RegisterWriteLimits, failures: Counter) {
    this.#inner = inner;
    this.#limits = limits;
    this.#failures = failures;
  }

  async record(record: DeletionRecord): Promise<DeletionReceipt> {
    await this.#enter();
    try {
      return await this.#inner.record(record);
    } finally {
      this.#leave();
    }
  }

  async #enter(): Promise<void> {
    if (this.#running < this.#limits.limit) {
      this.#running += 1;
      return;
    }
    const granted = await new Promise<boolean>((resolve) => {
      const take = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.#waiting.splice(this.#waiting.indexOf(take), 1);
        resolve(false);
      }, this.#limits.waitMs);
      this.#waiting.push(take);
    });
    if (!granted) {
      this.#failures.increment({ reason: 'busy' });
      throw new DeletionRegisterUnavailable('busy');
    }
  }

  /** The place goes straight to the first one that waits (it stays counted as running), otherwise it is free. */
  #leave(): void {
    const next = this.#waiting.shift();
    if (next === undefined) this.#running -= 1;
    else next();
  }
}
