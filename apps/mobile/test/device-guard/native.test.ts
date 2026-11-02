import { AppState } from 'react-native';
import {
  createAuthenticator,
  createBootClock,
  createContactClock,
  createDeviceLock,
  createPatchSource,
  reactNativeAppState,
} from '../../src/device-guard/native';
import {
  NO_OVERRIDES,
  overrideBootClock,
  overrideAuthenticator,
  overrideLock,
  overrideSessionClock,
  type DeviceOverrides,
} from '../../src/device-guard/overrides';

type Native = Parameters<typeof createDeviceLock>[0];
const native = (patch: Partial<NonNullable<Native>> = {}): NonNullable<Native> => ({
  isDeviceSecure: () => true,
  elapsedRealtime: () => 123,
  authenticate: () => Promise.resolve('success'),
  deviceInfo: () => ({ securityPatch: '2026-10-05' }),
  ...patch,
});
const boom = (): never => {
  throw new Error('native (synthetic)');
};

describe('native adapters of the device controls fail closed (EVM-101 AC1, AC3)', () => {
  it('EVM-101 AC1: the screen lock is true only when the module says true; a missing module or an exception is "no lock"', async () => {
    expect(await createDeviceLock(native()).isDeviceSecure()).toBe(true);
    expect(await createDeviceLock(native({ isDeviceSecure: () => false })).isDeviceSecure()).toBe(false);
    expect(await createDeviceLock(native({ isDeviceSecure: boom })).isDeviceSecure()).toBe(false);
    expect(await createDeviceLock(null).isDeviceSecure()).toBe(false);
  });

  it('EVM-101 AC3: the boot clock comes from the module; missing, thrown or non-numeric is null (the app lock then locks)', () => {
    expect(createBootClock(native()).elapsedRealtime()).toBe(123);
    expect(createBootClock(native({ elapsedRealtime: boom })).elapsedRealtime()).toBeNull();
    expect(createBootClock(native({ elapsedRealtime: () => 'x' as unknown as number })).elapsedRealtime()).toBeNull();
    expect(createBootClock(null).elapsedRealtime()).toBeNull();
  });

  it('EVM-101 AC2: the clock of the 7-day rule is the boot clock with the boot counter as the boot id; every gap is fail-closed', () => {
    const wall = () => 10_000_000_000;
    const clock = createContactClock(native({ elapsedRealtime: () => 5000, bootCount: () => 42 }), wall);
    expect(clock.now()).toBe(10_000_000_000);
    expect(clock.monotonicNow()).toBe(5000);
    expect(clock.bootId()).toBe('boot-42');
    // no boot counter: derived from the wall clock and the boot clock, stable within the minute
    expect(createContactClock(native({ elapsedRealtime: () => 5000, bootCount: () => -1 }), wall).bootId()).toBe(
      createContactClock(native({ elapsedRealtime: () => 5000 }), wall).bootId(),
    );
    expect(createContactClock(native({ elapsedRealtime: () => 5000, bootCount: boom }), wall).bootId()).toMatch(/^boot-w\d+$/);
    for (const broken of [null, native({ elapsedRealtime: boom }), native({ elapsedRealtime: () => Number.NaN })]) {
      const gone = createContactClock(broken, wall);
      expect(Number.isNaN(gone.monotonicNow())).toBe(true);
      expect(gone.bootId()).toBe('');
    }
  });

  it('EVM-101 AC3 (P7): the unlock passes the title ONLY - no key, alias or crypto object - and maps the codes', async () => {
    const calls: unknown[][] = [];
    const make = (code: string) =>
      createAuthenticator(
        () => ({ title: 'Odblokuj' }),
        native({
          authenticate: (...args: unknown[]) => {
            calls.push(args);
            return code === 'throws' ? Promise.reject(new Error('native (synthetic)')) : Promise.resolve(code);
          },
        }),
      );
    expect(await make('success').authenticate()).toBe('success');
    expect(await make('cancelled').authenticate()).toBe('cancelled');
    expect(await make('error').authenticate()).toBe('error');
    expect(await make('anything else').authenticate()).toBe('error');
    expect(await make('throws').authenticate()).toBe('error');
    expect(await createAuthenticator(() => ({ title: 't' }), null).authenticate()).toBe('error');
    expect(calls.every((args) => args.length === 1 && args[0] === 'Odblokuj')).toBe(true);
  });

  it('EVM-101 AC6: the patch level is the text of the module or null', async () => {
    expect(await createPatchSource(native()).securityPatch()).toBe('2026-10-05');
    expect(await createPatchSource(native({ deviceInfo: () => ({}) })).securityPatch()).toBeNull();
    expect(await createPatchSource(native({ deviceInfo: boom })).securityPatch()).toBeNull();
    expect(await createPatchSource(null).securityPatch()).toBeNull();
  });

  it('EVM-101 AC3: the AppState port maps the states and unsubscribes', () => {
    const seen: string[] = [];
    let handler: (next: string) => void = () => undefined;
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: (next: string) => void) => {
      handler = listener;
      return { remove };
    }) as never);
    const stop = reactNativeAppState.subscribe((next) => seen.push(next));
    for (const state of ['active', 'inactive', 'background', 'unknown', 'extension']) handler(state);
    expect(seen).toEqual(['active', 'inactive', 'background', 'background', 'background']);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    for (const state of ['active', 'inactive', 'background', 'unknown']) {
      Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
      expect(reactNativeAppState.current()).toBe(state === 'active' || state === 'inactive' ? state : 'background');
    }
  });
});

