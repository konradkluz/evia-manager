/**
 * Builds the Expo configuration (EVM-009 AC5, AC6) from the environment of the build. app.config.ts is a one-line wrapper.
 * - `version` (semver) is the single source of the app version shown to the update check (AC3);
 * - the Android `versionCode` comes from the CI run number so that it only grows (an older code cannot be installed over a newer one);
 * - a release build fails when the API address is not HTTPS (SR-COMM-04); plain HTTP to the emulator host exists in the e2e variant only;
 * - no permission is requested (INTERNET is added by the platform template) and risky defaults are blocked (SR-MOB-02);
 * - no OTA updates, no dev client, no analytics SDK (SR-MOB-09);
 * - the local database is SQLCipher only (EVM-093 AC1): expo-sqlite with `useSQLCipher`, there is no build without the cipher.
 */
import type { ExpoConfig } from 'expo/config';
import { parseApiBaseUrl, resolveBuildVariant } from '../src/config/api-base-url.ts';

export const APP_VERSION = '0.1.0';
/** Permanent application id: changing it creates a different app on the phones (confirmed by Konrad before the first sideload). */
export const ANDROID_APPLICATION_ID = 'pl.eviacharge.manager';
export const IOS_BUNDLE_IDENTIFIER = 'pl.eviacharge.manager';

/** Permissions the Expo prebuild template adds by default; the app needs none of them (MASVS-PRIVACY-1). */
export const BLOCKED_ANDROID_PERMISSIONS: readonly string[] = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE',
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  // Added by expo-secure-store for biometric prompts; the decision on biometrics is an ADR (not in the skeleton).
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  // Added by expo-modules-core for the Google Play install referrer; the app is distributed outside Google Play.
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
];

export function resolveVersionCode(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 1;
  if (!/^[1-9]\d{0,8}$/.test(value.trim()))
    throw new Error('EVIA_ANDROID_VERSION_CODE must be a positive integer (the CI run number plus an offset)');
  const code = Number(value.trim());
  if (code > 2_100_000_000) throw new Error('EVIA_ANDROID_VERSION_CODE exceeds the Android limit');
  return code;
}

export function buildExpoConfig(env: Readonly<Record<string, string | undefined>>): ExpoConfig {
  const variant = resolveBuildVariant(env['EVIA_BUILD_VARIANT']);
  // EVM-093 (security K1): the API address is the only public build variable; e2e hooks are chosen by the Metro resolver.
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('EXPO_PUBLIC_') && name !== 'EXPO_PUBLIC_API_BASE_URL' && value !== undefined && value !== '')
      throw new Error(`${name} is not allowed in the ${variant} build: EXPO_PUBLIC_API_BASE_URL is the only public variable.`);
  }
  const url = parseApiBaseUrl(env['EXPO_PUBLIC_API_BASE_URL'], { allowLocalHttp: variant === 'e2e' });
  if (!url.ok) {
    throw new Error(
      `EXPO_PUBLIC_API_BASE_URL is not allowed in the ${variant} build (${url.reason}): set an https:// address` +
        (variant === 'e2e' ? ' or http://10.0.2.2:<port>.' : '.'),
    );
  }
  return {
    name: 'EVia Manager',
    slug: 'evia-manager',
    version: APP_VERSION,
    orientation: 'default',
    userInterfaceStyle: 'light',
    ios: { bundleIdentifier: IOS_BUNDLE_IDENTIFIER, supportsTablet: true },
    android: {
      package: ANDROID_APPLICATION_ID,
      versionCode: resolveVersionCode(env['EVIA_ANDROID_VERSION_CODE']),
      permissions: [],
      blockedPermissions: [...BLOCKED_ANDROID_PERMISSIONS],
    },
    // EVM-093 (ADR-0007): expo-sqlite compiled with SQLCipher (community 4.17, OpenSSL from expo-sqlite's Gradle dependency).
    plugins: ['expo-secure-store', ['expo-sqlite', { useSQLCipher: true }], ['./plugins/with-hardening.ts', { variant }]],
    extra: { buildVariant: variant },
  };
}
