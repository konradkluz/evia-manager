/**
 * Production adapters of the device-control ports (EVM-101): the local Kotlin module `evia-keystore` (KeyguardManager,
 * SystemClock.elapsedRealtime, BiometricPrompt, build properties) and React Native `AppState`. Every failure of the native side is
 * swallowed into the fail-closed answer: no lock / no clock / not unlocked (SR-LOG-08: no message of the module is kept).
 * The unlock prompt is a UI gate: the native function takes only the texts of the window and returns a code; it has no key alias.
 */
import { requireOptionalNativeModule } from 'expo';
import { AppState } from 'react-native';
import type { SessionClock } from '../auth/ports';
import type { AppStateName, AppStateSource, Authenticator, BootClock, DeviceLock, PatchSource } from './ports';

export interface UnlockTexts {
  readonly title: string;
}

interface GuardNative {
  isDeviceSecure(): boolean;
  elapsedRealtime(): number;
  /** `Settings.Global.BOOT_COUNT`; negative = unknown. */
  bootCount?(): number;
  authenticate(title: string): Promise<string>;
  deviceInfo(): { securityPatch?: string };
}

const load = (): GuardNative | null => requireOptionalNativeModule<GuardNative>('EviaKeystore');

export function createDeviceLock(native: GuardNative | null = load()): DeviceLock {
  return {
    isDeviceSecure(): Promise<boolean> {
      try {
        return Promise.resolve(native?.isDeviceSecure() === true);
      } catch {
        return Promise.resolve(false);
      }
    },
  };
}

export function createBootClock(native: GuardNative | null = load()): BootClock {
  return {
    elapsedRealtime(): number | null {
      try {
        const value = native?.elapsedRealtime();
        return typeof value === 'number' ? value : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * The clock of the 7-day rule (EVM-101 AC2, SR-MOB-05): the boot clock (`elapsedRealtime`, counts deep sleep) as the monotonic
 * reading and the boot counter as the boot id, so a phone asleep in the background of a living process still ages the contact.
 * Without the native module the readings are invalid (`NaN`, empty boot id) and `evaluateContact` fails closed: the data stay hidden.
 * Without a boot counter the id is derived from the wall clock and the boot clock (a flip only falls back to the wall delta).
 */
export function createContactClock(native: GuardNative | null = load(), wall: () => number = Date.now): SessionClock {
  const elapsed = (): number | null => {
    try {
      const value = native?.elapsedRealtime();
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
  return {
    now: wall,
    monotonicNow: () => elapsed() ?? Number.NaN,
    bootId: () => {
      const real = elapsed();
      if (real === null) return '';
      let count: unknown;
      try {
        count = native?.bootCount?.();
      } catch {
        count = undefined;
      }
      if (typeof count === 'number' && Number.isInteger(count) && count >= 0) return `boot-${String(count)}`;
      return `boot-w${String(Math.round((wall() - real) / 60_000))}`;
    },
  };
}

export function createAuthenticator(texts: () => UnlockTexts, native: GuardNative | null = load()): Authenticator {
  return {
    async authenticate(): Promise<'success' | 'cancelled' | 'error'> {
      if (native === null) return 'error';
      try {
        const { title } = texts();
        const code = await native.authenticate(title);
        return code === 'success' ? 'success' : code === 'cancelled' ? 'cancelled' : 'error';
      } catch {
        return 'error';
      }
    },
  };
}

export function createPatchSource(native: GuardNative | null = load()): PatchSource {
  return {
    securityPatch(): Promise<string | null> {
      try {
        const value = native?.deviceInfo().securityPatch;
        return Promise.resolve(typeof value === 'string' && value !== '' ? value : null);
      } catch {
        return Promise.resolve(null);
      }
    },
  };
}

export const reactNativeAppState: AppStateSource = {
  current: (): AppStateName => {
    const state = AppState.currentState;
    return state === 'active' || state === 'inactive' ? state : 'background';
  },
  subscribe(listener) {
    const subscription = AppState.addEventListener('change', (next) => {
      listener(next === 'active' || next === 'inactive' ? next : 'background');
    });
    return () => {
      subscription.remove();
    };
  },
};
