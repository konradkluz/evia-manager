/**
 * Description of the phone sent with the first sign-in step (EVM-100 AC1; contract `MobileDeviceInfo`, MASVS-PRIVACY-1): model, Android
 * version and security patch level from the local module `evia-keystore` (Build.MODEL, Build.VERSION.RELEASE/SECURITY_PATCH), normalised
 * to the patterns of the contract so that an unusual vendor value never turns the sign-in into `400` (architect 8). No identifier.
 */
import { requireOptionalNativeModule } from 'expo';
import type { DeviceDescription } from '../api/auth-client';

interface DeviceInfoNative {
  deviceInfo(): unknown;
}

/** Contract fallbacks for a value that is missing or does not fit the pattern. */
export const FALLBACK_DEVICE: DeviceDescription = { model: 'Android', osVersion: '0', securityPatch: '1970-01-01' };

const field = (raw: unknown, name: string): string => {
  if (typeof raw !== 'object' || raw === null) return '';
  const value = (raw as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : '';
};

export function normalizeDeviceInfo(raw: unknown): DeviceDescription {
  const model = field(raw, 'model')
    .replace(/[^A-Za-z0-9 ._()/+-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
  const os = /^\d{1,2}(\.\d{1,3}){0,2}/.exec(field(raw, 'osVersion').trim())?.[0];
  const patch = field(raw, 'securityPatch').trim();
  return {
    model: model === '' ? FALLBACK_DEVICE.model : model,
    osVersion: os ?? FALLBACK_DEVICE.osVersion,
    securityPatch: /^\d{4}-\d{2}-\d{2}$/.test(patch) ? patch : FALLBACK_DEVICE.securityPatch,
  };
}

export function readDeviceInfo(
  native: DeviceInfoNative | null = requireOptionalNativeModule<DeviceInfoNative>('EviaKeystore'),
): Promise<DeviceDescription> {
  try {
    return Promise.resolve(normalizeDeviceInfo(native?.deviceInfo()));
  } catch {
    return Promise.resolve(FALLBACK_DEVICE);
  }
}
