import type { ManagedDevice } from '@evia/contracts';
import {
  ActionMenu,
  DataTable,
  EllipsisVertical,
  IconButton,
  type ActionMenuItem,
  type DataTableColumn,
  type DataTableRow,
} from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { relativeTime } from '../work-orders/journal-entry.tsx';
import { formatFullDateTime } from '../work-orders/journal-format.ts';
import { DeviceStateLabel } from './device-state-label.tsx';
import { PATCH_MARKERS, patchLabel, stateLabel } from './device-view.ts';

export interface DevicesTableProps {
  readonly devices: readonly ManagedDevice[];
  readonly online: boolean;
  readonly now: number;
  readonly onLogout: (device: ManagedDevice) => void;
  readonly onWipe: (device: ManagedDevice) => void;
}

/**
 * The table of W-17 (EVM-095 AC2; flows/16): user, device (model and system), version of the app, level of patches, last contact and
 * state (icon + word) with the menu `⋮` of the row: "Wyloguj urządzenie…" and, apart at the end, "Zablokuj i wyczyść…". An item that
 * does not apply to the state stays reachable and says why (§ 3.20); offline every action says "Wymaga połączenia". No serial number,
 * IMEI, address or token is in the data, so none is shown.
 */
export function DevicesTable({ devices, online, now, onLogout, onWipe }: DevicesTableProps) {
  const { t } = useTranslation();
  const columns: DataTableColumn[] = [
    { id: 'user', header: t('devices.table.user'), card: 'primary' },
    { id: 'device', header: t('devices.table.device'), card: 'meta' },
    { id: 'app', header: t('devices.table.app'), card: 'detail', cardLabel: true },
    { id: 'patch', header: t('devices.table.patch'), card: 'detail', cardLabel: true },
    { id: 'contact', header: t('devices.table.contact'), card: 'detail', cardLabel: true },
    { id: 'state', header: t('devices.table.state'), card: 'badge' },
    { id: 'actions', header: t('devices.table.actions'), card: 'action' },
  ];
  const rows: DataTableRow[] = devices.map((device) => {
    const patch = PATCH_MARKERS[device.patchLevel];
    const PatchIcon = patch.icon;
    const menuLabel = t('devices.menu.label', { model: device.model, user: device.user.displayName });
    const offlineHint = online ? undefined : t('devices.menu.offline');
    const items: ActionMenuItem[] = [
      {
        id: 'logout',
        label: t('devices.menu.logout'),
        onSelect: () => {
          onLogout(device);
        },
        ...(device.state === 'active' ? {} : { disabledHint: t('devices.menu.notActive') }),
      },
      {
        id: 'wipe',
        label: t('devices.menu.wipe'),
        tone: 'danger',
        startsGroup: true,
        onSelect: () => {
          onWipe(device);
        },
        ...(device.state === 'wipe_required' || device.state === 'wiped' ? { disabledHint: t('devices.menu.alreadyWiping') } : {}),
      },
    ];
    return {
      id: device.id,
      label: t('devices.table.row', {
        model: device.model,
        user: device.user.displayName,
        state: stateLabel(t, device.state),
      }),
      cells: [
        device.user.displayName,
        <span key="device" className="flex flex-col">
          <span>{device.model}</span>
          <span className="text-body-sm text-text-secondary">{t('devices.table.deviceOs', { os: device.osVersion })}</span>
        </span>,
        device.appVersion,
        <span key="patch" className="inline-flex items-center gap-inline-sm">
          <PatchIcon aria-hidden="true" className={`size-icon-sm shrink-0 ${patch.tone}`} />
          {patchLabel(t, device.patchLevel)}
        </span>,
        <span key="contact" title={formatFullDateTime(device.lastContactAt)}>
          {relativeTime(t, device.lastContactAt, now)}
        </span>,
        <DeviceStateLabel key="state" state={device.state} lastContactAt={device.lastContactAt} now={now} />,
        <ActionMenu
          key="actions"
          align="end"
          label={menuLabel}
          items={items}
          trigger={(props) => (
            <IconButton
              {...props}
              {...(online ? {} : { onClick: () => undefined, 'aria-disabled': true, 'aria-expanded': false, title: offlineHint })}
              icon={EllipsisVertical}
              label={menuLabel}
            />
          )}
        />,
      ],
    };
  });
  return <DataTable caption={t('devices.table.caption')} columns={columns} rows={rows} />;
}
