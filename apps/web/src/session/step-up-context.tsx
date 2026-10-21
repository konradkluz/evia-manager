import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ReauthenticationDialog, type ReauthenticationAsk } from './reauthentication-dialog.tsx';
import { StepUpDialog, type StepUpMethod } from './step-up-dialog.tsx';

/**
 * `title` — "Potwierdź tożsamość, aby …"; `details` — the lines of the summary of the operation under the title (flows/01 → "Tytuły
 * operacji M1": e.g. the correction of a payment, EVM-057), plain text.
 */
type RequestStepUp = (title: string, details?: readonly string[], methods?: readonly StepUpMethod[]) => Promise<boolean>;

/** The full re-authentication of EVM-028 (W-04, second and third use): `true` once the one-time mark is set on the session. */
type RequestReauthentication = (ask: ReauthenticationAsk) => Promise<boolean>;

const StepUpContext = createContext<RequestStepUp | null>(null);
const ReauthenticationContext = createContext<RequestReauthentication | null>(null);

type Pending =
  | {
      readonly kind: 'step-up';
      readonly title: string;
      readonly details: readonly string[];
      readonly methods: readonly StepUpMethod[] | undefined;
      readonly settle: (confirmed: boolean) => void;
    }
  | { readonly kind: 'reauthentication'; readonly ask: ReauthenticationAsk; readonly settle: (confirmed: boolean) => void };

/**
 * Owner of the one W-04 dialog of the tab: a page asks `requestStepUp(title)` after the server answered
 * `403 step_up_required` and gets `true` once the identity is confirmed (the new session is in place) or `false` after
 * "Anuluj". The panel never keeps "step-up is valid" — each operation asks the server again (EVM-015, S4). A second
 * request while the dialog is open gets the answer of the same dialog — a dialog never stacks on a dialog (§ 3.13).
 * The same holds for the full re-authentication (`requestReauthentication`, EVM-028): one dialog at a time, of either kind.
 */
export function StepUpProvider({ children }: { readonly children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Promise<boolean> | null>(null);
  const open = useCallback((make: (settle: (confirmed: boolean) => void) => Pending): Promise<boolean> => {
    if (current.current !== null) return current.current;
    const promise = new Promise<boolean>((resolve) => {
      setPending(
        make((confirmed) => {
          current.current = null;
          setPending(null);
          resolve(confirmed);
        }),
      );
    });
    current.current = promise;
    return promise;
  }, []);
  const request = useCallback<RequestStepUp>(
    (title, details = [], methods) => open((settle) => ({ kind: 'step-up', title, details, methods, settle })),
    [open],
  );
  const reauthenticate = useCallback<RequestReauthentication>(
    (ask) => open((settle) => ({ kind: 'reauthentication', ask, settle })),
    [open],
  );
  return (
    <StepUpContext value={request}>
      <ReauthenticationContext value={reauthenticate}>
        {children}
        {pending === null ? null : pending.kind === 'step-up' ? (
          <StepUpDialog title={pending.title} details={pending.details} methods={pending.methods} onDone={pending.settle} />
        ) : (
          <ReauthenticationDialog ask={pending.ask} onDone={pending.settle} />
        )}
      </ReauthenticationContext>
    </StepUpContext>
  );
}

export function useStepUp(): RequestStepUp {
  const request = useContext(StepUpContext);
  if (request === null) throw new Error('useStepUp outside StepUpProvider');
  return request;
}

export function useReauthentication(): RequestReauthentication {
  const request = useContext(ReauthenticationContext);
  if (request === null) throw new Error('useReauthentication outside StepUpProvider');
  return request;
}
