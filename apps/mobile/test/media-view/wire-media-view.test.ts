// EVM-142 AC5: the viewer may load only while a session runs, the app is in the foreground, not locked and not in the hidden-data mode.
import { MediaViewer } from '../../src/media-view/media-viewer';
import { wireMediaView } from '../../src/media-view/wire-media-view';
import type { GuardSnapshot } from '../../src/device-guard/device-guard';
import type { DeviceGuard } from '../../src/device-guard/device-guard';
import type { AppStateName } from '../../src/device-guard/ports';

function setup() {
  let guardState = { locked: false, hidden: null } as Pick<GuardSnapshot, 'locked' | 'hidden'>;
  let appState: AppStateName = 'active';
  let syncActive = true;
  const guardListeners = new Set<() => void>();
  const appListeners = new Set<() => void>();
  const syncListeners = new Set<() => void>();
  const endListeners = new Set<() => void>();
  const guard = {
    getSnapshot: () => guardState,
    subscribe: (listener: () => void) => {
      guardListeners.add(listener);
      return () => guardListeners.delete(listener);
    },
    onAppStateChange: (listener: () => void) => {
      appListeners.add(listener);
      return () => appListeners.delete(listener);
    },
    appState: { current: () => appState, subscribe: () => () => undefined },
  } as unknown as DeviceGuard;
  const viewer = new MediaViewer({
    source: {
      requestUrl: () => Promise.resolve({ kind: 'error' }),
      fetchImage: () => Promise.resolve({ kind: 'error' }),
      requestVideoUrl: () => Promise.resolve({ kind: 'error' }),
    },
    now: () => 0,
  });
  const stop = wireMediaView({
    viewer,
    guard,
    sync: {
      getSnapshot: () => ({ active: syncActive }) as never,
      subscribe: (listener) => {
        syncListeners.add(listener);
        return () => syncListeners.delete(listener);
      },
    },
    onBeforeSessionEnd: (listener) => {
      endListeners.add(listener);
      return () => endListeners.delete(listener);
    },
  });
  return {
    viewer,
    stop,
    guardListeners,
    appListeners,
    syncListeners,
    endListeners,
    setGuard: (next: Partial<typeof guardState>) => {
      guardState = { ...guardState, ...next };
      for (const listener of guardListeners) listener();
    },
    setApp: (next: AppStateName) => {
      appState = next;
      for (const listener of appListeners) listener();
    },
    setSync: (active: boolean) => {
      syncActive = active;
      for (const listener of syncListeners) listener();
    },
    end: () => {
      for (const listener of endListeners) listener();
    },
  };
}

describe('wiring of the viewer (EVM-142 AC5; SR-MOB-05)', () => {
  it('EVM-142 AC5: allowed in the foreground of an unlocked session; the lock, every hidden-data reason, the background and a stopped synchronization turn it off, and the return turns it on', () => {
    const w = setup();
    expect(w.viewer.allowed).toBe(true);
    w.setGuard({ locked: true });
    expect(w.viewer.allowed).toBe(false);
    w.setGuard({ locked: false });
    expect(w.viewer.allowed).toBe(true);
    for (const hidden of ['screen_lock_off', 'contact_expired', 'clock_anomaly', 'wipe_in_progress'] as const) {
      w.setGuard({ hidden });
      expect(w.viewer.allowed).toBe(false);
      w.setGuard({ hidden: null });
      expect(w.viewer.allowed).toBe(true);
    }
    w.setApp('background');
    expect(w.viewer.allowed).toBe(false);
    w.setApp('active');
    expect(w.viewer.allowed).toBe(true);
    w.setSync(false);
    expect(w.viewer.allowed).toBe(false);
    w.setSync(true);
    expect(w.viewer.allowed).toBe(true);
  });

  it('EVM-142 AC5: the end of the session (sign-out, session_revoked, wipe) frees the images BEFORE the replica goes; the stop removes every listener', () => {
    const w = setup();
    const ended = jest.spyOn(w.viewer, 'endSession');
    w.viewer.setAllowed(true);
    w.end();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(w.viewer.allowed).toBe(false);
    w.stop();
    expect(w.guardListeners.size + w.appListeners.size + w.syncListeners.size + w.endListeners.size).toBe(0);
  });

  it('EVM-142 AC5: the app that starts locked or without a session does not load anything', () => {
    const w = setup();
    w.setGuard({ locked: true });
    w.setSync(false);
    w.setGuard({ locked: false });
    expect(w.viewer.allowed).toBe(false);
  });
});
