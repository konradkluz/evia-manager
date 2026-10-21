import {
  getStepUpPasskeyOptions,
  reauthenticate,
  type ReauthenticationPurpose,
  type ReauthenticationRequestWritable,
} from '@evia/contracts';
import { Button, Dialog, InlineAlert, KeyRound, TextField } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { normaliseTotpCode } from '../mfa/code-input.ts';
import { retryMinutes } from '../pages/login-failure.tsx';
import { getPasskey } from '../passkey/get-passkey.ts';
import { useOnline } from '../shell/use-online.ts';
import { setLoginNotice } from './login-flow.ts';
import { sessionQueryOptions, useSession } from './session.ts';

/** What a page asks W-04 for in the mode of the full re-authentication (EVM-028; SR-AUTH-10, ASVS V7.5.1). */
export interface ReauthenticationAsk {
  readonly purpose: ReauthenticationPurpose;
  /** "Potwierdź tożsamość, aby …" */
  readonly title: string;
  /** The e-mail of the account, only shown read-only above the password (`autocomplete="username"`); never sent. */
  readonly email?: string | undefined;
}

type Failure =
  | { readonly kind: 'rejected' }
  | { readonly kind: 'key' }
  | { readonly kind: 'code' }
  | { readonly kind: 'rate'; readonly minutes: number }
  | { readonly kind: 'server'; readonly code: string };

type Proof = { readonly kind: 'passkey' } | { readonly kind: 'totp'; readonly code: string };

/**
 * W-04 in the mode of the full re-authentication (EVM-028 AC2, AC3, AC5; flows/01 → W-04, flows/12 → W-15): for a change of the
 * second step (`second_step_change`) step 1 is the password, step 2 the second step; for a change of the password
 * (`password_change`) only the second step (the current password is in the form of the page). The server answers with ONE failure for
 * the password, the key and the code (no oracle, ASVS V6.3.8) — so the dialog says "check the password and the second step" and goes
 * back to step 1 with the password cleared. No recovery code (decision 16). Success sets a one-time mark on the session (5 minutes,
 * for this purpose): the operation itself is sent again by the page. The password lives in the state of this dialog only (SR-WEB-05)
 * and is gone with it. A lock after too many tries ends the session on the server: the tab then goes to W-01 with a notice.
 */
