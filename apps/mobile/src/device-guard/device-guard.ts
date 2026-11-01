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
import type { AppStateName, AppStateSource, Authenticator, BootClock, DeviceLock, PatchSource } from './ports';

/** Contact facts of the open session; `null` = no session (nothing to evaluate). */
export type ContactReading = { readonly status: ContactStatus | null; readonly windowDays: unknown } | null;

export interface GuardSnapshot {
  readonly screenSecure: boolean | null;
  readonly locked: boolean;
  /** The system unlock is on screen (its transitions of `AppState` are ignored). */
  readonly prompting: boolean;
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
}

export class DeviceGuard {
  readonly #d: GuardDeps;
  readonly #lock: AppLock;
  readonly #listeners = new Set<() => void>();
  readonly #foreground = new Set<() => void>();
  #unsubscribe: (() => void) | undefined;
  #screenSecure: boolean | null = null;
  #contact: ContactView = UNKNOWN_CONTACT;
  #wiping = false;
  #prompting = false;
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

  getSnapshot = (): GuardSnapshot => this.#snapshot;

  /** Callbacks for "the app is in the foreground again" (the wipe confirmation retry, EVM-101 AC4); no second `AppState` listener. */
  onForeground(listener: () => void): () => void {
    this.#foreground.add(listener);
    return () => {
      this.#foreground.delete(listener);
    };
  }

  #onAppState(next: AppStateName): void {
    if (this.#prompting) return; // the unlock window itself must not lock the app again (loop)
    if (next === 'active') {
      this.#lock.returned();
      this.#publish();
      void this.refresh();
      for (const listener of this.#foreground) listener();
    } else {
      this.#lock.enteredBackground();
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

  /** The system unlock. Cancelling or an error leaves the app locked. */
  async unlock(): Promise<boolean> {
    if (this.#prompting || !this.#lock.locked) return !this.#lock.locked;
    this.#prompting = true;
    this.#publish();
    let result: 'success' | 'cancelled' | 'error';
    try {
      result = await this.#d.authenticator.authenticate();
    } catch {
      result = 'error';
    }
    this.#prompting = false;
    if (result === 'success') this.#lock.unlock();
    this.#d.diagnostics?.({ event: 'app-lock', outcome: result });
    this.#publish();
    return result === 'success';
  }

  #compute(): GuardSnapshot {
    const hidden = hiddenReason({ screenSecure: this.#screenSecure, contact: this.#contact, wiping: this.#wiping });
    return {
      screenSecure: this.#screenSecure,
      // without a screen lock the phone has no credential to ask for: the cover would never open. The data are hidden then (the
      // notice "Włącz blokadę ekranu"), the camera and the queue stay reachable (AC1); the lock returns with the screen lock
      locked: this.#lock.locked && this.#screenSecure !== false,
      prompting: this.#prompting,
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
