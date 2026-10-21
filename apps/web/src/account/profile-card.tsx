import { updateAccount, type Account } from '@evia/contracts';
import { Button, Card, TextField } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { roleLabel } from '../administration/labels.ts';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { retryMinutes } from '../pages/login-failure.tsx';
import { SESSION_KEY } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { MAX_DISPLAY_NAME, nameProblem, normaliseName, serverNameProblem, type NameProblem } from './account-input.ts';
import { ACCOUNT_KEY } from './query-keys.ts';

type Failure =
  | { readonly kind: 'field'; readonly problem: NameProblem }
  | { readonly kind: 'rate'; readonly minutes: number }
  | { readonly kind: 'other' };

/**
 * W-15 "Profil" (EVM-028 AC1; SR-DATA-03): the display name (≤ 200 characters, plain text) — the only editable thing; the e-mail and
 * the role are read-only with the reason. The name is changed without a re-authentication; the header and the other users see it at
 * once (the session is read again). Offline the button is disabled with the reason and the typed name stays in the memory of the tab.
 */
export function ProfileCard({ account, online }: { readonly account: Account; readonly online: boolean }) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(account.displayName);
  const [failure, setFailure] = useState<Failure | null>(null);

  const save = useMutation({
    mutationFn: (displayName: string) => unwrap(updateAccount({ client, body: { displayName } })),
    onSuccess: (result) => {
      setName(result.displayName);
      setFailure(null);
      showToast(t('account.profile.saved'));
      void queryClient.invalidateQueries({ queryKey: [ACCOUNT_KEY] });
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400) {
        const problem = serverNameProblem(error.errors, '/displayName');
        if (problem !== null) {
          setFailure({ kind: 'field', problem });
          input.current?.focus();
          return;
        }
      }
      setFailure(error instanceof ApiError && error.status === 429 ? { kind: 'rate', minutes: retryMinutes(error) } : { kind: 'other' });
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || save.isPending) return;
    const problem = nameProblem(name, MAX_DISPLAY_NAME);
    if (problem !== null) {
      setFailure({ kind: 'field', problem });
      input.current?.focus();
      return;
    }
    setFailure(null);
    save.mutate(normaliseName(name));
  };

  const error = (() => {
    switch (failure?.kind) {
      case undefined:
        return undefined;
      case 'field':
        return failure.problem === 'required'
          ? t('account.profile.required')
          : failure.problem === 'too_long'
            ? t('account.profile.tooLong')
            : t('account.profile.invalid');
      case 'rate':
        return t('account.failure.rateLimited', { minutes: failure.minutes });
      case 'other':
        return t('account.profile.failed');
    }
  })();

  return (
    <Card labelledBy={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-heading-3">
        {t('account.profile.title')}
      </h2>
      <form noValidate onSubmit={submit} className="flex flex-col gap-stack-sm">
        <TextField
          label={t('account.profile.name')}
          hint={t('account.profile.nameHint')}
          autoComplete="name"
          value={name}
          inputRef={input}
          {...(error === undefined ? {} : { error })}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <div className="flex flex-wrap items-center gap-inline-md">
          <Button
            type="submit"
            variant="secondary"
            loading={save.isPending}
            disabled={!online || normaliseName(name) === account.displayName}
          >
            {t('account.profile.save')}
          </Button>
          {online ? null : <p className="text-body-sm text-text-tertiary">{t('account.offlineHint')}</p>}
        </div>
      </form>
      <dl className="flex flex-col gap-stack-sm">
        <div className="flex flex-col gap-stack-xs">
          <dt className="text-label text-text-secondary">{t('account.profile.email')}</dt>
          <dd className="text-body">
            {account.email}
            <span className="block text-body-sm text-text-secondary">{t('account.profile.emailHint')}</span>
          </dd>
        </div>
        <div className="flex flex-col gap-stack-xs">
          <dt className="text-label text-text-secondary">{t('account.profile.role')}</dt>
          <dd className="text-body">
            {roleLabel(t, account.role)}
            <span className="block text-body-sm text-text-secondary">{t('account.profile.roleHint')}</span>
          </dd>
        </div>
      </dl>
    </Card>
  );
}
