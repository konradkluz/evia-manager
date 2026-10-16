import { checkPasswordResetLink, completePasswordReset } from '@evia/contracts';
import { Banner, Button, Card, EmptyState, InlineAlert, Link2Off, Skeleton, TextField, WifiOff } from '@evia/ui-web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import {
  describeFailure,
  FailureAlert,
  lengthProblem,
  passwordProblemOf,
  problemText,
  type Failure,
  type FieldProblem,
} from '../forms/password-link.tsx';
import { LOGIN_PATH, LOGIN_RESET_PATH, LOGIN_SECOND_STEP_PATH } from '../paths.ts';
import { clearResetToken, getResetTokenSnapshot, subscribeResetToken } from '../reset/reset-token.ts';
import { setCsrfToken } from '../session/csrf.ts';
import { setLoginFlow } from '../session/login-flow.ts';
import { DEFAULT_RETURN_TO } from '../session/return-to.ts';
import { useSession } from '../session/session.ts';
import { AuthFooter } from '../shell/auth-footer.tsx';
import { AuthLayout } from '../shell/auth-layout.tsx';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';

/** First element of the key of the link check; the token itself is never part of a key. */
const LINK_KEY = 'password-reset-link';

/**
 * W-12 "Ustaw nowe hasło" (EVM-025 AC2–AC5; flows/11). The token comes from memory (the fragment was removed in main.tsx),
 * the link is checked without being spent (a link scanner in the mailbox does not burn it), the e-mail of the account
 * appears only after a valid check, and every invalid link — used, expired, superseded, unknown, missing after a refresh —
 * shows the same state (CWE-204).
 */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  usePageTitle(t('reset.pageTitle'));
  const client = useApi();
  const navigate = useNavigate();
  const online = useOnline();
  // The token lives in memory only; a link opened later in this tab changes the generation and starts over.
  const { token, generation } = useSyncExternalStore(subscribeResetToken, getResetTokenSnapshot);
  const session = useSession();
  const check = useQuery({
    // The token is never part of the key: keys are visible in tools and caches.
    queryKey: [LINK_KEY, generation],
    queryFn: ({ signal }) => unwrap(checkPasswordResetLink({ client, body: { token: token ?? '' }, signal })),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const invalidFromCheck = check.error instanceof ApiError && check.error.status === 400;
  // No token = refresh, used link, or a link dropped after a rejected save: always the one invalid-link state.
  const showInvalid = token === null || invalidFromCheck;
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (showInvalid) {
      clearResetToken();
      titleRef.current?.focus();
    }
  }, [showInvalid]);

  const heading = useId();
  let content;
  if (showInvalid) {
    content = (
      <Card>
        <EmptyState
          icon={Link2Off}
          headingLevel={1}
          titleRef={titleRef}
          title={t('reset.invalid.title')}
          description={t('reset.invalid.description')}
          action={
            <div className="flex flex-wrap justify-center gap-inline-md">
              <Button
                size="lg"
                onClick={() => {
                  void navigate({ to: LOGIN_RESET_PATH });
                }}
              >
                {t('reset.invalid.resend')}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => {
                  void navigate({ to: LOGIN_PATH });
                }}
              >
                {t('reset.invalid.back')}
              </Button>
            </div>
          }
        />
      </Card>
    );
  } else if (check.data !== undefined) {
    content = (
      <ResetForm key={generation} token={token} email={check.data.email} otherAccount={session.data !== undefined} online={online} />
    );
  } else if (check.isError) {
    const failure = describeFailure(check.error);
    content = (
      <Card labelledBy={heading}>
        <h1 id={heading} className="text-heading-2">
          {t('reset.title')}
        </h1>
        {failure.kind === 'network' && !online ? (
          <>
            <Banner icon={WifiOff}>{t('activation.offlineLoad')}</Banner>
            <Button
              variant="secondary"
              onClick={() => {
                void check.refetch();
              }}
            >
              {t('activation.retry')}
            </Button>
          </>
        ) : (
          <FailureAlert
            failure={failure}
            serverKey="checkFailed"
            action={() => {
              void check.refetch();
            }}
          />
        )}
      </Card>
    );
  } else {
    content = (
      <Card labelledBy={heading}>
        <h1 id={heading} className="text-heading-2">
          {t('reset.title')}
        </h1>
        <div aria-busy="true" className="flex flex-col gap-stack-md">
          <p role="status" className="text-body text-text-secondary">
            {t('reset.checking')}
          </p>
          <Skeleton shape="field" />
          <Skeleton shape="field" />
          <Skeleton />
        </div>
      </Card>
    );
  }
  return <AuthLayout footer={<AuthFooter />}>{content}</AuthLayout>;
}

