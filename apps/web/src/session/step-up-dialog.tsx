import { getStepUpPasskeyOptions, stepUp } from '@evia/contracts';
import { AlertDialog, Button, InlineAlert, KeyRound } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { retryMinutes } from '../pages/login-failure.tsx';
import { getPasskey } from '../passkey/get-passkey.ts';
import { useOnline } from '../shell/use-online.ts';
import { setCsrfToken } from './csrf.ts';
import { SESSION_KEY } from './session.ts';
import { runStepUp } from './step-up.ts';

type Failure =
  { readonly kind: 'key' } | { readonly kind: 'rate'; readonly minutes: number } | { readonly kind: 'server'; readonly code: string };

/** Session problems (`unauthenticated`, `session_expired`, `session_revoked`) are the gate's business: the dialog just closes. */
const isSessionProblem = (error: unknown): boolean => error instanceof ApiError && error.status === 401 && error.code !== 'passkey_failed';

function classify(error: unknown): Failure {
  if (error instanceof ApiError && error.status === 429) return { kind: 'rate', minutes: retryMinutes(error) };
  // A refused or cancelled ceremony (a DOMException — never shown), a key the server did not accept, a refused body.
  if (!(error instanceof ApiError) || error.status === 400 || error.status === 401) return { kind: 'key' };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/**
 * W-04 "Potwierdź tożsamość, aby …" (EVM-029 AC1, AC3, AC4; styleguide § 3.13): the dialog of the step-up of an
 * Administrator — the only method is a passkey (decision 16: no recovery code, no other way). The key is checked by the
 * server (its own challenge, the key of the account, user verification); the answer brings the new CSRF token of the
 * rotated session, which replaces the old one at once. A failed key leaves the dialog open with a message; "Anuluj" and
 * Esc close it without doing anything. Offline the dialog says so and sends nothing.
 */
export function StepUpDialog({ title, onDone }: { readonly title: string; readonly onDone: (confirmed: boolean) => void }) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const id = useId();
  const confirm = useMutation({
    mutationFn: () =>
      runStepUp(async () => {
        const options = await unwrap(getStepUpPasskeyOptions({ client }));
        const credential = await getPasskey(options);
        const result = await unwrap(stepUp({ client, body: { credential } }));
        // The session was rotated: the new token replaces the old one before anything else is sent.
        setCsrfToken(result.csrfToken);
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      onDone(true);
    },
    onError: (error) => {
      if (isSessionProblem(error)) onDone(false);
    },
  });
  const failure = confirm.isError && !isSessionProblem(confirm.error) ? classify(confirm.error) : null;
  const failureText = (() => {
    switch (failure?.kind) {
      case undefined:
        return null;
      case 'key':
        return t('stepUp.failed');
      case 'rate':
        return t('stepUp.rateLimited', { minutes: failure.minutes });
      case 'server':
        return t('stepUp.serverError', { code: failure.code });
    }
  })();
  // First the errors, then the hint about the reset (so that a screen reader reads them in that order).
  const describedBy = [failureText === null ? null : `${id}-failure`, online ? null : `${id}-offline`, `${id}-hint`]
    .filter(Boolean)
    .join(' ');
  const cancel = () => {
    // The dialog does not close before the result of a running confirmation (loading blocks it).
    if (!confirm.isPending) onDone(false);
  };
  return (
    <AlertDialog
      open
      title={title}
      onDismiss={cancel}
      actions={
        <>
          <Button
            data-initial-focus
            icon={KeyRound}
            loading={confirm.isPending}
            disabled={!online}
            aria-describedby={describedBy}
            onClick={() => {
              confirm.mutate();
            }}
          >
            {confirm.isPending ? t('stepUp.inProgress') : t('stepUp.useKey')}
          </Button>
          <Button variant="tertiary" onClick={cancel}>
            {t('stepUp.cancel')}
          </Button>
        </>
      }
    >
      {failureText === null ? null : (
        <div id={`${id}-failure`}>
          <InlineAlert tone="error">{failureText}</InlineAlert>
        </div>
      )}
      {online ? null : (
        <div id={`${id}-offline`}>
          <InlineAlert tone="error">{t('stepUp.offline')}</InlineAlert>
        </div>
      )}
      <p id={`${id}-hint`} className="text-body-sm text-text-secondary">
        {t('stepUp.resetHint')}
      </p>
    </AlertDialog>
  );
}
