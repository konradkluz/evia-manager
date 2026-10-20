import { getStepUpPasskeyOptions, stepUp } from '@evia/contracts';
import { AlertDialog, Button, InlineAlert, KeyRound, TextField } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { normaliseTotpCode } from '../mfa/code-input.ts';
import { retryMinutes } from '../pages/login-failure.tsx';
import { getPasskey } from '../passkey/get-passkey.ts';
import { useOnline } from '../shell/use-online.ts';
import { setCsrfToken } from './csrf.ts';
import { SESSION_KEY, useSession } from './session.ts';
import { runStepUp } from './step-up.ts';

export type StepUpMethod = 'passkey' | 'totp';

type Failure =
  | { readonly kind: 'key' }
  | { readonly kind: 'code' }
  | { readonly kind: 'rate'; readonly minutes: number }
  | { readonly kind: 'server'; readonly code: string };

/** A credential the server did not accept leaves the session as it is; every other `401` is a session problem. */
const REJECTED = new Set(['passkey_failed', 'totp_failed']);

/** Session problems (`unauthenticated`, `session_expired`, `session_revoked`) are the gate's business: the dialog just closes. */
const isSessionProblem = (error: unknown): boolean => error instanceof ApiError && error.status === 401 && !REJECTED.has(error.code);

function classify(error: unknown, method: StepUpMethod): Failure {
  if (error instanceof ApiError && error.status === 429) return { kind: 'rate', minutes: retryMinutes(error) };
  // A refused or cancelled ceremony (a DOMException — never shown), a key or a code the server did not accept, a refused body.
  if (!(error instanceof ApiError) || error.status === 400 || error.status === 401) return { kind: method === 'totp' ? 'code' : 'key' };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/**
 * W-04 "Potwierdź tożsamość, aby …" (EVM-029 AC1, AC3, AC4, EVM-023 AC7; styleguide § 3.13): the dialog of the step-up. An
 * Administrator confirms only with a passkey; an Editor and a Read-only user with a passkey or a code of the authenticator app
 * (one field, never sent on its own). No recovery code, no other way (decision 16). The key or the code is checked by the
 * server (its own challenge, the key of the account, user verification; the code with a counter of failures of the session);
 * the answer brings the new CSRF token of the rotated session, which replaces the old one at once. A failed key or code leaves
 * the dialog open with a message; "Anuluj" and Esc close it without doing anything. Offline the dialog says so and sends nothing.
 */
export function StepUpDialog({
  title,
  details = [],
  methods,
  onDone,
}: {
  readonly title: string;
  /** The summary of the operation under the title (EVM-057: what is corrected, then the instalment, the order and the amount). */
  readonly details?: readonly string[];
  /** Methods offered; by default the role decides (Administrator — passkey only). The server checks the method anyway. */
  readonly methods?: readonly StepUpMethod[] | undefined;
  readonly onDone: (confirmed: boolean) => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const id = useId();
  const session = useSession();
  const offered: readonly StepUpMethod[] = methods ?? (session.data?.user.role === 'administrator' ? ['passkey'] : ['passkey', 'totp']);
  const withCode = offered.includes('totp');
  const codeInput = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);

  const succeeded = () => {
    void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    setCode('');
    onDone(true);
  };
  const confirm = useMutation({
    mutationFn: () =>
      runStepUp(async () => {
        const options = await unwrap(getStepUpPasskeyOptions({ client }));
        const credential = await getPasskey(options);
        const result = await unwrap(stepUp({ client, body: { credential } }));
        // The session was rotated: the new token replaces the old one before anything else is sent.
        setCsrfToken(result.csrfToken);
      }),
    onSuccess: succeeded,
    onError: (error) => {
      if (isSessionProblem(error)) {
        setCode('');
        onDone(false);
        return;
      }
      setFailure(classify(error, 'passkey'));
    },
  });
  const confirmCode = useMutation({
    mutationFn: (value: string) =>
      runStepUp(async () => {
        const result = await unwrap(stepUp({ client, body: { method: 'totp', code: value } }));
        setCsrfToken(result.csrfToken);
      }),
    onSuccess: succeeded,
    onError: (error) => {
      if (isSessionProblem(error)) {
        setCode('');
        onDone(false);
        return;
      }
      const next = classify(error, 'totp');
      // A wrong code is cleared and the field gets the focus; after a failure of the network the code stays (§ 3.2.1).
      if (next.kind === 'code') {
        setCode('');
        codeInput.current?.focus();
      }
      setFailure(next);
    },
  });
  const pending = confirm.isPending || confirmCode.isPending;

  const failureText = (() => {
    switch (failure?.kind) {
      case undefined:
        return null;
      case 'key':
        return t('stepUp.failed');
      case 'code':
        return t('stepUp.code.invalid');
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
    if (pending) return;
    setCode('');
    onDone(false);
  };
  const submitCode = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || pending) return;
    setFailure(null);
    const value = normaliseTotpCode(code);
    // Not a code at all: no request (it would only use up an attempt of the session), the same message as a wrong code.
    if (value === null) {
      setCode('');
      setFailure({ kind: 'code' });
      codeInput.current?.focus();
      return;
    }
    confirmCode.mutate(value);
  };
  const hint = session.data?.user.role === 'administrator' ? t('stepUp.resetHint') : t('stepUp.resetHintOther');

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
              setFailure(null);
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
      {details.map((line, index) => (
        // The lines of one summary never move: the index is a stable key.
        <p key={index} className={index === 0 ? 'text-body text-text-primary' : 'text-body-sm text-text-secondary'}>
          {line}
        </p>
      ))}
      {withCode ? (
        <form noValidate onSubmit={submitCode} className="flex flex-col gap-stack-sm">
          <TextField
            label={t('stepUp.code.label')}
            hint={t('stepUp.code.hint')}
            value={code}
            variant="one-time-code"
            inputRef={codeInput}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
          <div>
            <Button type="submit" variant="secondary" loading={confirmCode.isPending} disabled={!online}>
              {t('stepUp.code.submit')}
            </Button>
          </div>
        </form>
      ) : null}
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
        {hint}
      </p>
    </AlertDialog>
  );
}
