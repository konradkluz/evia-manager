/**
 * The owner of the session of the phone (EVM-100 AC1, AC4, AC5, AC7; decision 17 — ADR-0020 option (a), JavaScript until EVM-109
 * moves it to the native side behind the same surface). It is the ONLY place that knows the refresh token and the pending revocation;
 * the screens get the user, an access token, the sign-in steps and the sign-out. Rules (architect 1, 3, 4; security W1, W2, W11):
 * - one lock serialises the refresh, the commit of a sign-in, the sign-out, the revocation and the HTTP calls of the sign-in steps;
 *   one refresh at a time is shared by every caller (single-flight, also with `SessionGate` of sync-core);
 * - a rotated refresh token is stored BEFORE the new access token is used; the access token lives in memory only;
 * - after step 2 nothing is stored until the owner's store is unlocked: identity → refresh token → session record (commit marker);
 *   at start a session exists only with both the record and the refresh token, any partial state is removed;
 * - a sign-out stores the refresh token as a pending revocation first, ends the session locally, then asks the server; the pending
 *   token only ever goes `refresh → logout` (the rotated token is stored before the logout) and never becomes a session.
 */
import type { RefreshResult, SessionOwner } from '@evia/sync-core';
import type { OpenResult, UnlockedStore } from '../storage';
import { revealSession, type IssuedSession, type SessionData } from './opaque';
import type { AuthClient, AuthFailure, SessionClock, SessionEnded, SessionEndReason, SignInClient, TokenStore, WipeSignal } from './ports';
import { checkpoint, parseSessionMeta, sessionEndVariant, type SessionMeta } from './session-meta';

export type DeviceCheck = Exclude<OpenResult, { readonly kind: 'unlocked' }>;

/** Result of a sign-in commit or of the start: the device check of EVM-101/EVM-107 receives every result but `unlocked`. */
export type SessionStep =
  | { readonly kind: 'signed_in' }
  | { readonly kind: 'signed_out' }
  /** Storing the session failed: nothing usable is left, the sign-in shows the generic error. */
  | { readonly kind: 'failed' }
  | { readonly kind: 'device_check'; readonly result: DeviceCheck };

export interface SessionOwnerDeps {
  readonly client: AuthClient;
  readonly tokens: TokenStore;
  readonly host: { openForUser(userId: string): Promise<OpenResult> };
  readonly wipe: WipeSignal;
  readonly clock: SessionClock;
  /** For `authorizedFetch`; the default is the global fetch. */
  readonly fetch?: (request: Request) => Promise<Response>;
}

/** An access token is renewed this long before its end (clock skew, a request on the way). */
export const ACCESS_SKEW_MS = 30_000;
/** At most this many pending revocations are kept (a fifth one drops the oldest; the server ends it after 14 idle days anyway). */
export const MAX_PENDING_REVOCATIONS = 4;

const isAuthEnd = (failure: AuthFailure): boolean => failure.kind === 'problem' && (failure.status === 401 || failure.status === 403);

export class MobileSessionOwner implements SessionOwner {
  readonly #deps: SessionOwnerDeps;
  #tail: Promise<unknown> = Promise.resolve();
  #refreshing: Promise<RefreshResult> | undefined;
  #userId: string | null = null;
  #displayName = '';
  #store: UnlockedStore | null = null;
  #meta: SessionMeta | null = null;
  #access: { readonly token: string; readonly until: number } | null = null;
  /** A session of step 2 held in memory while the device check of EVM-101/EVM-107 runs (nothing of it is stored yet). */
  #pending: SessionData | null = null;
  readonly #listeners = new Set<(ended: SessionEnded) => void>();

  constructor(deps: SessionOwnerDeps) {
    this.#deps = deps;
  }

