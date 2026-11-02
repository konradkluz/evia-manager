// Fakes of the device-control ports (EVM-101): every answer is set by the test; nothing touches a native module.
import type { ContactReading, GuardDeps } from '../../src/device-guard/device-guard';
import { DeviceGuard } from '../../src/device-guard/device-guard';
import type { AppStateName, AppStateSource } from '../../src/device-guard/ports';

export const MIN = 60_000;
export const DAY = 86_400_000;

export class FakeAppState implements AppStateSource {
  state: AppStateName = 'active';
  listeners = 0;
  readonly #handlers = new Set<(next: AppStateName) => void>();
  current(): AppStateName {
    return this.state;
  }
  subscribe(listener: (next: AppStateName) => void): () => void {
    this.listeners += 1;
    this.#handlers.add(listener);
    return () => {
      this.#handlers.delete(listener);
    };
  }
  emit(next: AppStateName): void {
    this.state = next;
    for (const handler of this.#handlers) handler(next);
  }
}

export interface Rig {
  readonly guard: DeviceGuard;
  readonly appState: FakeAppState;
  readonly time: { wall: number; boot: number };
  readonly facts: {
    secure: boolean | 'throws';
    contact: ContactReading | 'throws';
    patch: string | null;
    auth: 'success' | 'cancelled' | 'error' | 'throws';
    authCalls: number;
    contactCalls: number;
    /** Runs while the system unlock window is open (it may emit AppState changes like the real one). */
    duringAuth: (() => void) | null;
  };
  readonly events: unknown[];
}

export const WALL0 = Date.UTC(2026, 10, 2, 10, 0, 0);

export function rig(overrides: Partial<GuardDeps> = {}): Rig {
  const appState = new FakeAppState();
  const time = { wall: WALL0, boot: 1_000_000 };
  const events: unknown[] = [];
  const facts: Rig['facts'] = {
    secure: true,
    contact: null,
    patch: '2026-10-05',
    auth: 'success',
    authCalls: 0,
    contactCalls: 0,
    duringAuth: null,
  };
  const guard = new DeviceGuard({
    deviceLock: {
      isDeviceSecure: () => (facts.secure === 'throws' ? Promise.reject(new Error('native (synthetic)')) : Promise.resolve(facts.secure)),
    },
    boot: { elapsedRealtime: () => time.boot },
    authenticator: {
      authenticate: () => {
        facts.authCalls += 1;
        facts.duringAuth?.();
        return facts.auth === 'throws' ? Promise.reject(new Error('native (synthetic)')) : Promise.resolve(facts.auth);
      },
    },
    appState,
    patch: { securityPatch: () => Promise.resolve(facts.patch) },
    contact: () => {
      facts.contactCalls += 1;
      return facts.contact === 'throws' ? Promise.reject(new Error('store (synthetic)')) : Promise.resolve(facts.contact);
    },
    now: () => time.wall,
    diagnostics: (event) => events.push(event),
    ...overrides,
  });
  return { guard, appState, time, facts, events };
}
