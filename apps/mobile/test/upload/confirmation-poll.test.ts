// The app asks for the confirmation of the sent files itself (EVM-111 AC2, AC5): right after the transfer, then at growing intervals, only while the app
// can show and use the data. Artificial clock; fakes of the sources - the real composition is in session.ts.
import { CONFIRMATION_DELAYS_MS, CONFIRMATION_REPEAT_MS, pollConfirmation } from '../../src/upload/confirmation-poll';

function source<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: Partial<T>): void => {
      value = { ...value, ...next };
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    count: () => listeners.size,
  };
}

function rig(over?: { awaiting?: boolean }) {
  const files = source<{ files: readonly { awaitsConfirmation?: boolean }[]; read?: 'loading' | 'ready' | 'failed' }>({
    files: over?.awaiting === false ? [] : [{ awaitsConfirmation: true }],
    read: 'ready',
  });
  const guard = source({ locked: false, hidden: null as string | null, wiping: false });
  const sync = source({ active: true, online: true, paused: null as string | null, syncing: false, retryAt: null as number | null });
  let appState: 'active' | 'background' | 'inactive' = 'active';
  const appListeners = new Set<() => void>();
  const pulls: number[] = [];
  const stop = pollConfirmation({
    files: { subscribe: files.subscribe, getSnapshot: files.get },
    guard: { subscribe: guard.subscribe, getSnapshot: guard.get },
    appState: {
      current: () => appState,
      subscribe: (listener) => {
        appListeners.add(listener);
        return () => {
          appListeners.delete(listener);
        };
      },
    },
    sync: {
      subscribe: sync.subscribe,
      getSnapshot: sync.get,
      foreground: () => {
        pulls.push(Date.now());
      },
    },
  });
  return {
    files,
    guard,
    sync,
    pulls,
    stop,
    appListeners,
    setApp: (next: 'active' | 'background' | 'inactive'): void => {
      appState = next;
      for (const listener of [...appListeners]) listener();
    },
  };
}

const at = (pulls: readonly number[], start: number): number[] => pulls.map((p) => p - start);

