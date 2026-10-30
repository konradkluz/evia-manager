/**
 * The sign-in of M-01 as a small state machine without React (EVM-100 AC1–AC3; UX 01 M-01 and 16 "Uzupełnienia M-01"). It knows the
 * two sign-in steps only (no token store, no refresh, no logout — architect 4). Secrets (security W2, W5):
 * - the challenge token lives in a private field, never in the state; it is dropped on "Zmień konto", on a failed step 2 that ends
 *   the challenge, when its deadline passed and on `dispose`;
 * - the password and the code are in the state only while typed; they are cleared once the server gave a verdict (kept only after a
 *   network error or `429`, so the technician does not type them again — UX § 3.2.1 "po błędzie sieci kod zostaje");
 * - one request at a time (a double tap sends one request, W8).
 */
import type { Challenge, IssuedSession } from './opaque';
import type { AuthOutcome, SignInClient, WipeSignal } from './ports';

/** Blocking states before a session (AC3) and the wipe order met at sign-in (AC4). */
export type BlockedVariant =
  | 'channel_not_allowed'
  | 'totp_not_configured'
  | 'mfa_enrollment_required'
  | 'device_limit_reached'
  | 'client_version_unsupported'
  | 'device_wipe_required';

export type LoginError = 'invalid_credentials' | 'invalid_code' | 'unavailable' | 'challenge_expired';

export interface LoginState {
  readonly step: 'credentials' | 'code';
  readonly email: string;
  readonly password: string;
  readonly code: string;
  readonly busy: boolean;
  readonly error: LoginError | null;
  /** Wall time until which the sign-in is locked by `429` (AC2), or `null`. */
  readonly lockedUntil: number | null;
  readonly blocked: BlockedVariant | null;
  /** Step 2 succeeded and the session was handed to the owner. */
  readonly done: boolean;
}

export interface LoginDeps {
  readonly signIn: SignInClient;
  /** Hands the session of step 2 to the owner and the device check; `failed` = nothing usable was stored. */
  readonly onSession: (session: IssuedSession) => Promise<'done' | 'failed'>;
  readonly wipe: WipeSignal;
  readonly now: () => number;
}

const BLOCKING_403: readonly BlockedVariant[] = [
  'channel_not_allowed',
  'totp_not_configured',
  'mfa_enrollment_required',
  'device_limit_reached',
];

export const INITIAL_LOGIN: LoginState = {
  step: 'credentials',
  email: '',
  password: '',
  code: '',
  busy: false,
  error: null,
  lockedUntil: null,
  blocked: null,
  done: false,
};

/** Spaces of a pasted or typed code are ignored; anything that is not 6 digits after that is refused (no echo of the value). */
export function normalizeCode(input: string): string | null {
  const compact = input.replace(/\s+/g, '');
  return /^\d{0,6}$/.test(compact) ? compact : null;
}

/** Whole minutes left of a `429` lock, rounded up (AC2: "Spróbuj ponownie za 4 min."); 0 = not locked. */
export function lockMinutes(state: LoginState, now: number): number {
  return state.lockedUntil === null || state.lockedUntil <= now ? 0 : Math.ceil((state.lockedUntil - now) / 60_000);
}

export class LoginMachine {
  readonly #deps: LoginDeps;
  #state: LoginState = INITIAL_LOGIN;
  #challenge: Challenge | null = null;
  readonly #listeners = new Set<() => void>();

  constructor(deps: LoginDeps) {
    this.#deps = deps;
  }

  get state(): LoginState {
    return this.#state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getState = (): LoginState => this.#state;

  #set(patch: Partial<LoginState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  setEmail(email: string): void {
    this.#set({ email, error: null });
  }

  setPassword(password: string): void {
    this.#set({ password, error: null });
  }

  setCode(input: string): void {
    const code = normalizeCode(input);
    if (code !== null) this.#set({ code, error: null });
  }

