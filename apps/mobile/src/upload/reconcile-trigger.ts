/**
 * When the files of the queue are reconciled again (EVM-130 architect 7): a session starts, a synchronization ends well or the number of
 * unsent items changes (a command was applied and settled, the replica brought a state of a file). Only while a session is active.
 * The reconciliation itself is single-flight, so a burst of changes is one run and one more.
 */
interface SyncView {
  subscribe(listener: () => void): () => void;
  getSnapshot(): { readonly active: boolean; readonly lastSuccessAt: number | null; readonly counts: { readonly unsent: number } };
}

export function reconcileOnSyncChange(sync: SyncView, media: { reconcile(): Promise<unknown> }): () => void {
  let seen = { active: false, last: null as number | null, unsent: -1 };
  return sync.subscribe(() => {
    const snapshot = sync.getSnapshot();
    const next = { active: snapshot.active, last: snapshot.lastSuccessAt, unsent: snapshot.counts.unsent };
    const changed = next.active !== seen.active || next.last !== seen.last || next.unsent !== seen.unsent;
    seen = next;
    if (changed && next.active) void media.reconcile();
  });
}
