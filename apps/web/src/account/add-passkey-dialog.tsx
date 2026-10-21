import { getPasskeyRegistrationOptions, registerPasskey } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, KeyRound, TextField, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { createPasskey } from '../passkey/create-passkey.ts';
import { describeAccountFailure, type AccountFailure } from './account-failure.ts';
import { AccountFailureAlert } from './account-failure-alert.tsx';
import { MAX_PASSKEY_NAME, nameProblem, normaliseName, serverNameProblem, type NameProblem } from './account-input.ts';
import { ReauthenticationCancelled, useReauthCall } from './use-reauth-call.ts';

/**
 * "Dodaj klucz dostępu" (EVM-028 AC3; SR-AUTH-09, SR-AUTH-10; W-15 → "Drugi krok logowania — operacje"): the optional name of the key
 * (plain text, ≤ 60 characters — it tells the keys apart on the list), then the system's ceremony. The panel asks the server for the
 * options first; the server answers `403 reauthentication_required` when there is no fresh mark, W-04 opens (this dialog steps
 * aside and keeps the name) and the whole call goes again. The key and its name are made by the person; the answer carries no secret.
 */
export function AddPasskeyDialog({
  email,
  online,
  onClose,
  onAdded,
}: {
  readonly email: string;
  readonly online: boolean;
  readonly onClose: () => void;
  readonly onAdded: () => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const id = useId();
  const reauth = useReauthCall('second_step_change', t('stepUp.title.addPasskey'), email);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<NameProblem | null>(null);
  const [failure, setFailure] = useState<AccountFailure | 'ceremony' | null>(null);

  const add = useMutation({
    mutationFn: () =>
      reauth.run(async () => {
        const options = await unwrap(getPasskeyRegistrationOptions({ client }));
        const credential = await createPasskey(options);
        const value = normaliseName(name);
        return unwrap(registerPasskey({ client, body: value === '' ? { credential } : { credential, name: value } }));
      }),
    onSuccess: onAdded,
    onError: (error) => {
      if (error instanceof ReauthenticationCancelled) return;
      if (error instanceof ApiError && error.status === 400) {
        const field = serverNameProblem(error.errors, '/name');
        setProblem(field);
        // A key the server did not accept (or a name it refused): the person tries again.
        setFailure(field === null ? 'ceremony' : null);
        return;
      }
      // A refused or cancelled ceremony is a DOMException (never shown): the same message as a key the server refused.
      setFailure(error instanceof ApiError ? describeAccountFailure(error) : 'ceremony');
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || add.isPending) return;
    const found = nameProblem(name, MAX_PASSKEY_NAME, { optional: true });
    setProblem(found);
    if (found !== null) return;
    setFailure(null);
    add.mutate();
  };

  const nameError =
    problem === null ? undefined : problem === 'too_long' ? t('account.passkeys.nameTooLong') : t('account.passkeys.nameInvalid');
  const cancel = () => {
    if (add.isPending) return;
    onClose();
  };

  return (
    <Dialog
      open={!reauth.stepping}
      size="sm"
      title={t('account.passkeys.addTitle')}
      closeLabel={t('account.close')}
      describedBy={`${id}-hint`}
      onDismiss={cancel}
      actions={
        <>
          <Button variant="tertiary" disabled={add.isPending} onClick={cancel}>
            {t('account.cancel')}
          </Button>
          <Button type="submit" form={`${id}-form`} icon={KeyRound} loading={add.isPending} disabled={!online}>
            {add.isPending ? t('stepUp.inProgress') : t('account.passkeys.add')}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} className="flex flex-col gap-stack-md">
        {online ? null : <Banner icon={WifiOff}>{t('account.offlineHint')}</Banner>}
        {failure === null ? null : failure === 'ceremony' ? (
          <InlineAlert tone="error">{t('account.passkeys.failed')}</InlineAlert>
        ) : (
          <AccountFailureAlert failure={failure} notFound={t('account.failure.forbidden')} />
        )}
        <TextField
          label={t('account.passkeys.name')}
          hint={t('account.passkeys.nameHint')}
          value={name}
          {...(nameError === undefined ? {} : { error: nameError })}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <p id={`${id}-hint`} className="text-body-sm text-text-secondary">
          {t('account.passkeys.addSummary')}
        </p>
      </form>
    </Dialog>
  );
}
