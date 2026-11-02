/**
 * Lock of the app (EVM-101 AC3; policy P7, SR-MOB-03): the content is covered after more than 5 minutes in the background and at
 * every cold start, until the system unlock succeeds. It is a UI gate only: no key is bound, nothing is decrypted by it.
 * Time in the background is measured by TWO clocks (architect 3, security W1): the boot clock (`elapsedRealtime`, counts deep
 * sleep) and the wall clock. The app locks when ANY of these holds: the boot clock advanced by more than 5 minutes, the wall clock
 * advanced by more than 5 minutes, the wall clock went back, or the boot clock is unavailable / went back (the phone restarted).
 */
import type { BootClock } from './ports';

export const APP_LOCK_AFTER_MS = 5 * 60_000;

interface Mark {
  readonly boot: number | null;
  readonly wall: number;
}

export class AppLock {
  readonly #boot: BootClock;
  readonly #wall: () => number;
  #mark: Mark | null = null;
  #locked = true; // a cold start is locked before the first render

  constructor(deps: { readonly boot: BootClock; readonly wall: () => number }) {
    this.#boot = deps.boot;
    this.#wall = deps.wall;
  }

  get locked(): boolean {
    return this.#locked;
  }

  #read(): Mark {
    let boot: number | null;
    try {
      const value = this.#boot.elapsedRealtime();
      boot = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      boot = null;
    }
    return { boot, wall: this.#wall() };
  }

  /** The app left the foreground (`background` / `inactive`): the first such moment of a stay in the background counts. */
  enteredBackground(): void {
    this.#mark ??= this.#read();
  }

  /** The app came back. Returns whether it is locked now. */
  returned(): boolean {
    const mark = this.#mark;
    this.#mark = null;
    if (this.#locked || mark === null) return this.#locked;
    const now = this.#read();
    const bootAway = mark.boot === null || now.boot === null ? null : now.boot - mark.boot;
    const wallAway = now.wall - mark.wall;
    if (bootAway === null || bootAway < 0 || bootAway > APP_LOCK_AFTER_MS || wallAway < 0 || wallAway > APP_LOCK_AFTER_MS) {
      this.#locked = true;
    }
    return this.#locked;
  }

  /** The system unlock succeeded, or the user has just signed in with the password and the code. */
  unlock(): void {
    this.#locked = false;
    this.#mark = null;
  }

  /** The session ended: the next one starts locked again only through a cold start; a fresh sign-in unlocks. */
  lock(): void {
    this.#locked = true;
  }
}
