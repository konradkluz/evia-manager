import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { StepUpDialog, type StepUpMethod } from './step-up-dialog.tsx';

/**
 * `title` — "Potwierdź tożsamość, aby …"; `details` — the lines of the summary of the operation under the title (flows/01 → "Tytuły
 * operacji M1": e.g. the correction of a payment, EVM-057), plain text.
 */
type RequestStepUp = (title: string, details?: readonly string[], methods?: readonly StepUpMethod[]) => Promise<boolean>;

const StepUpContext = createContext<RequestStepUp | null>(null);

interface Pending {
  readonly title: string;
  readonly details: readonly string[];
  readonly methods: readonly StepUpMethod[] | undefined;
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
  const request = useCallback<RequestStepUp>((title, details = [], methods) => {
    if (current.current !== null) return current.current;
    const promise = new Promise<boolean>((resolve) => {
      setPending({
        title,
        details,
        methods,
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
      {pending === null ? null : (
        <StepUpDialog title={pending.title} details={pending.details} methods={pending.methods} onDone={pending.settle} />
      )}
    </StepUpContext>
  );
}

export function useStepUp(): RequestStepUp {
  const request = useContext(StepUpContext);
  if (request === null) throw new Error('useStepUp outside StepUpProvider');
  return request;
}
