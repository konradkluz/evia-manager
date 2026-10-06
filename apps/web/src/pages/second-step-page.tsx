import { getLoginPasskeyOptions, verifyLoginPasskey } from '@evia/contracts';
import { Banner, Button, Card, InlineAlert, KeyRound, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { getPasskey } from '../passkey/get-passkey.ts';
import { LOGIN_PATH, LOGIN_SECOND_STEP_PATH, MFA_SETUP_PATH } from '../paths.ts';
import { completeLogin } from '../session/complete-login.ts';
import { getLoginFlow, setLoginFlow, type LoginFlow } from '../session/login-flow.ts';
import { useOpenPath } from '../session/open-path.ts';
import { DEFAULT_RETURN_TO } from '../session/return-to.ts';
import { AuthLayout } from '../shell/auth-layout.tsx';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { describeLoginFailure, LoginFailureAlert } from './login-failure.tsx';

type Failure = { readonly kind: 'key' } | { readonly kind: 'expired' } | ReturnType<typeof describeLoginFailure>;

/** The first step ran out (`login_expired`) or the token is unknown (`unauthenticated`): the same message, back to W-01. */
const isExpired = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401 && (error.code === 'login_expired' || error.code === 'unauthenticated');

function classify(error: unknown): Failure {
  if (isExpired(error)) return { kind: 'expired' };
  // A refused or cancelled ceremony (no DOMException details are shown) and a key the server did not accept.
  if (!(error instanceof ApiError) || error.status === 400 || error.status === 401) return { kind: 'key' };
  return describeLoginFailure(error);
}

/**
 * W-02 "Potwierdź logowanie" (EVM-067 AC4), the variant before EVM-023: the only method is a passkey (no "Użyj innej
 * metody", no code). The `loginToken` comes from the memory of the tab; without it (a refresh, a direct visit) the page
 * goes back to W-01. Cancelled or failed key → a message and a retry; the first step ran out → "Logowanie trwało zbyt
 * długo" and the way back. The server decides everything — key of the account, challenge, user verification (SR-AUTH-09).
 */
export function SecondStepPage() {
  // Taken once: the flow is cleared when the login succeeds, which must not bounce this page to W-01 on its way out.
  const [flow] = useState(getLoginFlow);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (flow !== null) return <SecondStep flow={flow} />;
  // While the router is already on another address (the login just succeeded) this page is a leftover frame: no redirect.
  return pathname === LOGIN_SECOND_STEP_PATH ? <Navigate to={LOGIN_PATH} replace /> : null;
}

function SecondStep({ flow }: { readonly flow: LoginFlow }) {
  const { t } = useTranslation();
  usePageTitle(t('login.pageTitle'));
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openPath = useOpenPath();
  const online = useOnline();
  const heading = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    button.current?.focus();
  }, []);

  const back = () => {
    setLoginFlow(null);
    void navigate({
      to: LOGIN_PATH,
      replace: true,
      ...(flow.returnTo === DEFAULT_RETURN_TO ? {} : { search: { returnTo: flow.returnTo } }),
    });
  };

  const useKey = useMutation({
    mutationFn: async () => {
      const options = await unwrap(getLoginPasskeyOptions({ client, body: { loginToken: flow.loginToken } }));
      const credential = await getPasskey(options);
      const result = await unwrap(verifyLoginPasskey({ client, body: { loginToken: flow.loginToken, credential } }));
      const session = await completeLogin(client, queryClient, result.csrfToken);
      await openPath(session?.state === 'mfa_enrollment' ? MFA_SETUP_PATH : flow.returnTo);
    },
    onError: (error) => {
      const next = classify(error);
      if (next.kind === 'expired') setLoginFlow(null);
      setFailure(next);
    },
  });

  const expired = failure?.kind === 'expired';

  return (
    <AuthLayout>
      <Card labelledBy={heading}>
        <h1 id={heading} className="text-heading-2">
          {t('secondStep.title')}
        </h1>
        {expired ? (
          <InlineAlert
            tone="error"
            action={
              <Button variant="tertiary" onClick={back}>
                {t('secondStep.back')}
              </Button>
            }
          >
            {t('secondStep.tooLong')}
          </InlineAlert>
        ) : (
          <>
            <p className="text-body text-text-secondary">{t('secondStep.description')}</p>
            {failure === null ? null : failure.kind === 'key' ? (
              <InlineAlert tone="error">{t('secondStep.failed')}</InlineAlert>
            ) : (
              <LoginFailureAlert failure={failure} />
            )}
            {online ? null : <Banner icon={WifiOff}>{t('login.offline')}</Banner>}
            <Button
              ref={button}
              size="lg"
              icon={KeyRound}
              loading={useKey.isPending}
              disabled={!online}
              onClick={() => {
                setFailure(null);
                useKey.mutate();
              }}
            >
              {useKey.isPending ? t('secondStep.inProgress') : t('secondStep.useKey')}
            </Button>
            {online ? null : <p className="text-body-sm text-text-tertiary">{t('login.offlineHint')}</p>}
            <Button variant="tertiary" onClick={back}>
              {t('secondStep.back')}
            </Button>
          </>
        )}
      </Card>
    </AuthLayout>
  );
}
