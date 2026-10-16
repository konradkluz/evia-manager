import { getLoginPasskeyOptions, loginRecoveryCode, loginTotp, verifyLoginPasskey, type CurrentSession } from '@evia/contracts';
import { Banner, Button, Card, InlineAlert, KeyRound, TextField, TriangleAlert, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type RefObject, type SyntheticEvent } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { normaliseRecoveryCode, normaliseTotpCode } from '../mfa/code-input.ts';
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

type Failure =
  { readonly kind: 'key' } | { readonly kind: 'code' } | { readonly kind: 'expired' } | ReturnType<typeof describeLoginFailure>;

type View = 'passkey' | 'totp' | 'recovery';

/** The first step ran out (`login_expired`) or the token is unknown (`unauthenticated`): the same message, back to W-01. */
const isExpired = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401 && (error.code === 'login_expired' || error.code === 'unauthenticated');

function classify(error: unknown, rejected: 'key' | 'code'): Failure {
  if (isExpired(error)) return { kind: 'expired' };
  // A refused or cancelled ceremony (no DOMException details are shown), a key or a code the server did not accept — one message.
  if (!(error instanceof ApiError) || error.status === 400 || error.status === 401) return { kind: rejected };
  return describeLoginFailure(error);
}

/** The methods the panel knows, in the order of the server; unknown values are ignored (the enum grows). */
function primaryMethods(methods: readonly string[]): ('passkey' | 'totp')[] {
  const known = methods.filter((method): method is 'passkey' | 'totp' => method === 'passkey' || method === 'totp');
  return [...new Set(known)];
}

/** "Pozostał 1 kod." / "Pozostały 3 kody." / "Pozostało 9 kodów." — the category of `Intl.PluralRules('pl')` (styleguide § 6.3); 0 — the last one. */
function remainingText(t: TFunction, count: number): string {
  if (count === 0) return t('secondStep.recovered.last');
  switch (new Intl.PluralRules('pl').select(count)) {
    case 'one':
      return t('secondStep.recovered.remainingOne', { count });
    case 'few':
      return t('secondStep.recovered.remainingFew', { count });
    case 'many':
      return t('secondStep.recovered.remainingMany', { count });
    default:
      return t('secondStep.recovered.remainingOther', { count });
  }
}

/** After a login with a recovery code: what the server answered (the count after this code) and the role for the hint. */
interface Recovered {
  readonly remaining: number;
  readonly role: CurrentSession['user']['role'] | undefined;
}

