// Fakes of the ports of the sign-in (EVM-100). The "phone" (secure store, identity, queue, replica) survives a restart: a restart is a
// new MobileSessionOwner on the same phone. Failure injection: a named operation fails once (or "crashes" after it ran).
import { Challenge, IssuedSession } from '../../src/auth/opaque';
import type { AuthClient, AuthOutcome, SessionClock, SessionSlot, TokenStore, WipeSignal } from '../../src/auth/ports';
import { MobileSessionOwner, type SessionOwnerDeps } from '../../src/auth/session-owner';
import type { OpenResult, UnlockedStore } from '../../src/storage';
import type { InstallationIdentity } from '../../src/storage/ports';
import { DEVICE_1, T0, USER_A, secret, token } from './fixtures';

export interface Phone {
  readonly slots: Map<SessionSlot, string>;
  identity: InstallationIdentity | null;
  /** Owner of the local store (null = no database yet). */
  owner: string | null;
  queue: number;
  replica: boolean;
  /** Every write/delete in order: "set:refreshToken", "identity.write", "endSession", … */
  readonly log: string[];
  /** Failure injection: `fail` throws before the effect, `crash` after it (and the process is "dead": every later call throws). */
  readonly faults: Map<string, 'fail' | 'crash'>;
  dead: boolean;
  openAs: OpenResult['kind'] | null;
}

export function newPhone(): Phone {
  return { slots: new Map(), identity: null, owner: null, queue: 0, replica: false, log: [], faults: new Map(), dead: false, openAs: null };
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
      queue: {} as UnlockedStore['queue'],
      replica: {} as UnlockedStore['replica'],
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
      takeSettled: () => Promise.resolve([]),
      unsentItemCount: async () => {
        await guard();
        return phone.queue;
      },
      endSession: async () => {
        await guard();
        await effect(phone, 'endSession', () => {
          phone.replica = false;
          phone.slots.delete('refreshToken');
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

/** Scripted client; every call is recorded (tokens included — the fake never leaves the test). */
export class FakeAuthClient implements AuthClient {
  readonly calls: string[] = [];
  readonly loginScript: Script<Challenge> = [];
  readonly totpScript: Script<IssuedSession> = [];
  readonly refreshScript: Script<IssuedSession> = [];
  readonly logoutScript: Script<null> = [];

  login(credentials: { email: string; password: string }): Promise<AuthOutcome<Challenge>> {
    this.calls.push(`login:${credentials.email}`);
    return Promise.resolve(this.loginScript.shift() ?? { kind: 'ok', value: Challenge.of('c'.repeat(43), T0 + 300_000) });
  }
  loginTotp(_challenge: Challenge, code: string): Promise<AuthOutcome<IssuedSession>> {
    this.calls.push(`totp:${code}`);
    return Promise.resolve(this.totpScript.shift() ?? { kind: 'ok', value: issued() });
  }
  refresh(refreshToken: string): Promise<AuthOutcome<IssuedSession>> {
    this.calls.push(`refresh:${refreshToken}`);
    const next = this.refreshScript.shift();
    return Promise.resolve(next ?? { kind: 'unavailable' });
  }
  logout(accessToken: string): Promise<AuthOutcome<null>> {
    this.calls.push(`logout:${accessToken}`);
    return Promise.resolve(this.logoutScript.shift() ?? { kind: 'ok', value: null });
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

export interface Rig {
  readonly owner: MobileSessionOwner;
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
  const owner = new MobileSessionOwner({ client, tokens, host, wipe, clock, ...overrides });
  return { owner, client, tokens, host, clock, wipe };
}

/** A signed-in phone: identity of DEVICE_1, the session of `issued(n)` stored. */
export async function signedIn(phone: Phone, n = 1, rig: Rig = start(phone)): Promise<Rig> {
  const step = await rig.owner.completeSignIn(issued({ n }));
  if (step.kind !== 'signed_in') throw new Error(`expected signed_in, got ${step.kind}`);
  return rig;
}
