/**
 * Ports of the device controls (EVM-101; SR-MOB-03/05/06, P7): each native surface sits behind a thin port so the whole state machine
 * is tested in Jest (ADR-0015). Production adapters: `native.ts` (module `evia-keystore`, React Native `AppState`). The e2e variant
 * replaces the answers through `src/e2e-hooks` (bundle-time slot) — never through a setter of these modules (security K7).
 */

/** The phone has a screen lock (PIN, pattern, password or biometrics behind one). Any failure counts as "no lock" (fail-closed). */
export interface DeviceLock {
  isDeviceSecure(): Promise<boolean>;
}

/**
 * Time since the phone booted, counting deep sleep (Android `SystemClock.elapsedRealtime`, CLOCK_BOOTTIME). `null` = the native module
 * is not available: the app lock then locks (architect 3). `performance.now()` is NOT such a clock — it stops while the phone sleeps.
 */
export interface BootClock {
  elapsedRealtime(): number | null;
}

/**
 * The system unlock (BiometricPrompt, `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`). It is a UI gate only: the port has no key, no
 * `CryptoObject` and no parameter that could carry one (P7). `cancelled` and `error` leave the app locked.
 */
export interface Authenticator {
  authenticate(): Promise<'success' | 'cancelled' | 'error'>;
}

export type AppStateName = 'active' | 'background' | 'inactive';

/** The single `AppState` listener of the app (one for the whole guard, not one per screen). */
export interface AppStateSource {
  current(): AppStateName;
  subscribe(listener: (next: AppStateName) => void): () => void;
}

/** Facts about the system patch level (`Build.VERSION.SECURITY_PATCH`), as text `YYYY-MM-DD`; `null` = unknown. */
export interface PatchSource {
  securityPatch(): Promise<string | null>;
}
