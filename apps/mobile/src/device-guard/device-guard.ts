/**
 * The device controls of a signed-in session (EVM-101 AC1–AC3, AC6; architect 5, 12): ONE store with ONE `AppState` listener that
 * holds the screen-lock fact, the app lock, the contact view with the day-5/6 warning, the wipe flag and the patch banner. The screens
 * read a snapshot through `session-context`; the hidden-data decision is made here and nowhere else.
 * Fail-closed everywhere: an error of a port is "no lock" / "anomaly", never "fine".
 */
import { windowDays } from '@evia/sync-core';
import type { ContactStatus } from '@evia/sync-core';
import type { GuardDiagnostic } from '../logging/log';
import { AppLock } from './app-lock';
import { contactView, contactWarning, hiddenReason, UNKNOWN_CONTACT, type ContactView, type HiddenReason } from './hidden-mode';
import { patchBanner, type PatchBanner } from './patch-level';
import type { AppStateName, AppStateSource, AuthCode, Authenticator, BootClock, DeviceLock, PatchSource } from './ports';

/** Contact facts of the open session; `null` = no session (nothing to evaluate). */
export type ContactReading = { readonly status: ContactStatus | null; readonly windowDays: unknown } | null;

export interface GuardSnapshot {
  readonly screenSecure: boolean | null;
  readonly locked: boolean;
  /** The system unlock is on screen (its transitions of `AppState` are ignored). */
  readonly prompting: boolean;
  /** The last unlock attempt failed (not cancelled): the cover shows the hint under the button. */
  readonly unlockFailed: boolean;
  readonly contact: ContactView;
  readonly wiping: boolean;
  readonly hidden: HiddenReason | null;
  readonly warning: { readonly daysLeft: 1 | 2 } | null;
  readonly patch: PatchBanner;
}

export interface GuardDeps {
  readonly deviceLock: DeviceLock;
  readonly boot: BootClock;
  readonly authenticator: Authenticator;
  readonly appState: AppStateSource;
  readonly patch: PatchSource;
  /** Evaluates the last contact with the server (ONE checkpoint write per call, `ContactClock.status`). */
  readonly contact: () => Promise<ContactReading>;
  readonly now: () => number;
  readonly diagnostics?: (event: GuardDiagnostic) => void;
  /** The last line of defence of the JS side (code `js_timeout`): without any answer the attempt counts as failed. Default 120 s - it must not cut the user typing a code. */
  readonly unlockTimeoutMs?: number;
}

const UNLOCK_TIMEOUT_MS = 120_000;

export class DeviceGuard {
  readonly #d: GuardDeps;
  readonly #lock: AppLock;
  readonly #listeners = new Set<() => void>();
  readonly #foreground = new Set<() => void>();
  readonly #appStateChange = new Set<() => void>();
  #unsubscribe: (() => void) | undefined;
  #screenSecure: boolean | null = null;
  #contact: ContactView = UNKNOWN_CONTACT;
  #wiping = false;
  #prompting = false;
  #unlockFailed = false;
  /** Token of the newest unlock attempt: the answer of an older one (cancelled, late) never changes the state. */
  #attempt = 0;
  /** Ends the wait of the attempt in flight when a newer one starts (its promise does not hang until the time limit). */
  #supersede: (() => void) | undefined;
  #patch: PatchBanner = 'none';
  #patchDismissed = false;
  #patchRead = false;
  #snapshot: GuardSnapshot;
  #lastHidden: HiddenReason | null | undefined;
  #refreshing: Promise<void> | undefined;

  constructor(deps: GuardDeps) {
    this.#d = deps;
    this.#lock = new AppLock({ boot: deps.boot, wall: deps.now });
    this.#snapshot = this.#compute();
  }