/**
 * W-02 "Potwierdź logowanie" (EVM-067 AC4, EVM-023 AC2, AC3, AC5): the methods come from the server in the answer of the
 * first step — a passkey, a code of an authenticator app (one field, never sent on its own) and the recovery code as a secondary
 * way (only here, never in W-04). The `loginToken` comes from the memory of the tab; without it (a refresh, a direct visit)
 * the page goes back to W-01. A failed key or code → one message and a retry; the first step ran out → "Logowanie trwało zbyt
 * długo" and the way back. The server decides everything — the account, the role, the code, the key (SR-AUTH-09).
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
  const keyButton = useRef<HTMLButtonElement>(null);
  const totpInput = useRef<HTMLInputElement>(null);
  const recoveryInput = useRef<HTMLInputElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const primary = primaryMethods(flow.methods);
  const canRecover = flow.methods.includes('recovery_code');
  const [view, setView] = useState<View>(primary[0] ?? (canRecover ? 'recovery' : 'passkey'));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [totp, setTotp] = useState('');
  const [recovery, setRecovery] = useState('');
  const [recovered, setRecovered] = useState<Recovered | null>(null);
  // After a password reset the success message is read right after the heading: focus starts there, once.
  const headingFocus = useRef(flow.passwordChanged === true);

  useEffect(() => {
    if (headingFocus.current) {
      headingFocus.current = false;
      title.current?.focus();
      return;
    }
    (view === 'passkey' ? keyButton : view === 'totp' ? totpInput : recoveryInput).current?.focus();
  }, [view]);
  useEffect(() => {
    if (recovered !== null) continueButton.current?.focus();
  }, [recovered]);

  const back = () => {
    setLoginFlow(null);
    void navigate({
      to: LOGIN_PATH,
      replace: true,
      ...(flow.returnTo === DEFAULT_RETURN_TO ? {} : { search: { returnTo: flow.returnTo } }),
    });
  };

  const onError = (error: unknown, rejected: 'key' | 'code', clear?: () => void, field?: RefObject<HTMLInputElement | null>) => {
    const next = classify(error, rejected);
    if (next.kind === 'expired') setLoginFlow(null);
    // A rejected code is cleared and the field gets the focus; after a network error the code stays (styleguide § 3.2.1).
    if (next.kind === 'code') {
      clear?.();
      field?.current?.focus();
    }
    setFailure(next);
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
      onError(error, 'key');
    },
  });

  const useTotp = useMutation({
    mutationFn: async (code: string) => {
      const result = await unwrap(loginTotp({ client, body: { loginToken: flow.loginToken, code } }));
      const session = await completeLogin(client, queryClient, result.csrfToken);
      await openPath(session?.state === 'mfa_enrollment' ? MFA_SETUP_PATH : flow.returnTo);
    },
    onError: (error) => {
      onError(
        error,
        'code',
        () => {
          setTotp('');
        },
        totpInput,
      );
    },
  });

  const useRecoveryCode = useMutation({
    mutationFn: async (code: string) => {
      const result = await unwrap(loginRecoveryCode({ client, body: { loginToken: flow.loginToken, code } }));
      const session = await completeLogin(client, queryClient, result.csrfToken);
      if (session === undefined || session.state === 'mfa_enrollment') {
        await openPath(MFA_SETUP_PATH);
        return;
      }
      // The step between the login and the panel: the count of codes that are left and the hint about the reset.
      setRecovery('');
      setRecovered({ remaining: result.remainingCodes, role: session.user.role });
    },
    onError: (error) => {
      onError(
        error,
        'code',
        () => {
          setRecovery('');
        },
        recoveryInput,
      );
    },
  });

  const busy = useKey.isPending || useTotp.isPending || useRecoveryCode.isPending;
  const expired = failure?.kind === 'expired';

  const submitTotp = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || busy) return;
    setFailure(null);
    const code = normaliseTotpCode(totp);
    // Not a code at all: no request (it would only use up an attempt of the login), the same message as a wrong code.
    if (code === null) {
      setTotp('');
      setFailure({ kind: 'code' });
      totpInput.current?.focus();
      return;
    }
    useTotp.mutate(code);
  };
  const submitRecovery = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || busy) return;
    setFailure(null);
    const code = normaliseRecoveryCode(recovery);
    if (code === null) {
      setRecovery('');
      setFailure({ kind: 'code' });
      recoveryInput.current?.focus();
      return;
    }
    useRecoveryCode.mutate(code);
  };

  const switchTo = (next: View) => {
    setFailure(null);
    setView(next);
  };
  const otherMethod = primary.length > 1 ? (view === 'passkey' ? 'totp' : 'passkey') : null;

  const codeError =
    failure?.kind === 'code' ? (view === 'recovery' ? t('secondStep.recovery.invalid') : t('secondStep.totp.invalid')) : undefined;
  const otherFailure = failure !== null && failure.kind !== 'code' && failure.kind !== 'key' && failure.kind !== 'expired' ? failure : null;

  return (
    <AuthLayout>
      <Card labelledBy={heading}>
        <h1
          id={heading}
          ref={title}
          tabIndex={flow.passwordChanged === true ? -1 : undefined}
          className="text-heading-2 focus-visible:focus-ring"
        >
          {t('secondStep.title')}
        </h1>
        {flow.passwordChanged === true && !expired && recovered === null ? (
          <InlineAlert tone="success">{t('secondStep.passwordChanged')}</InlineAlert>
        ) : null}
        {recovered !== null ? (
          <>
            <Banner icon={TriangleAlert}>
              <p>
                {t('secondStep.recovered.used')} {remainingText(t, recovered.remaining)} {t('secondStep.recovered.emailSent')}
              </p>
              <p>
                {recovered.role === 'administrator' ? t('secondStep.recovered.hintAdministrator') : t('secondStep.recovered.hintOther')}
              </p>
            </Banner>
            <Button
              ref={continueButton}
              size="lg"
              onClick={() => {
                void openPath(flow.returnTo);
              }}
            >
              {t('secondStep.recovered.continue')}
            </Button>
          </>
        ) : expired ? (
          <InlineAlert
            tone="error"
            action={
              <Button variant="tertiary" onClick={back}>
                {t('secondStep.back')}
              </Button>
            }
          >
            {flow.passwordChanged === true ? t('secondStep.tooLongAfterReset') : t('secondStep.tooLong')}
          </InlineAlert>
        ) : (
          <>
            {view === 'recovery' ? <p className="text-body text-text-secondary">{t('secondStep.recovery.description')}</p> : null}
            {view === 'passkey' ? <p className="text-body text-text-secondary">{t('secondStep.description')}</p> : null}
            {failure?.kind === 'key' ? <InlineAlert tone="error">{t('secondStep.failed')}</InlineAlert> : null}
            {otherFailure === null ? null : <LoginFailureAlert failure={otherFailure} />}
            {online ? null : <Banner icon={WifiOff}>{t('login.offline')}</Banner>}
            {view === 'passkey' ? (
              <Button
                ref={keyButton}
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
            ) : (
              <form noValidate onSubmit={view === 'totp' ? submitTotp : submitRecovery} className="flex flex-col gap-stack-md">
                {view === 'totp' ? (
                  <TextField
                    label={t('secondStep.totp.label')}
                    hint={t('secondStep.totp.hint')}
                    value={totp}
                    variant="one-time-code"
                    inputRef={totpInput}
                    {...(codeError === undefined ? {} : { error: codeError })}
                    onChange={(event) => {
                      setTotp(event.target.value);
                    }}
                  />
                ) : (
                  <TextField
                    label={t('secondStep.recovery.label')}
                    hint={t('secondStep.recovery.hint')}
                    value={recovery}
                    variant="recovery-code"
                    inputRef={recoveryInput}
                    {...(codeError === undefined ? {} : { error: codeError })}
                    onChange={(event) => {
                      setRecovery(event.target.value);
                    }}
                  />
                )}
                <Button
                  type="submit"
                  size="lg"
                  loading={view === 'totp' ? useTotp.isPending : useRecoveryCode.isPending}
                  disabled={!online}
                >
                  {view === 'totp' ? t('secondStep.totp.submit') : t('secondStep.recovery.submit')}
                </Button>
              </form>
            )}
            {online ? null : <p className="text-body-sm text-text-tertiary">{t('login.offlineHint')}</p>}
            {otherMethod === null ? null : (
              <Button
                variant="tertiary"
                disabled={busy}
                onClick={() => {
                  switchTo(otherMethod);
                }}
              >
                {t('secondStep.otherMethod')}
              </Button>
            )}
            {canRecover && view !== 'recovery' ? (
              <Button
                variant="tertiary"
                disabled={busy}
                onClick={() => {
                  switchTo('recovery');
                }}
              >
                {t('secondStep.useRecovery')}
              </Button>
            ) : null}
            {view === 'recovery' && primary.length > 0 ? (
              <Button
                variant="tertiary"
                disabled={busy}
                onClick={() => {
                  switchTo(primary[0] ?? 'passkey');
                }}
              >
                {t('secondStep.otherMethod')}
              </Button>
            ) : null}
            <Button variant="tertiary" onClick={back}>
              {t('secondStep.back')}
            </Button>
          </>
        )}
      </Card>
    </AuthLayout>
  );
}
