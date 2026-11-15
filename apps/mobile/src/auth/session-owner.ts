/**
 * The session of the phone as the app sees it (EVM-100 AC1, AC4, AC5, AC7; EVM-130 AC2, AC3; decision 17 — ADR-0020a). A THIN ADAPTER
 * over the native owner of the tokens (module `EviaUpload`): the refresh token goes to the native method once, at the sign-in, and is
 * kept nowhere in JavaScript — no state, no log, no error with its content; only the access token comes back and lives in memory.
 * The refresh (single-flight, a rotated token stored before it is used), the sign-out with its pending revocations and the end of a
 * session abandoned in step 2 are native; JavaScript asks for a valid access token and reacts to the state the module reports.
 * What stays here (the story EVM-100): the identity of the installation, the session record (user, name, role, clock checkpoints), the
 * device check, the 7-day contact rule and the screens' end-of-session events.
 * - one lock serialises the sign-in commit, the sign-out, the end of a session and the HTTP calls of the sign-in steps;
 * - after step 2 the tokens are STAGED natively (memory only) and committed only when the store of this user is unlocked: identity →
 *   native commit → session record (commit marker); at start a session exists only when the record and the native session both exist.
 */
import { ContactClock, parseClientConfig, parseContactRecord } from '@evia/sync-core';
import type { ContactStatus, RefreshResult, SessionOwner } from '@evia/sync-core';
import type { SessionStateName } from '../../modules/evia-upload/src';
import type { OpenResult, UnlockedStore } from '../storage';
import { takeSession, type IssuedSession, type SessionData } from './opaque';
import type {
  NativeSession,
  QueueEntryRow,
  SessionClock,
  SessionEnded,
  SessionEndReason,
  SignInClient,
  TokenStore,
  WipeSignal,
} from './ports';
import { checkpoint, contactAt, parseSessionMeta, sessionEndVariant, type SessionMeta } from './session-meta';

export type DeviceCheck = Exclude<OpenResult, { readonly kind: 'unlocked' }>;

/** Result of a sign-in commit or of the start: the device check of EVM-101/EVM-107 receives every result but `unlocked`. */
export type SessionStep =
  | { readonly kind: 'signed_in' }
  | { readonly kind: 'signed_out' }
  /** Storing the session failed: nothing usable is left, the sign-in shows the generic error. */
  | { readonly kind: 'failed' }
  | { readonly kind: 'device_check'; readonly result: DeviceCheck };

export interface SessionOwnerDeps {
  /** The two sign-in steps only; the refresh and the logout are native. */
  readonly client: SignInClient;
  /** The session record (the only slot). */
  readonly tokens: TokenStore;
  /** The native owner of the tokens (`nativeSessionOf(loadEviaUpload())`). */
  readonly native: NativeSession;
  readonly host: { openForUser(userId: string): Promise<OpenResult> };
  readonly wipe: WipeSignal;
  readonly clock: SessionClock;
  /** Clock of the 7-day rule (boot clock, EVM-101 AC2); `clock` when absent. */
  readonly contactClock?: SessionClock;
  /** For `authorizedFetch`; the default is the global fetch. */
  readonly fetch?: (request: Request) => Promise<Response>;
}

/** An access token is renewed this long before its end (clock skew, a request on the way). */
export const ACCESS_SKEW_MS = 30_000;

/** What a sign-in leaves in JavaScript: no token of any kind. */
interface LoginFacts {
  readonly deviceId: string;
  readonly installationSecret: string | undefined;
  readonly serverTime: number;
  readonly user: SessionData['user'];
}

const sane = (value: number): boolean => Number.isFinite(value) && value >= 0;

export class MobileSessionOwner implements SessionOwner {
  readonly #deps: SessionOwnerDeps;
  #tail: Promise<unknown> = Promise.resolve();
  #refreshing: Promise<RefreshResult> | undefined;
  #userId: string | null = null;
  #displayName = '';
  #store: UnlockedStore | null = null;
  #meta: SessionMeta | null = null;
  #access: { readonly token: string; readonly until: number } | null = null;
  /** A session of step 2 staged natively while the device check of EVM-101/EVM-107 runs; JavaScript keeps its facts, never a token. */
  #pending: LoginFacts | null = null;
  readonly #listeners = new Set<(ended: SessionEnded) => void>();
  readonly #beforeEnd = new Set<() => void>();
  readonly #updateListeners = new Set<() => void>();

