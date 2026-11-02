// Session ports for component tests (EVM-100): a stand-in owner whose state is set by the test. The real owner is tested in
// test/auth/session-owner.test.ts; here the screens and the session gate are exercised.
import { Challenge, IssuedSession } from '../src/auth/opaque';
import type { AuthOutcome, QueueEntryRow, SessionEnded, SignInClient } from '../src/auth/ports';
import type { SessionControl, SessionStep } from '../src/auth/session-owner';
import type { SessionPorts } from '../src/screens/SessionRoot';
import { rig as guardRig, type Rig } from './device-guard/fakes';
import { FakeSync } from './sync/fake-sync';

export interface StubOwner extends SessionControl {
  readonly calls: string[];
  restoreResult: SessionStep;
  completeResult: SessionStep;
  unsent: number;
  queue: QueueEntryRow[];
  /** What `queueEntries` was asked for (`true` = with labels). */
  readonly labelRequests: boolean[];
  name: string | null;
  /** Sends an end of the session to the screens (as the owner does after a 401). */
  end(ended: SessionEnded): void;
}

export function stubOwner(signIn: SignInClient = okSignIn()): StubOwner {
  const listeners = new Set<(ended: SessionEnded) => void>();
  const owner: StubOwner = {
    calls: [],
    restoreResult: { kind: 'signed_in' },
    completeResult: { kind: 'signed_in' },
    unsent: 0,
    queue: [],
    labelRequests: [],
    name: 'Piotr Testowy',
    end(ended) {
      for (const listener of listeners) listener(ended);
    },
    restore: () => {
      owner.calls.push('restore');
      return Promise.resolve(owner.restoreResult);
    },
    completeSignIn: () => {
      owner.calls.push('completeSignIn');
      return Promise.resolve(owner.completeResult);
    },
    continueDeviceCheck: (result) => {
      owner.calls.push(`continue:${result.kind}`);
      return Promise.resolve(result.kind === 'unlocked' ? { kind: 'signed_in' } : { kind: 'device_check', result });
    },
    abandonSignIn: () => {
      owner.calls.push('abandon');
      return Promise.resolve();
    },
    signOut: ({ online }) => {
      owner.calls.push(`signOut:${online ? 'online' : 'offline'}`);
      const ended: SessionEnded = { reason: 'signed_out', unsentItems: owner.unsent };
      owner.end(ended);
      return Promise.resolve(ended);
    },
    flushPendingRevocation: () => {
      owner.calls.push('flush');
      return Promise.resolve();
    },
    onSessionEnded: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    displayName: () => owner.name,
    refresh: () => {
      owner.calls.push('refresh');
      return Promise.resolve('refreshed');
    },
    signInClient: () => signIn,
    unsentItemCount: () => Promise.resolve(owner.unsent),
    contactStatus: () => Promise.resolve(null),
    queueEntries: (withLabels) => {
      owner.labelRequests.push(withLabels);
      return Promise.resolve(owner.queue.map((row) => ({ ...row, label: withLabels ? row.label : null })));
    },
    onBeforeSessionEnd: () => () => undefined,
    syncStore: () => null,
    endSessionForWipe: ({ online }) => {
      // the real owner emits no `SessionEnded` here: the screen shows the result of the wipe itself
      owner.calls.push(`endSessionForWipe:${online ? 'online' : 'offline'}`);
      return Promise.resolve();
    },
  };
  return owner;
}

export function okSignIn(overrides: Partial<SignInClient> = {}): SignInClient {
  return {
    login: () => Promise.resolve<AuthOutcome<Challenge>>({ kind: 'ok', value: Challenge.of('c'.repeat(43), Date.now() + 300_000) }),
    loginTotp: () =>
      Promise.resolve<AuthOutcome<IssuedSession>>({
        kind: 'ok',
        value: IssuedSession.of({
          deviceId: '7a000000-0000-4000-8000-000000000001',
          installationSecret: undefined,
          accessToken: 'test-access'.padEnd(40, '-'),
          accessTokenTtlMs: 900_000,
          refreshToken: 'test-refresh'.padEnd(40, '-'),
          serverTime: Date.now(),
          user: { id: '90000000-0000-4000-8000-0000000000aa', displayName: 'Piotr Testowy', role: 'editor' },
        }),
      }),
    ...overrides,
  };
}

export interface PortsRig {
  readonly ports: SessionPorts;
  readonly sync: FakeSync;
  readonly copied: string[];
  readonly owner: StubOwner;
  readonly opened: string[];
  readonly wipes: { count: number };
  /** The device-control rig behind `ports.guard` (fake native answers). */
  readonly device: Rig;
  readonly manualWipes: { count: number; result: 'done' | 'incomplete' };
  /** For `<App session={…} />`: always the same ports object. */
  readonly session: () => SessionPorts;
}

export function stubPorts(owner: StubOwner = stubOwner(), unsentBeforeSignIn: number | null = 0): PortsRig {
  const opened: string[] = [];
  const wipes = { count: 0 };
  const manualWipes: { count: number; result: 'done' | 'incomplete' } = { count: 0, result: 'done' };
  const device = guardRig();
  const sync = new FakeSync();
  // the rows of the owner's stub, as the facade of the synchronization would return them (the label only on request)
  sync.source = (withLabels) => {
    owner.labelRequests.push(withLabels);
    return owner.queue.map((row) => ({
      id: row.id,
      type: (row.type === 'CreateNote' ? 'CreateNote' : 'CreateComment') as 'CreateNote',
      state: row.state === 'attention' ? 'attention' : 'pending',
      createdAt: 0,
      targetId: null,
      code: null,
      attempts: 0,
      reason: row.state === 'attention' ? 'unknown' : null,
      actions: [],
      dependents: 0,
      label: withLabels ? row.label : null,
    }));
  };
  const copied: string[] = [];
  const ports: SessionPorts = {
    sync,
    copyToClipboard: (text) => {
      copied.push(text);
      return true;
    },
    owner,
    wipe: {
      wipeRequired: () => {
        wipes.count += 1;
      },
    },
    unsentBeforeSignIn: () => Promise.resolve(unsentBeforeSignIn),
    openForgotPassword: () => opened.push('forgot'),
    openHelp: () => opened.push('help'),
    guard: device.guard,
    screenLockOk: () => Promise.resolve(device.facts.secure === true),
    companyWipe: {
      unsentItemCount: () => Promise.resolve(owner.unsent),
      runManual: () => {
        manualWipes.count += 1;
        return Promise.resolve(manualWipes.result);
      },
    },
    openAddTarget: (target) => opened.push(`add:${target}`),
    appVersion: '0.4.0',
  };
  return { ports, sync, copied, owner, opened, wipes, device, manualWipes, session: () => ports };
}

/** A signed-in phone for the tests of the shell (EVM-009). */
export const signedIn = stubPorts().session;
