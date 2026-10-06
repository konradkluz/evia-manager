import { checkActivationLink, setActivationPassword, type UserRole } from '@evia/contracts';
import { Banner, Button, Card, InlineAlert, Link2Off, EmptyState, Skeleton, TextField, WifiOff } from '@evia/ui-web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { clearActivationToken, getActivationToken } from '../activation/activation-token.ts';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { LOGIN_PATH, MFA_SETUP_PATH } from '../paths.ts';
import { setCsrfToken } from '../session/csrf.ts';
import { SESSION_KEY, sessionQueryOptions, useSession } from '../session/session.ts';
import { AuthLayout } from '../shell/auth-layout.tsx';
import { usePageTitle } from '../shell/use-page-title.ts';
import { useOnline } from '../shell/use-online.ts';

/** Password rules of P2 as the server counts them: Unicode code points after NFC (SR-AUTH-01). */
const MIN_LENGTH = 15;
const MAX_LENGTH = 256;

type FieldProblem = 'too_short' | 'too_long' | 'too_weak';

function lengthProblem(password: string): FieldProblem | null {
  const length = Array.from(password.normalize('NFC')).length;
  if (length < MIN_LENGTH) return 'too_short';
  return length > MAX_LENGTH ? 'too_long' : null;
}

function problemText(t: TFunction, problem: FieldProblem): string {
  switch (problem) {
    case 'too_short':
      return t('activation.tooShort');
    case 'too_long':
      return t('activation.tooLong');
    case 'too_weak':
      return t('activation.tooWeak');
  }
}

function roleText(t: TFunction, role: UserRole): string {
  switch (role) {
    case 'administrator':
      return t('roles.administrator');
    case 'editor':
      return t('roles.editor');
    case 'read_only':
      return t('roles.readOnly');
  }
}

/** Failures that keep the form (the link is still fine) and what the user sees. */
type Failure =
  { readonly kind: 'rate'; readonly minutes: number } | { readonly kind: 'server'; readonly code: string } | { readonly kind: 'network' };

function describeFailure(error: unknown): Failure {
  if (error instanceof ApiError) {
    if (error.status === 429) return { kind: 'rate', minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)) };
    if (error.status === 0) return { kind: 'network' };
    return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
  }
  return { kind: 'network' };
}

function FailureAlert({
  failure,
  action,
  serverKey,
}: {
  readonly failure: Failure;
  readonly action: () => void;
  readonly serverKey: 'checkFailed' | 'submitFailed';
}) {
  const { t } = useTranslation();
  const retry = (
    <Button variant="tertiary" onClick={action}>
      {t('activation.retry')}
    </Button>
  );
  switch (failure.kind) {
    case 'rate':
      return (
        <InlineAlert tone="error" action={retry}>
          {t('activation.rateLimited', { minutes: failure.minutes })}
        </InlineAlert>
      );
    case 'network':
      return (
        <InlineAlert tone="error" action={retry}>
          {t('activation.noConnection')}
        </InlineAlert>
      );
    case 'server':
      return (
        <InlineAlert tone="error" action={retry}>
          {serverKey === 'checkFailed'
            ? t('activation.checkFailed', { code: failure.code })
            : t('activation.submitFailed', { code: failure.code })}
        </InlineAlert>
      );
  }
}

/**
 * W-13 "Ustaw hasło" (EVM-016 AC3, AC5; flows/11). The token comes from memory (the fragment was removed in main.tsx),
 * the link is checked without being spent, account data (e-mail, role) appears only after a valid check, and every
 * invalid link — used, changed, superseded, expired, missing after a refresh — shows the same state (CWE-204).
 */
