import { changePassword, type Account } from '@evia/contracts';
import { Banner, Button, Card, InlineAlert, TextField, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { lengthProblem, problemText, type FieldProblem } from '../forms/password-link.tsx';
import { retryMinutes } from '../pages/login-failure.tsx';
import { setLoginNotice } from '../session/login-flow.ts';
import { sessionQueryOptions } from '../session/session.ts';
import { describeAccountFailure, type AccountFailure } from './account-failure.ts';
import { AccountFailureAlert } from './account-failure-alert.tsx';
import { pluralOf } from './plural.ts';
import { ReauthenticationCancelled, useReauthCall } from './use-reauth-call.ts';

type NewPasswordProblem = FieldProblem | 'same_as_current';
type FocusTarget = 'current' | 'open' | 'save' | 'notice';

/** The refusal of the server for the new password (`/newPassword`), if that is what the answer was. */
function newPasswordProblemOf(error: unknown): NewPasswordProblem | null {
  const field = error instanceof ApiError ? error.errors.find((entry) => entry.pointer === '/newPassword') : undefined;
  return field?.code === 'too_short' || field?.code === 'too_long' || field?.code === 'too_weak' || field?.code === 'same_as_current'
    ? field.code
    : null;
}

/**
 * W-15 "Hasło" (EVM-028 AC2; SR-AUTH-03, SR-AUTH-10; ASVS V7.5.1, V7.4.3). "Zmień hasło" opens the form in its place (it is not a toggle):
 * the current password, the new one, then W-04 with the second step only. The order is the server's: the current password (every wrong
 * one counts towards the limits of the login), the rules of the new one, the mark of the re-authentication. Passwords live in the state
 * of this card only (SR-WEB-05): cleared by "Anuluj", after the success and with the page. After the change the form is closed and
 * empty, the notice says how many other sessions the account has and offers to end them.
 */
export function PasswordCard({
  account,
  online,
  onEndOtherSessions,
}: {
  readonly account: Account;
  readonly online: boolean;
  /** "Zakończ pozostałe sesje" of the notice: the page ends them (a step-up when the server asks) and says so in a toast. */
  readonly onEndOtherSessions: () => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const id = useId();
  const currentInput = useRef<HTMLInputElement>(null);
  const newInput = useRef<HTMLInputElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const wanted = useRef<FocusTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState('');
  const [currentError, setCurrentError] = useState<string | undefined>(undefined);
  const [newProblem, setNewProblem] = useState<NewPasswordProblem | null>(null);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [changed, setChanged] = useState<number | null>(null);
  const reauth = useReauthCall('password_change', t('stepUp.title.changePassword'), undefined);

  // The focus moves after the render that shows its target (flows/12 → W-15 "Fokus").
  useEffect(() => {
    const target = wanted.current;
    if (target === null) return;
    wanted.current = null;
    const element = { current: currentInput, open: openButton, save: saveButton, notice }[target].current;
    element?.focus();
  });

  const reset = () => {
    setCurrent('');
    setFresh('');
    setCurrentError(undefined);
    setNewProblem(null);
    setFailure(null);
  };

  const save = useMutation({
    mutationFn: () => reauth.run(() => unwrap(changePassword({ client, body: { currentPassword: current, newPassword: fresh } }))),
    onSuccess: (result) => {
      reset();
      setOpen(false);
      setChanged(result.otherActiveSessions);
      wanted.current = 'notice';
    },
    onError: (error) => {
      if (error instanceof ReauthenticationCancelled) {
        // "Anuluj" in W-04: the form comes back with its data and the focus on "Zapisz nowe hasło".
        setFailure(null);
        wanted.current = 'save';
        return;
      }
      if (error instanceof ApiError && error.status === 401 && error.code === 'invalid_credentials') {
        setCurrent('');
        setCurrentError(t('account.password.currentInvalid'));
        wanted.current = 'current';
        return;
      }
      const problem = newPasswordProblemOf(error);
      if (problem !== null) {
        setNewProblem(problem);
        setFresh('');
        newInput.current?.focus();
        return;
      }
      if (error instanceof ApiError && error.status === 429) {
        // A lock ends the session on the server: read it, and when it is gone the tab goes to W-01 with the notice.
        void queryClient.query({ ...sessionQueryOptions(client), staleTime: 0 }).catch((reason: unknown) => {
          if (reason instanceof ApiError && reason.status === 401 && reason.code === 'session_revoked') setLoginNotice('attempts');
        });
        setFailure({ kind: 'rate', minutes: retryMinutes(error) });
        return;
      }
      setFailure(describeAccountFailure(error));
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || save.isPending || reauth.stepping) return;
    setFailure(null);
    if (current === '') {
      setCurrentError(t('account.password.currentRequired'));
      currentInput.current?.focus();
      return;
    }
    setCurrentError(undefined);
    const local = lengthProblem(fresh);
    if (local !== null) {
      setNewProblem(local);
      newInput.current?.focus();
      return;
    }
    setNewProblem(null);
    save.mutate();
  };

  const newError =
    newProblem === null ? undefined : newProblem === 'same_as_current' ? t('account.password.sameAsCurrent') : problemText(t, newProblem);
  const others = (count: number): string => {
    switch (pluralOf(count)) {
      case 'one':
        return t('account.password.othersOne', { count });
      case 'few':
        return t('account.password.othersFew', { count });
      case 'many':
        return t('account.password.othersMany', { count });
    }
  };

  return (
    <Card labelledBy={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-heading-3">
        {t('account.password.title')}
      </h2>
      {changed === null ? null : (
        <InlineAlert tone="success" alertRef={notice}>
          {changed === 0 ? t('account.password.changed') : `${t('account.password.changed')} ${others(changed)}`}
        </InlineAlert>
      )}
      {changed !== null && changed > 0 ? (
        <div>
          <Button variant="secondary" disabled={!online} onClick={onEndOtherSessions}>
            {t('account.sessions.endOthers')}
          </Button>
        </div>
      ) : null}
      {open ? (
        <form noValidate onSubmit={submit} className="flex flex-col gap-stack-md">
          {online ? null : <Banner icon={WifiOff}>{t('account.offlineHint')}</Banner>}
          {failure === null ? null : <AccountFailureAlert failure={failure} notFound={t('account.failure.forbidden')} />}
          <TextField
            label={t('account.password.email')}
            type="email"
            value={account.email}
            autoComplete="username"
            name="username"
            readOnly
          />
          <TextField
            label={t('account.password.current')}
            type="password"
            name="current-password"
            autoComplete="current-password"
            value={current}
            reveal={{ show: t('account.password.show'), hide: t('account.password.hide') }}
            inputRef={currentInput}
            {...(currentError === undefined ? {} : { error: currentError })}
            onChange={(event) => {
              setCurrent(event.target.value);
            }}
          />
          <TextField
            label={t('account.password.new')}
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={fresh}
            hint={`${t('account.password.hint')} ${t('account.password.secondStep')}`}
            reveal={{ show: t('account.password.show'), hide: t('account.password.hide') }}
            inputRef={newInput}
            {...(newError === undefined ? {} : { error: newError })}
            onChange={(event) => {
              setFresh(event.target.value);
            }}
          />
          <div className="flex flex-wrap items-center justify-end gap-inline-md max-medium:flex-col-reverse max-medium:items-stretch">
            <Button
              variant="tertiary"
              disabled={save.isPending}
              onClick={() => {
                reset();
                setOpen(false);
                wanted.current = 'open';
              }}
            >
              {t('account.password.cancel')}
            </Button>
            <Button ref={saveButton} type="submit" loading={save.isPending} disabled={!online}>
              {t('account.password.save')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-inline-md">
          <Button
            ref={openButton}
            variant="secondary"
            disabled={!online}
            onClick={() => {
              setOpen(true);
              setChanged(null);
              wanted.current = 'current';
            }}
          >
            {t('account.password.change')}
          </Button>
          {online ? null : <p className="text-body-sm text-text-tertiary">{t('account.offlineHint')}</p>}
        </div>
      )}
    </Card>
  );
}
