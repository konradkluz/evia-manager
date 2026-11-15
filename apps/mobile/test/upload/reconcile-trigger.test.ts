import { reconcileOnSyncChange } from '../../src/upload/reconcile-trigger';

function rig() {
  const listeners = new Set<() => void>();
  const state = { active: false, lastSuccessAt: null as number | null, counts: { unsent: 0 } };
  const calls: string[] = [];
  const stop = reconcileOnSyncChange(
    {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => state,
    },
    {
      reconcile: () => {
        calls.push('reconcile');
        return Promise.resolve();
      },
    },
  );
  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return { state, calls, emit, stop, listeners };
}

describe('when the files are reconciled again (EVM-130 architect 7)', () => {
  it('EVM-130 AC1: a session that starts, a good cycle and a change of the number of unsent items each cause a reconciliation; a snapshot without change does not', () => {
    const r = rig();
    r.emit();
    expect(r.calls).toEqual([]);
    r.state.active = true;
    r.emit();
    expect(r.calls).toHaveLength(1);
    r.emit();
    expect(r.calls).toHaveLength(1);
    r.state.lastSuccessAt = 5;
    r.emit();
    expect(r.calls).toHaveLength(2);
    r.state.counts = { unsent: 3 };
    r.emit();
    expect(r.calls).toHaveLength(3);
  });

  it('EVM-130 AC1: nothing is reconciled without a session (the service is not active); the subscription can be ended', () => {
    const r = rig();
    r.state.counts = { unsent: 2 };
    r.state.lastSuccessAt = 9;
    r.emit();
    expect(r.calls).toEqual([]);
    r.stop();
    expect(r.listeners.size).toBe(0);
  });
});
