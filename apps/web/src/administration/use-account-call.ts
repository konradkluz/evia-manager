import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { describeAccountFailure, type AccountFailure } from './account-failure.ts';
import { useGuardedCall } from './use-guarded-call.ts';

/**
 * One operation of an Administrator on an account (EVM-027): the call goes through W-04 when the server asks for it
 * (`403 step_up_required`, the same call once more after the confirmation), and a failure is kept for the alert of the dialog —
 * the data of the dialog stays. `stepping` is true while W-04 is open, so the dialog steps aside (a dialog never stacks on a dialog).
 */
export function useAccountCall(stepUpTitle: string) {
  const guarded = useGuardedCall(stepUpTitle);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const mutation = useMutation({ mutationFn: (call: () => Promise<unknown>) => guarded.run(call) });

  const run = (call: () => Promise<unknown>, onDone: () => void) => {
    setFailure(null);
    mutation.mutate(call, {
      onSuccess: () => {
        mutation.reset();
        onDone();
      },
      onError: (error) => {
        setFailure(describeAccountFailure(error));
      },
    });
  };
  const clear = () => {
    setFailure(null);
    mutation.reset();
  };
  return { stepping: guarded.stepping, pending: mutation.isPending, failure, run, clear };
}
