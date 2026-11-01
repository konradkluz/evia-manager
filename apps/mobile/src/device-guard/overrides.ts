/**
 * Answers of the device controls that the e2e variant may change (EVM-101; security K7). The object exists ONLY in the panel of the
 * e2e hooks (bundled by plugins/e2e-hooks-resolver.ts); in every other bundle `deviceOverrides` of `src/e2e-hooks` is `null`.
 */
export interface DeviceOverrides {
  /** `null` = the real answer of the phone. */
  screenSecure: boolean | null;
  /** Added to the wall and monotonic clocks of the session owner (contact with the server: days without a connection). */
  contactShiftMs: number;
  /** Added to the boot and wall clocks of the app lock (time spent in the background). */
  backgroundShiftMs: number;
}

export const NO_OVERRIDES: DeviceOverrides = { screenSecure: null, contactShiftMs: 0, backgroundShiftMs: 0 };

/** Applies the overrides to the production ports; with `null` the ports are returned untouched. */
export function overrideLock<T extends { isDeviceSecure(): Promise<boolean> }>(port: T, overrides: DeviceOverrides | null): T {
  if (overrides === null) return port;
  return {
    ...port,
    isDeviceSecure: () => (overrides.screenSecure === null ? port.isDeviceSecure() : Promise.resolve(overrides.screenSecure)),
  };
}

/**
 * The shift of the boot clock models "the phone slept this long in the background": the first read after it is set (the moment of
 * leaving the foreground) is real, the next one (the return) carries the shift, which is then spent.
 */
export function overrideBootClock<T extends { elapsedRealtime(): number | null }>(port: T, overrides: DeviceOverrides | null): T {
  if (overrides === null) return port;
  let marked = false;
  return {
    ...port,
    elapsedRealtime: () => {
      const real = port.elapsedRealtime();
      if (real === null || overrides.backgroundShiftMs === 0) return real;
      if (!marked) {
        marked = true;
        return real;
      }
      marked = false;
      const shifted = real + overrides.backgroundShiftMs;
      overrides.backgroundShiftMs = 0;
      return shifted;
    },
  };
}

export function overrideSessionClock<T extends { now(): number; monotonicNow(): number }>(clock: T, overrides: DeviceOverrides | null): T {
  if (overrides === null) return clock;
  return {
    ...clock,
    now: () => clock.now() + overrides.contactShiftMs,
    monotonicNow: () => clock.monotonicNow() + overrides.contactShiftMs,
  };
}
