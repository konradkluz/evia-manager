/**
 * What the panel shows of a device (EVM-095; W-15, W-17), independent of the framework: the state as the person understands it, the level of the security
 * patches and the check of the typed model. "Signed out" is derived (an active device with no valid session), never stored.
 */
import type { DeviceState } from '../infrastructure/tables.ts';

export type DeviceViewState = 'active' | 'signed_out' | 'wipe_required' | 'wiped';
export type DevicePatchLevel = 'current' | 'older_6m' | 'older_12m' | 'unknown';

const DAY_MS = 24 * 3_600_000;
/** A patch date before this is a placeholder of a phone that did not report one. */
const EARLIEST_REAL_PATCH_MS = Date.UTC(2010, 0, 1);

export function viewState(state: DeviceState, hasValidSession: boolean): DeviceViewState {
  if (state !== 'active') return state;
  return hasValidSession ? 'active' : 'signed_out';
}

/** Up to 183 days old is `current`, up to 365 `older_6m`, older `older_12m`; no usable date (or one in the future of the clock beyond a day) is `unknown`. */
export function patchLevel(securityPatch: Date, now: Date): DevicePatchLevel {
  const patchMs = securityPatch.getTime();
  if (Number.isNaN(patchMs) || patchMs < EARLIEST_REAL_PATCH_MS || patchMs > now.getTime() + DAY_MS) return 'unknown';
  const ageDays = (now.getTime() - patchMs) / DAY_MS;
  if (ageDays <= 183) return 'current';
  return ageDays <= 365 ? 'older_6m' : 'older_12m';
}

const normalise = (value: string): string => value.normalize('NFC').trim();

/** The typed model must be the model of the device after trimming and NFC; the case matters (the same as the dialog of the panel). */
export function modelConfirmed(typed: string, model: string): boolean {
  return normalise(typed) === normalise(model);
}
