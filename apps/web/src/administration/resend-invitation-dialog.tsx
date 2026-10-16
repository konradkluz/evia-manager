import { resendUserInvitation, type User } from '@evia/contracts';
import { AlertDialog, Button, InlineAlert } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useOnline } from '../shell/use-online.ts';
import { describeUserFailure, type UserFailure } from './user-failure.ts';
import { UserFailureAlert } from './user-failure-alert.tsx';
import { useGuardedCall } from './use-guarded-call.ts';

export interface ResendInvitationDialogProps {
  /** The account that waits for activation, or `null` when the dialog is closed. */
  readonly user: User | null;
  /** The time of the server now: "Poprzedni link przestanie działać." is said only while the previous link is still valid. */
  readonly now: number;
  readonly onClose: () => void;
  readonly onResent: (user: User) => void;
  /** "Odśwież listę" of the alert (the account changed or is gone). */
  readonly onRefresh: () => void;
}

/**
 * "Wysłać zaproszenie ponownie?" (EVM-024 AC4, AC1; W-16 dialog 2): a summary of the effect — a new link valid 72 hours to the address
 * of the account, the previous one stops working (said only while it is still valid), the alert for Administrators when the
 * role is Administrator — then the button. `403 step_up_required` opens W-04 ("…, aby ponownie wysłać zaproszenie") and the same
 * request is sent again once. The server unlinks the previous link in the same transaction, so the old link stops at once, also
 * when the e-mail service is down (AC5).
 */
export function ResendInvitationDialog({ user, now, onClose, onResent, onRefresh }: ResendInvitationDialogProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const guarded = useGuardedCall(t('stepUp.title.resendInvitation'));
  const [failure, setFailure] = useState<UserFailure | null>(null);

  const mutation = useMutation({
    mutationFn: (userId: string) => guarded.run(() => unwrap(resendUserInvitation({ client, path: { userId } }))),
  });

  const close = () => {
    setFailure(null);
    mutation.reset();
    onClose();
  };

  if (user === null) return null;

  const expiresAt = user.invitation?.expiresAt;
  const previousValid = user.invitation?.state === 'sent' && expiresAt != null && Date.parse(expiresAt) > now;

  const send = () => {
    setFailure(null);
    mutation.mutate(user.id, {
      onSuccess: (resent) => {
        setFailure(null);
        mutation.reset();
        onResent(resent);
      },
      onError: (error) => {
        setFailure(describeUserFailure(error, false));
      },
    });
  };

  return (
    <AlertDialog
      open={!guarded.stepping}
      title={t('users.resendDialog.title')}
      onDismiss={close}
      actions={
        <>
          <Button data-initial-focus variant="tertiary" onClick={close}>
            {t('users.resendDialog.cancel')}
          </Button>
          <Button loading={mutation.isPending} disabled={!online} onClick={send}>
            {t('users.resendDialog.submit')}
          </Button>
        </>
      }
    >
      {failure === null ? null : (
        <UserFailureAlert
          failure={failure}
          find={() => undefined}
          onShowAccount={close}
          onRefresh={() => {
            close();
            onRefresh();
          }}
        />
      )}
      <p>{t('users.resendDialog.description', { email: user.email })}</p>
      {previousValid ? <p>{t('users.resendDialog.previous')}</p> : null}
      {user.role === 'administrator' ? <InlineAlert tone="info">{t('users.dialog.administratorAlert')}</InlineAlert> : null}
    </AlertDialog>
  );
}