interface ResetFormProps {
  readonly token: string;
  readonly email: string;
  readonly otherAccount: boolean;
  readonly online: boolean;
}

function ResetForm({ token, email, otherAccount, online }: ResetFormProps) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const heading = useId();
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<FieldProblem | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = useMutation({
    mutationFn: async (value: string) => {
      const result = await unwrap(completePasswordReset({ client, body: { token, password: value } }));
      // The server ended every session of the account and created none (AC4, AC5): whatever this tab knew about a session
      // is gone, the first step of the login is carried to W-02 in memory, and only after that the token leaves memory
      // (clearing it earlier would swap this page for the invalid-link state under the eyes of the user).
      setCsrfToken(null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== LINK_KEY });
      setLoginFlow({ loginToken: result.loginToken, methods: result.methods, returnTo: DEFAULT_RETURN_TO, passwordChanged: true });
      await navigate({ to: LOGIN_SECOND_STEP_PATH, replace: true });
      clearResetToken();
    },
    onError: (error) => {
      const field = passwordProblemOf(error);
      if (field !== null) {
        setProblem(field);
        setPassword('');
        input.current?.focus();
      } else if (error instanceof ApiError && error.status === 400) {
        // password_reset_link_invalid, or the token itself was rejected: one state for every invalid link.
        setPassword('');
        clearResetToken();
      } else {
        setFailure(describeFailure(error));
      }
    },
  });

  const send = (value: string) => {
    setFailure(null);
    setProblem(null);
    submit.mutate(value);
  };
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || submit.isPending) return;
    const local = lengthProblem(password);
    if (local !== null) {
      setProblem(local);
      input.current?.focus();
      return;
    }
    send(password);
  };

  return (
    <Card labelledBy={heading}>
      <h1 id={heading} className="text-heading-2">
        {t('reset.title')}
      </h1>
      {otherAccount ? <InlineAlert tone="info">{t('reset.otherAccount')}</InlineAlert> : null}
      {online ? null : <Banner icon={WifiOff}>{t('activation.offlineLoad')}</Banner>}
      <form onSubmit={onSubmit} className="flex flex-col gap-stack-md">
        <TextField label={t('reset.email')} type="email" value={email} autoComplete="username" name="username" readOnly />
        <TextField
          label={t('reset.password')}
          type="password"
          name="password"
          autoComplete="new-password"
          value={password}
          hint={t('reset.hint')}
          {...(problem === null ? {} : { error: problemText(t, problem) })}
          reveal={{ show: t('reset.show'), hide: t('reset.hide') }}
          inputRef={input}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          onBlur={() => {
            setProblem(lengthProblem(password));
          }}
        />
        <p className="text-body text-text-secondary">{t('reset.effects')}</p>
        {failure === null ? null : (
          <FailureAlert
            failure={failure}
            serverKey="submitFailed"
            action={() => {
              send(password);
            }}
          />
        )}
        <Button type="submit" size="lg" loading={submit.isPending} disabled={!online}>
          {t('reset.submit')}
        </Button>
        {online ? null : <p className="text-body-sm text-text-tertiary">{t('activation.offlineSubmit')}</p>}
        <Button
          variant="tertiary"
          onClick={() => {
            void navigate({ to: LOGIN_PATH });
          }}
        >
          {t('reset.back')}
        </Button>
      </form>
    </Card>
  );
}