  /** The `429` lock is over (the screen's minute timer calls this). */
  tick(): void {
    if (this.#state.lockedUntil !== null && this.#state.lockedUntil <= this.#deps.now()) this.#set({ lockedUntil: null });
  }

  canSubmit(online: boolean): boolean {
    const s = this.#state;
    if (!online || s.busy || lockMinutes(s, this.#deps.now()) > 0) return false;
    return s.step === 'credentials' ? s.email.trim() !== '' && s.password !== '' : s.code.length === 6;
  }

  async submitCredentials(online: boolean): Promise<void> {
    if (this.#state.step !== 'credentials' || !this.canSubmit(online)) return;
    const { email, password } = this.#state;
    this.#set({ busy: true, error: null });
    const outcome = await this.#deps.signIn.login({ email: email.trim(), password });
    if (outcome.kind === 'ok') {
      this.#challenge = outcome.value;
      this.#set({ busy: false, step: 'code', password: '', code: '' });
      return;
    }
    this.#fail(outcome, 'credentials');
  }

  async submitCode(online: boolean): Promise<void> {
    if (this.#state.step !== 'code' || !this.canSubmit(online)) return;
    const challenge = this.#challenge;
    if (challenge === null || challenge.expiresAt <= this.#deps.now()) {
      this.#expire();
      return;
    }
    const { code } = this.#state;
    this.#set({ busy: true, error: null });
    const outcome = await this.#deps.signIn.loginTotp(challenge, code);
    if (outcome.kind === 'ok') {
      this.#challenge = null;
      this.#set({ code: '' });
      const handed = await this.#deps.onSession(outcome.value).catch(() => 'failed' as const);
      if (handed === 'done') this.#set({ busy: false, done: true });
      else this.#set({ ...INITIAL_LOGIN, email: this.#state.email, error: 'unavailable' });
      return;
    }
    this.#fail(outcome, 'code');
  }

  #fail(outcome: Exclude<AuthOutcome<unknown>, { kind: 'ok' }>, step: 'credentials' | 'code'): void {
    if (outcome.kind === 'unavailable') {
      this.#set({ busy: false, error: 'unavailable' });
      return;
    }
    const { status, code } = outcome;
    if (status === 429) {
      this.#set({ busy: false, lockedUntil: this.#deps.now() + (outcome.retryAfterMs ?? 0) });
      return;
    }
    const blocked: BlockedVariant | null =
      status === 426
        ? 'client_version_unsupported'
        : status === 401 && code === 'device_wipe_required'
          ? 'device_wipe_required'
          : status === 403
            ? (BLOCKING_403.find((variant) => variant === code) ?? null)
            : null;
    if (blocked !== null) {
      this.#challenge = null;
      if (blocked === 'device_wipe_required') this.#deps.wipe.wipeRequired();
      this.#set({ ...INITIAL_LOGIN, email: this.#state.email, blocked });
      return;
    }
    if (status === 401 && code === 'invalid_credentials') {
      // step 1: one message for every wrong e-mail or password (no state of the account, W7); step 2: a wrong or expired code
      if (step === 'credentials') this.#set({ busy: false, password: '', error: 'invalid_credentials' });
      else this.#set({ busy: false, code: '', error: 'invalid_code' });
      return;
    }
    // an unknown or unexpected code gets the generic message, never a new variant (W7)
    this.#set({ busy: false, error: 'unavailable' });
  }

  #expire(): void {
    this.#challenge = null;
    this.#set({ ...INITIAL_LOGIN, email: this.#state.email, error: 'challenge_expired' });
  }

  /** Back in the foreground (or any time): a challenge past its deadline is dropped and step 1 returns. */
  checkChallenge(): void {
    const challenge = this.#challenge;
    if (this.#state.step === 'code' && (challenge === null || challenge.expiresAt <= this.#deps.now())) this.#expire();
  }

  /** "Zmień konto" (UX 16): back to the e-mail, which stays; password, code and challenge are cleared. */
  changeAccount(): void {
    this.#challenge = null;
    this.#set({ ...INITIAL_LOGIN, email: this.#state.email, lockedUntil: this.#state.lockedUntil });
  }

  /** From a blocking variant back to M-01 ("Wróć do logowania"); the e-mail stays. */
  backToSignIn(): void {
    this.#challenge = null;
    this.#set({ ...INITIAL_LOGIN, email: this.#state.email });
  }

  /** The screen is left: nothing of the form survives. */
  dispose(): void {
    this.#challenge = null;
    this.#state = INITIAL_LOGIN;
    this.#listeners.clear();
  }
}
