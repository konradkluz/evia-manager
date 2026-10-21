import type { ReauthenticationPurpose } from '@evia/contracts';
import { useState } from 'react';
import { ApiError } from '../api/client.ts';
import { withRotationRetry } from '../session/step-up.ts';
import { useReauthentication } from '../session/step-up-context.tsx';

/** W-04 (the full re-authentication) was cancelled: nothing was sent again, the data of the form stays (EVM-028 AC2, AC3, AC5). */
export class ReauthenticationCancelled extends Error {
  constructor() {
    super('re-authentication cancelled');
    this.name = 'ReauthenticationCancelled';
  }
}

export const isReauthenticationRequired = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403 && error.code === 'reauthentication_required';

/**
 * An operation of the own account that needs the full re-authentication (SR-AUTH-10): the call goes first; when the server answers
 * `403 reauthentication_required`, W-04 opens and, after the confirmation, the SAME call is sent once more (the mark is one-time and
 * the server spends it — the panel remembers nothing). `first: true` asks before the call — for the one operation whose server
 * path does not answer with that code (new recovery codes). `stepping` is true while W-04 is open, so that the dialog of the
 * operation can step aside and keep its data (a dialog never stacks on a dialog, § 3.13).
 */
export function useReauthCall(purpose: ReauthenticationPurpose, title: string, email: string | undefined) {
  const request = useReauthentication();
  const [stepping, setStepping] = useState(false);
  const ask = async () => {
    setStepping(true);
    let confirmed: boolean;
    try {
      confirmed = await request({ purpose, title, email });
    } finally {
      setStepping(false);
    }
    if (!confirmed) throw new ReauthenticationCancelled();
  };
  const run = async <T>(call: () => Promise<T>, { first = false }: { readonly first?: boolean } = {}): Promise<T> => {
    if (first) {
      await ask();
      return withRotationRetry(call);
    }
    try {
      return await withRotationRetry(call);
    } catch (error) {
      if (!isReauthenticationRequired(error)) throw error;
    }
    await ask();
    return withRotationRetry(call);
  };
  return { run, stepping };
}
