import { removePasskey, removeTotp, type Passkey } from '@evia/contracts';
import { AlertDialog, Button } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { describeAccountFailure, type AccountFailure } from './account-failure.ts';
import { AccountFailureAlert } from './account-failure-alert.tsx';
import { ReauthenticationCancelled, useReauthCall } from './use-reauth-call.ts';

export type RemoveTarget = { readonly kind: 'passkey'; readonly passkey: Passkey } | { readonly kind: 'totp' };

/**
 * AlertDialog "Usunąć klucz dostępu „…”?" / "Usunąć kod z aplikacji uwierzytelniającej?" (EVM-028 AC3, AC4; W-15 → operacje): says what the
 * person loses, "Anuluj" has the focus. "Usuń …" sends the delete; the server asks for the full re-authentication (W-04 opens, this
 * dialog steps aside) and decides the rule of the last method (`409 last_second_step_method`, shown here with what to add first).
 * A key that is no longer there (a stranger's and a missing one look the same, `404`) closes the dialog with a toast and a fresh list.
 * The name of a key is plain text made by the person.
 */
export function RemoveMethodDialog({
  target,
  role,
  email,
  online,
  onClose,
  onRemoved,
  onGone,
}: {
  readonly target: RemoveTarget;
  readonly role: 'administrator' | 'editor' | 'read_only';
  readonly email: string;
  readonly online: boolean;
  readonly onClose: () => void;
  readonly onRemoved: () => void;
  readonly onGone: () => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const passkey = target.kind === 'passkey';
  const reauth = useReauthCall('second_step_change', passkey ? t('stepUp.title.removePasskey') : t('stepUp.title.removeTotp'), email);
  const [failure, setFailure] = useState<AccountFailure | null>(null);

  const remove = useMutation({
    mutationFn: () =>
      reauth.run(() =>
        target.kind === 'passkey'
          ? unwrap(removePasskey({ client, path: { passkeyId: target.passkey.id } }))
          : unwrap(removeTotp({ client })),
      ),
    onSuccess: onRemoved,
    onError: (error) => {
      if (error instanceof ReauthenticationCancelled) return;
      const next = describeAccountFailure(error);
      if (next.kind === 'notFound') {
        onGone();
        return;
      }
      setFailure(next);
    },
  });
  const cancel = () => {
    if (remove.isPending) return;
    onClose();
  };

  const title = target.kind === 'passkey' ? t('account.remove.passkeyTitle', { name: target.passkey.name }) : t('account.remove.totpTitle');
  const body =
    target.kind === 'passkey'
      ? t('account.remove.passkeyBody')
      : role === 'read_only'
        ? t('account.remove.totpBodyReadOnly')
        : t('account.remove.totpBody');

  return (
    <AlertDialog
      open={!reauth.stepping}
      title={title}
      onDismiss={cancel}
      actions={
        <>
          <Button data-initial-focus variant="tertiary" disabled={remove.isPending} onClick={cancel}>
            {t('account.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            disabled={!online}
            onClick={() => {
              setFailure(null);
              remove.mutate();
            }}
          >
            {target.kind === 'passkey' ? t('account.remove.passkeySubmit') : t('account.remove.totpSubmit')}
          </Button>
        </>
      }
    >
      <p>{body}</p>
      {failure === null ? null : <AccountFailureAlert failure={failure} notFound={t('account.passkeys.notFound')} />}
      {online ? null : <p className="text-body-sm text-text-secondary">{t('account.offlineHint')}</p>}
    </AlertDialog>
  );
}
