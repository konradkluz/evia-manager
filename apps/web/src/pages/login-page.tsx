import { login } from '@evia/contracts';
import { Banner, Button, Card, InlineAlert, TextField, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { LOGIN_SECOND_STEP_PATH, MFA_SETUP_PATH } from '../paths.ts';
import { completeLogin } from '../session/complete-login.ts';
import { useOpenPath } from '../session/open-path.ts';
import { getLoginNotice, setLoginFlow, subscribeLoginFlow } from '../session/login-flow.ts';
import { resolveReturnTo } from '../session/return-to.ts';
import { AuthLayout } from '../shell/auth-layout.tsx';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { describeLoginFailure, LoginFailureAlert, type LoginFailure } from './login-failure.tsx';

/**
 * W-01 "Zaloguj się" (EVM-067 AC1–AC3, AC8; flows/01). The first step: e-mail and password. Every refusal — wrong
 * password, unknown e-mail, invited or deactivated account — is one message (SR-AUTH-05); the e-mail stays in the field,
 * the password is dropped at once and never leaves the state of this form. The `loginToken` of the answer goes to the
 * memory of the tab (login-flow.ts) and W-02 takes over; an account without a second step gets a limited session and
 * W-03. `returnTo` is validated against the origin of the panel (SR-WEB-06).
 */
export function LoginPage() {
  const { t } = useTranslation();
  usePageTitle(t('login.pageTitle'));
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openPath = useOpenPath();
  const online = useOnline();
  const { returnTo } = useSearch({ strict: false });
  const notice = useSyncExternalStore(subscribeLoginFlow, getLoginNotice);
  const heading = useId();
  const emailInput = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<LoginFailure | null>(null);

  useEffect(() => {
    // Back from W-02 (or a refresh): a login that was not finished is not resumed, its token is gone.
    setLoginFlow(null);
    emailInput.current?.focus();
  }, []);
  useEffect(() => {
    if (failure !== null) alert.current?.focus();
  }, [failure]);

  const submit = useMutation({
    mutationFn: async ({ address, secret }: { address: string; secret: string }) => {
      const result = await unwrap(login({ client, body: { email: address, password: secret } }));
      if (result.state === 'second_step') {
        setLoginFlow({ loginToken: result.loginToken, returnTo: resolveReturnTo(returnTo, globalThis.location.origin) });
        await navigate({ to: LOGIN_SECOND_STEP_PATH });
        return;
      }
      // No second step on the account: a limited session (`mfa_enrollment`) — the gate leads to W-03.
      await completeLogin(client, queryClient, result.csrfToken);
      await openPath(MFA_SETUP_PATH);
    },
    onError: (error) => {
      setPassword('');
      setFailure(describeLoginFailure(error));
    },
  });

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || submit.isPending) return;
    setFailure(null);
    const address = email.trim();
    const secret = password;
    if (address === '' || secret === '') {
      setPassword('');
      setFailure({ kind: 'invalid' });
      return;
    }
    submit.mutate({ address, secret });
  };

  return (
    <AuthLayout>
      <Card labelledBy={heading}>
        <h1 id={heading} className="text-heading-2">
          {t('login.title')}
        </h1>
        {notice === 'expired' ? <InlineAlert tone="info">{t('login.expired')}</InlineAlert> : null}
        {failure === null ? null : <LoginFailureAlert failure={failure} alertRef={alert} />}
        {online ? null : <Banner icon={WifiOff}>{t('login.offline')}</Banner>}
        <form onSubmit={onSubmit} className="flex flex-col gap-stack-md">
          <TextField
            label={t('login.email')}
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            inputRef={emailInput}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <TextField
            label={t('login.password')}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            reveal={{ show: t('login.show'), hide: t('login.hide') }}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <Button type="submit" size="lg" loading={submit.isPending} disabled={!online}>
            {t('login.submit')}
          </Button>
          {online ? null : <p className="text-body-sm text-text-tertiary">{t('login.offlineHint')}</p>}
        </form>
      </Card>
    </AuthLayout>
  );
}
