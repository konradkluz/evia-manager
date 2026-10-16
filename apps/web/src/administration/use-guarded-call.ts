import { useState } from 'react';
import { ApiError } from '../api/client.ts';
import { withRotationRetry } from '../session/step-up.ts';
import { useStepUp } from '../session/step-up-context.tsx';

/** W-04 was cancelled: nothing was sent again (EVM-024 AC1, AC4; the data of the dialog stays). */
export class StepUpCancelled extends Error {
  constructor() {
    super('step-up cancelled');
    this.name = 'StepUpCancelled';
  }
}

export const isStepUpRequired = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403 && error.code === 'step_up_required';

/**
 * An operation of an Administrator that needs a recent confirmation of identity (P2): the call goes first; when the server answers
 * `403 step_up_required`, W-04 opens with `title` and, after the confirmation, the SAME call is sent once more — the same
 * `Idempotency-Key`, no loop (a second `step_up_required` is an error like any other). `stepping` is true while W-04 is open, so
 * the dialog of the operation can step aside (a dialog never stacks on a dialog, styleguide § 3.13) and keep its data.
 */
export function useGuardedCall(title: string) {
  const requestStepUp = useStepUp();
  const [stepping, setStepping] = useState(false);
  const run = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await withRotationRetry(call);
    } catch (error) {
      if (!isStepUpRequired(error)) throw error;
    }
    setStepping(true);
    let confirmed: boolean;
    try {
      confirmed = await requestStepUp(title);
    } finally {
      setStepping(false);
    }
    if (!confirmed) throw new StepUpCancelled();
    return withRotationRetry(call);
  };
  return { run, stepping };
}
