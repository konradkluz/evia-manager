import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { StepUpDialog } from './step-up-dialog.tsx';

type RequestStepUp = (title: string) => Promise<boolean>;

const StepUpContext = createContext<RequestStepUp | null>(null);

interface Pending {
  readonly title: string;
  readonly settle: (confirmed: boolean) => void;
}

/**
 * Owner of the one W-04 dialog of the tab: a page asks `requestStepUp(title)` after the server answered
 * `403 step_up_required` and gets `true` once the identity is confirmed (the new session is in place) or `false` after
 * "Anuluj". The panel never keeps "step-up is valid" — each operation asks the server again (EVM-015, S4). A second
 * request while the dialog is open gets the answer of the same dialog — a dialog never stacks on a dialog (§ 3.13).
 */
export function StepUpProvider({ children }: { readonly children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Promise<boolean> | null>(null);
  const request = useCallback<RequestStepUp>((title) => {
    if (current.current !== null) return current.current;
    const promise = new Promise<boolean>((resolve) => {
      setPending({
        title,
        settle: (confirmed) => {
          current.current = null;
          setPending(null);
          resolve(confirmed);
        },
      });
    });
    current.current = promise;
    return promise;
  }, []);
  return (
    <StepUpContext value={request}>
      {children}
      {pending === null ? null : <StepUpDialog title={pending.title} onDone={pending.settle} />}
    </StepUpContext>
  );
}

export function useStepUp(): RequestStepUp {
  const request = useContext(StepUpContext);
  if (request === null) throw new Error('useStepUp outside StepUpProvider');
  return request;
}
