/**
 * The app asks for the confirmation of the sent files by itself (EVM-111 AC2, AC5). A file the module has sent leaves the list only when the replica says the
 * server accepted it, and the replica is read by the synchronization - so while such a file is there, the SAME download that a return to the foreground starts is
 * started again: at once, then after 5, 10, 20, 40 s and every 60 s. No second mechanism: this only calls `sync.foreground()` (one cycle at a time inside the
 * service; the confirmation itself is `reconcileOnSyncChange` -> `MediaUploads.reconcile`, the native engine is untouched).
 *
 * It runs only while the data may be used and the network is there: the app in the foreground, not locked, not in the hidden-data mode, no wipe, a synchronization
 * of this session that is active, online and not paused (`session_revoked` is one of the pauses). Any of those lost = the timer is cancelled and the next interval
 * starts from the beginning when it returns. The asking never loops on an error: the next interval is the answer to a failure, a change of a snapshot never asks again.
 */
import type { MediaUploadsSnapshot } from './types';

/** The pauses before the next asking, one after another; after the last one {@link CONFIRMATION_REPEAT_MS} repeats. */
export const CONFIRMATION_DELAYS_MS: readonly number[] = [5000, 10000, 20000, 40000];
export const CONFIRMATION_REPEAT_MS = 60000;

type Subscribe = (listener: () => void) => () => void;

export interface ConfirmationPollDeps {
  readonly files: {
    subscribe: Subscribe;
    getSnapshot: () => Pick<MediaUploadsSnapshot, 'read'> & { readonly files: readonly { readonly awaitsConfirmation?: boolean }[] };
  };
  readonly guard: {
    subscribe: Subscribe;
    getSnapshot: () => { readonly locked: boolean; readonly hidden: unknown; readonly wiping: boolean };
  };
  readonly appState: { current: () => string; subscribe: Subscribe };
  readonly sync: {
    subscribe: Subscribe;
    getSnapshot: () => { readonly active: boolean; readonly online: boolean; readonly paused: unknown; readonly syncing: boolean };
    foreground: () => void;
  };
}

/** Starts watching; returns the function that ends it (timer and subscriptions). */
export function pollConfirmation(deps: ConfirmationPollDeps): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let step = 0;
  let running = false;

  const wanted = (): boolean => {
    const files = deps.files.getSnapshot();
    const guard = deps.guard.getSnapshot();
    const sync = deps.sync.getSnapshot();
    return (
      (files.read === undefined || files.read === 'ready') &&
      files.files.some((file) => file.awaitsConfirmation === true) &&
      deps.appState.current() === 'active' &&
      !guard.locked &&
      guard.hidden === null &&
      !guard.wiping &&
      sync.active &&
      sync.online &&
      sync.paused === null
    );
  };

  const halt = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    running = false;
    step = 0;
  };

  const tick = (): void => {
    timer = undefined;
    if (!wanted()) {
      halt();
      return;
    }
    // one download at a time: a cycle in flight is not asked again - this interval only passes
    if (!deps.sync.getSnapshot().syncing) deps.sync.foreground();
    const delay = CONFIRMATION_DELAYS_MS[step] ?? CONFIRMATION_REPEAT_MS;
    step += 1;
    timer = setTimeout(tick, delay);
  };

  const evaluate = (): void => {
    if (!wanted()) {
      if (running) halt();
      return;
    }
    if (running) return;
    running = true;
    step = 0;
    tick();
  };

  const subscriptions = [
    deps.files.subscribe(evaluate),
    deps.guard.subscribe(evaluate),
    deps.sync.subscribe(evaluate),
    deps.appState.subscribe(evaluate),
  ];
  evaluate();
  return () => {
    for (const unsubscribe of subscriptions) unsubscribe();
    halt();
  };
}
