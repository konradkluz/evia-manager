import { getPasskeyRegistrationOptions, registerPasskey } from '@evia/contracts';
import { Banner, BlockingState, Button, InlineAlert, KeyRound, RadioGroup, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { RecoveryCodesStep } from '../mfa/recovery-codes-step.tsx';
import { setSetupFinishing } from '../mfa/setup-progress.ts';
import { TotpEnrolment } from '../mfa/totp-enrolment.tsx';
import { createPasskey } from '../passkey/create-passkey.ts';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { setCsrfToken } from '../session/csrf.ts';
import { SESSION_KEY, sessionQueryOptions, useSession } from '../session/session.ts';
import { useLogout } from '../session/use-logout.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';

type Method = 'passkey' | 'totp';
type Step = 'method' | Method | 'codes';

/** Step numbers of "Krok N z 3": the choice is 1, the registration 2, the recovery codes 3. */
const STEP_NUMBER: Record<Step, number> = { method: 1, passkey: 2, totp: 2, codes: 3 };

/**
 * W-03 "Skonfiguruj drugi krok logowania" (EVM-016 AC4, EVM-023 AC1, AC4, AC8; flows/01), variant "od EVM-023": three steps —
 * the choice of the method (a passkey or a code of an authenticator app; the Administrator has only the passkey and goes
 * straight to it), the registration, and the recovery codes shown once. The screen is a blocking state without navigation and
 * data, with "Wyloguj" in the top right corner. The progress of the steps lives in the memory of the tab (offline it stays); a
 * refresh drops it. Once the method is active the session is `active`; the gate keeps this page until "Zakończ konfigurację"
 * (the codes are never shown a second time).
 */
export function MfaSetupPage() {
  const { t } = useTranslation();
  usePageTitle(t('mfa.pageTitle'));
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const online = useOnline();
  const session = useSession();
  const role = session.data?.user.role ?? 'administrator';
  const { logout, pending: loggingOut, failed: logoutFailed } = useLogout();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stepRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>(role === 'administrator' ? 'passkey' : 'method');
  const [choice, setChoice] = useState<Method>('passkey');
  // What the person set up — for the summary of step 3.
  const [method, setMethod] = useState<Method>('passkey');
  const first = useRef(true);

  useEffect(() => {
    // After entering the focus is on the title; after a change of the step — on the heading of the step (flows/01 accessibility).
    if (first.current) {
      first.current = false;
      titleRef.current?.focus();
      return;
    }
    stepRef.current?.focus();
  }, [step]);
  // The mark "the codes are being shown" never outlives the page (a refresh, a logout, a leave).
  useEffect(
    () => () => {
      setSetupFinishing(false);
    },
    [],
  );

  /** The answer of the server has no session data of its own: the new `active` session is read (its token replaces the old one). */
  const readSession = () =>
    queryClient.query({ ...sessionQueryOptions(client), staleTime: 0 }).catch(() => queryClient.resetQueries({ queryKey: SESSION_KEY }));

  const register = useMutation({
    mutationFn: async () => {
      const options = await unwrap(getPasskeyRegistrationOptions({ client }));
      const credential = await createPasskey(options);
      await unwrap(registerPasskey({ client, body: { credential } }));
      // The method is active and the session turns `active`: the gate must keep this page for step 3 before it reads it.
      setSetupFinishing(true);
      // The cached `mfa_enrollment` session is outdated; a failure here is handled by the gate.
      await readSession();
    },
    onSuccess: () => {
      setMethod('passkey');
      setStep('codes');
    },
  });

  const confirmedTotp = async (csrfToken: string) => {
    setCsrfToken(csrfToken);
    setSetupFinishing(true);
    await readSession();
    setMethod('totp');
    setStep('codes');
  };

  const finish = () => {
    setSetupFinishing(false);
    showToast(t('mfa.done'));
    void navigate({ to: WORK_ORDERS_PATH, replace: true });
  };

  const current = STEP_NUMBER[step];
  const back =
    role === 'administrator'
      ? undefined
      : () => {
          setStep('method');
        };

  return (
    <BlockingState
      brand={t('app.name')}
      icon={KeyRound}
      title={t('mfa.title')}
      description={t('mfa.description')}
      titleRef={titleRef}
      topAction={
        <Button variant="tertiary" loading={loggingOut} disabled={!online} onClick={logout}>
          {t('shell.logout')}
        </Button>
      }
    >
      <p className="text-label text-text-secondary">{t('mfa.step', { current, total: 3 })}</p>
      {online ? null : <Banner icon={WifiOff}>{t('mfa.offlineBanner')}</Banner>}
      {step === 'method' ? (
        <section className="flex w-full flex-col gap-stack-md">
          <RadioGroup
            legend={t('mfa.method.legend')}
            value={choice}
            onChange={(value) => {
              setChoice(value === 'totp' ? 'totp' : 'passkey');
            }}
            options={[
              { value: 'passkey', label: t('mfa.method.passkey') },
              { value: 'totp', label: t('mfa.method.totp') },
            ]}
          />
          {role === 'editor' ? <InlineAlert tone="info">{t('mfa.method.phone')}</InlineAlert> : null}
          <div>
            <Button
              size="lg"
              onClick={() => {
                setStep(choice);
              }}
            >
              {t('mfa.method.next')}
            </Button>
          </div>
        </section>
      ) : null}
      {step === 'passkey' ? (
        <section className="flex w-full flex-col gap-stack-md">
          {role === 'administrator' ? <p className="text-body">{t('mfa.passkeyRequired')}</p> : null}
          <p className="text-body">{t('mfa.passkeyDescription')}</p>
          <div>
            <Button
              size="lg"
              icon={KeyRound}
              loading={register.isPending}
              disabled={!online}
              onClick={() => {
                register.mutate();
              }}
            >
              {register.isPending ? t('mfa.inProgress') : t('mfa.add')}
            </Button>
          </div>
          {back === undefined ? null : (
            <div>
              <Button variant="tertiary" disabled={register.isPending} onClick={back}>
                {t('mfa.totp.back')}
              </Button>
            </div>
          )}
          {online ? null : <p className="text-body-sm text-text-tertiary">{t('mfa.offlineHint')}</p>}
          {register.isError ? <InlineAlert tone="error">{t('mfa.failed')}</InlineAlert> : null}
        </section>
      ) : null}
      {step === 'totp' ? (
        <TotpEnrolment online={online} headingRef={stepRef} onConfirmed={confirmedTotp} {...(back === undefined ? {} : { onBack: back })} />
      ) : null}
      {step === 'codes' ? <RecoveryCodesStep variant={method} role={role} online={online} headingRef={stepRef} onFinish={finish} /> : null}
      {logoutFailed ? <InlineAlert tone="error">{t('shell.logoutError')}</InlineAlert> : null}
    </BlockingState>
  );
}