  #exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(task);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  /** Listens to the end of a session (M-02 variants); returns the unsubscribe. */
  onSessionEnded(listener: (ended: SessionEnded) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit(ended: SessionEnded): void {
    for (const listener of this.#listeners) {
      try {
        listener(ended);
      } catch {
        // a screen must not break the end of a session
      }
    }
  }

  currentUserId(): Promise<string | null> {
    return Promise.resolve(this.#userId);
  }

  /** Display name of the signed-in user (M-09); never persisted elsewhere. */
  displayName(): string | null {
    return this.#userId === null ? null : this.#displayName;
  }

  /** Unsent items of the signed-in user's queue (the sign-out warning, AC7); 0 without a session. */
  async unsentItemCount(): Promise<number> {
    return (await this.#store?.unsentItemCount().catch(() => 0)) ?? 0;
  }

  /** The two sign-in steps, serialised with the refresh and the revocation (security W1d). */
  signInClient(): SignInClient {
    return {
      login: (credentials) => this.#exclusive(() => this.#deps.client.login(credentials)),
      loginTotp: (challenge, code) => this.#exclusive(() => this.#deps.client.loginTotp(challenge, code)),
    };
  }

  /**
   * Start of the app (AC6: no request here — a signed-in user works offline at once). Removes partial states and finishes a sign-out
   * that was interrupted between storing the pending revocation and ending the session.
   */
  restore(): Promise<SessionStep> {
    return this.#exclusive(async () => {
      const { tokens } = this.#deps;
      const [metaText, refreshToken, pending] = await Promise.all([
        tokens.get('sessionMeta').catch(() => null),
        tokens.get('refreshToken').catch(() => null),
        this.#readPending(),
      ]);
      const meta = parseSessionMeta(metaText);
      if (refreshToken !== null && pending.includes(refreshToken)) {
        // the user confirmed the sign-out before the process died: finish it, the token stays pending
        if (meta !== null) {
          const opened = await this.#deps.host.openForUser(meta.userId).catch(() => null);
          if (opened?.kind === 'unlocked') await opened.store.endSession().catch(() => undefined);
        }
        await this.#clearSession();
        return { kind: 'signed_out' };
      }
      if (meta === null || refreshToken === null) {
        await this.#clearSession();
        return { kind: 'signed_out' };
      }
      const opened = await this.#deps.host.openForUser(meta.userId).catch((): OpenResult => ({ kind: 'unavailable', code: 'closed' }));
      if (opened.kind !== 'unlocked') return { kind: 'device_check', result: opened };
      this.#adopt(opened.store, meta);
      return { kind: 'signed_in' };
    });
  }

  /**
   * After step 2 (AC1): stores the session only when the store of this user is unlocked. Every other result goes to the device check
   * with the session in memory only (the old installation secret keeps working on the server, two-phase rotation).
   */
  completeSignIn(session: IssuedSession): Promise<SessionStep> {
    return this.#exclusive(async () => {
      const data = revealSession(session);
      if (data === null) return { kind: 'failed' };
      const opened = await this.#deps.host.openForUser(data.user.id).catch((): OpenResult => ({ kind: 'unavailable', code: 'closed' }));
      if (opened.kind !== 'unlocked') {
        this.#pending = data;
        return { kind: 'device_check', result: opened };
      }
      return this.#commit(opened.store, data);
    });
  }

  /**
   * The device check went on (e.g. "Rozumiem" after `data_lost` opened a new database): the session held in memory is stored into
   * that store; after a start (`restore`) the stored session is adopted.
   */
  continueDeviceCheck(result: OpenResult): Promise<SessionStep> {
    return this.#exclusive(async () => {
      const data = this.#pending;
      if (result.kind !== 'unlocked') return { kind: 'device_check', result };
      if (data !== null) {
        this.#pending = null;
        if (result.store.userId !== data.user.id) {
          await this.#discard(data);
          return { kind: 'failed' };
        }
        return this.#commit(result.store, data);
      }
      const meta = parseSessionMeta(await this.#deps.tokens.get('sessionMeta').catch(() => null));
      const refreshToken = await this.#deps.tokens.get('refreshToken').catch(() => null);
      if (meta === null || refreshToken === null || meta.userId !== result.store.userId) {
        result.store.lock();
        return { kind: 'signed_out' };
      }
      this.#adopt(result.store, meta);
      return { kind: 'signed_in' };
    });
  }

  /**
   * The device check was cancelled: the session of step 2 is dropped from memory (nothing was stored) and ended on the server, so it
   * neither stays valid for 14 idle days nor counts towards the device limit of the user (code review, RR-72). Never rejects.
   */
  abandonSignIn(): Promise<void> {
    return this.#exclusive(async () => {
      const data = this.#pending;
      this.#pending = null;
      if (data !== null) await this.#discard(data);
    });
  }

  /**
   * Ends a session of step 2 that is not kept (abandoned, refused or not stored): a best-effort logout with its access token; when the
   * server cannot be asked (network, 5xx, 429, 426) its refresh token becomes a pending revocation, sent at the next connection.
   * Runs inside the lock of the caller.
   */
  async #discard(data: SessionData): Promise<void> {
    const outcome = await this.#deps.client.logout(data.accessToken).catch((): AuthFailure => ({ kind: 'unavailable' }));
    if (outcome.kind === 'ok' || isAuthEnd(outcome)) return;
    await this.#writePending([...(await this.#readPending()), data.refreshToken]).catch(() => undefined);
  }

  async #commit(store: UnlockedStore, data: SessionData): Promise<SessionStep> {
    const { tokens, clock } = this.#deps;
    const previous = await store.identity.read().catch(() => null);
    try {
      if (data.installationSecret !== undefined) await store.identity.write({ deviceId: data.deviceId, secret: data.installationSecret });
    } catch {
      // the old secret stays valid on the server (RR-69): the sign-in fails, nothing else is stored, the new session is ended
      store.lock();
      await this.#discard(data);
      return { kind: 'failed' };
    }
    const mark = checkpoint(data.serverTime, clock);
    const meta: SessionMeta = {
      v: 1,
      userId: data.user.id,
      displayName: data.user.displayName,
      role: data.user.role,
      started: mark,
      lastContact: mark,
    };
    try {
      await tokens.set('refreshToken', data.refreshToken);
      await tokens.set('sessionMeta', JSON.stringify(meta));
    } catch {
      await tokens.delete('refreshToken').catch(() => undefined);
      store.lock();
      await this.#discard(data);
      return { kind: 'failed' };
    }
    // the same installation was recognised: the server already ended its earlier sessions ('rotated') — a pending revocation of
    // them is dropped WITHOUT a request (a refresh of it now could look like reuse and end the new session; security W1d)
    if (previous !== null && previous.deviceId === data.deviceId) await tokens.delete('revocationToken').catch(() => undefined);
    this.#adopt(store, meta);
    this.#access = { token: data.accessToken, until: clock.now() + data.accessTokenTtlMs };
    return { kind: 'signed_in' };
  }

  #adopt(store: UnlockedStore, meta: SessionMeta): void {
    this.#store = store;
    this.#meta = meta;
    this.#userId = meta.userId;
    this.#displayName = meta.displayName;
    this.#access = null;
  }

  /** A valid access token (renewed through the shared refresh when needed), or `null` without a session. */
  async accessToken(): Promise<string | null> {
    const access = this.#access;
    if (access !== null && this.#deps.clock.now() < access.until - ACCESS_SKEW_MS) return access.token;
    if (this.#userId === null) return null;
    return (await this.refresh()) === 'refreshed' ? (this.#access?.token ?? null) : null;
  }

  /** One refresh for every caller (AC5). */
  refresh(): Promise<RefreshResult> {
    this.#refreshing ??= this.#exclusive(() => this.#refresh())
      .catch((): RefreshResult => 'unavailable')
      .finally(() => {
        this.#refreshing = undefined;
      });
    return this.#refreshing;
  }

  async #refresh(): Promise<RefreshResult> {
    const { tokens, client, clock } = this.#deps;
    if (this.#userId === null) return 'session_revoked';
    let refreshToken: string | null;
    try {
      refreshToken = await tokens.get('refreshToken');
    } catch {
      return 'unavailable';
    }
    if (refreshToken === null) {
      await this.#end('session_revoked');
      return 'session_revoked';
    }
    const outcome = await client.refresh(refreshToken);
    if (outcome.kind === 'ok') {
      const data = revealSession(outcome.value);
      if (data === null) return 'unavailable';
      try {
        await tokens.set('refreshToken', data.refreshToken);
      } catch {
        // not stored = not used (security W2): the next request tries again
        return 'unavailable';
      }
      const meta = this.#meta;
      if (meta !== null) {
        const next: SessionMeta = { ...meta, lastContact: checkpoint(data.serverTime, clock) };
        if (
          await tokens.set('sessionMeta', JSON.stringify(next)).then(
            () => true,
            () => false,
          )
        )
          this.#meta = next;
      }
      this.#access = { token: data.accessToken, until: clock.now() + data.accessTokenTtlMs };
      return 'refreshed';
    }
    if (outcome.kind === 'problem' && outcome.status === 401) {
      if (outcome.code === 'device_wipe_required') {
        await this.#endWipe();
        return 'device_wipe_required';
      }
      await this.#end(sessionEndVariant(this.#meta, clock));
      return 'session_revoked';
    }
    // network, 5xx, 429, 426, 403: nothing ends, the next request retries (AC5)
    return 'unavailable';
  }

  /** `session_revoked` / expiry (AC4): N is read first, then the replica and the refresh token go; the queue stays encrypted. */
  async #end(reason: Extract<SessionEndReason, 'session_revoked' | 'session_expired'>): Promise<void> {
    const store = this.#store;
    const unsentItems = store === null ? 0 : await store.unsentItemCount().catch(() => 0);
    if (store !== null) await store.endSession().catch(() => undefined);
    await this.#clearSession();
    this.#emit({ reason, unsentItems });
  }

  /** `device_wipe_required` (AC4): tokens and record go, the data become unreachable, the wipe is signalled to EVM-101. */
  async #endWipe(): Promise<void> {
    this.#store?.lock();
    await this.#clearSession();
    this.#deps.wipe.wipeRequired();
    this.#emit({ reason: 'device_wipe_required', unsentItems: 0 });
  }

  async #clearSession(): Promise<void> {
    this.#store = null;
    this.#meta = null;
    this.#userId = null;
    this.#displayName = '';
    this.#access = null;
    await this.#deps.tokens.delete('refreshToken').catch(() => undefined);
    await this.#deps.tokens.delete('sessionMeta').catch(() => undefined);
  }

  /**
   * "Wyloguj" (AC7). Waits for a running refresh (the same lock), stores the refresh token as a pending revocation, ends the session on
   * the phone (replica and tokens removed, queue and identity stay encrypted) and — online — ends it on the server.
   */
  signOut({ online }: { readonly online: boolean }): Promise<SessionEnded> {
    return this.#exclusive(async () => {
      const { tokens, clock } = this.#deps;
      const refreshToken = await tokens.get('refreshToken').catch(() => null);
      if (refreshToken !== null) await this.#writePending([...(await this.#readPending()), refreshToken]).catch(() => undefined);
      const access = this.#access !== null && clock.now() < this.#access.until - ACCESS_SKEW_MS ? this.#access.token : null;
      const store = this.#store;
      const unsentItems = store === null ? 0 : await store.unsentItemCount().catch(() => 0);
      if (store !== null) await store.endSession().catch(() => undefined);
      await this.#clearSession();
      const ended: SessionEnded = { reason: 'signed_out', unsentItems };
      this.#emit(ended);
      if (online && refreshToken !== null) {
        if (access === null) {
          await this.#flush();
        } else {
          const outcome = await this.#deps.client.logout(access);
          if (outcome.kind === 'ok' || isAuthEnd(outcome)) await this.#removePending(refreshToken);
        }
      }
      return ended;
    });
  }

  /** Sends the pending revocations (after a sign-in, at start and whenever the network returns); never during a sign-in commit. */
  flushPendingRevocation(): Promise<void> {
    return this.#exclusive(() => (this.#pending === null ? this.#flush() : Promise.resolve()));
  }

  async #flush(): Promise<void> {
    const { client } = this.#deps;
    for (const token of await this.#readPending()) {
      const refreshed = await client.refresh(token);
      if (refreshed.kind !== 'ok') {
        if (isAuthEnd(refreshed)) {
          await this.#removePending(token);
          continue;
        }
        return; // no network (or 429/5xx/426): everything stays for the next connection
      }
      const data = revealSession(refreshed.value);
      if (data === null) return;
      // the rotated token replaces the used one BEFORE the logout: a retry later never reuses a spent token (SR-SESS-09)
      await this.#replacePending(token, data.refreshToken).catch(() => undefined);
      const outcome = await client.logout(data.accessToken);
      if (outcome.kind === 'ok' || isAuthEnd(outcome)) await this.#removePending(data.refreshToken);
      else return;
    }
  }

  async #readPending(): Promise<string[]> {
    const text = await this.#deps.tokens.get('revocationToken').catch(() => null);
    if (text === null) return [];
    try {
      const value: unknown = JSON.parse(text);
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
    } catch {
      return [];
    }
  }

  async #writePending(list: readonly string[]): Promise<void> {
    const kept = [...new Set(list)].slice(-MAX_PENDING_REVOCATIONS);
    if (kept.length === 0) await this.#deps.tokens.delete('revocationToken');
    else await this.#deps.tokens.set('revocationToken', JSON.stringify(kept));
  }

  async #replacePending(used: string, next: string): Promise<void> {
    await this.#writePending((await this.#readPending()).map((item) => (item === used ? next : item)));
  }

  async #removePending(token: string): Promise<void> {
    await this.#writePending((await this.#readPending()).filter((item) => item !== token)).catch(() => undefined);
  }

  /**
   * `fetch` with the access token for the calls of the app (AC5): a plain `401` refreshes once (shared) and retries once;
   * `401 session_revoked` / `device_wipe_required` end the session. `null` without a session (nothing is sent).
   */
  async authorizedFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
    const send = (accessToken: string): Promise<Response> => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      const fetchImpl = this.#deps.fetch ?? ((request: Request) => fetch(request));
      return fetchImpl(new Request(url, { ...init, headers }));
    };
    const first = await this.accessToken();
    if (first === null) return null;
    const response = await send(first);
    if (response.status !== 401) return response;
    const code = await response
      .clone()
      .json()
      .then((body: unknown) => (typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined))
      .catch(() => undefined);
    if (code === 'device_wipe_required') {
      await this.#exclusive(() => (this.#userId === null ? Promise.resolve() : this.#endWipe()));
      return response;
    }
    if (code === 'session_revoked') {
      await this.#exclusive(() => (this.#userId === null ? Promise.resolve() : this.#end('session_revoked')));
      return response;
    }
    if ((await this.refresh()) !== 'refreshed') return response;
    const second = this.#access?.token;
    return second === undefined ? response : send(second);
  }
}

/** What the composition and the screens use of the owner (never the token store). */
export type SessionControl = Pick<
  MobileSessionOwner,
  | 'restore'
  | 'completeSignIn'
  | 'continueDeviceCheck'
  | 'abandonSignIn'
  | 'signOut'
  | 'flushPendingRevocation'
  | 'onSessionEnded'
  | 'displayName'
  | 'refresh'
  | 'signInClient'
  | 'unsentItemCount'
>;
