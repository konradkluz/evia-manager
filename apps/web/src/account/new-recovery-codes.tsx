import { generateRecoveryCodes } from '@evia/contracts';
import { AlertDialog, Button, Dialog, FieldError } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { RecoveryCodesView } from '../mfa/recovery-codes-view.tsx';
import { describeAccountFailure, type AccountFailure } from './account-failure.ts';
import { AccountFailureAlert } from './account-failure-alert.tsx';
import { ReauthenticationCancelled, useReauthCall } from './use-reauth-call.ts';

/**
 * "Wygeneruj nowe kody…" (EVM-028 AC5; SR-AUTH-08, SR-AUTH-10; W-15 → operacje): an AlertDialog says that the earlier codes stop working;
 * "Wygeneruj nowe kody" asks for the full re-authentication FIRST (the server path of the new codes does not answer with a request
 * for it — it simply refuses without the mark), then makes ten codes, shown once in a dialog like step 3 of W-03. The codes live in
 * the state of this component (the memory of the tab): not in storage, the address, the console or the query cache, and they are gone
 * when the dialog is closed. Leaving the dialog before the codes are marked as saved is refused with a reminder — they are never shown again.
 */
export function NewRecoveryCodes({
  email,
  online,
  onClose,
  onDone,
}: {
  readonly email: string;
  readonly online: boolean;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const reauth = useReauthCall('second_step_change', t('stepUp.title.newRecoveryCodes'), email);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [leaving, setLeaving] = useState(false);

  const generate = useMutation({
    gcTime: 0,
    mutationFn: async (): Promise<readonly string[]> =>
      (await reauth.run(() => unwrap(generateRecoveryCodes({ client })), { first: true })).codes,
    onSuccess: (result) => {
      setCodes(result);
    },
    onError: (error) => {
      if (error instanceof ReauthenticationCancelled) return;
      setFailure(describeAccountFailure(error));
    },
  });
  const cancel = () => {
    if (generate.isPending) return;
    onClose();
  };

  if (codes !== null) {
    return (
      <Dialog
        open
        title={t('account.codes.newTitle')}
        closeLabel={t('account.close')}
        onDismiss={() => {
          setLeaving(true);
        }}
        actions={null}
      >
        <p className="text-body">{t('account.codes.newDescription')}</p>
        {leaving ? <FieldError>{t('account.codes.leave')}</FieldError> : null}
        <RecoveryCodesView
          codes={codes}
          finishLabel={t('account.codes.finish')}
          online={online}
          onFinish={() => {
            setCodes(null);
            onDone();
          }}
        />
      </Dialog>
    );
  }
  return (
    <AlertDialog
      open={!reauth.stepping}
      title={t('account.codes.confirmTitle')}
      onDismiss={cancel}
      actions={
        <>
          <Button data-initial-focus variant="tertiary" disabled={generate.isPending} onClick={cancel}>
            {t('account.cancel')}
          </Button>
          <Button
            loading={generate.isPending}
            disabled={!online}
            onClick={() => {
              setFailure(null);
              generate.mutate();
            }}
          >
            {t('account.codes.generate')}
          </Button>
        </>
      }
    >
      <p>{t('account.codes.confirmBody')}</p>
      {failure === null ? null : <AccountFailureAlert failure={failure} notFound={t('account.failure.forbidden')} />}
      {online ? null : <p className="text-body-sm text-text-secondary">{t('account.offlineHint')}</p>}
    </AlertDialog>
  );
}