  constructor(deps: SessionOwnerDeps) {
    this.#deps = deps;
    // the module tells about a session that stopped working (the job met 401 / 426 / a wipe order while the app was alive)
    deps.native.addListener('onSessionState', ({ state }) => {
      this.#exclusive(() => this.#blocked(state)).catch(() => undefined);
    });
  }

  #exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(task);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  /** A call of the native module that never throws: a failure is the fallback value (the module answers codes, never texts). */
  async #call<T>(task: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await task();
    } catch {
      return fallback;
    }
  }

  /** Listens to the end of a session (M-02 variants); returns the unsubscribe. */
  onSessionEnded(listener: (ended: SessionEnded) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** The module paused the upload and the session on `426` (`paused_update`): the screen of the update (nothing is removed). */
  onUpdateRequired(listener: () => void): () => void {
    this.#updateListeners.add(listener);
    return () => {
      this.#updateListeners.delete(listener);
    };
  }

  /**
   * Called synchronously BEFORE the replica is removed or the store is locked (sign-out, session_revoked, wipe): the synchronization
   * service stops, so that no answer in flight writes after the removal (EVM-107 security S2). A listener must not call the owner.
   */
  onBeforeSessionEnd(listener: () => void): () => void {
    this.#beforeEnd.add(listener);
    return () => {
      this.#beforeEnd.delete(listener);
    };
  }

  #stopListeners(): void {
    for (const listener of [...this.#beforeEnd]) {
      try {
        listener();
      } catch {
        // stopping a service must not break the end of a session
      }
    }
  }

  /** The capability of the store for the synchronization service; null without a session. Composition only (security S3). */
  syncStore(): UnlockedStore | null {
    return this.#userId === null ? null : this.#store;
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

  /** The two sign-in steps, serialised with the end of a session (security W1d). */
  signInClient(): SignInClient {
    return {
      login: (credentials) => this.#exclusive(() => this.#deps.client.login(credentials)),
      loginTotp: (challenge, code) => this.#exclusive(() => this.#deps.client.loginTotp(challenge, code)),
    };
  }

  /**
   * Start of the app (AC6: no request here — a signed-in user works offline at once). A session exists only with the record AND the
   * native session of the same user; an orphan on either side is removed (a native session without a record is ended, the way a
   * sign-out interrupted half-way is finished). After an update from a version with JavaScript tokens the native side is empty: the
   * record goes, the user signs in once more, the queue and the local data stay (EVM-130 AC3).
   */
  restore(): Promise<SessionStep> {
    return this.#exclusive(async () => {
      const [metaText, state] = await Promise.all([
        this.#deps.tokens.get('sessionMeta').catch(() => null),
        this.#call(() => this.#deps.native.sessionState(), { state: 'unavailable', ownerId: null } as const),
      ]);
      const meta = parseSessionMeta(metaText);
      const live = state.state === 'signed_in' || state.state === 'paused_revoked' || state.state === 'paused_update';
      if (state.state === 'wipe_required') {
        // the module met the wipe order while the app was dead: the wipe runs now (the record, when there is one, goes with it)
        await this.#clearSession();
        this.#deps.wipe.wipeRequired();
        return { kind: 'signed_out' };
      }
      if (meta?.ending === true) {
        // the user confirmed the sign-out before the process died: finish it (native side, replica, record)
        await this.#endOrphan(`${meta.userId}:`);
        await this.#clearSession();
        return { kind: 'signed_out' };
      }
      if (meta === null || !live || (state.ownerId !== null && !state.ownerId.startsWith(`${meta.userId}:`))) {
        if (state.state === 'signed_in' || state.state === 'paused_revoked' || state.state === 'paused_update') {
          await this.#endOrphan(state.ownerId);
        }
        await this.#clearSession();
        return { kind: 'signed_out' };
      }
      const opened = await this.#deps.host.openForUser(meta.userId).catch((): OpenResult => ({ kind: 'unavailable', code: 'closed' }));
      if (opened.kind !== 'unlocked') return { kind: 'device_check', result: opened };
      this.#adopt(opened.store, meta);
      await this.#mergeContact();
      return { kind: 'signed_in' };
    });
  }

  /** A native session without a matching record: ended natively (a pending revocation when offline) and its replica removed. */
  async #endOrphan(ownerId: string | null): Promise<void> {
    await this.#call(() => this.#deps.native.signOut(false), false);
    const userId = ownerId?.split(':')[0] ?? '';
    if (userId === '') return;
    const opened = await this.#deps.host.openForUser(userId).catch(() => null);
    if (opened?.kind === 'unlocked') await opened.store.endSession().catch(() => undefined);
  }

  /**
   * After step 2 (AC1): the tokens go to the native module AT ONCE (staged, memory only; the carrier gives them up only once) and
   * the session is stored only when the store of this user is unlocked. Every other result goes to the device check with the session
   * staged natively (the old installation secret keeps working on the server, two-phase rotation).
   */
  completeSignIn(session: IssuedSession): Promise<SessionStep> {
    return this.#exclusive(async () => {
      const data = takeSession(session);
      if (data === null) return { kind: 'failed' };
      const staged = await this.#call(
        () =>
          this.#deps.native.stageLogin(
            data.user.id,
            data.deviceId,
            data.refreshToken,
            data.accessToken,
            data.accessTokenTtlMs,
            data.serverTime,
          ),
        'unavailable' as const,
      );
      if (staged !== 'ok') return { kind: 'failed' };
      const facts: LoginFacts = {
        deviceId: data.deviceId,
        installationSecret: data.installationSecret,
        serverTime: data.serverTime,
        user: data.user,
      };
      const opened = await this.#deps.host.openForUser(facts.user.id).catch((): OpenResult => ({ kind: 'unavailable', code: 'closed' }));
      if (opened.kind !== 'unlocked') {
        this.#pending = facts;
        return { kind: 'device_check', result: opened };
      }
      return this.#commit(opened.store, facts);
    });
  }

  /**
   * The device check went on (e.g. "Rozumiem" after `data_lost` opened a new database): the session staged natively is stored into
   * that store; after a start (`restore`) the stored session is adopted.
   */
  continueDeviceCheck(result: OpenResult): Promise<SessionStep> {
    return this.#exclusive(async () => {
      const facts = this.#pending;
      if (result.kind !== 'unlocked') return { kind: 'device_check', result };
      if (facts !== null) {
        this.#pending = null;
        if (result.store.userId !== facts.user.id) {
          await this.#call(() => this.#deps.native.abandonStaged(), 'unavailable' as const);
          return { kind: 'failed' };
        }
        return this.#commit(result.store, facts);
      }
      const meta = parseSessionMeta(await this.#deps.tokens.get('sessionMeta').catch(() => null));
      const state = await this.#call(() => this.#deps.native.sessionState(), { state: 'unavailable', ownerId: null } as const);
      if (meta === null || state.state !== 'signed_in' || meta.userId !== result.store.userId) {
        result.store.lock();
        return { kind: 'signed_out' };
      }
      this.#adopt(result.store, meta);
      return { kind: 'signed_in' };
    });
  }

  /**
   * The device check was cancelled: the session staged natively is ended on the server (a pending revocation when the server cannot
   * be asked — native), so it neither stays valid for 14 idle days nor counts towards the device limit (code review, RR-72).
   * Nothing was stored. Never rejects.
   */
  abandonSignIn(): Promise<void> {
    return this.#exclusive(async () => {
      const had = this.#pending !== null;
      this.#pending = null;
      if (had) await this.#call(() => this.#deps.native.abandonStaged(), 'unavailable' as const);
    });
  }

  async #commit(store: UnlockedStore, facts: LoginFacts): Promise<SessionStep> {
    const { tokens, clock, native } = this.#deps;
    const previous = await store.identity.read().catch(() => null);
    try {
      if (facts.installationSecret !== undefined)
        await store.identity.write({ deviceId: facts.deviceId, secret: facts.installationSecret });
    } catch {
      // the old secret stays valid on the server (RR-69): the sign-in fails, nothing else is stored, the new session is ended
      store.lock();
      await this.#call(() => native.abandonStaged(), 'unavailable' as const);
      return { kind: 'failed' };
    }
    // the same installation was recognised: the server already ended its earlier sessions ('rotated') — the pending revocations of
    // them are dropped by the module WITHOUT a request (a refresh of one could look like reuse and end the new session; security W1d)
    const sameInstallation = previous !== null && previous.deviceId === facts.deviceId;
    const committed = await this.#call(() => native.commitStaged(sameInstallation), 'unavailable' as const);
    if (committed !== 'ok') {
      // the module ended the staged session itself when it could not store it
      store.lock();
      return { kind: 'failed' };
    }
    const mark = checkpoint(facts.serverTime, clock);
    const meta: SessionMeta = {
      v: 1,
      userId: facts.user.id,
      displayName: facts.user.displayName,
      role: facts.user.role,
      started: mark,
      lastContact: mark,
    };
    try {
      await tokens.set('sessionMeta', JSON.stringify(meta));
    } catch {
      // no record = no session: the committed native session is ended again (online when it can, else a pending revocation)
      await this.#call(() => native.signOut(true), false);
      store.lock();
      return { kind: 'failed' };
    }
    this.#adopt(store, meta);
    // a full sign-in lifts the wipe marker of an earlier wipe (the module keeps it while a wipe is unfinished)
    await this.#call(() => native.clearWipeMarkerAfterLogin(), false);
    await this.#recordContact(facts.serverTime);
    return { kind: 'signed_in' };
  }

  /**
   * A contact with the server (an authenticated 2xx with a valid `serverTime`): the checkpoint of the 7-day rule (EVM-101 AC2,
   * sync-core `ContactClock`, EVM-092 AC7). A failing write never fails the session — the data then stay hidden (no record).
   */
  async #recordContact(serverTime: number): Promise<void> {
    const store = this.#store;
    if (store === null) return;
    await new ContactClock(store.replica, this.#deps.clock, this.#deps.contactClock ?? this.#deps.clock)
      .record(serverTime)
      .catch(() => undefined);
  }

  /**
   * The last contact of the NATIVE side (a refresh made by the job while no JavaScript ran, EVM-130 / architect 9, security 3):
   * the rule of 7 days takes the later of the two checkpoints, and so does the record of the session (the 14-day variant). It is a
   * contact like any other — it never brings back data that are already hidden (window elapsed, a clock anomaly, no record): only a
   * full sign-in does, exactly like a refresh of the app (SR-MOB-05/06).
   */
  async #mergeContact(): Promise<void> {
    const store = this.#store;
    if (store === null) return;
    const last = await this.#call(() => this.#deps.native.lastContact(), null);
    if (last === null || last.serverTimeMs === null) return;
    const { serverTimeMs: serverTime, wallMs, monoMs, bootId } = last;
    if (!sane(serverTime) || !sane(wallMs) || !sane(monoMs) || typeof bootId !== 'string' || bootId.length < 1 || bootId.length > 128)
      return;
    try {
      const state = await store.replica.loadState();
      const own = parseContactRecord(state.contact);
      if (own !== null && own.serverTime >= serverTime) return;
      if ((await this.contactStatus())?.status.visible !== true) return;
      const record = contactAt(serverTime, wallMs, monoMs, bootId);
      await store.replica.saveContact(record);
      const meta = this.#meta;
      if (meta !== null && meta.lastContact.serverTime < serverTime) {
        const next: SessionMeta = { ...meta, lastContact: record };
        await this.#deps.tokens.set('sessionMeta', JSON.stringify(next));
        this.#meta = next;
      }
    } catch {
      // a failing write never fails the session — the data then stay as they were
    }
  }

  /** Called at start, on return to the foreground and after an event of the module. */
  mergeNativeContact(): Promise<void> {
    return this.#exclusive(() => this.#mergeContact());
  }

  /**
   * The state of the 7-day rule for the device guard (EVM-101 AC2): ONE evaluation (and one checkpoint write) of sync-core
   * `ContactClock.status`, the window from the last known client-config (7 days without one). `null` = no session.
   */
  async contactStatus(): Promise<{ readonly status: ContactStatus; readonly windowDays: unknown } | null> {
    const store = this.#store;
    if (store === null) return null;
    const state = await store.replica.loadState();
    const config = typeof state.config === 'object' && state.config !== null ? parseClientConfig(state.config) : null;
    const clock = new ContactClock(store.replica, this.#deps.clock, this.#deps.contactClock ?? this.#deps.clock);
    const windowDays: unknown = config?.offlineContactWindowDays;
    return { status: await clock.status(state.contact, state.hasData, windowDays), windowDays };
  }

  /**
   * Entries of the queue for the "Kolejka" list. Without `withLabels` (hidden-data mode, EVM-101 AC8) the contents of the entries are
   * dropped at this source: only type and state leave. `[]` without a session.
   */
  async queueEntries(withLabels: boolean): Promise<QueueEntryRow[]> {
    const store = this.#store;
    if (store === null) return [];
    const records = await store.queue.readAll();
    return records.map((record, index): QueueEntryRow => {
      const entry = typeof record === 'object' && record !== null ? (record as Record<string, unknown>) : {};
      const payload =
        typeof entry['payload'] === 'object' && entry['payload'] !== null ? (entry['payload'] as Record<string, unknown>) : {};
      const body = payload['body'];
      return {
        id: typeof entry['mutationId'] === 'string' ? entry['mutationId'] : String(index),
        type: typeof entry['type'] === 'string' ? entry['type'] : 'unknown',
        state: typeof entry['state'] === 'string' ? entry['state'] : 'pending',
        label: withLabels && typeof body === 'string' ? body.slice(0, 200) : null,
      };
    });
  }

  /**
   * "Wyczyść dane firmowe" / "Usuń i zaloguj" (EVM-101 AC4, AC5): ends the session on the phone before the wipe — the module is asked
   * to sign out first (online it asks the server; offline it keeps a pending revocation that the wipe of the native store removes
   * with everything else), the store is locked. Emits no `SessionEnded`: the screen that asked for the wipe decides what comes next
   * once the wipe has a result.
   */
  endSessionForWipe({ online }: { readonly online: boolean }): Promise<void> {
    return this.#exclusive(async () => {
      this.#stopListeners();
      const store = this.#store;
      store?.lock();
      await this.#clearSession();
      await this.#call(() => this.#deps.native.signOut(online), false);
      // no `SessionEnded` event: the caller shows the result of the wipe (done / unfinished) itself - an event here would put
      // "Wylogowano" (and a sentence about unsent items that the wipe is about to remove) over the running wipe
    });
  }

  #adopt(store: UnlockedStore, meta: SessionMeta): void {
    this.#store = store;
    this.#meta = meta;
    this.#userId = meta.userId;
    this.#displayName = meta.displayName;
    this.#access = null;
  }

  /** A valid access token (asked from the module when needed), or `null` without a session. */
  async accessToken(): Promise<string | null> {
    const access = this.#access;
    if (access !== null && this.#deps.clock.now() < access.until - ACCESS_SKEW_MS) return access.token;
    if (this.#userId === null) return null;
    return (await this.refresh()) === 'refreshed' ? (this.#access?.token ?? null) : null;
  }

  /** One request to the module for every caller (AC5); the module itself refreshes once for the app and the job. */
  refresh(): Promise<RefreshResult> {
    this.#refreshing ??= this.#exclusive(() => this.#refresh())
      .catch((): RefreshResult => 'unavailable')
      .finally(() => {
        this.#refreshing = undefined;
      });
    return this.#refreshing;
  }

  async #refresh(): Promise<RefreshResult> {
    if (this.#userId === null) return 'session_revoked';
    // the token the server rejected (when there is one) makes the module renew even a token that still looks valid
    const answer = await this.#call(() => this.#deps.native.accessToken(this.#access?.token ?? null), { status: 'unavailable' } as const);
    if (answer.status === 'ready') {
      this.#access = { token: answer.accessToken, until: this.#deps.clock.now() + answer.validForMs };
      await this.#mergeContact();
      return 'refreshed';
    }
    if (answer.status === 'blocked') return this.#blocked(answer.state);
    return 'unavailable';
  }

  /**
   * The module cannot serve the session any more (`session_revoked` → `paused_revoked`, no token, the wipe order, `426`): the
   * existing states of the app. No session in JavaScript = nothing to end (the answer only).
   */
  async #blocked(state: SessionStateName): Promise<RefreshResult> {
    if (state === 'paused_update') {
      if (this.#userId !== null) for (const listener of [...this.#updateListeners]) listener();
      return 'unavailable';
    }
    if (state === 'signed_in') return 'unavailable';
    if (state === 'wipe_required') {
      if (this.#userId !== null) await this.#endWipe();
      return 'device_wipe_required';
    }
    if (this.#userId !== null) {
      if (state === 'paused_revoked') {
        await this.#mergeContact();
        await this.#end(sessionEndVariant(this.#meta, this.#deps.clock));
      } else {
        await this.#end('session_revoked');
      }
    }
    return 'session_revoked';
  }

  /** Compares the state of the module with the session of the app (start, return to the foreground): a stopped session ends here. */
  reconcileNative(): Promise<void> {
    return this.#exclusive(async () => {
      if (this.#userId === null) return;
      const state = await this.#call(() => this.#deps.native.sessionState(), { state: 'unavailable', ownerId: null } as const);
      if (state.state !== 'signed_in' && state.state !== 'unavailable') await this.#blocked(state.state);
    });
  }

  /** `session_revoked` / expiry (AC4): N is read first, then the replica and the record go; the queue stays encrypted. */
  async #end(reason: Extract<SessionEndReason, 'session_revoked' | 'session_expired'>): Promise<void> {
    this.#stopListeners();
    const store = this.#store;
    const unsentItems = store === null ? 0 : await store.unsentItemCount().catch(() => 0);
    if (store !== null) await store.endSession().catch(() => undefined);
    await this.#clearSession();
    this.#emit({ reason, unsentItems });
  }

  /** `device_wipe_required` (AC4): the record goes, the data become unreachable, the wipe is signalled to EVM-101. */
  async #endWipe(): Promise<void> {
    this.#stopListeners();
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
    await this.#deps.tokens.delete('sessionMeta').catch(() => undefined);
  }

  /**
   * "Wyloguj" (AC7). The module signs out FIRST (its call starts at once: the tokens are removed in one atomic write, a pending
   * revocation kept when offline), while the session on the phone ends (replica and record removed, queue and identity stay
   * encrypted); the answer of the server is awaited after the screens were told.
   */
  signOut({ online }: { readonly online: boolean }): Promise<SessionEnded> {
    return this.#exclusive(async () => {
      this.#stopListeners();
      // the confirmation is stored first: a death after the module signed out must still end with the replica removed
      if (this.#meta !== null) {
        await this.#deps.tokens.set('sessionMeta', JSON.stringify({ ...this.#meta, ending: true })).catch(() => undefined);
      }
      // without a session there is nothing to sign out of (the module is not asked: its state, e.g. a revoked session, stays as it is)
      const nativeDone = this.#userId === null ? Promise.resolve(false) : this.#call(() => this.#deps.native.signOut(online), false);
      // the capture cache of the camera goes with the session, session or not (EVM-108 pkt 13); this call touches no token and no state; a cleaning
      // that leaves something is retried by the module at the next start and at the next return of the network (`flushPendingRevocations`)
      const cacheDone = this.#call(() => this.#deps.native.clearCaptureCache(), false);
      const store = this.#store;
      const unsentItems = store === null ? 0 : await store.unsentItemCount().catch(() => 0);
      if (store !== null) await store.endSession().catch(() => undefined);
      await this.#clearSession();
      const ended: SessionEnded = { reason: 'signed_out', unsentItems };
      this.#emit(ended);
      await Promise.all([nativeDone, cacheDone]);
      return ended;
    });
  }

  /** Sends the pending revocations (after a sign-in, at start and whenever the network returns); never during a sign-in commit. */
  flushPendingRevocation(): Promise<void> {
    return this.#exclusive(async () => {
      if (this.#pending === null) await this.#call(() => this.#deps.native.flushPendingRevocations(), false);
    });
  }

  /**
   * `fetch` with the access token for the calls of the app (AC5): a plain `401` renews the token through the module once and retries
   * once; `401 session_revoked` / `device_wipe_required` and `426` are reported to the module (the job stops too) and end the
   * session / the wipe. `null` without a session (nothing is sent).
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
    if (response.status === 426) {
      await this.#call(() => this.#deps.native.reportUpdateRequired(), false);
      return response;
    }
    if (response.status !== 401) return response;
    const code = await response
      .clone()
      .json()
      .then((body: unknown) => (typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined))
      .catch(() => undefined);
    if (code === 'device_wipe_required') {
      await this.#call(() => this.#deps.native.reportDeviceWipeRequired(), false);
      await this.#exclusive(() => (this.#userId === null ? Promise.resolve() : this.#endWipe()));
      return response;
    }
    if (code === 'session_revoked') {
      await this.#call(() => this.#deps.native.reportApiRevoked(), false);
      await this.#exclusive(() => (this.#userId === null ? Promise.resolve() : this.#end('session_revoked')));
      return response;
    }
    if ((await this.refresh()) !== 'refreshed') return response;
    const second = this.#access?.token;
    return second === undefined || second === first ? response : send(second);
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
  | 'onUpdateRequired'
  | 'displayName'
  | 'refresh'
  | 'signInClient'
  | 'unsentItemCount'
  | 'contactStatus'
  | 'queueEntries'
  | 'endSessionForWipe'
  | 'onBeforeSessionEnd'
  | 'syncStore'
  | 'reconcileNative'
  | 'mergeNativeContact'
>;
