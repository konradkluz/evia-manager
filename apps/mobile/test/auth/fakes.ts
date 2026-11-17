// Fakes of the ports of the sign-in (EVM-100, EVM-130). The "phone" (secure store, identity, queue, replica, the state of the native
// module) survives a restart: a restart is a new MobileSessionOwner on the same phone. Failure injection: a named operation fails
// once (or "crashes" after it ran).
import type { AccessTokenResult, LastContact, SessionStateName } from '../../modules/evia-upload/src';
import { Challenge, IssuedSession } from '../../src/auth/opaque';
import type { AuthClient, AuthOutcome, NativeSession, SessionClock, SessionSlot, TokenStore, WipeSignal } from '../../src/auth/ports';
import { MobileSessionOwner, type SessionOwnerDeps } from '../../src/auth/session-owner';
import type { OpenResult, UnlockedStore } from '../../src/storage';
import type { InstallationIdentity } from '../../src/storage/ports';
import { DEVICE_1, T0, USER_A, secret, token } from './fixtures';

export interface NativeState {
  /** What the module keeps across restarts of the process (its own token store). */
  session: { state: SessionStateName | 'unavailable'; ownerId: string | null };
  staged: { userId: string; deviceId: string; accessToken: string; ttlMs: number } | null;
  /** Every call by name, in order (`stageLogin`, `commitStaged:same`, `signOut:online`, ...). Never a token. */
  readonly calls: string[];
  /** What the module received as tokens (test only: the proof that they are handed over once). */
  readonly received: { refreshToken: string; accessToken: string }[];
  /** The `rejected` argument of every `accessToken` call. */
  readonly rejected: (string | null)[];
  accessScript: (AccessTokenResult | Promise<AccessTokenResult>)[];
  stageResult: 'ok' | 'invalid' | 'unavailable';
  commitResult: 'ok' | 'storage_failed' | 'nothing_staged' | 'unavailable';
  accessToken: string;
  contact: LastContact | null;
  signOutHangs: Promise<void> | null;
  /** The answers of `clearCaptureCache`, one per call (the last one repeats); `'throws'` rejects. */
  cacheAnswers: (boolean | 'throws')[];
  /** How many times `clearCaptureCache` was called (kept apart from `calls`: it is not a call about the session). */
  cacheCalls: number;
}

export function newNativeState(): NativeState {
  return {
    session: { state: 'signed_out', ownerId: null },
    staged: null,
    calls: [],
    received: [],
    rejected: [],
    accessScript: [],
    stageResult: 'ok',
    commitResult: 'ok',
    accessToken: token('access-1'),
    contact: null,
    signOutHangs: null,
    cacheAnswers: [true],
    cacheCalls: 0,
  };
}

export interface Phone {
  readonly slots: Map<SessionSlot, string>;
  identity: InstallationIdentity | null;
  /** Owner of the local store (null = no database yet). */
  owner: string | null;
  queue: number;
  replica: boolean;
  /** Every write/delete in order: "set:sessionMeta", "identity.write", "endSession", "native.signOut:offline", … */
  readonly log: string[];
  /** Failure injection: `fail` throws before the effect, `crash` after it (and the process is "dead": every later call throws). */
  readonly faults: Map<string, 'fail' | 'crash'>;
  dead: boolean;
  /** Replica facts of the contact rule (EVM-101): the last saved record, the client-config, whether data exist. */
  contact: unknown;
  config: unknown;
  hasData: boolean;
  /** Records of the queue as `queue.readAll` returns them. */
  queueRecords: unknown[];
  openAs: OpenResult['kind'] | null;
  /** The native module's side of the phone (survives a restart of the app process). */
  native: NativeState;
}

export function newPhone(): Phone {
  return {
    slots: new Map(),
    identity: null,
    owner: null,
    queue: 0,
    replica: false,
    log: [],
    faults: new Map(),
    dead: false,
    contact: undefined,
    config: undefined,
    hasData: false,
    queueRecords: [],
    openAs: null,
    native: newNativeState(),
  };
}

function effect(phone: Phone, name: string, work: () => void): Promise<void> {
  if (phone.dead) return Promise.reject(new Error('process is dead (synthetic)'));
  const fault = phone.faults.get(name);
  phone.faults.delete(name);
  if (fault === 'fail') return Promise.reject(new Error(`synthetic failure of ${name}`));
  work();
  phone.log.push(name);
  if (fault === 'crash') {
    phone.dead = true;
    return Promise.reject(new Error(`synthetic crash after ${name}`));
  }
  return Promise.resolve();
}

