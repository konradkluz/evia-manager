import { listAccountDevices, logoutAccountDevice, type AccountDevice } from '@evia/contracts';
import {
  AlertDialog,
  Button,
  Card,
  CircleAlert,
  DataTable,
  Skeleton,
  Smartphone,
  type DataTableColumn,
  type DataTableRow,
} from '@evia/ui-web';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGuardedCall } from '../administration/use-guarded-call.ts';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { ACCOUNT_DEVICES_KEY, describeDeviceFailure, stateLabel } from '../devices/device-view.ts';
import { DeviceStateLabel } from '../devices/device-state-label.tsx';
import { withRotationRetry } from '../session/step-up.ts';
import { useToast } from '../shell/toast-context.tsx';
import { formatDate } from '../work-orders/format.ts';
import { formatFullDateTime } from '../work-orders/journal-format.ts';
import { relativeTime } from '../work-orders/journal-entry.tsx';

/**
 * W-15 "Urządzenia" (EVM-095 AC1, AC3; flows/16): the own phones of the account (model, system, version of the app, last contact, state)
 * and "Wyloguj telefon" behind a confirmation and a step-up (W-04 opens when the server asks; the same call is sent again). The card is
 * not rendered for Tylko odczyt (there is no phone) — the server refuses that role anyway (`403`). A phone that is not there (`404`,
 * a stranger's looks the same) is a toast and a fresh list. The list lives in the memory of the tab only (SR-WEB-05); the model is the
 * name of the phone from the system — no serial number, IMEI or address is ever shown.
 */
export function DevicesCard({ online, now }: { readonly online: boolean; readonly now: number }) {
  const { t } = useTranslation();
  const client = useApi();
  const showToast = useToast();
  const id = useId();
  const [logout, setLogout] = useState<AccountDevice | null>(null);
  const guarded = useGuardedCall(t('stepUp.title.logoutPhone'));

  const query = useQuery({
    queryKey: [ACCOUNT_DEVICES_KEY],
    queryFn: ({ signal }) => withRotationRetry(() => unwrap(listAccountDevices({ client, signal }))),
    retry: false,
    gcTime: 0,
  });

  const end = useMutation({
    mutationFn: (device: AccountDevice) =>
      guarded.run(() => unwrap(logoutAccountDevice({ client, path: { deviceId: device.id } }))).then(() => 'done' as const),
    onSuccess: () => {
      setLogout(null);
      showToast(t('account.devices.logoutDone'));
      void query.refetch();
    },
    onError: (error) => {
      setLogout(null);
      showToast(describeDeviceFailure(error) === 'notFound' ? t('account.devices.notFound') : t('account.devices.logoutFailed'));
      void query.refetch();
    },
  });

  const columns: DataTableColumn[] = [
    { id: 'phone', header: t('account.devices.phone'), card: 'primary' },
    { id: 'contact', header: t('account.devices.lastContact'), card: 'detail', cardLabel: true },
    { id: 'state', header: t('account.devices.state'), card: 'badge' },
    { id: 'action', header: t('account.devices.action'), card: 'action' },
  ];
  const rows: DataTableRow[] =
    query.data?.items.map((device) => ({
      id: device.id,
      label: `${device.model}, ${stateLabel(t, device.state)}`,
      cells: [
        <span key="phone" className="flex flex-col">
          <span className="inline-flex items-center gap-inline-sm">
            <Smartphone aria-hidden="true" className="size-icon-sm shrink-0 text-icon-secondary" />
            {t('account.devices.description', { model: device.model, os: device.osVersion, app: device.appVersion })}
          </span>
          <span className="text-body-sm text-text-secondary">
            {t('account.devices.registered', { date: formatDate(device.createdAt) })}
          </span>
        </span>,
        <span key="contact" title={formatFullDateTime(device.lastContactAt)}>
          {relativeTime(t, device.lastContactAt, now)}
        </span>,
        <DeviceStateLabel key="state" state={device.state} lastContactAt={device.lastContactAt} now={now} />,
        device.state === 'active' ? (
          <Button
            key="logout"
            variant="secondary"
            aria-label={t('account.devices.logoutLabel', { model: device.model })}
            disabled={!online || end.isPending}
            {...(online ? {} : { title: t('account.devices.offline') })}
            onClick={() => {
              setLogout(device);
            }}
          >
            {t('account.devices.logout')}
          </Button>
        ) : null,
      ],
    })) ?? [];

  return (
    <Card labelledBy={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-heading-3">
        {t('account.devices.title')}
      </h2>
      <p className="text-body text-text-secondary">{t('account.devices.intro')}</p>
      {query.isError && query.data === undefined ? (
        <div role="alert" className="flex flex-wrap items-center gap-inline-md">
          <CircleAlert aria-hidden="true" className="size-icon-sm text-icon-error" />
          <p className="text-body">{t('account.devices.error')}</p>
          <Button
            variant="secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            {t('account.devices.retry')}
          </Button>
        </div>
      ) : query.data === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-stack-sm">
          <p role="status" className="text-body text-text-secondary">
            {t('account.devices.loading')}
          </p>
          <Skeleton />
          <Skeleton className="w-1/2" />
        </div>
      ) : query.data.items.length === 0 ? (
        <p className="text-body">{t('account.devices.empty')}</p>
      ) : (
        <DataTable caption={t('account.devices.caption')} columns={columns} rows={rows} />
      )}
      <p className="text-body-sm text-text-secondary">{t('account.devices.hint')}</p>
      <AlertDialog
        open={logout !== null && !guarded.stepping}
        title={t('account.devices.dialog.title', { model: logout?.model ?? '' })}
        onDismiss={() => {
          if (!end.isPending) setLogout(null);
        }}
        actions={
          <>
            <Button
              variant="tertiary"
              data-initial-focus
              disabled={end.isPending}
              onClick={() => {
                setLogout(null);
              }}
            >
              {t('account.devices.dialog.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={end.isPending}
              disabled={!online}
              onClick={() => {
                if (logout !== null) end.mutate(logout);
              }}
            >
              {t('account.devices.dialog.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('account.devices.dialog.body')}</p>
      </AlertDialog>
    </Card>
  );
}
