/**
 * "Wyczyść dane firmowe" and the server-ordered wipe (EVM-101 AC4, AC5; SR-MOB-04, SR-MOB-13). Orchestration only: the steps of the
 * wipe are the EVM-093 AC6 ones of the local store (`LocalDataHost.wipeCompanyData`); this class decides WHEN they run and keeps the
 * confirmation promise to the server:
 * - the manual wipe asks nothing of the server (AC4 wants a confirmation for `device_wipe_required` only);
 * - `device_wipe_required` wipes at once, without a question, and the pair `deviceId` + secret that `confirmDeviceWipe` needs is kept
 *   by the store in its own slot (architect 1). It travels here as an opaque `InstallationProof` — this module never reads it;
 * - the confirmation is sent after the data are gone and repeated at every start and every return to the foreground, with or
 *   without a session, until the server answers `204` or `401 invalid_credentials` (both delete the slot); `429` waits `Retry-After`;
 * - the confirmation does not check the version of the app (`426` does not apply to it).
 */
import type { WipeSignal } from '../auth/ports';
import type { InstallationProof } from '../storage';

export type WipeConfirmOutcome =
  | { readonly kind: 'confirmed' }
  /** `401 invalid_credentials`: the server does not know the pair (any more); nothing to confirm. */
  | { readonly kind: 'rejected' }
  | { readonly kind: 'rate_limited'; readonly retryAfterMs: number }
  /** Network, timeout, 5xx or anything else: tried again at the next start or return. */
  | { readonly kind: 'unavailable' };

/** `confirmDeviceWipe` (HTTP adapter `src/api/auth-client.ts`). */
export interface WipeConfirmClient {
  confirmWipe(proof: InstallationProof): Promise<WipeConfirmOutcome>;
}

/** What the wipe needs of the local store. */
export interface WipeHost {
  unsentItemCount(): Promise<number>;
  wipeCompanyData(options?: { readonly confirmToServer?: boolean }): Promise<'done' | 'incomplete'>;
  /** Finishes an interrupted wipe (marker present). */
  prepare(): Promise<'ready' | 'wipe_incomplete'>;
  pendingWipeConfirmation(): Promise<InstallationProof | null>;
  clearWipeConfirmation(): Promise<void>;
}

export type WipePhase = 'idle' | 'wiping' | 'incomplete';

export interface WipeDiagnostics {
  (event: { readonly event: 'wipe-confirmation'; readonly outcome: 'sent' | 'rejected' | 'retry' }): void;
}

/** Runs a call of the host so that even a synchronous throw becomes a rejection the callers handle. */
const attempt = <T>(task: () => Promise<T>): Promise<T> => Promise.resolve().then(task);

export class CompanyDataWipe implements WipeSignal {
  readonly #host: WipeHost;
  readonly #client: WipeConfirmClient;
  readonly #now: () => number;
  readonly #diagnostics: WipeDiagnostics | undefined;
  readonly #listeners = new Set<(phase: WipePhase) => void>();
  #phase: WipePhase = 'idle';
  #tail: Promise<unknown> = Promise.resolve();
  #notBefore = 0;

  constructor(deps: { host: WipeHost; client: WipeConfirmClient; now: () => number; diagnostics?: WipeDiagnostics }) {
    this.#host = deps.host;
    this.#client = deps.client;
    this.#now = deps.now;
    this.#diagnostics = deps.diagnostics;
  }

  get phase(): WipePhase {
    return this.#phase;
  }

  /** The phase of the wipe: the app is in the hidden-data mode while it is not `idle` (AC4). Returns the unsubscribe. */
  onPhase(listener: (phase: WipePhase) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #setPhase(phase: WipePhase): void {
    if (phase === this.#phase) return;
    this.#phase = phase;
    for (const listener of this.#listeners) listener(phase);
  }

  #exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(task);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  /** Unsent items for the dialog (a number only); `0` when it cannot be read. Called when the dialog opens, not before. */
  async unsentItemCount(): Promise<number> {
    return attempt(() => this.#host.unsentItemCount()).catch(() => 0);
  }

  /** The signal of the session owner and of the sign-in: the server ordered the wipe. No question, no way to cancel. */
  wipeRequired(): void {
    void this.runRequired();
  }

  /** `device_wipe_required`: wipe, then confirm to the server (now when possible, otherwise at the next start or return). */
  runRequired(): Promise<'done' | 'incomplete'> {
    return this.#exclusive(async () => {
      const result = await this.#wipe(true);
      if (result === 'done') await this.#confirm();
      return result;
    });
  }

  /** The user confirmed "Wyczyść dane firmowe" (or "Usuń i zaloguj" of AC5): no confirmation is owed to the server. */
  runManual(): Promise<'done' | 'incomplete'> {
    return this.#exclusive(() => this.#wipe(false));
  }

  async #wipe(confirmToServer: boolean): Promise<'done' | 'incomplete'> {
    this.#setPhase('wiping');
    const result = await attempt(() => this.#host.wipeCompanyData({ confirmToServer })).catch((): 'incomplete' => 'incomplete');
    this.#setPhase(result === 'done' ? 'idle' : 'incomplete');
    return result;
  }

  /** Start of the app and return to the foreground (with or without a session): finish a wipe, send the owed confirmation. */
  resume(): Promise<void> {
    return this.#exclusive(async () => {
      const prepared = await attempt(() => this.#host.prepare()).catch((): 'wipe_incomplete' => 'wipe_incomplete');
      if (prepared === 'wipe_incomplete') {
        this.#setPhase('incomplete');
        return;
      }
      this.#setPhase('idle');
      await this.#confirm();
    });
  }

  async #confirm(): Promise<void> {
    if (this.#now() < this.#notBefore) return;
    const proof = await attempt(() => this.#host.pendingWipeConfirmation()).catch(() => null);
    if (proof === null) return;
    const outcome = await attempt(() => this.#client.confirmWipe(proof)).catch((): WipeConfirmOutcome => ({ kind: 'unavailable' }));
    if (outcome.kind === 'confirmed' || outcome.kind === 'rejected') {
      await attempt(() => this.#host.clearWipeConfirmation()).catch(() => undefined);
      this.#notBefore = 0;
      this.#diagnostics?.({ event: 'wipe-confirmation', outcome: outcome.kind === 'confirmed' ? 'sent' : 'rejected' });
      return;
    }
    if (outcome.kind === 'rate_limited') this.#notBefore = this.#now() + Math.max(0, outcome.retryAfterMs);
    this.#diagnostics?.({ event: 'wipe-confirmation', outcome: 'retry' });
  }
}
