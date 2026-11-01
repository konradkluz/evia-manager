import { logoutDevice, wipeDevice, type ManagedDevice } from '@evia/contracts';
import { AlertDialog, Button, InlineAlert, TextField } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGuardedCall } from '../administration/use-guarded-call.ts';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { useOnline } from '../shell/use-online.ts';
import { describeDeviceFailure, sameModel, type DeviceFailure } from './device-view.ts';

export interface DeviceDialogProps {
  readonly device: ManagedDevice;
  readonly onClose: () => void;
  /** The server accepted the operation (the dialog is done). */
  readonly onDone: () => void;
  /** The device is not there any more (`404`): the page says so and reads the list again. */
  readonly onGone: () => void;
}

/**
 * "Wyloguj urządzenie" (EVM-095 AC3; W-17, AlertDialog § 4.11): the focus starts on "Anuluj"; "Wyloguj urządzenie" asks for a step-up
 * when the server wants it (W-04, then the same call once more). The effect comes with the next contact of the phone, which the text says.
 */
export function LogoutDeviceDialog({ device, onClose, onDone, onGone }: DeviceDialogProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const guarded = useGuardedCall(t('stepUp.title.logoutDevice'));
  const [failure, setFailure] = useState<DeviceFailure | null>(null);
  const mutation = useMutation({
    mutationFn: () => guarded.run(() => unwrap(logoutDevice({ client, path: { deviceId: device.id } }))),
    onSuccess: onDone,
    onError: (error) => {
      const failed = describeDeviceFailure(error);
      if (failed === 'notFound') onGone();
      else setFailure(failed);
    },
  });
  return (
    <AlertDialog
      open={!guarded.stepping}
      title={t('devices.logout.title', { model: device.model, user: device.user.displayName })}
      onDismiss={() => {
        if (!mutation.isPending) onClose();
      }}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus disabled={mutation.isPending} onClick={onClose}>
            {t('devices.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={mutation.isPending}
            disabled={!online}
            onClick={() => {
              setFailure(null);
              mutation.mutate();
            }}
          >
            {t('devices.logout.confirm')}
          </Button>
        </>
      }
    >
      {failure === null ? null : <InlineAlert tone="error">{t('devices.actionFailed')}</InlineAlert>}
      <p>{t('devices.logout.body')}</p>
    </AlertDialog>
  );
}

/**
 * "Zablokuj i wyczyść" (EVM-095 AC4; W-17): irreversible, so the button stays off until the model of the phone is typed (the pattern
 * "potwierdź nazwą"; the server compares again and answers `400 device_model_mismatch` without echo). The dialog shows the last number of
 * unsent items reported by THIS phone, warns about losing them and speaks of the company data in the app, not of the whole phone (BYOD).
 */
export function WipeDeviceDialog({ device, onClose, onDone, onGone }: DeviceDialogProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const guarded = useGuardedCall(t('stepUp.title.wipeDevice'));
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<DeviceFailure | null>(null);
  const mutation = useMutation({
    mutationFn: () => guarded.run(() => unwrap(wipeDevice({ client, path: { deviceId: device.id }, body: { confirmModel: typed } }))),
    onSuccess: onDone,
    onError: (error) => {
      const failed = describeDeviceFailure(error);
      if (failed === 'notFound') onGone();
      else setFailure(failed);
    },
  });
  const matches = sameModel(typed, device.model);
  return (
    <AlertDialog
      open={!guarded.stepping}
      title={t('devices.wipe.title', { model: device.model })}
      onDismiss={() => {
        if (!mutation.isPending) onClose();
      }}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus disabled={mutation.isPending} onClick={onClose}>
            {t('devices.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={mutation.isPending}
            disabled={!online || !matches}
            onClick={() => {
              setFailure(null);
              mutation.mutate();
            }}
          >
            {t('devices.wipe.confirm')}
          </Button>
        </>
      }
    >
      {failure === null ? null : (
        <InlineAlert tone="error">{failure === 'mismatch' ? t('devices.wipe.mismatch') : t('devices.actionFailed')}</InlineAlert>
      )}
      <p>{t('devices.wipe.body')}</p>
      <p className="font-semibold">{t('devices.wipe.pending', { count: device.pendingItemsReported })}</p>
      <p>{t('devices.wipe.advice')}</p>
      <TextField
        label={t('devices.wipe.field', { model: device.model })}
        value={typed}
        autoComplete="off"
        disabled={mutation.isPending}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
    </AlertDialog>
  );
}