export class FakeTokens implements TokenStore {
  readonly phone: Phone;
  constructor(phone: Phone) {
    this.phone = phone;
  }
  get(slot: SessionSlot): Promise<string | null> {
    if (this.phone.dead) return Promise.reject(new Error('dead'));
    if (this.phone.faults.get(`get:${slot}`) === 'fail') {
      this.phone.faults.delete(`get:${slot}`);
      return Promise.reject(new Error('synthetic'));
    }
    return Promise.resolve(this.phone.slots.get(slot) ?? null);
  }
  set(slot: SessionSlot, value: string): Promise<void> {
    return effect(this.phone, `set:${slot}`, () => this.phone.slots.set(slot, value));
  }
  delete(slot: SessionSlot): Promise<void> {
    return effect(this.phone, `delete:${slot}`, () => this.phone.slots.delete(slot));
  }
}

export class FakeHost {
  readonly opened: string[] = [];
  readonly phone: Phone;
  constructor(phone: Phone) {
    this.phone = phone;
  }

  openForUser(userId: string): Promise<OpenResult> {
    if (this.phone.dead) return Promise.reject(new Error('dead'));
    this.opened.push(userId);
    const forced = this.phone.openAs;
    if (forced === 'data_lost') {
      return Promise.resolve({
        kind: 'data_lost',
        reason: 'key_missing',
        acknowledge: () => {
          this.phone.openAs = null;
          this.phone.identity = null;
          this.phone.owner = null;
          this.phone.queue = 0;
          return this.openForUser(userId);
        },
      });
    }
    if (forced === 'unavailable') return Promise.resolve({ kind: 'unavailable', code: 'key_unavailable' });
    if (forced === 'update_required') return Promise.resolve({ kind: 'update_required' });
    if (forced === 'wipe_incomplete') return Promise.resolve({ kind: 'wipe_incomplete' });
    if (this.phone.owner !== null && this.phone.owner !== userId) {
      return Promise.resolve({ kind: 'owner_mismatch', unsentItemCount: this.phone.queue });
    }
    this.phone.owner = userId;
    return Promise.resolve({ kind: 'unlocked', store: this.#store(userId), initialPullRequired: false });
  }

  #store(userId: string): UnlockedStore {
    const phone = this.phone;
    let locked = false;
    const guard = (): Promise<void> => (locked ? Promise.reject(new Error('locked')) : Promise.resolve());
    return {
      userId,
      queue: { readAll: () => Promise.resolve(phone.queueRecords) } as unknown as UnlockedStore['queue'],
      replica: {
        loadState: () => Promise.resolve({ contact: phone.contact, config: phone.config, hasData: phone.hasData }),
        saveContact: (record: unknown) => {
          phone.contact = JSON.parse(JSON.stringify(record));
          phone.log.push('saveContact');
          return Promise.resolve();
        },
      } as unknown as UnlockedStore['replica'],
      identity: {
        read: async () => {
          await guard();
          return phone.identity;
        },
        write: async (identity) => {
          await guard();
          await effect(phone, 'identity.write', () => (phone.identity = identity));
        },
      },
      replicaExtras: {
        readLastSuccess: () => Promise.resolve(null),
        writeLastSuccess: () => Promise.resolve(),
        listWorkOrders: () => Promise.resolve([]),
        listOrderNumbers: () => Promise.resolve([]),
        readOrderListSource: () => Promise.resolve({ orders: [], customers: [], sites: [], stages: [] }),
        readOrderDetailSource: () => Promise.resolve(null),
        readTemplates: () => Promise.resolve(null),
        writeTemplates: () => Promise.resolve(),
        readQuickOrderSource: () => Promise.resolve({ customers: [], sites: [] }),
        readMediaServerStates: () => Promise.resolve(new Map()),
        readClientConfig: () => Promise.resolve(null),
        readSurveyOrderIds: () => Promise.resolve([]),
        readSurveyCreated: () => Promise.resolve(new Map()),
        readSurveyMarks: () => Promise.resolve([]),
        addSurveyMarks: () => Promise.resolve(),
      },
      media: {
        register: () => Promise.resolve(),
        list: () => Promise.resolve([]),
        setState: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        discard: () => Promise.resolve(),
      },
      takeSettled: () => Promise.resolve([]),
      unsentItemCount: async () => {
        await guard();
        return phone.queue;
      },
      endSession: async () => {
        await guard();
        await effect(phone, 'endSession', () => {
          phone.replica = false;
        });
        locked = true;
      },
      lock: () => {
        locked = true;
        phone.log.push('lock');
      },
    };
  }
}

type Script<T> = (AuthOutcome<T> | Promise<AuthOutcome<T>>)[];

/** Scripted client of the two sign-in steps; every call is recorded (the fake never leaves the test). */
export class FakeAuthClient implements AuthClient {
  readonly calls: string[] = [];
  readonly loginScript: Script<Challenge> = [];
  readonly totpScript: Script<IssuedSession> = [];

