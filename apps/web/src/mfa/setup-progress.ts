import { useSyncExternalStore } from 'react';

/**
 * "The second step is set, the recovery codes are not yet written down" (W-03 step 3). The method became active, so the
 * session is already `active` — without this mark the session gate would take the tab to the panel before the codes are
 * shown (they are shown once). It lives in the memory of the tab only (never storage, address or title): a refresh drops
 * it and the panel opens — the codes are never shown a second time (flows/01 W-03, offline).
 */
let finishing = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSetupFinishing(value: boolean): void {
  if (finishing === value) return;
  finishing = value;
  for (const listener of listeners) listener();
}

export function useSetupFinishing(): boolean {
  return useSyncExternalStore(subscribe, () => finishing);
}
