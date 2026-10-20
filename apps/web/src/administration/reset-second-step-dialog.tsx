import { resetUserSecondStep, type IdentityVerification } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, RadioGroup, WifiOff } from '@evia/ui-web';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useOnline } from '../shell/use-online.ts';
import { alertsAdministrators, IDENTITY_VERIFICATIONS, ifMatchOf } from './account-operations.ts';
import { AccountFailureAlert } from './account-failure-alert.tsx';
import type { AccountDialogProps } from './change-role-dialog.tsx';
import { useAccountCall } from './use-account-call.ts';

/**
 * "Zresetować drugi krok logowania konta „…”?" (EVM-027 AC4, AC7; SR-AUTH-13; W-16 dialog 7): the Administrator must say how the
 * identity of the person was confirmed — in person or by video, no default and no free text (the choice goes to the audit as a
 * code, never a note). The summary says what is removed, that the account sets the second step up again within 24 hours and that
 * an e-mail goes to the address of the account; for an Administrator only a passkey can be set up, and everybody is alerted.
 * A person who forgot the password or whose password may have fallen into the wrong hands changes it first, from another device
 * (the window after a reset needs the password only — RR-27).
 */
export function ResetSecondStepDialog({ user, onClose, onDone, onRefreshAccount, onRefreshList }: AccountDialogProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const call = useAccountCall(t('stepUp.title.resetSecondStep'));
  const [choice, setChoice] = useState<IdentityVerification | ''>('');
  const [error, setError] = useState<string | undefined>(undefined);
  const id = useId();

  const submit = () => {
    if (choice === '') {
      setError(t('users.account.reset.required'));
      return;
    }
    setError(undefined);
    call.run(
      () =>
        unwrap(
          resetUserSecondStep({
            client,
            path: { userId: user.id },
            headers: { 'If-Match': ifMatchOf(user) },
            body: { identityVerification: choice },
          }),
        ),
      onDone,
    );
  };

  return (
    <Dialog
      open={!call.stepping}
      title={t('users.account.reset.title', { name: user.displayName })}
      closeLabel={t('users.account.reset.close')}
      describedBy={`${id}-summary`}
      onDismiss={onClose}
      actions={
        <>
          <Button data-initial-focus variant="tertiary" onClick={onClose}>
            {t('users.account.cancel')}
          </Button>
          <Button variant="danger" type="submit" form={`${id}-form`} loading={call.pending} disabled={!online}>
            {t('users.account.reset.submit')}
          </Button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        noValidate
        className="flex flex-col gap-stack-md"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {online ? null : <Banner icon={WifiOff}>{t('users.account.offline')}</Banner>}
        {call.failure === null ? null : (
          <AccountFailureAlert failure={call.failure} onRefreshAccount={onRefreshAccount} onRefreshList={onRefreshList} />
        )}
        <RadioGroup
          legend={t('users.account.reset.legend')}
          value={choice}
          onChange={(value) => {
            setChoice(IDENTITY_VERIFICATIONS.find((known) => known === value) ?? '');
            setError(undefined);
          }}
          options={[
            { value: 'in_person', label: t('users.account.reset.inPerson') },
            { value: 'video_call', label: t('users.account.reset.videoCall') },
          ]}
          {...(error === undefined ? {} : { error })}
        />
        <div id={`${id}-summary`} className="flex flex-col gap-stack-sm text-body text-text-secondary">
          <p>{t('users.account.reset.summary')}</p>
          <p>{t('users.account.reset.window')}</p>
          {user.role === 'administrator' ? <p>{t('users.account.reset.administratorKey')}</p> : null}
          <p>{t('users.account.reset.password')}</p>
        </div>
        {alertsAdministrators('reset', user) ? <InlineAlert tone="info">{t('users.dialog.administratorAlert')}</InlineAlert> : null}
      </form>
    </Dialog>
  );
}
