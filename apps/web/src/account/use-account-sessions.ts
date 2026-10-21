import { endAccountSession, endOtherAccountSessions, listAccountSessions, type AccountSession } from '@evia/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { StepUpCancelled, useGuardedCall } from '../administration/use-guarded-call.ts';
import { useToast } from '../shell/toast-context.tsx';
import { describeAccountFailure, type AccountFailure } from './account-failure.ts';
import { pluralOf } from './plural.ts';

/** The sessions of the account as loaded (the memory of the tab only: IP addresses are personal data, SR-WEB-05) and when. */
export interface LoadedSessions {
  readonly items: readonly AccountSession[];
  readonly at: number;
}

/** "Edge · Windows": the family of the browser and the system from the closed dictionary of the server (never a raw User-Agent). */
export const browserLabel = (session: AccountSession): string => `${session.browser} · ${session.os}`;

/**
 * The calls of "Moje sesje" (EVM-028 AC6, AC8; SR-SESS-07; W-15): the list, "Zakończ sesję" and "Zakończ pozostałe sesje". Each goes
 * through W-04 as a step-up when the server answers `403 step_up_required` (the same call is sent again; nothing is remembered). The
 * result is told in a toast and by the live region of the card; a session that is no longer there (`404`, a stranger's looks the same)
 * is a toast and a fresh list. The IDs sent are the opaque IDs of the records of the sessions — never a token.
 */
export function useAccountSessions() {
  const { t } = useTranslation();
  const client = useApi();
  const showToast = useToast();
  const [sessions, setSessions] = useState<LoadedSessions | null>(null);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [justLoaded, setJustLoaded] = useState(0);
  const viewing = useGuardedCall(t('stepUp.title.viewSessions'));
  const endingOne = useGuardedCall(t('stepUp.title.endSession'));
  const endingOthers = useGuardedCall(t('stepUp.title.endOtherSessions'));

  const read = async () => {
    const result = await viewing.run(() => unwrap(listAccountSessions({ client })));
    setSessions({ items: result.items, at: Date.now() });
    return result.items;
  };
  const fail = (error: unknown) => {
    // W-04 cancelled: nothing happened and nothing is said (the person just closed the dialog).
    if (error instanceof StepUpCancelled) return;
    setFailure(describeAccountFailure(error));
  };

  const load = useMutation({
    mutationFn: read,
    onMutate: () => {
      setFailure(null);
    },
    onSuccess: () => {
      setJustLoaded((count) => count + 1);
    },
    onError: fail,
  });

  const endOne = useMutation({
    mutationFn: async (session: AccountSession) => {
      try {
        await endingOne.run(() => unwrap(endAccountSession({ client, path: { sessionId: session.id } })));
      } catch (error) {
        // Not found (a stranger's, ended meanwhile): the same toast, then the list is read again.
        if (describeAccountFailure(error).kind !== 'notFound') throw error;
        showToast(t('account.sessions.notFound'));
        await read();
        return;
      }
      showToast(t('account.sessions.endedOne', { name: browserLabel(session) }));
      await read();
    },
    onMutate: () => {
      setFailure(null);
    },
    onError: fail,
  });

  const endOthers = useMutation({
    mutationFn: async () => {
      const result = await endingOthers.run(() => unwrap(endOtherAccountSessions({ client })));
      const message =
        result.ended === 0
          ? t('account.sessions.endedNone')
          : pluralOf(result.ended) === 'one'
            ? t('account.sessions.endedOthersOne', { count: result.ended })
            : pluralOf(result.ended) === 'few'
              ? t('account.sessions.endedOthersFew', { count: result.ended })
              : t('account.sessions.endedOthersMany', { count: result.ended });
      showToast(message);
      // The list is read only where the person is looking at it (the step-up of the call is fresh, so no second W-04).
      if (sessions !== null) await read();
    },
    onMutate: () => {
      setFailure(null);
    },
    onError: fail,
  });

  return {
    sessions,
    failure,
    justLoaded,
    loading: load.isPending,
    endingOne: endOne.isPending ? endOne.variables.id : null,
    endingOthers: endOthers.isPending,
    load: () => {
      load.mutate();
    },
    endOne: (session: AccountSession) => {
      endOne.mutate(session);
    },
    endOthers: () => {
      endOthers.mutate();
    },
  };
}

export type AccountSessionsState = ReturnType<typeof useAccountSessions>;
