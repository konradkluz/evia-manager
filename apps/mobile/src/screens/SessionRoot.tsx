import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { View as Box } from 'react-native';
import { color } from '../ui/theme';
import { LoginMachine, type BlockedVariant } from '../auth/login-machine';
import type { WipeSignal } from '../auth/ports';
import type { DeviceCheck, SessionControl, SessionStep } from '../auth/session-owner';
import type { DeviceGuard } from '../device-guard/device-guard';
import { useStartup } from '../startup';
import type { QueueItem, SyncRuntime } from '../sync/types';
import { DeviceStateScreen, QueuePreviewScreen, type DeviceStateVariant } from './DeviceStateScreen';
import { LocalDataLostScreen } from './LocalDataScreens';
import { LoginScreen, useOfflineRecheck } from './LoginScreen';
import { LockGate } from './LockOverlay';
import { SessionContext, type SessionActions } from './session-context';
import type { AddTarget } from './AddSheet';
import { SyncGate } from './SyncGate';
import { OwnerMismatchDialog } from './WipeDialogs';

/** Everything the session part of the app needs; composed in App.tsx (architect 6). */
export interface SessionPorts {
  readonly owner: SessionControl;
  readonly wipe: WipeSignal;
  /** Unsent items before a sign-in ("Aktualizacja wymagana", the second-step variants); `null` = unknown. */
  readonly unsentBeforeSignIn: () => Promise<number | null>;
  /** "Nie pamiętasz hasła?": the panel in the browser (a fixed address). */
  readonly openForgotPassword: () => void;
  /** "Pomoc" (M-11, EVM-102). */
  readonly openHelp: () => void;
  /** Whether the phone has a screen lock; asked before the password is sent (EVM-101 AC1). */
  readonly screenLockOk: () => Promise<boolean>;
  /** The device controls of EVM-101 (screen lock, 7 days, app lock, patch level); one store, one `AppState` listener. */
  readonly guard: DeviceGuard;
  /** The wipe of company data (EVM-101 AC4, AC5): the number for the dialog and the run without a question to the server. */
  readonly companyWipe: {
    unsentItemCount(): Promise<number>;
    runManual(): Promise<'done' | 'incomplete'>;
  };
  /** Destination of a pick in "Dodaj" (EVM-107 / E11 provide the screens). */
  readonly openAddTarget: (target: AddTarget) => void;
  /** A new id (UUIDv7) for an entry created on the phone (EVM-105): the generator of the session, CSPRNG. */
  readonly newId: () => string;
  /** The synchronization of the session (EVM-107): the service is started here after the sign-in and stopped when it ends. */
  readonly sync: SyncRuntime;
  /** The sensitive clipboard (marked, removed after 60 s); `false` = not copied. */
  readonly copyToClipboard: (text: string) => boolean;
  /** "Utwórz ponownie": opens the form of the quick work order (M-10) once it exists; without it the entry is created again at once. */
  readonly openRecreate?: (item: QueueItem) => void;
  readonly appVersion: string;
  readonly now?: () => number;
}

/** Blocking variants that tell about the unsent items of the account (UX 01 M-02 and 16). */
const COUNTS_BEFORE_SIGN_IN: readonly BlockedVariant[] = ['client_version_unsupported', 'totp_not_configured', 'mfa_enrollment_required'];

type View =
  | { readonly kind: 'starting' }
  | { readonly kind: 'signIn' }
  | { readonly kind: 'state'; readonly variant: DeviceStateVariant; readonly unsent: number | null; readonly fromSignIn: boolean }
  | { readonly kind: 'queuePreview'; readonly unsent: number | null }
  | { readonly kind: 'dataLost'; readonly check: Extract<DeviceCheck, { kind: 'data_lost' }> }
  | { readonly kind: 'ownerMismatch'; readonly unsent: number }
  | { readonly kind: 'signedIn' };

/**
 * The session gate of the app (EVM-100): no session → M-01; a blocking answer → M-02; a session → the device check (EVM-101/EVM-107,
 * a stand-in here: only "data lost" of EVM-093 is shown) → the shell. A signed-in start makes no request (AC6); when the network is
 * there the session is refreshed in the background (AC4 "przy starcie") and pending revocations are sent (AC7).
 */
