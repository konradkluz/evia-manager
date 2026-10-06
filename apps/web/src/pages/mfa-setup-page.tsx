import { getPasskeyRegistrationOptions, registerPasskey } from '@evia/contracts';
import { BlockingState, Button, InlineAlert, KeyRound } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { createPasskey } from '../passkey/create-passkey.ts';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { sessionQueryOptions } from '../session/session.ts';
import { useLogout } from '../session/use-logout.ts';
import { useToast } from '../shell/toast-context.tsx';
import { usePageTitle } from '../shell/use-page-title.ts';

/**
 * W-03 "Skonfiguruj drugi krok logowania" in the variant before EVM-023 (EVM-016 AC4; flows/01): the only method is a
 * passkey, the screen is a blocking state without navigation and data, with "Wyloguj" in the top right corner. After the
 * key is registered the session is read again (a new session id and CSRF token), a toast confirms and the panel opens.
 */
export function MfaSetupPage() {
  const { t } = useTranslation();
  usePageTitle(t('mfa.pageTitle'));
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const { logout, pending: loggingOut, failed: logoutFailed } = useLogout();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const register = useMutation({
    mutationFn: async () => {
      const options = await unwrap(getPasskeyRegistrationOptions({ client }));
      const credential = await createPasskey(options);
      await unwrap(registerPasskey({ client, body: { credential } }));
      // The answer has no session data (contract): read the new `active` session; a failure here is handled by the gate.
      await queryClient.query({ ...sessionQueryOptions(client), staleTime: 0 }).catch(() => undefined);
    },
    onSuccess: () => {
      showToast(t('mfa.done'));
      void navigate({ to: WORK_ORDERS_PATH, replace: true });
    },
  });

  return (
    <BlockingState
      brand={t('app.name')}
      icon={KeyRound}
      title={t('mfa.title')}
      description={t('mfa.description')}
      titleRef={titleRef}
      topAction={
        <Button variant="tertiary" loading={loggingOut} onClick={logout}>
          {t('shell.logout')}
        </Button>
      }
      action={
        <Button
          size="lg"
          icon={KeyRound}
          loading={register.isPending}
          onClick={() => {
            register.mutate();
          }}
        >
          {register.isPending ? t('mfa.inProgress') : t('mfa.add')}
        </Button>
      }
    >
      {register.isError ? <InlineAlert tone="error">{t('mfa.failed')}</InlineAlert> : null}
      {logoutFailed ? <InlineAlert tone="error">{t('shell.logoutError')}</InlineAlert> : null}
    </BlockingState>
  );
}
