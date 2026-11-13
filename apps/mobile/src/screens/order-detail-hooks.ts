import { useCallback, useEffect, useState } from 'react';
import type { HiddenReason } from '../device-guard/hidden-mode';
import type { OrderDetail } from '../orders/order-detail-model';
import { useGuard, useSession, useSyncSnapshot } from './session-context';

export type OrderDetailState =
  | { readonly kind: 'hidden'; readonly reason: HiddenReason }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly detail: OrderDetail };

type Model =
  | { readonly id: string; readonly kind: 'ready'; readonly detail: OrderDetail }
  | { readonly id: string; readonly kind: 'unavailable' }
  | { readonly id: string; readonly kind: 'error' };

/**
 * The model of the work order details (EVM-104 AC1, AC5, AC6; security K3, K4, K6). It is read from the local replica and the queue
 * when the screen opens and again whenever the synchronization reports a change (also while the screen is open), so a work order that
 * leaves the scope or is deleted becomes "unavailable" at once; the previous details stay on the screen until the new ones arrive.
 * - Hidden-data mode (`guard.hidden !== null`, fail-closed: also while the check runs): the state is `hidden` in the same render,
 *   before any effect, the stored model is dropped, and NO read with personal data is made.
 * - A late answer is dropped when the mode, the order or the data changed in the meantime (the cleanup of the older run runs first),
 *   so it can never put names, addresses or texts back. After the return from the mode the details are read afresh.
 * - Unavailable (no such order in the active generation) drops the model; only the id stays, held by the shell. Nothing is removed from
 *   the queue here. Errors are never logged (no message of the database, no id).
 */
export function useOrderDetail(orderId: string): { state: OrderDetailState; retry: () => void } {
  const { sync } = useSession();
  const reason = useGuard().hidden;
  const hidden = reason !== null;
  const snapshot = useSyncSnapshot();
  const [model, setModel] = useState<Model | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (hidden) {
      setModel(null);
      return () => {
        active = false;
      };
    }
    sync.orderDetail(orderId).then(
      (detail) => {
        if (active) setModel(detail === null ? { id: orderId, kind: 'unavailable' } : { id: orderId, kind: 'ready', detail });
      },
      () => {
        // a failed refresh keeps the details that are already shown
        if (active) setModel((current) => (current?.id === orderId && current.kind === 'ready' ? current : { id: orderId, kind: 'error' }));
      },
    );
    return () => {
      active = false;
    };
  }, [
    sync,
    orderId,
    hidden,
    attempt,
    snapshot.active,
    snapshot.syncing,
    snapshot.resyncing,
    snapshot.lastSuccessAt,
    snapshot.counts,
    snapshot.initialLoad,
  ]);
  const retry = useCallback(() => {
    setModel(null);
    setAttempt((value) => value + 1);
  }, []);
  let state: OrderDetailState;
  if (reason !== null) state = { kind: 'hidden', reason };
  else if (model === null || model.id !== orderId) state = { kind: 'loading' };
  else state = model;
  return { state, retry };
}
