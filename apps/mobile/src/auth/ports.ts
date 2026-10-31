/**
 * Ports of the sign-in and the session of the phone (EVM-100). The screens see only the sign-in client (two steps) and the session
 * owner; the token store, the refresh and the sign-out on the server are known to the owner alone (decision 17, ADR-0020 option (a):
 * EVM-109 replaces the owner with a native one without touching the screens). Real adapters: `src/api/auth-client.ts` (contract EVM-090)
 * and the secure store (`src/secure-store`); tests use fakes that follow the order of errors of EVM-094.
 */
import type { Challenge, IssuedSession } from './opaque';

export type { UserRole } from './opaque';

/**
 * A failed call: `problem` = the server answered 4xx with a problem code (unknown or malformed codes are `unknown`); `unavailable` =
 * no usable answer (network, timeout, 5xx, a body that does not match the contract). Never a message, a body or a cause (SR-LOG-08).
 */
export type AuthFailure =
  | { readonly kind: 'problem'; readonly status: number; readonly code: string; readonly retryAfterMs?: number }
  | { readonly kind: 'unavailable' };

export type AuthOutcome<T> = { readonly kind: 'ok'; readonly value: T } | AuthFailure;

/** The two steps of the sign-in, the only part of the client the sign-in screen may use. */
export interface SignInClient {
  /** Step 1. The adapter adds the description of the phone and, when it exists, the proof of the installation. */
  login(credentials: { readonly email: string; readonly password: string }): Promise<AuthOutcome<Challenge>>;
  /** Step 2. */
  loginTotp(challenge: Challenge, code: string): Promise<AuthOutcome<IssuedSession>>;
}

/** The whole client; `refresh` and `logout` are for the session owner only. */
export interface AuthClient extends SignInClient {
  refresh(refreshToken: string): Promise<AuthOutcome<IssuedSession>>;
  /** `mobileLogout` with the access token as Bearer; `ok` = 204. */
  logout(accessToken: string): Promise<AuthOutcome<null>>;
}

/** Slots of the secure store the owner uses (Keystore, SR-MOB-03); the production store is `tokenStore` of `src/secure-store`. */
export type SessionSlot = 'refreshToken' | 'revocationToken' | 'sessionMeta';

export interface TokenStore {
  get(slot: SessionSlot): Promise<string | null>;
  set(slot: SessionSlot, value: string): Promise<void>;
  delete(slot: SessionSlot): Promise<void>;
}

/** Port to EVM-101: the server ordered a wipe of this phone (the wipe itself is not part of EVM-100). */
export interface WipeSignal {
  wipeRequired(): void;
}

/** Why a session ended; the device-state screen (M-02) shows the matching variant. */
export type SessionEndReason = 'session_revoked' | 'session_expired' | 'device_wipe_required' | 'signed_out';

export interface SessionEnded {
  readonly reason: SessionEndReason;
  /** Unsent items of the local queue, counted before the replica was removed (AC4: "Niewysłane elementy (N)"). */
  readonly unsentItems: number;
}

/** Wall clock and a clock that the user cannot set back within one process (sync-core `MonotonicClock`). */
export interface SessionClock {
  now(): number;
  monotonicNow(): number;
  bootId(): string;
}