export function ActivationPage() {
  const { t } = useTranslation();
  usePageTitle(t('activation.pageTitle'));
  const client = useApi();
  const navigate = useNavigate();
  const online = useOnline();
  const [token] = useState(getActivationToken);
  const [linkInvalid, setLinkInvalid] = useState(token === null);
  const session = useSession();
  const check = useQuery({
    queryKey: ['activation-link'],
    // The token is never part of the key: keys are visible in tools and caches.
    queryFn: ({ signal }) => unwrap(checkActivationLink({ client, body: { token: token ?? '' }, signal })),
    enabled: token !== null && !linkInvalid,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const invalidFromCheck = check.error instanceof ApiError && check.error.status === 400;
  const showInvalid = linkInvalid || invalidFromCheck;
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (showInvalid) {
      clearActivationToken();
      titleRef.current?.focus();
    }
  }, [showInvalid]);

  const heading = useId();
  let content;
  if (showInvalid) {
    content = (
      <EmptyState
        icon={Link2Off}
        headingLevel={1}
        titleRef={titleRef}
        title={t('activation.invalid.title')}
        description={t('activation.invalid.description')}
        action={
          <Button
            size="lg"
            onClick={() => {
              void navigate({ to: LOGIN_PATH });
            }}
          >
            {t('activation.invalid.action')}
          </Button>
        }
      />
    );
  } else if (check.data !== undefined && token !== null) {
    content = (
      <ActivationForm
        token={token}
        email={check.data.email}
        role={check.data.role}
        otherAccount={session.data !== undefined}
        online={online}
        onInvalid={() => {
          setLinkInvalid(true);
        }}
      />
    );
  } else if (check.isError) {
    const failure = describeFailure(check.error);
    content = (
      <Card labelledBy={heading}>
        <h1 id={heading} className="text-heading-2">
          {t('activation.title')}
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
          {t('activation.title')}
        </h1>
        <div aria-busy="true" className="flex flex-col gap-stack-md">
          <p role="status" className="text-body text-text-secondary">
            {t('activation.checking')}
          </p>
          <Skeleton shape="field" />
          <Skeleton shape="field" />
          <Skeleton />
        </div>
      </Card>
    );
  }
  return <AuthLayout>{content}</AuthLayout>;
}

interface ActivationFormProps {
  readonly token: string;
  readonly email: string;
  readonly role: UserRole;
  readonly otherAccount: boolean;
  readonly online: boolean;
  readonly onInvalid: () => void;
}

function ActivationForm({ token, email, role, otherAccount, online, onInvalid }: ActivationFormProps) {
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
      const result = await unwrap(setActivationPassword({ client, body: { token, password: value } }));
      // Success: the token and the password leave memory, data of another account is dropped, the new session is read.
      clearActivationToken();
      setCsrfToken(result.csrfToken);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
      await queryClient.query({ ...sessionQueryOptions(client), staleTime: 0 }).catch(() => undefined);
    },
    onSuccess: () => {
      setPassword('');
      void navigate({ to: MFA_SETUP_PATH, replace: true });
    },
    onError: (error) => {
      const field = error instanceof ApiError ? error.errors.find((entry) => entry.pointer === '/password') : undefined;
      if (field?.code === 'too_short' || field?.code === 'too_long' || field?.code === 'too_weak') {
        setProblem(field.code);
        setPassword('');
        input.current?.focus();
      } else if (error instanceof ApiError && error.status === 400) {
        // activation_link_invalid, or the token itself was rejected: one state for every invalid link.
        setPassword('');
        onInvalid();
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
      <div className="flex flex-col gap-stack-xs">
        <h1 id={heading} className="text-heading-2">
          {t('activation.title')}
        </h1>
        <p className="text-body text-text-secondary">{t('activation.role', { role: roleText(t, role) })}</p>
      </div>
      {otherAccount ? <InlineAlert tone="info">{t('activation.otherAccount')}</InlineAlert> : null}
      {online ? null : <Banner icon={WifiOff}>{t('activation.offlineLoad')}</Banner>}
      <form onSubmit={onSubmit} className="flex flex-col gap-stack-md">
        <TextField label={t('activation.email')} type="email" value={email} autoComplete="username" name="username" readOnly />
        <TextField
          label={t('activation.password')}
          type="password"
          name="password"
          autoComplete="new-password"
          value={password}
          hint={t('activation.hint')}
          {...(problem === null ? {} : { error: problemText(t, problem) })}
          reveal={{ show: t('activation.show'), hide: t('activation.hide') }}
          inputRef={input}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          onBlur={() => {
            setProblem(lengthProblem(password));
          }}
        />
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
          {t('activation.submit')}
        </Button>
        {online ? null : <p className="text-body-sm text-text-tertiary">{t('activation.offlineSubmit')}</p>}
        <p className="text-body-sm text-text-secondary">{t('activation.next')}</p>
      </form>
    </Card>
  );
}
