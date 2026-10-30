import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { LoginMachine, type BlockedVariant } from '../auth/login-machine';
import type { WipeSignal } from '../auth/ports';
import type { DeviceCheck, SessionControl, SessionStep } from '../auth/session-owner';
import { useStartup } from '../startup';
import { DeviceStateScreen, QueuePreviewScreen, type DeviceStateVariant } from './DeviceStateScreen';
import { LocalDataLostScreen } from './LocalDataScreens';
import { LoginScreen } from './LoginScreen';
import { SessionContext, type SessionActions } from './session-context';

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
  /** "Wyczyść dane firmowe" (EVM-101). */
  readonly requestCompanyDataWipe: () => void;
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
  | { readonly kind: 'signedIn' };

/**
 * The session gate of the app (EVM-100): no session → M-01; a blocking answer → M-02; a session → the device check (EVM-101/EVM-107,
 * a stand-in here: only "data lost" of EVM-093 is shown) → the shell. A signed-in start makes no request (AC6); when the network is
 * there the session is refreshed in the background (AC4 "przy starcie") and pending revocations are sent (AC7).
 */
export function SessionRoot({ ports, children }: { ports: SessionPorts; children: ReactNode }) {
  const { owner, wipe } = ports;
  const now = ports.now ?? Date.now;
  const { state: startup } = useStartup();
  const online = startup.kind === 'online';
  const [view, setView] = useState<View>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const refreshedAtStart = useRef(false);

  const afterStep = useCallback(
    (step: SessionStep): 'done' | 'failed' => {
      if (step.kind === 'signed_in') {
        setView({ kind: 'signedIn' });
        return 'done';
      }
      if (step.kind === 'device_check' && step.result.kind === 'data_lost') {
        setView({ kind: 'dataLost', check: step.result });
        return 'done';
      }
      // the other device checks belong to EVM-101/EVM-107; until then the session of step 2 is dropped (nothing was stored)
      owner.abandonSignIn();
      setView({ kind: 'signIn' });
      return 'failed';
    },
    [owner],
  );

  const machine = useMemo(
    () =>
      new LoginMachine({
        signIn: owner.signInClient(),
        wipe,
        now,
        onSession: async (session) => {
          const result = afterStep(await owner.completeSignIn(session));
          if (result === 'done') void owner.flushPendingRevocation();
          return result;
        },
      }),
    // a new machine for every visit of M-01: nothing of an earlier form survives
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `attempt` renews the machine on purpose
    [owner, wipe, afterStep, attempt],
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
        setView({ kind: 'state', variant: ended.reason, unsent: ended.unsentItems, fromSignIn: false });
      }),
    [owner],
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
      requestCompanyDataWipe: ports.requestCompanyDataWipe,
      openHelp: ports.openHelp,
    }),
    // the name is read again whenever the view changes (a new sign-in)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `view` refreshes the display name
    [owner, ports, online, view],
  );

  switch (view.kind) {
    case 'starting':
      return null;
    case 'signedIn':
      return <SessionContext.Provider value={actions}>{children}</SessionContext.Provider>;
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
