import type { DevicePatchLevel, DeviceState } from '@evia/contracts';
import { CircleAlert, CircleCheck, CircleHelp, LogOut, ShieldCheck, ShieldOff, TriangleAlert, type Icon } from '@evia/ui-web';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/client.ts';

/** Query key roots of the devices: personal data (names of people, models), dropped from the cache once the page is left (SR-WEB-05). */
export const ACCOUNT_DEVICES_KEY = 'account-devices' as const;
export const DEVICES_KEY = 'devices' as const;

const DAY_MS = 86_400_000;
/** From the 3rd day without contact the state says so; from the 7th the data of the orders is hidden in the phone (flows/16 → W-17). */
const SILENT_FROM_DAYS = 3;
const HIDDEN_FROM_DAYS = 7;

/** Icon and colour role of a state of a device (icon + word, never the colour alone; flows/16 → "Stany urządzenia", proposal P-14). */
export const STATE_MARKERS: Readonly<Record<DeviceState, { readonly icon: Icon; readonly tone: string }>> = {
  active: { icon: CircleCheck, tone: 'text-icon-success' },
  signed_out: { icon: LogOut, tone: 'text-icon-secondary' },
  wipe_required: { icon: ShieldOff, tone: 'text-icon-warning' },
  wiped: { icon: ShieldCheck, tone: 'text-icon-secondary' },
};
export const UNKNOWN_STATE_MARKER = { icon: CircleHelp, tone: 'text-icon-secondary' } as const;

export const PATCH_MARKERS: Readonly<Record<DevicePatchLevel, { readonly icon: Icon; readonly tone: string }>> = {
  current: { icon: CircleCheck, tone: 'text-icon-success' },
  older_6m: { icon: TriangleAlert, tone: 'text-icon-warning' },
  older_12m: { icon: CircleAlert, tone: 'text-icon-error' },
  unknown: { icon: CircleHelp, tone: 'text-icon-secondary' },
};

/** Whole days since the last contact (0 for a time in the future or text that is not a date). */
export function daysSince(iso: string, nowMs: number): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : Math.max(0, Math.floor((nowMs - at) / DAY_MS));
}

/** What the silence of a phone adds to its state: nothing under 3 days, "Brak kontaktu od N dni" from the 3rd, plus "hidden" from the 7th. */
export function silenceOf(iso: string, nowMs: number): { readonly days: number; readonly hidden: boolean } | null {
  const days = daysSince(iso, nowMs);
  return days < SILENT_FROM_DAYS ? null : { days, hidden: days >= HIDDEN_FROM_DAYS };
}

/** The model typed to confirm the wipe is compared as the server does: trimmed, NFC, case-sensitive (the server decides anyway). */
export const sameModel = (typed: string, model: string): boolean => typed.trim().normalize('NFC') === model.trim().normalize('NFC');

export type DeviceFailure = 'notFound' | 'mismatch' | 'other';

/** The failure of an operation on a device: a missing (or a stranger's, which looks the same) device, a wrong model, the rest. */
export function describeDeviceFailure(error: unknown): DeviceFailure {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'notFound';
    if (error.status === 400 && error.code === 'device_model_mismatch') return 'mismatch';
  }
  return 'other';
}

/** The word for a state of a device (a state the panel does not know is shown as "Nieznany status", never raw). */
export function stateLabel(t: TFunction, state: string): string {
  switch (state) {
    case 'active':
      return t('devices.state.active');
    case 'signed_out':
      return t('devices.state.signed_out');
    case 'wipe_required':
      return t('devices.state.wipe_required');
    case 'wiped':
      return t('devices.state.wiped');
    default:
      return t('users.status.unknown');
  }
}

/** The word for the level of the patches of a phone. */
export function patchLabel(t: TFunction, level: DevicePatchLevel): string {
  switch (level) {
    case 'current':
      return t('devices.patch.current');
    case 'older_6m':
      return t('devices.patch.older_6m');
    case 'older_12m':
      return t('devices.patch.older_12m');
    case 'unknown':
      return t('devices.patch.unknown');
  }
}
