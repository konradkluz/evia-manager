import { AppLock, APP_LOCK_AFTER_MS } from '../../src/device-guard/app-lock';
import { MIN } from './fakes';

function lock() {
  const time = { boot: 10_000_000 as number | null | 'throws' | 'nan', wall: 1_000_000_000 };
  const appLock = new AppLock({
    boot: {
      elapsedRealtime: () => {
        if (time.boot === 'throws') throw new Error('native (synthetic)');
        return time.boot === 'nan' ? Number.NaN : time.boot;
      },
    },
    wall: () => time.wall,
  });
  appLock.unlock();
  return { appLock, time };
}

/** Leaves the foreground, lets `boot` and `wall` pass, returns. */
function away(l: ReturnType<typeof lock>, boot: number, wall: number = boot): boolean {
  l.appLock.enteredBackground();
  if (typeof l.time.boot === 'number') l.time.boot += boot;
  l.time.wall += wall;
  return l.appLock.returned();
}

describe('lock of the app after 5 minutes in the background (EVM-101 AC3, P7)', () => {
  it('EVM-101 AC3: a cold start is locked before anything is rendered', () => {
    expect(new AppLock({ boot: { elapsedRealtime: () => 1 }, wall: () => 1 }).locked).toBe(true);
  });

  it.each([
    [0, false],
    [4 * MIN, false],
    [APP_LOCK_AFTER_MS, false],
    [APP_LOCK_AFTER_MS + 1, true],
    [6 * MIN, true],
    [30 * MIN, true],
  ])('EVM-101 AC3: %s ms away on both clocks -> locked: %s', (ms, locked) => {
    expect(away(lock(), ms)).toBe(locked);
  });

  it('EVM-101 AC3 (security W1): a phone asleep for 30 minutes locks even when the wall clock moved little - the boot clock decides', () => {
    expect(away(lock(), 30 * MIN, 1_000)).toBe(true);
  });

  it('EVM-101 AC3: the wall clock moved forward by more than 5 minutes locks even when the boot clock did not', () => {
    expect(away(lock(), 1_000, 6 * MIN)).toBe(true);
  });

  it('EVM-101 AC3: a wall clock set back never skips the lock', () => {
    expect(away(lock(), 1_000, -10 * MIN)).toBe(true);
  });

  it('EVM-101 AC3: a boot clock that went back (a restart) locks', () => {
    const l = lock();
    l.appLock.enteredBackground();
    l.time.boot = 5;
    expect(l.appLock.returned()).toBe(true);
  });

  it.each([null, 'throws', 'nan'] as const)(
    'EVM-101 AC3: an unavailable boot clock (%s) locks - the native module failed, fail-closed',
    (state) => {
      const l = lock();
      l.time.boot = state;
      l.appLock.enteredBackground();
      l.time.boot = 5_000_000;
      expect(l.appLock.returned()).toBe(true);
    },
  );

  it('EVM-101 AC3: a stay in the background counts from its first moment (inactive then background)', () => {
    const l = lock();
    l.appLock.enteredBackground();
    l.time.boot = 10_000_000 + 4 * MIN;
    l.time.wall += 4 * MIN;
    l.appLock.enteredBackground();
    l.time.boot += 2 * MIN;
    l.time.wall += 2 * MIN;
    expect(l.appLock.returned()).toBe(true);
  });

  it('EVM-101 AC3: returning without leaving does nothing; a locked app stays locked until the unlock', () => {
    const l = lock();
    expect(l.appLock.returned()).toBe(false);
    away(l, 6 * MIN);
    l.appLock.enteredBackground();
    expect(l.appLock.returned()).toBe(true);
    l.appLock.unlock();
    expect(l.appLock.locked).toBe(false);
    l.appLock.lock();
    expect(l.appLock.locked).toBe(true);
  });
});
