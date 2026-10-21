import { confirmTotp, startTotpEnrolment, type TotpSetup } from '@evia/contracts';
import { Button, Disclosure, InlineAlert, QrCode, Skeleton, TextField } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type Ref, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { retryMinutes } from '../pages/login-failure.tsx';
import { normaliseTotpCode } from './code-input.ts';

type StartFailure = 'configured' | 'unavailable' | 'failed';
type ConfirmFailure =
  | { readonly kind: 'code' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'rate'; readonly minutes: number }
  | { readonly kind: 'server'; readonly code: string };

function startFailureOf(error: unknown): StartFailure {
  if (error instanceof ApiError && error.status === 409) return 'configured';
  if (error instanceof ApiError && error.status === 503) return 'unavailable';
  return 'failed';
}

function confirmFailureOf(error: unknown): ConfirmFailure {
  if (error instanceof ApiError && error.status === 429) return { kind: 'rate', minutes: retryMinutes(error) };
  if (!(error instanceof ApiError) || error.status === 400) return { kind: 'code' };
  // From W-15 (EVM-028): the mark of the full re-authentication ran out (5 minutes) before the code was confirmed.
  if (error.status === 403 && error.code === 'reauthentication_required') return { kind: 'expired' };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/** The secret in groups of four, easier to copy by eye into an app ("JBSW Y3DP …"). */
const grouped = (secret: string): string => secret.replace(/(.{4})(?=.)/g, '$1 ');

/**
 * W-03 step 2, variant "kod z aplikacji" (EVM-023 AC1; SR-AUTH-07, SR-CRYPTO-02): the server makes a secret (160 bits, kept
 * encrypted), the panel draws the QR code itself — the secret never leaves the browser for any service — and offers "Pokaż klucz
 * do wpisania" as the text alternative. The method works only after a correct code. The secret, the address and the code live in
 * the state of this component (the memory of the tab): not in storage, the address, the title, the console or the query cache
 * (`gcTime: 0`), and they are gone as soon as the step ends.
 */
export function TotpEnrolment({
  online,
  headingRef,
  initialSetup,
  heading = true,
  onConfirmed,
  onBack,
}: {
  readonly online: boolean;
  readonly headingRef: Ref<HTMLHeadingElement>;
  /** W-15 (EVM-028): the secret was already made (after the full re-authentication); the step does not start another one. */
  readonly initialSetup?: TotpSetup;
  /** `false` where a dialog already names the step (W-15 "Dodaj kod z aplikacji"). */
  readonly heading?: boolean;
  /** The method is active and the session is a new one: the page reads it and moves to the recovery codes. */
  readonly onConfirmed: (csrfToken: string) => Promise<void>;
  /** Back to the choice of the method (only where there is a choice). */
  readonly onBack?: () => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const input = useRef<HTMLInputElement>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(initialSetup ?? null);
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<ConfirmFailure | null>(null);
  const [expanded, setExpanded] = useState(false);

  const start = useMutation({
    gcTime: 0,
    mutationFn: () => unwrap(startTotpEnrolment({ client })),
    onSuccess: (result) => {
      setSetup(result);
    },
  });
  const started = useRef(false);
  useEffect(() => {
    // One secret per visit of the step (a second call would replace the first one under the eyes of the user).
    if (started.current || initialSetup !== undefined) return;
    started.current = true;
    start.mutate();
  }, [start, initialSetup]);

  const confirm = useMutation({
    gcTime: 0,
    mutationFn: async (value: string) => {
      const result = await unwrap(confirmTotp({ client, body: { code: value } }));
      await onConfirmed(result.csrfToken);
    },
    onError: (error) => {
      const next = confirmFailureOf(error);
      // A wrong code is cleared and the field gets the focus; after another failure the code stays (styleguide § 3.2.1).
      if (next.kind === 'code') {
        setCode('');
        input.current?.focus();
      }
      setFailure(next);
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || confirm.isPending) return;
    setFailure(null);
    const value = normaliseTotpCode(code);
    if (value === null) {
      setCode('');
      setFailure({ kind: 'code' });
      input.current?.focus();
      return;
    }
    confirm.mutate(value);
  };

  const failureText = (() => {
    switch (failure?.kind) {
      case undefined:
        return undefined;
      case 'code':
        return t('mfa.totp.invalid');
      case 'expired':
        return t('mfa.totp.expired');
      case 'rate':
        return t('mfa.totp.rateLimited', { minutes: failure.minutes });
      case 'server':
        return t('mfa.totp.serverError', { code: failure.code });
    }
  })();

  const startFailureText = (() => {
    if (!start.isError) return null;
    switch (startFailureOf(start.error)) {
      case 'configured':
        return t('mfa.totp.configured');
      case 'unavailable':
        return t('mfa.totp.unavailable');
      case 'failed':
        return t('mfa.totp.startFailed');
    }
  })();

  return (
    <section className="flex w-full flex-col gap-stack-md">
      {heading ? (
        <h2 ref={headingRef} tabIndex={-1} className="text-heading-3 focus-visible:focus-ring">
          {t('mfa.totp.title')}
        </h2>
      ) : null}
      {start.isError ? (
        <InlineAlert
          tone="error"
          action={
            start.error instanceof ApiError && start.error.status === 409 ? undefined : (
              <Button
                variant="tertiary"
                disabled={!online}
                onClick={() => {
                  start.mutate();
                }}
              >
                {t('mfa.totp.retry')}
              </Button>
            )
          }
        >
          {startFailureText}
        </InlineAlert>
      ) : null}
      {setup === null && !start.isError ? (
        <div aria-busy="true" className="flex flex-col gap-stack-md">
          <p role="status" className="text-body text-text-secondary">
            {t('mfa.totp.loading')}
          </p>
          <Skeleton className="h-icon-2xl" />
          <Skeleton className="w-1/2" />
        </div>
      ) : null}
      {setup === null ? null : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-stack-md">
          <p className="text-body">{t('mfa.totp.scan')}</p>
          <QrCode value={setup.otpauthUri} label={t('mfa.totp.qrLabel')} />
          <Disclosure
            title={t('mfa.totp.manualTitle')}
            summary={t('mfa.totp.manualSummary')}
            expanded={expanded}
            onExpandedChange={setExpanded}
          >
            <p className="text-body-sm text-text-secondary">{t('mfa.totp.manualHint')}</p>
            <p className="font-mono text-mono break-all text-text-primary">{grouped(setup.secret)}</p>
          </Disclosure>
          <p className="text-body">{t('mfa.totp.enter')}</p>
          <TextField
            label={t('mfa.totp.label')}
            hint={t('mfa.totp.hint')}
            value={code}
            variant="one-time-code"
            inputRef={input}
            {...(failureText === undefined ? {} : { error: failureText })}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
          <p className="text-body-sm text-text-secondary">{t('mfa.totp.onlyAfter')}</p>
          <div className="flex flex-wrap items-center gap-inline-md">
            <Button type="submit" size="lg" loading={confirm.isPending} disabled={!online}>
              {t('mfa.totp.submit')}
            </Button>
            {onBack === undefined ? null : (
              <Button variant="tertiary" disabled={confirm.isPending} onClick={onBack}>
                {t('mfa.totp.back')}
              </Button>
            )}
          </div>
        </form>
      )}
      {setup === null && onBack !== undefined ? (
        <Button variant="tertiary" onClick={onBack}>
          {t('mfa.totp.back')}
        </Button>
      ) : null}
    </section>
  );
}