export function SessionRoot({ ports, children }: { ports: SessionPorts; children: ReactNode }) {
  const { owner, wipe, guard } = ports;
  const now = ports.now ?? Date.now;
  const { state: startup, retry: recheckConnection } = useStartup();
  const online = startup.kind === 'online';
  const [view, setView] = useState<View>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const refreshedAtStart = useRef(false);

  const guardState = useSyncExternalStore(guard.subscribe, guard.getSnapshot);
  useEffect(() => guard.start(), [guard]);
  const { sync } = ports;
  const syncSnapshot = useSyncExternalStore(sync.subscribe, sync.getSnapshot);

  // The synchronization starts only for a signed-in session whose owner check has passed (the store exists only then) and while no
  // wipe runs; it ends with the view (EVM-107 security S2, S3). The owner stops it itself before it removes the replica.
  const syncAllowed = view.kind === 'signedIn' && !guardState.wiping;
  useEffect(() => {
    if (!syncAllowed) return undefined;
    sync.startSession();
    return () => {
      sync.stop();
    };
  }, [syncAllowed, sync]);
  useEffect(() => {
    sync.setOnline(online);
  }, [sync, online]);
  // A failed cycle may mean that the connection was lost while the app runs: check again, so the capsule can say "Offline" and the
  // slow recheck of the startup provider notices the return of the network.
  // Started offline and kept in the foreground: the connection is asked again by itself (10 s, doubling to 60 s), so the queue is
  // sent when the network returns (EVM-107 AC2 "wraca sieć").
  useOfflineRecheck(view.kind === 'signedIn' && startup.kind === 'offline', recheckConnection);
  const cycleFailed = syncSnapshot.failure !== null;
  useEffect(() => {
    if (cycleFailed && online) recheckConnection();
  }, [cycleFailed, online, recheckConnection]);
  useEffect(
    () =>
      sync.onPause((reason) => {
        // 401 is the owner's (it ends the session itself); 426 and 403 are answered with a state of EVM-100, nothing is removed
        const unsent = sync.getSnapshot().counts.unsent;
        if (reason === 'upgrade_required') setView({ kind: 'state', variant: 'client_version_unsupported', unsent, fromSignIn: false });
        else if (reason === 'forbidden') setView({ kind: 'state', variant: 'channel_not_allowed', unsent, fromSignIn: false });
      }),
    [sync],
  );

  const afterStep = useCallback(
    (step: SessionStep, fresh = false): 'done' | 'failed' => {
      if (step.kind === 'signed_in') {
        // a full sign-in (password and code) is an authentication of the user: the app lock opens; a restored session stays locked
        if (fresh) void guard.signedIn();
        else void guard.refresh();
        setView({ kind: 'signedIn' });
        return 'done';
      }
      if (step.kind === 'device_check' && step.result.kind === 'owner_mismatch') {
        setView({ kind: 'ownerMismatch', unsent: step.result.unsentItemCount });
        return 'done';
      }
      if (step.kind === 'device_check' && step.result.kind === 'data_lost') {
        setView({ kind: 'dataLost', check: step.result });
        return 'done';
      }
      // the other device checks belong to EVM-101/EVM-107; until then the session of step 2 is dropped (nothing was stored) and
      // ended on the server (the owner keeps a pending revocation when it cannot ask)
      void owner.abandonSignIn();
      setView({ kind: 'signIn' });
      return 'failed';
    },
    [owner, guard],
  );

  const machine = useMemo(
    () =>
      new LoginMachine({
        signIn: owner.signInClient(),
        wipe,
        now,
        screenLockOk: ports.screenLockOk,
        onSession: async (session) => {
          const result = afterStep(await owner.completeSignIn(session), true);
          if (result === 'done') {
            // a fresh access token is in memory: no refresh "at start" for this session
            refreshedAtStart.current = true;
            void owner.flushPendingRevocation();
          }
          return result;
        },
      }),
    // a new machine for every visit of M-01: nothing of an earlier form survives
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `attempt` renews the machine on purpose
    [owner, wipe, afterStep, attempt, ports.screenLockOk],
  );
  useEffect(
    () => () => {
      machine.dispose();
    },
    [machine],
  );
  const login = useSyncExternalStore(machine.subscribe, machine.getState);

  useEffect(() => {
    let active = true;
    void owner.restore().then((step) => {
      if (!active) return;
      if (step.kind === 'signed_out' || step.kind === 'failed') setView({ kind: 'signIn' });
      else afterStep(step);
    });
    return () => {
      active = false;
    };
  }, [owner, afterStep]);

  useEffect(
    () =>
      owner.onSessionEnded((ended) => {
        guard.signedOut();
        setView({ kind: 'state', variant: ended.reason, unsent: ended.unsentItems, fromSignIn: false });
      }),
    [owner, guard],
  );

  // a blocking answer of the sign-in becomes its M-02 variant; the number of unsent items only where the copy has it
  useEffect(() => {
    const variant = login.blocked;
    if (variant === null) return undefined;
    let active = true;
    setView({ kind: 'state', variant, unsent: null, fromSignIn: true });
    if (COUNTS_BEFORE_SIGN_IN.includes(variant)) {
      void ports.unsentBeforeSignIn().then((unsent) => {
        if (active) setView({ kind: 'state', variant, unsent, fromSignIn: true });
      });
    }
    return () => {
      active = false;
    };
  }, [login.blocked, ports]);

  useEffect(() => {
    if (!online) return;
    void owner.flushPendingRevocation();
    if (view.kind === 'signedIn' && !refreshedAtStart.current) {
      refreshedAtStart.current = true;
      void owner.refresh();
    }
  }, [online, view.kind, owner]);

  const toSignIn = useCallback(() => {
    refreshedAtStart.current = false;
    setAttempt((n) => n + 1);
    setView({ kind: 'signIn' });
  }, []);

  const actions = useMemo<SessionActions>(
    () => ({
      displayName: owner.displayName() ?? '',
      appVersion: ports.appVersion,
      unsentItemCount: () => owner.unsentItemCount(),
      signOut: async () => {
        await owner.signOut({ online });
      },
      wipeCompanyData: async () => {
        await owner.endSessionForWipe({ online });
        const done = (await ports.companyWipe.runManual()) === 'done';
        // only a finished wipe leaves the shell: "Wylogowano" then says the truth (nothing unsent is left to count); an unfinished
        // one keeps the dialog with its retry
        if (done) {
          guard.signedOut();
          setView({ kind: 'state', variant: 'signed_out', unsent: 0, fromSignIn: false });
        }
        return done;
      },
      reSignIn: async () => {
        await owner.signOut({ online });
      },
      recheckDevice: () => guard.refresh(),
      guard,
      queueEntries: (withLabels) => owner.queueEntries(withLabels),
      sync,
      copyToClipboard: ports.copyToClipboard,
      openRecreate:
        ports.openRecreate ??
        ((item) => {
          void sync.recreate(item.id);
        }),
      openAddTarget: ports.openAddTarget,
      newId: ports.newId,
      openHelp: ports.openHelp,
    }),
    // the name is read again whenever the view changes (a new sign-in)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `view` refreshes the display name
    [owner, ports, online, view, guard, sync],
  );

  switch (view.kind) {
    case 'starting':
      return null;
    case 'signedIn':
      return (
        <SessionContext.Provider value={actions}>
          <LockGate
            locked={guardState.locked}
            prompting={guardState.prompting}
            onUnlock={() => {
              void guard.unlock();
            }}
          >
            <SyncGate
              snapshot={syncSnapshot}
              onRetry={() => {
                sync.trigger();
              }}
              onHelp={ports.openHelp}
            >
              {children}
            </SyncGate>
          </LockGate>
        </SessionContext.Provider>
      );
    case 'ownerMismatch':
      return (
        <Box style={{ flex: 1, backgroundColor: color.bg.canvas }}>
          <OwnerMismatchDialog
            unsentItems={view.unsent}
            onCancel={() => {
              // nothing is removed; the session of step 2 was only in memory and is ended on the server
              void owner.abandonSignIn();
              toSignIn();
            }}
            onConfirm={async () => {
              await owner.abandonSignIn();
              if ((await ports.companyWipe.runManual()) === 'done') toSignIn();
            }}
          />
        </Box>
      );
    case 'dataLost':
      return (
        <LocalDataLostScreen
          onAcknowledge={() => {
            void view.check
              .acknowledge()
              .then((result) => owner.continueDeviceCheck(result))
              .then(afterStep);
          }}
        />
      );
    case 'queuePreview':
      return (
        <QueuePreviewScreen
          unsentItems={view.unsent}
          onBack={() => {
            setView({ kind: 'state', variant: 'client_version_unsupported', unsent: view.unsent, fromSignIn: true });
          }}
        />
      );
    case 'state':
      return (
        <DeviceStateScreen
          variant={view.variant}
          unsentItems={view.unsent}
          onHelp={ports.openHelp}
          onPrimary={() => {
            if (view.variant === 'client_version_unsupported') {
              setView({ kind: 'queuePreview', unsent: view.unsent });
            } else if (view.fromSignIn) {
              machine.backToSignIn();
              setView({ kind: 'signIn' });
            } else if (view.variant === 'channel_not_allowed') {
              // read-only account in the mobile channel (decision of the owner): the session ends on the phone, the queue stays encrypted
              void owner.signOut({ online });
            } else {
              toSignIn();
            }
          }}
        />
      );
    case 'signIn':
      return <LoginScreen machine={machine} onForgotPassword={ports.openForgotPassword} now={now} />;
  }
}