export function ReauthenticationDialog({
  ask,
  onDone,
}: {
  readonly ask: ReauthenticationAsk;
  readonly onDone: (confirmed: boolean) => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const session = useSession();
  const id = useId();
  const withPassword = ask.purpose === 'second_step_change';
  const isAdministrator = session.data?.user.role === 'administrator';
  const passwordInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const keyButton = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<'password' | 'second'>(withPassword ? 'password' : 'second');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);

  // The password field takes the focus (the read-only e-mail above it must not); after a failure the focus goes back to the password.
  useEffect(() => {
    if (step === 'password') passwordInput.current?.focus();
    else keyButton.current?.focus();
  }, [step]);

  /** A lock ends the session on the server: read it, and when it is gone the tab goes to W-01 with the notice (SR-AUTH-05). */
  const probeSession = () => {
    void queryClient.query({ ...sessionQueryOptions(client), staleTime: 0 }).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401 && error.code === 'session_revoked') setLoginNotice('attempts');
    });
  };

  const send = useMutation({
    mutationFn: async (proof: Proof) => {
      const head = withPassword ? { purpose: ask.purpose, password } : { purpose: ask.purpose };
      let body: ReauthenticationRequestWritable;
      if (proof.kind === 'totp') {
        body = { ...head, method: 'totp', code: proof.code };
      } else {
        const options = await unwrap(getStepUpPasskeyOptions({ client }));
        const credential = await getPasskey(options);
        body = { ...head, credential };
      }
      await unwrap(reauthenticate({ client, body }));
    },
    onSuccess: () => {
      setPassword('');
      setCode('');
      onDone(true);
    },
    onError: (error, proof) => {
      if (error instanceof ApiError && error.status === 429) {
        setFailure({ kind: 'rate', minutes: retryMinutes(error) });
        probeSession();
        return;
      }
      if (error instanceof ApiError && error.status === 401 && error.code !== 'reauthentication_failed') {
        // The session is gone (expired, ended, locked): the gate takes the tab to W-01.
        setPassword('');
        setCode('');
        onDone(false);
        return;
      }
      // A refused or cancelled ceremony is a DOMException (never shown): the person stays at the second step and may try again.
      if (!(error instanceof ApiError)) {
        setFailure({ kind: proof.kind === 'totp' ? 'code' : 'key' });
        return;
      }
      if (error.status === 400 || error.status === 401) {
        if (withPassword) {
          // One answer for every factor: back to the password, cleared.
          setPassword('');
          setCode('');
          setStep('password');
          setFailure({ kind: 'rejected' });
        } else {
          setFailure({ kind: proof.kind === 'totp' ? 'code' : 'key' });
          if (proof.kind === 'totp') {
            setCode('');
            codeInput.current?.focus();
          }
        }
        return;
      }
      setFailure({ kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code });
    },
  });
  const pending = send.isPending;

  const failureText = (() => {
    switch (failure?.kind) {
      case undefined:
        return null;
      case 'rejected':
        return t('reauth.rejected');
      case 'key':
        return t('stepUp.failed');
      case 'code':
        return t('stepUp.code.invalid');
      case 'rate':
        return t('reauth.rateLimited', { minutes: failure.minutes });
      case 'server':
        return t('stepUp.serverError', { code: failure.code });
    }
  })();

  const cancel = () => {
    if (pending) return;
    setPassword('');
    setCode('');
    onDone(false);
  };
  const next = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online) return;
    if (password === '') {
      setPasswordError(t('reauth.passwordRequired'));
      passwordInput.current?.focus();
      return;
    }
    setPasswordError(undefined);
    setFailure(null);
    setStep('second');
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
    send.mutate({ kind: 'totp', code: value });
  };

  const hint = isAdministrator ? t('stepUp.resetHint') : t('stepUp.resetHintOther');
  const summary = withPassword ? t('reauth.summary') : t('reauth.summaryPassword');
  const showSecond = step === 'second';

  return (
    <Dialog
      open
      size="sm"
      title={ask.title}
      closeLabel={t('reauth.close')}
      describedBy={`${id}-summary`}
      onDismiss={cancel}
      actions={
        <>
          <Button variant="tertiary" onClick={cancel}>
            {t('stepUp.cancel')}
          </Button>
          {showSecond ? null : (
            <Button type="submit" form={`${id}-password`} disabled={!online}>
              {t('reauth.next')}
            </Button>
          )}
        </>
      }
    >
      <p id={`${id}-summary`} className="text-body text-text-secondary">
        {summary}
      </p>
      {withPassword ? (
        <p className="text-label text-text-secondary">{t('reauth.step', { current: showSecond ? 2 : 1, total: 2 })}</p>
      ) : null}
      {failureText === null ? null : <InlineAlert tone="error">{failureText}</InlineAlert>}
      {online ? null : <InlineAlert tone="error">{t('stepUp.offline')}</InlineAlert>}
      {showSecond ? null : (
        <form id={`${id}-password`} noValidate onSubmit={next} className="flex flex-col gap-stack-md">
          {ask.email === undefined ? null : (
            <TextField label={t('reauth.email')} type="email" value={ask.email} autoComplete="username" name="username" readOnly />
          )}
          <TextField
            label={t('reauth.password')}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            reveal={{ show: t('reauth.show'), hide: t('reauth.hide') }}
            inputRef={passwordInput}
            {...(passwordError === undefined ? {} : { error: passwordError })}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </form>
      )}
      {showSecond ? (
        <>
          <Button
            ref={keyButton}
            icon={KeyRound}
            loading={pending && send.variables.kind === 'passkey'}
            disabled={!online}
            onClick={() => {
              setFailure(null);
              send.mutate({ kind: 'passkey' });
            }}
          >
            {pending && send.variables.kind === 'passkey' ? t('stepUp.inProgress') : t('stepUp.useKey')}
          </Button>
          {isAdministrator ? null : (
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
                <Button type="submit" variant="secondary" loading={pending && send.variables.kind === 'totp'} disabled={!online}>
                  {t('stepUp.code.submit')}
                </Button>
              </div>
            </form>
          )}
          <p className="text-body-sm text-text-secondary">{hint}</p>
        </>
      ) : null}
    </Dialog>
  );
}