  /** The single listener of `AppState`; idempotent. Returns the stop function. */
  start(): () => void {
    if (this.#unsubscribe === undefined) {
      this.#unsubscribe = this.#d.appState.subscribe((next) => {
        this.#onAppState(next);
      });
      if (this.#d.appState.current() !== 'active') this.#lock.enteredBackground();
    }
    return () => {
      this.#unsubscribe?.();
      this.#unsubscribe = undefined;
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** The source of `AppState` of this guard (the cover asks for the unlock only in the foreground). */
  get appState(): AppStateSource {
    return this.#d.appState;
  }

  getSnapshot = (): GuardSnapshot => this.#snapshot;

  /** Callbacks for "the app is in the foreground again" (the wipe confirmation retry, EVM-101 AC4); no second `AppState` listener. */
  onForeground(listener: () => void): () => void {
    this.#foreground.add(listener);
    return () => {
      this.#foreground.delete(listener);
    };
  }

  /**
   * Callbacks for EVERY change of `AppState` (also while the unlock window is on screen), after the source says the new state: for what only needs to know
   * that the app went to the background or came back (EVM-111 AC2: the asking for the confirmation of the files); no second `AppState` listener.
   */
  onAppStateChange(listener: () => void): () => void {
    this.#appStateChange.add(listener);
    return () => {
      this.#appStateChange.delete(listener);
    };
  }

  #onAppState(next: AppStateName): void {
    // fail-closed: the lock is handled FIRST; a listener that throws must never skip it (nor stop the other listeners)
    try {
      if (this.#prompting) return; // the unlock window itself must not lock the app again (loop)
      if (next === 'active') {
        this.#lock.returned();
        this.#publish();
        void this.refresh();
        for (const listener of [...this.#foreground]) this.#safely(listener);
      } else {
        this.#lock.enteredBackground();
      }
    } finally {
      for (const listener of [...this.#appStateChange]) this.#safely(listener);
    }
  }

  /** A listener is not trusted: its exception ends only that call, and nothing about it is logged (it could carry data). */
  #safely(listener: () => void): void {
    try {
      listener();
    } catch {
      // intentionally empty
    }
  }

  /** Checks the screen lock and the contact; the patch level once. Never rejects. */
  refresh(): Promise<void> {
    this.#refreshing ??= this.#refresh().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  async #refresh(): Promise<void> {
    const [secure, reading] = await Promise.all([
      this.#d.deviceLock.isDeviceSecure().then(
        (value) => value,
        () => false,
      ),
      this.#d.contact().then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      ),
    ]);
    this.#screenSecure = secure;
    if (!reading.ok) this.#contact = { kind: 'anomaly', elapsedMs: null, windowDays: 7 };
    else if (reading.value === null) this.#contact = { kind: 'ok', elapsedMs: null, windowDays: 7 };
    else this.#contact = contactView(reading.value.status, windowDays(reading.value.windowDays));
    if (!this.#patchRead) {
      this.#patchRead = true;
      const level = await this.#d.patch.securityPatch().catch(() => null);
      const result = patchBanner(level, this.#d.now());
      this.#patch = result.banner;
      if (!result.readable) this.#d.diagnostics?.({ event: 'patch-level', outcome: 'unreadable' });
    }
    this.#publish();
  }

  /** The password and the code were just entered: that is an authentication of the user. */
  signedIn(): Promise<void> {
    this.#lock.unlock();
    this.#contact = UNKNOWN_CONTACT;
    this.#publish();
    return this.refresh();
  }

  /** The session ended: back to the neutral state (the next sign-in starts from "checking"). */
  signedOut(): void {
    this.#lock.lock();
    this.#contact = UNKNOWN_CONTACT;
    this.#publish();
  }

  setWiping(wiping: boolean): void {
    this.#wiping = wiping;
    this.#publish();
  }

  dismissPatch(): void {
    this.#patchDismissed = true;
    this.#publish();
  }

  /**
   * The system unlock. Cancelling, an error and a timeout leave the app locked (fail-closed). Pressing it while a request is open
   * asks AGAIN (the native side cancels the older window): the button is never dead. `auto` = the cover asks by itself; it never
   * opens a second request while one is open.
   */
  async unlock(options: { readonly auto?: boolean } = {}): Promise<boolean> {
    if (!this.#lock.locked) return true;
    if (options.auto === true && this.#prompting) return false;
    this.#supersede?.();
    this.#attempt += 1;
    const token = this.#attempt;
    this.#prompting = true;
    this.#unlockFailed = false;
    this.#publish();
    const answer: Promise<AuthCode> = this.#d.authenticator.authenticate().then(
      (code) => code,
      () => 'error' as const,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<AuthCode>((resolve) => {
      timer = setTimeout(() => {
        resolve('js_timeout');
      }, this.#d.unlockTimeoutMs ?? UNLOCK_TIMEOUT_MS);
    });
    const replaced = new Promise<AuthCode>((resolve) => {
      this.#supersede = () => {
        resolve('superseded');
      };
    });
    const code = await Promise.race([answer, timeout, replaced]);
    clearTimeout(timer);
    if (token === this.#attempt) this.#supersede = undefined; // nothing left to end for this attempt
    if (token !== this.#attempt) return false; // replaced by a newer attempt: its answer decides
    const unlocked = this.#settleUnlock(code);
    if (code === 'js_timeout') {
      // a real success of the system that comes late (the user was slow) still counts, unless a newer attempt took over
      void answer.then((late) => {
        if (late === 'success' && token === this.#attempt && this.#lock.locked) this.#settleUnlock(late);
      });
    }
    return unlocked;
  }

  #settleUnlock(code: AuthCode): boolean {
    this.#prompting = false;
    // cancelled and superseded are silent: the user closed the window / a newer request took over
    this.#unlockFailed = code !== 'success' && code !== 'cancelled' && code !== 'superseded';
    if (code === 'success') this.#lock.unlock();
    this.#d.diagnostics?.({ event: 'app-lock', outcome: code });
    this.#publish();
    return code === 'success';
  }

  #compute(): GuardSnapshot {
    const hidden = hiddenReason({ screenSecure: this.#screenSecure, contact: this.#contact, wiping: this.#wiping });
    return {
      screenSecure: this.#screenSecure,
      // without a screen lock the phone has no credential to ask for: the cover would never open. The data are hidden then (the
      // notice "Włącz blokadę ekranu"), the camera and the queue stay reachable (AC1); the lock returns with the screen lock
      locked: this.#lock.locked && this.#screenSecure !== false,
      prompting: this.#prompting,
      unlockFailed: this.#unlockFailed,
      contact: this.#contact,
      wiping: this.#wiping,
      hidden,
      warning: hidden === null ? contactWarning(this.#contact) : null,
      patch: this.#patchDismissed ? 'none' : this.#patch,
    };
  }

  #publish(): void {
    const next = this.#compute();
    const previous = this.#snapshot;
    this.#snapshot = next;
    if (next.hidden !== this.#lastHidden) {
      this.#lastHidden = next.hidden;
      if (next.hidden !== null && next.hidden !== 'checking') this.#d.diagnostics?.({ event: 'hidden-mode', reason: next.hidden });
    }
    if (JSON.stringify(previous) !== JSON.stringify(next)) for (const listener of this.#listeners) listener();
  }
}
