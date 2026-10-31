// Session ports for component tests (EVM-100): a stand-in owner whose state is set by the test. The real owner is tested in
// test/auth/session-owner.test.ts; here the screens and the session gate are exercised.
import { Challenge, IssuedSession } from '../src/auth/opaque';
import type { AuthOutcome, SessionEnded, SignInClient } from '../src/auth/ports';
import type { SessionControl, SessionStep } from '../src/auth/session-owner';
import type { SessionPorts } from '../src/screens/SessionRoot';

export interface StubOwner extends SessionControl {
  readonly calls: string[];
  restoreResult: SessionStep;
  completeResult: SessionStep;
  unsent: number;
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
  readonly owner: StubOwner;
  readonly opened: string[];
  readonly wipes: { count: number };
  /** For `<App session={…} />`: always the same ports object. */
  readonly session: () => SessionPorts;
}

export function stubPorts(owner: StubOwner = stubOwner(), unsentBeforeSignIn: number | null = 0): PortsRig {
  const opened: string[] = [];
  const wipes = { count: 0 };
  const ports: SessionPorts = {
    owner,
    wipe: {
      wipeRequired: () => {
        wipes.count += 1;
      },
    },
    unsentBeforeSignIn: () => Promise.resolve(unsentBeforeSignIn),
    openForgotPassword: () => opened.push('forgot'),
    openHelp: () => opened.push('help'),
    requestCompanyDataWipe: () => opened.push('wipe'),
    appVersion: '0.4.0',
  };
  return { ports, owner, opened, wipes, session: () => ports };
}

/** A signed-in phone for the tests of the shell (EVM-009). */
export const signedIn = stubPorts().session;
