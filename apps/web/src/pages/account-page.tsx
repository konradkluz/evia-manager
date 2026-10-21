import { getAccount, type Account } from '@evia/contracts';
import { Banner, Button, CircleAlert, EmptyState, InlineAlert, Skeleton } from '@evia/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileCard } from '../account/profile-card.tsx';
import { PasswordCard } from '../account/password-card.tsx';
import { ACCOUNT_KEY } from '../account/query-keys.ts';
import { SecondStepCard } from '../account/second-step-card.tsx';
import { SessionsCard } from '../account/sessions-card.tsx';
import { useAccountSessions } from '../account/use-account-sessions.ts';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { SECOND_STEP_ANCHOR } from '../paths.ts';
import { serverNow } from '../session/server-clock.ts';
import { withRotationRetry } from '../session/step-up.ts';
import { useNow } from '../shell/use-now.ts';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { retryMinutes } from './login-failure.tsx';

/**
 * W-15 "Konto" (EVM-028 AC1–AC8; flows/12): the own account of every role — "Profil", "Hasło", "Drugi krok logowania" (anchor
 * `#drugi-krok`: the focus goes to the heading of that card) and "Moje sesje". The account is the session's: there is no identifier in
 * the address or in a request, so there is no way to ask for somebody else's. The data is personal (e-mail, names of keys) and is not
 * kept in the cache once the page is left (SR-WEB-05); the title of the tab has none of it. "Urządzenia" (E9) is not here yet.
 */
export function AccountPage() {
  const { t } = useTranslation();
  usePageTitle(t('account.pageTitle'));
  const client = useApi();
  const online = useOnline();
  const now = serverNow(useNow(30_000));
  const hash = useRouterState({ select: (state) => state.location.hash });
  const secondStepHeading = useRef<HTMLHeadingElement>(null);
  const sessions = useAccountSessions();

  const query = useQuery({
    queryKey: [ACCOUNT_KEY],
    queryFn: ({ signal }) => withRotationRetry(() => unwrap(getAccount({ client, signal }))),
    retry: false,
    // The e-mail and the names of the keys are personal data: nothing of them stays in the cache once the page is left (SR-WEB-05).
    gcTime: 0,
  });
  const account: Account | undefined = query.data;

  // The anchor `#drugi-krok` (from W-03, M-02 and the e-mails 5 and 6) brings the focus to the heading of the card once it is there.
  const anchored = account !== undefined && hash === SECOND_STEP_ANCHOR;
  useEffect(() => {
    if (!anchored) return;
    secondStepHeading.current?.focus();
  }, [anchored]);

  const failed = query.isError && account === undefined;
  const rate = query.error instanceof ApiError && query.error.status === 429 ? retryMinutes(query.error) : null;

  return (
    <div className="flex w-full max-w-form-max-width flex-col gap-stack-md">
      <h1 className="font-display text-heading-1 text-text-primary">{t('account.title')}</h1>
      {online ? null : <Banner icon={CircleAlert}>{t('account.offlineBanner')}</Banner>}
      {failed ? (
        rate !== null ? (
          <InlineAlert
            tone="error"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  void query.refetch();
                }}
              >
                {t('account.retry')}
              </Button>
            }
          >
            {t('account.failure.rateLimited', { minutes: rate })}
          </InlineAlert>
        ) : (
          <EmptyState
            icon={CircleAlert}
            title={t('account.error.title')}
            description={t('account.error.description')}
            action={
              <Button
                onClick={() => {
                  void query.refetch();
                }}
              >
                {t('account.retry')}
              </Button>
            }
          />
        )
      ) : account === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-stack-md">
          <p role="status" className="text-body text-text-secondary">
            {t('account.loading')}
          </p>
          <Skeleton shape="field" />
          <Skeleton />
          <Skeleton className="w-1/2" />
        </div>
      ) : (
        <>
          <ProfileCard key={account.displayName} account={account} online={online} />
          <PasswordCard account={account} online={online} onEndOtherSessions={sessions.endOthers} />
          <SecondStepCard account={account} online={online} headingRef={secondStepHeading} />
          <SessionsCard state={sessions} online={online} now={now} />
        </>
      )}
    </div>
  );
}
