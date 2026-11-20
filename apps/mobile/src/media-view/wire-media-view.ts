import type { DeviceGuard } from '../device-guard/device-guard';
import type { SyncRuntime } from '../sync/types';
import type { MediaViewer } from './media-viewer';

/**
 * Decides when the viewer may request and hold images (EVM-142 AC5; SR-MOB-05): only while a session runs (the synchronization of the session is active), the app
 * is in the foreground, not locked and not in the hidden-data mode (any reason, the wipe included). Every other state frees the images and aborts the requests at
 * once - the screens are taken out of the tree by their own rules, this is the second safeguard for what a hidden `Activity` cannot clean. The sign-out, a revoked
 * session and the wipe call `onBeforeSessionEnd` first, so the images are gone before the replica is. Returns the function that removes the listeners.
 */
export function wireMediaView({
  viewer,
  guard,
  sync,
  onBeforeSessionEnd,
}: {
  readonly viewer: MediaViewer;
  readonly guard: DeviceGuard;
  readonly sync: Pick<SyncRuntime, 'getSnapshot' | 'subscribe'>;
  readonly onBeforeSessionEnd: (listener: () => void) => () => void;
}): () => void {
  const evaluate = (): void => {
    const state = guard.getSnapshot();
    viewer.setAllowed(sync.getSnapshot().active && !state.locked && state.hidden === null && guard.appState.current() !== 'background');
  };
  const stops = [
    guard.subscribe(evaluate),
    guard.onAppStateChange(evaluate),
    sync.subscribe(evaluate),
    onBeforeSessionEnd(() => {
      viewer.setAllowed(false);
    }),
  ];
  evaluate();
  return () => {
    for (const stop of stops) stop();
  };
}
