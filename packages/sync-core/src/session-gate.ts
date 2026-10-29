import type { ContactClock } from './contact-clock.ts';
import type { EventSink, RefreshResult, SessionOwner } from './ports.ts';
import type { EngineEvent, PauseReason } from './types.ts';

export type PauseListener = (reason: PauseReason, owner: string | null) => void;
export type GateVerdict = 'retry' | 'stop' | 'other';

/**
 * Session and pause state shared by push and pull (EVM-092): a pause caused by one side (401, `session_revoked`, 426, 403) stops
 * the other, `resume()` is the same for both, and the contact with the server is recorded in one place. `epoch` grows with every
 * new pause so a response fetched before a pause is never applied after it (TOCTOU).
 */
export class SessionGate {
  readonly #session: SessionOwner;
  readonly #events: EventSink | undefined;
  #pause: PauseReason | undefined;
  #pausedOwner: string | null = null;
  #epoch = 0;
  #refreshing: Promise<RefreshResult> | undefined;
  readonly #listeners: PauseListener[] = [];
  #contact: ContactClock | undefined;

  constructor(session: SessionOwner, events?: EventSink) {
    this.#session = session;
    this.#events = events;
  }

  get paused(): PauseReason | undefined {
    return this.#pause;
  }

  get epoch(): number {
    return this.#epoch;
  }

  onPause(listener: PauseListener): void {
    this.#listeners.push(listener);
  }

  attachContact(contact: ContactClock): void {
    this.#contact = contact;
  }

  currentUserId(): Promise<string | null> {
    return this.#session.currentUserId();
  }

  emit(event: EngineEvent): void {
    try {
      this.#events?.emit(event);
    } catch {
      // diagnostics must never break synchronization
    }
  }

  pauseWith(reason: PauseReason, owner: string | null): 'stop' {
    if (this.#pause === 'device_wipe_required') return 'stop';
    if (this.#pause !== reason) {
      this.#pause = reason;
      this.#pausedOwner = owner;
      this.#epoch += 1;
      this.emit({ kind: 'paused', reason });
      if (
        reason === 'session_revoked' ||
        reason === 'device_wipe_required' ||
        reason === 'upgrade_required' ||
        reason === 'auth_required'
      ) {
        this.emit({ kind: 'signal', signal: reason });
      }
      for (const listener of this.#listeners) {
        try {
          listener(reason, owner);
        } catch {
          // a listener must not break the pause
        }
      }
    }
    return 'stop';
  }

  /** Resumes after a pause. `session_revoked` only for the same user after a full sign-in; `device_wipe_required` never. */
  async resume(): Promise<boolean> {
    const pause = this.#pause;
    if (pause === undefined) return true;
    if (pause === 'device_wipe_required') return false;
    if (pause === 'session_revoked') {
      const userId = await this.#session.currentUserId();
      if (userId === null) return false;
      if (userId !== this.#pausedOwner) {
        this.emit({ kind: 'signal', signal: 'owner_mismatch' });
        return false;
      }
    }
    this.#pause = undefined;
    return true;
  }

  /** One refresh for all callers: concurrent 401s wait for the same promise. */
  refresh(): Promise<RefreshResult> {
    this.#refreshing ??= this.#session
      .refresh()
      .catch((): RefreshResult => 'unavailable')
      .finally(() => {
        this.#refreshing = undefined;
      });
    return this.#refreshing;
  }

  /** 401, 426 and 403 are handled identically by push and pull; anything else is `other` (the caller decides). */
  async onHttpFailure(status: number, code: string | undefined, userId: string, canRefresh: boolean): Promise<GateVerdict> {
    if (status === 401) {
      if (code === 'device_wipe_required') return this.pauseWith('device_wipe_required', userId);
      if (code === 'session_revoked') return this.pauseWith('session_revoked', userId);
      if (!canRefresh) return this.pauseWith('auth_required', userId);
      const refreshed = await this.refresh();
      if (refreshed === 'session_revoked') return this.pauseWith('session_revoked', userId);
      if (refreshed === 'unavailable') return this.pauseWith('auth_required', userId);
      return 'retry';
    }
    if (status === 426) return this.pauseWith('upgrade_required', userId);
    if (status === 403) return this.pauseWith('forbidden', userId);
    return 'other';
  }

  /**
   * Records the contact after an authenticated 2xx response. Nothing is recorded while the gate is paused (e.g. after
   * `device_wipe_required`) or when the epoch changed while the request was in flight.
   */
  async recordContact(serverTime: number | undefined, epoch: number): Promise<void> {
    if (this.#contact === undefined || serverTime === undefined || this.#pause !== undefined || epoch !== this.#epoch) return;
    try {
      await this.#contact.record(serverTime);
    } catch {
      this.emit({ kind: 'pull_failed', code: 'contact_not_saved' });
    }
  }
}
