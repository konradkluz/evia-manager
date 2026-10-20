import { requestPasswordReset } from '@evia/contracts';
import { Banner, Button, Card, InlineAlert, TextField, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { isWrongOrigin } from '../api/panel-address.ts';
import { LOGIN_PATH } from '../paths.ts';
import { AuthFooter } from '../shell/auth-footer.tsx';
import { AuthLayout } from '../shell/auth-layout.tsx';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { retryMinutes, wrongOriginText } from './login-failure.tsx';

/** What the user sees when the request did not go through; the answer of the server never says anything about the account. */
type Failure =
  | { readonly kind: 'rate'; readonly minutes: number }
  | { readonly kind: 'network' }
  | { readonly kind: 'origin' }
  | { readonly kind: 'server'; readonly code: string };

function describeFailure(error: unknown): Failure {
  if (!(error instanceof ApiError)) return { kind: 'network' };
  if (error.status === 429) return { kind: 'rate', minutes: retryMinutes(error) };
  if (error.status === 0) return { kind: 'network' };
  if (isWrongOrigin(error)) return { kind: 'origin' };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/**
 * W-01 "Zresetuj hasło" (EVM-025 AC1, AC6, AC7; flows/01, flows/11). The card of W-01 with one field: whatever the
 * address, the visitor reads the same message (SR-AUTH-05, CWE-204) — the page never learns whether the account exists,
 * and the answer is the same `202`. The field is empty when the page opens (ASVS V6.4.3: no address is carried over from
 * W-12 or the mail), and what was typed stays after sending and after an error.
 */
export function ResetRequestPage() {
  const { t } = useTranslation();
  usePageTitle(t('resetRequest.pageTitle'));
  const client = useApi();
  const navigate = useNavigate();
  const online = useOnline();
  const heading = useId();
  const emailInput = useRef<HTMLInputElement>(null);
  const message = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    emailInput.current?.focus();
  }, []);
  useEffect(() => {
    if (sent || failure !== null) message.current?.focus();
  }, [sent, failure]);

  const submit = useMutation({
    mutationFn: (address: string) => unwrap(requestPasswordReset({ client, body: { email: address } })),
    onSuccess: () => {
      setSent(true);
    },
    onError: (error) => {
      // 400 is `validation_failed` for the shape of the address only: the one message under the field.
      if (error instanceof ApiError && error.status === 400) {
        setFieldError(true);
        emailInput.current?.focus();
      } else {
        setFailure(describeFailure(error));
      }
    },
  });

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || submit.isPending) return;
    setSent(false);
    setFailure(null);
    const address = email.trim();
    if (address === '') {
      setFieldError(true);
      emailInput.current?.focus();
      return;
    }
    setFieldError(false);
    submit.mutate(address);
  };

  const failureText = (current: Failure): string => {
    switch (current.kind) {
      case 'rate':
        return t('resetRequest.rateLimited', { minutes: current.minutes });
      case 'network':
        return t('resetRequest.noConnection');
      case 'origin':
        return wrongOriginText(t, 'resetRequest');
      case 'server':
        return t('resetRequest.serverError', { code: current.code });
    }
  };

  return (
    <AuthLayout footer={<AuthFooter />}>
      <Card labelledBy={heading}>
        <h1 id={heading} className="text-heading-2">
          {t('resetRequest.title')}
        </h1>
        {sent ? (
          <InlineAlert tone="info" alertRef={message}>
            {t('resetRequest.sent')}
          </InlineAlert>
        ) : null}
        {failure === null ? null : (
          <InlineAlert tone="error" alertRef={message}>
            {failureText(failure)}
          </InlineAlert>
        )}
        {online ? null : <Banner icon={WifiOff}>{t('resetRequest.offline')}</Banner>}
        <form onSubmit={onSubmit} className="flex flex-col gap-stack-md" noValidate>
          <TextField
            label={t('resetRequest.email')}
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            inputRef={emailInput}
            {...(fieldError ? { error: t('resetRequest.emailInvalid') } : {})}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <Button type="submit" size="lg" loading={submit.isPending} disabled={!online}>
            {t('resetRequest.submit')}
          </Button>
          {online ? null : <p className="text-body-sm text-text-tertiary">{t('resetRequest.offlineHint')}</p>}
          <Button
            variant="tertiary"
            onClick={() => {
              void navigate({ to: LOGIN_PATH });
            }}
          >
            {t('resetRequest.back')}
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
