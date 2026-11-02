import { changeUserRole, getUserDevicesSummary, type User, type UserDevicesSummary, type UserRole } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, RadioGroup, WifiOff } from '@evia/ui-web';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useOnline } from '../shell/use-online.ts';
import { alertsAdministrators, hasPasskey, ifMatchOf } from './account-operations.ts';
import { AccountFailureAlert } from './account-failure-alert.tsx';
import { ROLES, roleDescription } from './labels.ts';
import { useAccountCall } from './use-account-call.ts';
import { StepUpCancelled, useGuardedCall } from './use-guarded-call.ts';

export interface AccountDialogProps {
  readonly user: User;
  readonly onClose: () => void;
  /** The server accepted the operation: the dialog is done, the list is read again. */
  readonly onDone: () => void;
  /** "Odśwież dane konta": the list is read again, the dialog and its choice stay. */
  readonly onRefreshAccount: () => void;
  /** "Odśwież listę": the dialog closes and the list is read again. */
  readonly onRefreshList: () => void;
}

/**
 * "Zmienić rolę konta „…”?" (EVM-027 AC1, AC5, AC7; W-16 dialog 3): the roles with the present one marked, the summary of the effect
 * (the sessions of the account end, the new role works after signing in again) and, when the role Administrator is granted or taken
 * away, the alert for all Administrators. A passkey is a condition of the role Administrator (Konrad, 2026-10-19): an account
 * without one is told to add it first (Konto → Drugi krok logowania) and nothing is sent; the server refuses the same
 * (`409 administrator_passkey_required`). `If-Match` carries the version the choice was made on (`412` → "Odśwież dane konta").
 */
export function ChangeRoleDialog({ user, onClose, onDone, onRefreshAccount, onRefreshList }: AccountDialogProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const call = useAccountCall(t('stepUp.title.changeRole'));
  const [role, setRole] = useState<UserRole>(user.role);
  const [error, setError] = useState<string | undefined>(undefined);
  /** EVM-095 AC5: the phones of the account, read before the role Tylko odczyt (it wipes them); null = not read yet. */
  const [devices, setDevices] = useState<UserDevicesSummary | 'unknown' | null>(null);
  const [checking, setChecking] = useState(false);
  const summaryCall = useGuardedCall(t('stepUp.title.deviceSummary'));
  const id = useId();

  const send = () => {
    call.run(
      () => unwrap(changeUserRole({ client, path: { userId: user.id }, headers: { 'If-Match': ifMatchOf(user) }, body: { role } })),
      onDone,
    );
  };
  /** Reads how many phones and unsent items the role would wipe: none → the change goes on; some → the Administrator sees them first. */
  const checkDevices = async () => {
    setChecking(true);
    try {
      const summary = await summaryCall.run(() => unwrap(getUserDevicesSummary({ client, path: { userId: user.id } })));
      if (summary.devices === 0) send();
      else setDevices(summary);
    } catch (failure) {
      // W-04 cancelled: nothing happens; any other failure is told, and the next "Zmień rolę" goes on (the server wipes anyway).
      if (!(failure instanceof StepUpCancelled)) setDevices('unknown');
    } finally {
      setChecking(false);
    }
  };

  const submit = () => {
    if (role === user.role) {
      setError(t('users.account.role.same'));
      return;
    }
    if (role === 'administrator' && !hasPasskey(user)) {
      setError(t('users.account.role.passkeyRequired'));
      return;
    }
    setError(undefined);
    if (role === 'read_only' && devices === null) {
      void checkDevices();
      return;
    }
    send();
  };

  return (
    <Dialog
      open={!call.stepping && !summaryCall.stepping}
      title={t('users.account.role.title', { name: user.displayName })}
      closeLabel={t('users.account.role.close')}
      describedBy={`${id}-summary`}
      onDismiss={onClose}
      actions={
        <>
          <Button data-initial-focus variant="tertiary" onClick={onClose}>
            {t('users.account.cancel')}
          </Button>
          <Button type="submit" form={`${id}-form`} loading={call.pending || checking} disabled={!online}>
            {t('users.account.role.submit')}
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
          legend={t('users.account.role.legend')}
          value={role}
          onChange={(value) => {
            setRole(ROLES.find((known) => known === value) ?? role);
            setError(undefined);
            setDevices(null);
          }}
          options={ROLES.map((known) => ({
            value: known,
            label: known === user.role ? `${roleDescription(t, known)} ${t('users.account.role.current')}` : roleDescription(t, known),
          }))}
          {...(error === undefined ? {} : { error })}
        />
        <p id={`${id}-summary`} className="text-body text-text-secondary">
          {t('users.account.role.summary')}
        </p>
        {devices === null ? null : (
          <InlineAlert tone="error">
            {devices === 'unknown'
              ? t('users.account.role.devicesUnknown')
              : `${t('users.account.role.devicesWarning', { devices: devices.devices, pending: devices.pendingItemsReported })} ${t('users.account.role.devicesWarningConfirm')}`}
          </InlineAlert>
        )}
        {alertsAdministrators('role', user, role) ? <InlineAlert tone="info">{t('users.dialog.administratorAlert')}</InlineAlert> : null}
      </form>
    </Dialog>
  );
}
