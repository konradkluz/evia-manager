import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { QueueEntryRow } from '../auth/ports';
import type { DeviceGuard, GuardSnapshot } from '../device-guard/device-guard';
import type { QueueItem, QueueView, SyncControl, SyncSnapshot } from '../sync/types';
import type { AddTarget } from './AddSheet';

/** What the signed-in screens may do with the session (EVM-100 AC7, M-09; EVM-101); the owner itself stays outside the screens. */
export interface SessionActions {
  readonly displayName: string;
  readonly appVersion: string;
  /** Unsent items of the queue for the sign-out warning and the wipe dialog (a number only); called when a dialog opens. */
  readonly unsentItemCount: () => Promise<number>;
  /** Ends the session on the phone (and on the server when online); M-02 "Wylogowano" follows. */
  readonly signOut: () => Promise<void>;
  /** "Wyczyść dane firmowe" after the confirmation of M-09 (EVM-101 AC4): ends the session, runs the wipe; `false` = unfinished. */
  readonly wipeCompanyData: () => Promise<boolean>;
  /** "Zaloguj się ponownie" of the hidden-data notice (AC2): ends the session on the phone, the queue stays encrypted. */
  readonly reSignIn: () => Promise<void>;
  /** "Sprawdź ponownie" of the hidden-data notice: asks the phone again for the screen lock and the contact. */
  readonly recheckDevice: () => Promise<void>;
  /** The device controls (single store, single AppState listener). */
  readonly guard: DeviceGuard;
  /** Entries of the queue; `withLabels = false` in the hidden-data mode (the contents are not read at all). */
  readonly queueEntries: (withLabels: boolean) => Promise<QueueEntryRow[]>;
  /** The synchronization of the session (EVM-107): state, triggers, the queue and the operations on "Wymaga uwagi". */
  readonly sync: SyncControl;
  /** "Kopiuj treść": the sensitive clipboard (marked, removed after 60 s); false when it could not be done. */
  readonly copyToClipboard: (text: string) => boolean;
  /** "Utwórz ponownie" of a rejected entry: opens the form where there is one (M-10), otherwise creates it again at once. */
  readonly openRecreate: (item: QueueItem) => void;
  /** The destination of a pick in "Dodaj" (entries and quick work orders: EVM-107; the camera: E11). */
  readonly openAddTarget: (target: AddTarget) => void;
  /** "Pomoc" (M-11, EVM-102). */
  readonly openHelp: () => void;
}

export const SessionContext = createContext<SessionActions | null>(null);

export function useSession(): SessionActions {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession must be used inside SessionContext');
  return value;
}

/** Snapshot of the device controls (hidden-data mode, warning, patch banner, app lock). */
export function useGuard(): GuardSnapshot {
  const { guard } = useSession();
  return useSyncExternalStore(guard.subscribe, guard.getSnapshot);
}

/**
 * The single control point of the hidden-data mode for the queue (EVM-101 AC1, AC2, AC8; architect 5): in the mode the labels are not
 * requested from the source, and a label that still arrived is dropped here. `null` rows = not loaded yet.
 */
export function useQueueEntries(): { readonly hidden: boolean; readonly rows: readonly QueueEntryRow[] | null } {
  const session = useSession();
  const hidden = useGuard().hidden !== null;
  const [rows, setRows] = useState<readonly QueueEntryRow[] | null>(null);
  useEffect(() => {
    let active = true;
    setRows(null);
    session.queueEntries(!hidden).then(
      (loaded) => {
        if (active) setRows(hidden ? loaded.map((row) => ({ ...row, label: null })) : loaded);
      },
      () => {
        if (active) setRows([]);
      },
    );
    return () => {
      active = false;
    };
  }, [session, hidden]);
  return { hidden, rows };
}

/** The synchronization state (immutable, memoized snapshot: no render loop). */
export function useSyncSnapshot(): SyncSnapshot {
  const { sync } = useSession();
  return useSyncExternalStore(sync.subscribe, sync.getSnapshot);
}

/**
 * The queue for the "Kolejka" list (EVM-107 AC3, AC4): in the hidden-data mode the contents are not requested at all. Reloads when the
 * synchronization state changes (counts, a cycle started or ended) and on reload() after an operation.
 */
export function useQueueView(): { readonly hidden: boolean; readonly view: QueueView | null; readonly reload: () => void } {
  const { sync } = useSession();
  const hidden = useGuard().hidden !== null;
  const snapshot = useSyncSnapshot();
  const [view, setView] = useState<QueueView | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    sync.queueView(!hidden).then(
      (loaded) => {
        if (active) setView(loaded);
      },
      () => {
        if (active) setView({ items: [], sent: [] });
      },
    );
    return () => {
      active = false;
    };
  }, [sync, hidden, snapshot.counts, snapshot.syncing, tick]);
  const reload = useCallback(() => {
    setTick((n) => n + 1);
  }, []);
  return { hidden, view, reload };
}
