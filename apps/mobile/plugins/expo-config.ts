/**
 * Builds the Expo configuration (EVM-009 AC5, AC6) from the environment of the build. app.config.ts is a one-line wrapper.
 * - `version` (semver) is the single source of the app version shown to the update check (AC3);
 * - the Android `versionCode` comes from the CI run number so that it only grows (an older code cannot be installed over a newer one);
 * - a release build fails when the API address is not HTTPS (SR-COMM-04); plain HTTP to the emulator host exists in the e2e variant only;
 * - the app requests no permission itself (INTERNET is added by the platform template) and risky defaults are blocked (SR-MOB-02); the only
 *   one let through by the merge is CAMERA of the camera library (EVM-108 AC8: plugins/with-camera.ts, scanners of Google off); the microphone
 *   (RECORD_AUDIO) stays blocked for good (EVM-110: films have no sound, the camera view is muted);
 * - no OTA updates, no dev client, no analytics SDK (SR-MOB-09);
 * - the local database is SQLCipher only (EVM-093 AC1): expo-sqlite with `useSQLCipher`, there is no build without the cipher;
 * - the background upload (EVM-130 AC7, plugins/with-upload.ts) is configured from the SAME API address and from `EVIA_STORAGE_HOSTS` (the
 *   hosts of the part storage, a comma separated list of host names); a release without it carries no upload (fail closed).
 */
import type { ExpoConfig } from 'expo/config';
import { parseApiBaseUrl, resolveBuildVariant } from '../src/config/api-base-url.ts';
import { parseStorageHosts } from './with-upload.ts';
import { parseContactEmail, parseContactPhone } from '../src/config/contact-values.ts';
import { ADMINISTRATOR, CLAUSES, DRAFT } from '../src/privacy/content.ts';

export const APP_VERSION = '1.0.0';
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
  // NOT blocked (EVM-101 AC3), both are normal permissions without a prompt: USE_BIOMETRIC (API 28+; without it the system refuses
  // BiometricPrompt and BiometricManager without a window) and USE_FINGERPRINT (API 24-27, where androidx.biometric 1.1.0 uses
  // FingerprintManagerCompat and declares it itself; blocked, the unlock window does not open on Android 7-8.1, minSdk is 24).
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

/**
 * The state of the privacy clauses built into the package (EVM-102 AC6), declared in `extra` so that `tools/mobile-apk sign` can refuse a
 * package with a draft or with markers of data still to be filled in. A flat object of plain JSON (tools/mobile-apk/src/telemetry.mjs).
 */
export function privacyClausesState(): { draft: boolean; markers: boolean; versions: string } {
  const text = JSON.stringify([ADMINISTRATOR, CLAUSES]);
  return {
    draft: DRAFT,
    markers: text.includes('[DO UZUPEŁNIENIA]') || text.includes('[PRAWNIK/IOD]'),
    versions: [...new Set(CLAUSES.map((clause) => clause.version))].join(', '),
  };
}

/** A contact of the office from the build (EVM-102 AC3): absent is fine, a malformed value fails the build instead of being shown wrongly. */
function contactFrom(name: string, parse: (raw: unknown) => string | null | undefined, raw: string | undefined): string | null {
  const value = parse(raw);
  if (value === undefined)
    throw new Error(`${name} is not a valid value (an address like office@example.com or a number like +48 123 456 789)`);
  return value;
}

export function buildExpoConfig(env: Readonly<Record<string, string | undefined>>): ExpoConfig {
  const variant = resolveBuildVariant(env['EVIA_BUILD_VARIANT']);
  // EVM-093 (security K1): no public switch of our own besides the API address (e2e hooks are chosen by the Metro resolver).
  // Public variables of Expo itself (the project root, set by the CLI while it reads this config) are not switches of the app.
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('EXPO_PUBLIC_') && name.slice('EXPO_PUBLIC_'.length).startsWith('EVIA_') && value !== undefined && value !== '')
      throw new Error(`${name} is not allowed in the ${variant} build: EXPO_PUBLIC_API_BASE_URL is the only public variable of the app.`);
  }
  const url = parseApiBaseUrl(env['EXPO_PUBLIC_API_BASE_URL'], { allowLocalHttp: variant === 'e2e' });
  if (!url.ok) {
    throw new Error(
      `EXPO_PUBLIC_API_BASE_URL is not allowed in the ${variant} build (${url.reason}): set an https:// address` +
        (variant === 'e2e' ? ' or http://10.0.2.2:<port>.' : '.'),
    );
  }
  const authority = url.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
  const storageHosts = parseStorageHosts(env['EVIA_STORAGE_HOSTS'], variant, authority);
  // the native side builds `<origin>/api/v1/...` itself (sign-in, refresh and upload): an address with a path would make every request
  // wrong, so the build says so (the API address is written to the manifest in every package, also without the upload)
  if (url.url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '') !== '')
    throw new Error(
      `EXPO_PUBLIC_API_BASE_URL with a path is not supported by the native session in the ${variant} build: use the origin only.`,
    );
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
    plugins: [
      'expo-secure-store',
      ['expo-sqlite', { useSQLCipher: true }],
      ['./plugins/with-hardening.ts', { variant }],
      ['./plugins/with-upload.ts', { variant, apiBaseUrl: url.url, storageHosts }],
      './plugins/with-camera.ts',
      './plugins/with-video.ts',
    ],
    extra: {
      buildVariant: variant,
      // EVM-142 AC5 (SR-MOB-10): the hosts of the bucket, public (the same list as pl.eviacharge.STORAGE_HOSTS); the app fetches images only from them
      storageHosts: storageHosts === null ? [] : storageHosts.split(','),
      // EVM-102: contact of the office (not in the repository: the build variables EVIA_CONTACT_EMAIL / EVIA_CONTACT_PHONE; visible in the CI artifact and in the APK, so only a functional
      // address and number of the office, never of a person)
      contactEmail: contactFrom('EVIA_CONTACT_EMAIL', parseContactEmail, env['EVIA_CONTACT_EMAIL']),
      contactPhone: contactFrom('EVIA_CONTACT_PHONE', parseContactPhone, env['EVIA_CONTACT_PHONE']),
      privacyClauses: privacyClausesState(),
    },
  };
}