describe('overrides of the e2e variant (EVM-101; security K7)', () => {
  const fresh = (): DeviceOverrides => ({ ...NO_OVERRIDES });

  it('EVM-101 AC1: without overrides (every bundle but e2e) the ports are returned untouched', () => {
    const lock = { isDeviceSecure: () => Promise.resolve(true) };
    const boot = { elapsedRealtime: () => 5 };
    const clock = { now: () => 1, monotonicNow: () => 2 };
    expect(overrideLock(lock, null)).toBe(lock);
    expect(overrideBootClock(boot, null)).toBe(boot);
    expect(overrideSessionClock(clock, null)).toBe(clock);
  });

  it('EVM-101 AC1: the screen-lock answer is replaced only while set', async () => {
    const o = fresh();
    const lock = overrideLock({ isDeviceSecure: () => Promise.resolve(true) }, o);
    expect(await lock.isDeviceSecure()).toBe(true);
    o.screenSecure = false;
    expect(await lock.isDeviceSecure()).toBe(false);
  });

  it('EVM-101 AC1: the system unlock is answered by the override only while it is set; untouched without overrides', async () => {
    const real = { authenticate: () => Promise.resolve('cancelled' as const) };
    expect(overrideAuthenticator(real, null)).toBe(real);
    const o = fresh();
    const auth = overrideAuthenticator(real, o);
    expect(await auth.authenticate()).toBe('cancelled');
    o.autoUnlock = true;
    expect(await auth.authenticate()).toBe('success');
  });

  it('EVM-101 AC2: the contact clocks move together', () => {
    const o = fresh();
    o.contactShiftMs = 5 * 86_400_000;
    const clock = overrideSessionClock({ now: () => 10, monotonicNow: () => 20, bootId: () => 'b' }, o);
    expect([clock.now(), clock.monotonicNow(), clock.bootId()]).toEqual([10 + 5 * 86_400_000, 20 + 5 * 86_400_000, 'b']);
  });

  it('EVM-101 AC3: the background shift is real at the moment of leaving and counted once at the return', () => {
    const o = fresh();
    const boot = overrideBootClock({ elapsedRealtime: (): number | null => 1000 }, o);
    expect(boot.elapsedRealtime()).toBe(1000);
    o.backgroundShiftMs = 6 * 60_000;
    expect(boot.elapsedRealtime()).toBe(1000);
    expect(boot.elapsedRealtime()).toBe(1000 + 6 * 60_000);
    expect(o.backgroundShiftMs).toBe(0);
    expect(boot.elapsedRealtime()).toBe(1000);
    const none = overrideBootClock({ elapsedRealtime: () => null }, { ...fresh(), backgroundShiftMs: 5 });
    expect(none.elapsedRealtime()).toBeNull();
  });
});