describe('the confirmation is asked for without the user (EVM-111 AC2, AC5)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('EVM-111 AC2: the intervals are 5, 10, 20, 40 s and then every 60 s', () => {
    expect(CONFIRMATION_DELAYS_MS).toEqual([5000, 10000, 20000, 40000]);
    expect(CONFIRMATION_REPEAT_MS).toBe(60000);
  });

  it('EVM-111 AC2: a file after the transfer is asked about at once, then after 5, 10, 20, 40 s and every 60 s while it is there', () => {
    const r = rig();
    expect(r.pulls).toHaveLength(1);
    jest.advanceTimersByTime(5000 + 10000 + 20000 + 40000 + 60000 + 60000);
    expect(at(r.pulls, 1_000_000)).toEqual([0, 5000, 15000, 35000, 75000, 135000, 195000]);
    r.stop();
  });

  it('EVM-111 AC2: nothing is asked while no file waits for a confirmation, and the asking starts when one appears (also after the read of the table)', () => {
    const r = rig({ awaiting: false });
    jest.advanceTimersByTime(120000);
    expect(r.pulls).toEqual([]);
    r.files.set({ files: [{ awaitsConfirmation: true }] });
    expect(r.pulls).toHaveLength(1);
    r.stop();
  });

  it('EVM-111 AC2: a table that is not read (loading, failed) is no reason to ask', () => {
    const r = rig();
    r.files.set({ read: 'failed' });
    const before = r.pulls.length;
    jest.advanceTimersByTime(300000);
    expect(r.pulls).toHaveLength(before);
    r.files.set({ read: 'ready' });
    expect(r.pulls).toHaveLength(before + 1);
    r.stop();
  });

  it('EVM-111 AC2: the asking stops when the confirmation came (no file is left) and the next file starts it from the first interval again', () => {
    const r = rig();
    jest.advanceTimersByTime(5000);
    expect(r.pulls).toHaveLength(2);
    r.files.set({ files: [] });
    jest.advanceTimersByTime(300000);
    expect(r.pulls).toHaveLength(2);
    const start = Date.now();
    r.files.set({ files: [{ awaitsConfirmation: true }] });
    jest.advanceTimersByTime(5000);
    expect(at(r.pulls.slice(2), start)).toEqual([0, 5000]);
    r.stop();
  });

  it('EVM-111 AC2: a file that is only waiting or sending (not after the transfer) is no reason to ask', () => {
    const r = rig({ awaiting: false });
    r.files.set({ files: [{}, {}] });
    jest.advanceTimersByTime(120000);
    expect(r.pulls).toEqual([]);
    r.stop();
  });

  it('EVM-111 AC2: in the background nothing is asked, also not by a timer already set; the return starts it again from the first interval', () => {
    const r = rig();
    jest.advanceTimersByTime(5000);
    expect(r.pulls).toHaveLength(2);
    r.setApp('background');
    jest.advanceTimersByTime(300000);
    expect(r.pulls).toHaveLength(2);
    const start = Date.now();
    r.setApp('active');
    jest.advanceTimersByTime(5000);
    expect(at(r.pulls.slice(2), start)).toEqual([0, 5000]);
    r.stop();
  });

  it('EVM-111 AC2: the system dialog ("inactive") is not the foreground either', () => {
    const r = rig();
    const before = r.pulls.length;
    r.setApp('inactive');
    jest.advanceTimersByTime(120000);
    expect(r.pulls).toHaveLength(before);
    r.stop();
  });

  it.each([
    ['the app lock', { locked: true }],
    ['the hidden-data mode', { hidden: 'seven_days' }],
    ['a company wipe', { wiping: true }],
  ])('EVM-111 AC2: with %s nothing is asked; after it ends the asking starts again', (_name, guardState) => {
    const r = rig();
    jest.advanceTimersByTime(5000);
    const before = r.pulls.length;
    r.guard.set(guardState);
    jest.advanceTimersByTime(300000);
    expect(r.pulls).toHaveLength(before);
    r.guard.set({ locked: false, hidden: null, wiping: false });
    expect(r.pulls).toHaveLength(before + 1);
    r.stop();
  });

  it('EVM-111 AC2: offline nothing is asked; the network back starts the asking again', () => {
    const r = rig();
    jest.advanceTimersByTime(5000);
    const before = r.pulls.length;
    r.sync.set({ online: false });
    jest.advanceTimersByTime(300000);
    expect(r.pulls).toHaveLength(before);
    r.sync.set({ online: true });
    expect(r.pulls).toHaveLength(before + 1);
    r.stop();
  });

  it('EVM-111 AC2, AC5: after session_revoked (or any other pause) and after the end of the session nothing is asked', () => {
    const r = rig();
    jest.advanceTimersByTime(5000);
    const before = r.pulls.length;
    r.sync.set({ paused: 'session_revoked' });
    jest.advanceTimersByTime(300000);
    expect(r.pulls).toHaveLength(before);
    r.sync.set({ paused: null, active: false });
    jest.advanceTimersByTime(300000);
    expect(r.pulls).toHaveLength(before);
    r.stop();
  });

  it('EVM-111 AC2: no overlapping downloads - a cycle in flight is not asked again; the next interval comes as usual', () => {
    const r = rig();
    expect(r.pulls).toHaveLength(1);
    r.sync.set({ syncing: true });
    jest.advanceTimersByTime(5000);
    expect(r.pulls).toHaveLength(1);
    r.sync.set({ syncing: false });
    jest.advanceTimersByTime(10000);
    expect(r.pulls).toHaveLength(2);
    r.stop();
  });

  it('EVM-111 AC2: a failed download is no loop - changes of the snapshot do not ask again before the next interval; the failure is the next interval', () => {
    const r = rig();
    expect(r.pulls).toHaveLength(1);
    // a cycle that fails flips the snapshot several times (syncing, failure) - none of it is a reason to ask at once
    for (let n = 0; n < 5; n += 1) {
      r.sync.set({ syncing: true });
      r.sync.set({ syncing: false });
    }
    r.files.set({ files: [{ awaitsConfirmation: true }] });
    expect(r.pulls).toHaveLength(1);
    jest.advanceTimersByTime(4999);
    expect(r.pulls).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(r.pulls).toHaveLength(2);
    jest.advanceTimersByTime(9999);
    expect(r.pulls).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(r.pulls).toHaveLength(3);
    r.stop();
  });

  it('EVM-111 AC2 (rate limit): a retryAt in the future of the synchronization postpones the next asking to max(interval, retryAt - now)', () => {
    const r = rig();
    expect(r.pulls).toHaveLength(1);
    // the cycle that was just started ends with a 429: the server wants 30 s
    r.sync.set({ retryAt: Date.now() + 30000 });
    jest.advanceTimersByTime(29999);
    expect(r.pulls).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(at(r.pulls, 1_000_000)).toEqual([0, 30000]);
    // a wait shorter than the interval changes nothing: the next one is still the interval (10 s)
    r.sync.set({ retryAt: Date.now() + 2000 });
    jest.advanceTimersByTime(9999);
    expect(r.pulls).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(r.pulls).toHaveLength(3);
    r.stop();
  });

  it('EVM-111 AC2 (rate limit): a retryAt that is already known when the interval is set is honoured, and a past one is ignored', () => {
    const r = rig();
    jest.advanceTimersByTime(5000);
    expect(r.pulls).toHaveLength(2);
    r.sync.set({ retryAt: Date.now() - 1 });
    jest.advanceTimersByTime(10000);
    expect(r.pulls).toHaveLength(3);
    r.sync.set({ retryAt: Date.now() + 90000 });
    jest.advanceTimersByTime(89999);
    expect(r.pulls).toHaveLength(3);
    jest.advanceTimersByTime(1);
    expect(r.pulls).toHaveLength(4);
    r.stop();
  });

  it('EVM-111 AC2 (flicker): a condition that flips every second never gives more than one asking per 5 s', () => {
    const r = rig();
    expect(r.pulls).toHaveLength(1);
    for (let second = 1; second <= 20; second += 1) {
      r.sync.set({ online: second % 2 === 0 });
      jest.advanceTimersByTime(1000);
    }
    const times = at(r.pulls, 1_000_000);
    for (let n = 1; n < times.length; n += 1) expect((times[n] ?? 0) - (times[n - 1] ?? 0)).toBeGreaterThanOrEqual(5000);
    expect(times.length).toBeLessThanOrEqual(5);
    r.stop();
  });

  it('EVM-111 AC2 (flicker): a resume within 5 s of the last asking waits for the rest of the gap; a resume after a longer pause asks at once', () => {
    const r = rig();
    jest.advanceTimersByTime(2000);
    r.sync.set({ online: false });
    jest.advanceTimersByTime(1000);
    r.sync.set({ online: true });
    expect(r.pulls).toHaveLength(1);
    jest.advanceTimersByTime(1999);
    expect(r.pulls).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(r.pulls).toHaveLength(2);
    r.sync.set({ online: false });
    jest.advanceTimersByTime(60000);
    r.sync.set({ online: true });
    expect(r.pulls).toHaveLength(3);
    r.stop();
  });

  it('EVM-111 AC2: the end of the poll cancels the timer and removes every subscription', () => {
    const r = rig();
    r.stop();
    jest.advanceTimersByTime(300000);
    expect(r.pulls).toHaveLength(1);
    r.files.set({ files: [{ awaitsConfirmation: true }] });
    r.setApp('background');
    r.setApp('active');
    expect(r.pulls).toHaveLength(1);
    expect(r.appListeners.size).toBe(0);
    expect(r.files.count()).toBe(0);
    expect(r.guard.count()).toBe(0);
    expect(r.sync.count()).toBe(0);
  });
});
