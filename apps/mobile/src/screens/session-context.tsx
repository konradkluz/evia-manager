import { createContext, useContext } from 'react';

/** What the signed-in screens may do with the session (EVM-100 AC7, M-09); the owner itself stays outside the screens. */
export interface SessionActions {
  readonly displayName: string;
  readonly appVersion: string;
  /** Unsent items of the queue for the sign-out warning (a number only). */
  readonly unsentItemCount: () => Promise<number>;
  /** Ends the session on the phone (and on the server when online); M-02 "Wylogowano" follows. */
  readonly signOut: () => Promise<void>;
  /** "Wyczyść dane firmowe" — handed over to EVM-101. */
  readonly requestCompanyDataWipe: () => void;
  /** "Pomoc" (M-11, EVM-102). */
  readonly openHelp: () => void;
}

export const SessionContext = createContext<SessionActions | null>(null);

export function useSession(): SessionActions {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession must be used inside SessionContext');
  return value;
}
