/**
 * Startup context (EVM-009 AC2, AC3): runs the health and minimum-version check and shares the state with the screens.
 * One check at a time; after the first result a new check starts only when the app returns to the foreground (debounced, no retry
 * loop) or on the user's request. The state stays visible while a repeated check runs (no flicker back to the skeleton).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { createStartupChecker } from './checker';
import type { StartupChecker } from './checker';
import type { StartupState } from './state';

/** After this time of waiting the skeleton offers "try again" (UX: "Ładowanie trwa dłużej niż zwykle…"). */
export const SLOW_CHECK_MS = 5000;
/** A return to the foreground within this time of the previous check does not start another one. */
export const FOREGROUND_DEBOUNCE_MS = 5000;

export interface StartupContextValue {
  readonly state: StartupState;
  /** A check is running now (also when `state` already shows an earlier result). */
  readonly checking: boolean;
  /** The first check takes longer than usual. */
  readonly slow: boolean;
  readonly retry: () => void;
}

const StartupContext = createContext<StartupContextValue | null>(null);

export function StartupProvider({ checker, children }: { checker?: StartupChecker; children: ReactNode }) {
  const check = useMemo(() => checker ?? createStartupChecker(), [checker]);
  const [state, setState] = useState<StartupState>({ kind: 'checking' });
  const [checking, setChecking] = useState(true);
  const [slow, setSlow] = useState(false);
  const inFlight = useRef(false);
  const lastStartedAt = useRef(0);
  const mounted = useRef(true);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastStartedAt.current = Date.now();
    setChecking(true);
    let next: StartupState;
    try {
      next = await check();
    } catch {
      next = { kind: 'serverUnavailable', problem: 'invalid' };
    }
    inFlight.current = false;
    if (!mounted.current) return;
    setState(next);
    setChecking(false);
  }, [check]);

  useEffect(() => {
    mounted.current = true;
    void run();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && Date.now() - lastStartedAt.current >= FOREGROUND_DEBOUNCE_MS) void run();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [run]);

  useEffect(() => {
    if (!checking) {
      setSlow(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setSlow(true);
    }, SLOW_CHECK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [checking]);

  const retry = useCallback(() => {
    void run();
  }, [run]);

  const value = useMemo<StartupContextValue>(() => ({ state, checking, slow, retry }), [state, checking, slow, retry]);
  return <StartupContext.Provider value={value}>{children}</StartupContext.Provider>;
}

export function useStartup(): StartupContextValue {
  const value = useContext(StartupContext);
  if (value === null) throw new Error('useStartup must be used inside StartupProvider');
  return value;
}
