import { deactivateUser, endUserSessions, reactivateUser, type User } from '@evia/contracts';
import { AlertDialog, Button, InlineAlert } from '@evia/ui-web';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useOnline } from '../shell/use-online.ts';
import { alertsAdministrators, ifMatchOf } from './account-operations.ts';
import { AccountFailureAlert } from './account-failure-alert.tsx';
import type { AccountDialogProps } from './change-role-dialog.tsx';
import { roleLabel } from './labels.ts';
import { useAccountCall } from './use-account-call.ts';

export type ConfirmOperation = 'deactivate' | 'reactivate' | 'sessions';

/**
 * The summaries of effect that need only a confirmation (EVM-027 AC2, AC3, AC7; W-16 dialogs 4, 5, 6): deactivation, reactivation
 * and "Wyloguj ze wszystkich sesji". The focus lands on "Anuluj" (§ 4.11). Deactivation and reactivation send `If-Match`; ending
 * sessions does not change the account, so it has none. Reactivation of an account that was never activated says it returns to
 * "Oczekuje na aktywację" and needs a new invitation (decided by `activatedAt`, not guessed).
 */
export function AccountConfirmDialog({
  operation,
  user,
  onClose,
  onDone,
  onRefreshAccount,
  onRefreshList,
}: AccountDialogProps & { readonly operation: ConfirmOperation }) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const call = useAccountCall(
    operation === 'deactivate'
      ? t('stepUp.title.deactivateUser')
      : operation === 'reactivate'
        ? t('stepUp.title.reactivateUser')
        : t('stepUp.title.endSessions'),
  );

  const send = () => {
    const path = { userId: user.id };
    const headers = { 'If-Match': ifMatchOf(user) };
    call.run(() => {
      switch (operation) {
        case 'deactivate':
          return unwrap(deactivateUser({ client, path, headers }));
        case 'reactivate':
          return unwrap(reactivateUser({ client, path, headers }));
        case 'sessions':
          return unwrap(endUserSessions({ client, path }));
      }
    }, onDone);
  };

  return (
    <AlertDialog
      open={!call.stepping}
      title={titleOf(t, operation, user)}
      onDismiss={onClose}
      actions={
        <>
          <Button data-initial-focus variant="tertiary" onClick={onClose}>
            {t('users.account.cancel')}
          </Button>
          <Button variant={operation === 'deactivate' ? 'danger' : 'primary'} loading={call.pending} disabled={!online} onClick={send}>
            {submitOf(t, operation)}
          </Button>
        </>
      }
    >
      {call.failure === null ? null : (
        <AccountFailureAlert failure={call.failure} onRefreshAccount={onRefreshAccount} onRefreshList={onRefreshList} />
      )}
      {summary(t, operation, user)}
      {alertsAdministrators(operation, user) ? <InlineAlert tone="info">{t('users.dialog.administratorAlert')}</InlineAlert> : null}
    </AlertDialog>
  );
}

function summary(t: TFunction, operation: ConfirmOperation, user: User) {
  switch (operation) {
    case 'deactivate':
      return (
        <>
          <p>{t('users.account.deactivate.summary')}</p>
          {user.status === 'invited' ? <p>{t('users.account.deactivate.invited')}</p> : null}
        </>
      );
    case 'reactivate':
      return user.activatedAt === null ? (
        <p>{t('users.account.reactivate.neverActivated')}</p>
      ) : (
        <p>{t('users.account.reactivate.activated', { role: roleLabel(t, user.role) })}</p>
      );
    case 'sessions':
      return <p>{t('users.account.sessions.summary')}</p>;
  }
}

function titleOf(t: TFunction, operation: ConfirmOperation, user: User): string {
  const name = user.displayName;
  switch (operation) {
    case 'deactivate':
      return t('users.account.deactivate.title', { name });
    case 'reactivate':
      return t('users.account.reactivate.title', { name });
    case 'sessions':
      return t('users.account.sessions.title', { name });
  }
}

function submitOf(t: TFunction, operation: ConfirmOperation): string {
  switch (operation) {
    case 'deactivate':
      return t('users.account.deactivate.submit');
    case 'reactivate':
      return t('users.account.reactivate.submit');
    case 'sessions':
      return t('users.account.sessions.submit');
  }
}
