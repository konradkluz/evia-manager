import { useEffect, useState } from 'react';
import { redactRows, type OrderRow } from '../orders/order-list-model';
import { useGuard, useSession, useSyncSnapshot } from './session-context';

interface Model {
  readonly rows: readonly OrderRow[];
  /** Built without personal data (the hidden-data mode). */
  readonly redacted: boolean;
}

/**
 * The model of "Moje zlecenia" (EVM-103 AC1, AC5; security K5). It is read from the local replica and the queue when the screen opens
 * and again whenever the synchronization reports a change (a cycle ended, the counts changed, a refresh of the replica, a new time of
 * the last success); the previous rows stay on the screen until the new ones arrive (no flicker).
 * - Hidden-data mode: `guard.hidden !== null` (fail-closed: also while the check runs). The model is replaced by its redacted version
 *   at once - in the same render, before any effect - and only reads without personal data are made.
 * - A late answer of a read with data is dropped when the mode changed in the meantime (the effect of the older run is cleaned up
 *   first), so it can never put names or addresses back.
 * - `null` = nothing loaded yet. After the return from the hidden-data mode the list starts empty and is read afresh.
 */
export function useOrderList(): readonly OrderRow[] | null {
  const { sync } = useSession();
  const hidden = useGuard().hidden !== null;
  const snapshot = useSyncSnapshot();
  const [model, setModel] = useState<Model | null>(null);
  useEffect(() => {
    let active = true;
    if (hidden) {
      setModel((current) => (current === null || current.redacted ? current : { rows: redactRows(current.rows), redacted: true }));
    }
    sync.orderList(!hidden).then(
      (rows) => {
        if (active) setModel({ rows, redacted: hidden });
      },
      () => {
        if (active) setModel((current) => current ?? { rows: [], redacted: hidden });
      },
    );
    return () => {
      active = false;
    };
  }, [sync, hidden, snapshot.active, snapshot.syncing, snapshot.resyncing, snapshot.lastSuccessAt, snapshot.counts, snapshot.initialLoad]);
  if (model === null) return null;
  if (hidden) return model.redacted ? model.rows : redactRows(model.rows);
  return model.redacted ? null : model.rows;
}