  login(credentials: { email: string; password: string }): Promise<AuthOutcome<Challenge>> {
    this.calls.push(`login:${credentials.email}`);
    return Promise.resolve(this.loginScript.shift() ?? { kind: 'ok', value: Challenge.of('c'.repeat(43), T0 + 300_000) });
  }
  loginTotp(_challenge: Challenge, code: string): Promise<AuthOutcome<IssuedSession>> {
    this.calls.push(`totp:${code}`);
    return Promise.resolve(this.totpScript.shift() ?? { kind: 'ok', value: issued() });
  }
  /** Not used by the JavaScript owner any more (the refresh is native): a call is a failure of the test. */
  refresh(): Promise<AuthOutcome<IssuedSession>> {
    this.calls.push('refresh');
    return Promise.resolve({ kind: 'unavailable' });
  }
  logout(): Promise<AuthOutcome<null>> {
    this.calls.push('logout');
    return Promise.resolve({ kind: 'ok', value: null });
  }
}

export function issued(
  overrides: { n?: number; user?: string; deviceId?: string; serverTime?: number; withSecret?: boolean; ttlMs?: number } = {},
): IssuedSession {
  const n = overrides.n ?? 1;
  return IssuedSession.of({
    deviceId: overrides.deviceId ?? DEVICE_1,
    installationSecret: overrides.withSecret === false ? undefined : secret(n),
    accessToken: token(`access-${String(n)}`),
    accessTokenTtlMs: overrides.ttlMs ?? 15 * 60_000,
    refreshToken: token(`refresh-${String(n)}`),
    serverTime: overrides.serverTime ?? T0,
    user: { id: overrides.user ?? USER_A, displayName: 'Piotr Testowy', role: 'editor' },
  });
}

export const ok = <T>(value: T): AuthOutcome<T> => ({ kind: 'ok', value });
export const problem = (status: number, code: string): AuthOutcome<never> => ({ kind: 'problem', status, code });
export const unavailable: AuthOutcome<never> = { kind: 'unavailable' };

export class FakeClock implements SessionClock {
  wall = T0;
  mono = 1000;
  boot = 'boot-1';
  now(): number {
    return this.wall;
  }
  monotonicNow(): number {
    return this.mono;
  }
  bootId(): string {
    return this.boot;
  }
  advance(ms: number): void {
    this.wall += ms;
    this.mono += ms;
  }
}

export class FakeWipe implements WipeSignal {
  signals = 0;
  wipeRequired(): void {
    this.signals += 1;
  }
}

/** One process of the native module over the state of the phone: the listeners die with the process, the session does not. */
export class FakeNative implements NativeSession {
  readonly state: NativeState;
  readonly phone: Phone;
  readonly #listeners = new Map<string, Set<(event: never) => void>>();
  constructor(phone: Phone) {
    this.phone = phone;
    this.state = phone.native;
    // the module lives in the process of the app: a killed process answers nothing
    for (const key of Object.keys(this)) {
      const member: unknown = Reflect.get(this, key);
      if (typeof member !== 'function' || key === 'emit' || key === 'addListener') continue;
      Reflect.set(this, key, (...args: unknown[]) =>
        phone.dead ? Promise.reject(new Error('process is dead (synthetic)')) : (Reflect.apply(member, this, args) as unknown),
      );
    }
  }
  #log(name: string): void {
    this.state.calls.push(name);
    this.phone.log.push(`native.${name}`);
  }
  emit(name: string, event: unknown): void {
    for (const listener of this.#listeners.get(name) ?? []) (listener as (e: unknown) => void)(event);
  }
  stageLogin: NativeSession['stageLogin'] = (userId, deviceId, refreshToken, accessToken, ttlMs) => {
    this.#log('stageLogin');
    this.state.received.push({ refreshToken, accessToken });
    if (this.state.stageResult !== 'ok') return Promise.resolve(this.state.stageResult);
    this.state.staged = { userId, deviceId, accessToken, ttlMs };
    return Promise.resolve('ok');
  };
  commitStaged: NativeSession['commitStaged'] = (same) => {
    this.#log(`commitStaged:${same ? 'same' : 'other'}`);
    const staged = this.state.staged;
    if (staged === null) return Promise.resolve('nothing_staged');
    this.state.staged = null;
    if (this.state.commitResult !== 'ok') return Promise.resolve(this.state.commitResult);
    this.state.session = { state: 'signed_in', ownerId: `${staged.userId}:${staged.deviceId}` };
    this.state.accessToken = staged.accessToken;
    return Promise.resolve('ok');
  };
  abandonStaged: NativeSession['abandonStaged'] = () => {
    this.#log('abandonStaged');
    this.state.staged = null;
    return Promise.resolve('ok');
  };
  accessToken: NativeSession['accessToken'] = (rejected) => {
    this.#log('accessToken');
    this.state.rejected.push(rejected);
    const next = this.state.accessScript.shift();
    if (next !== undefined) return Promise.resolve(next);
    const { state, ownerId } = this.state.session;
    if (state !== 'signed_in') {
      return Promise.resolve(state === 'unavailable' ? { status: 'unavailable' } : { status: 'blocked', state });
    }
    return Promise.resolve({ status: 'ready', accessToken: this.state.accessToken, ownerId: ownerId ?? '', validForMs: 15 * 60_000 });
  };
  reportApiRevoked: NativeSession['reportApiRevoked'] = () => {
    this.#log('reportApiRevoked');
    this.state.session = { state: 'paused_revoked', ownerId: this.state.session.ownerId };
    return Promise.resolve(true);
  };
  reportDeviceWipeRequired: NativeSession['reportDeviceWipeRequired'] = () => {
    this.#log('reportDeviceWipeRequired');
    this.state.session = { state: 'wipe_required', ownerId: null };
    return Promise.resolve(true);
  };
  reportUpdateRequired: NativeSession['reportUpdateRequired'] = () => {
    this.#log('reportUpdateRequired');
    this.state.session = { state: 'paused_update', ownerId: this.state.session.ownerId };
    return Promise.resolve(true);
  };
  signOut: NativeSession['signOut'] = async (online) => {
    this.#log(`signOut:${online ? 'online' : 'offline'}`);
    this.state.session = { state: 'signed_out', ownerId: null };
    await this.state.signOutHangs;
    return true;
  };
  flushPendingRevocations: NativeSession['flushPendingRevocations'] = () => {
    this.#log('flushPendingRevocations');
    return Promise.resolve(true);
  };
  sessionState: NativeSession['sessionState'] = () => {
    this.#log('sessionState');
    return Promise.resolve({ state: this.state.session.state, ownerId: this.state.session.ownerId });
  };
  clearWipeMarkerAfterLogin: NativeSession['clearWipeMarkerAfterLogin'] = () => {
    this.#log('clearWipeMarkerAfterLogin');
    return Promise.resolve(true);
  };
  clearCaptureCache: NativeSession['clearCaptureCache'] = () => {
    this.state.cacheCalls += 1;
    const answers = this.state.cacheAnswers;
    const answer = (answers.length > 1 ? answers.shift() : answers[0]) ?? true;
    return answer === 'throws' ? Promise.reject(new Error('synthetic')) : Promise.resolve(answer);
  };
  lastContact: NativeSession['lastContact'] = () => {
    this.#log('lastContact');
    return Promise.resolve(this.state.contact);
  };
  addListener: NativeSession['addListener'] = (name, listener) => {
    const set = this.#listeners.get(name) ?? new Set<(event: never) => void>();
    set.add(listener);
    this.#listeners.set(name, set);
    return {
      remove: () => {
        set.delete(listener);
      },
    };
  };
}

export interface Rig {
  readonly owner: MobileSessionOwner;
  readonly native: FakeNative;
  readonly client: FakeAuthClient;
  readonly tokens: FakeTokens;
  readonly host: FakeHost;
  readonly clock: FakeClock;
  readonly wipe: FakeWipe;
}

/** One process of the app on the phone. */
export function start(phone: Phone, overrides: Partial<SessionOwnerDeps> & { clock?: FakeClock; client?: FakeAuthClient } = {}): Rig {
  const client = overrides.client ?? new FakeAuthClient();
  const tokens = new FakeTokens(phone);
  const host = new FakeHost(phone);
  const clock = overrides.clock ?? new FakeClock();
  const wipe = new FakeWipe();
  const native = new FakeNative(phone);
  const owner = new MobileSessionOwner({ client, tokens, native, host, wipe, clock, ...overrides });
  return { owner, native, client, tokens, host, clock, wipe };
}

/** A signed-in phone: identity of DEVICE_1, the session of `issued(n)` stored. */
export async function signedIn(phone: Phone, n = 1, rig: Rig = start(phone)): Promise<Rig> {
  const step = await rig.owner.completeSignIn(issued({ n }));
  if (step.kind !== 'signed_in') throw new Error(`expected signed_in, got ${step.kind}`);
  return rig;
}
