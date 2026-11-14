/**
 * Config plugin of the background upload (EVM-130 AC7; ADR-0020/0020a, SR-MOB-07, SR-MOB-11, MASVS-PLATFORM-1, MASVS-NETWORK-1):
 * - the permissions the upload needs, and only those: `RUN_USER_INITIATED_JOBS` (Android 14+ user-initiated transfer),
 *   `ACCESS_NETWORK_STATE` (network constraint of the job), `RECEIVE_BOOT_COMPLETED` (the system re-arms PERSISTED jobs; the app has no
 *   boot receiver) and `POST_NOTIFICATIONS` (Android 13+). No foreground service permission: Android 13 and older upload in a plain job;
 * - the job service `pl.eviacharge.upload.android.UploadJobService`: not exported, bound by the system only (`BIND_JOB_SERVICE`), in the
 *   default process, not direct-boot aware, not a foreground service (`tools/mobile-apk verify` asserts all of it);
 * - the build configuration the service reads from the manifest (JavaScript passes none of it at run time): the API address
 *   (`pl.eviacharge.API_BASE_URL`, the same source as the address of the app), the hosts of the part storage
 *   (`pl.eviacharge.STORAGE_HOSTS`, from `EVIA_STORAGE_HOSTS`) and, in the e2e variant ONLY, the switch that allows http and the host of
 *   the scenario server (`pl.eviacharge.UPLOAD_E2E_CLEARTEXT`; `verify` rejects a package that carries it).
 * Fail closed: a release build without `EVIA_STORAGE_HOSTS` carries NO upload at all (no service, no permission, no configuration) -
 * never an empty or guessed host; a malformed value fails the build. `usesCleartextTraffic` stays `false` (with-hardening).
 */
import { withAndroidManifest } from 'expo/config-plugins';
import type { ConfigPlugin } from 'expo/config-plugins';
import { LOCAL_HTTP_HOSTS } from '../src/config/api-base-url.ts';
import type { BuildVariant } from '../src/config/api-base-url.ts';

/** The names `tools/mobile-apk/src/manifest.mjs` knows (a test compares them). */
export const API_BASE_URL_META = 'pl.eviacharge.API_BASE_URL';
export const STORAGE_HOSTS_META = 'pl.eviacharge.STORAGE_HOSTS';
export const UPLOAD_E2E_CLEARTEXT_META = 'pl.eviacharge.UPLOAD_E2E_CLEARTEXT';
export const UPLOAD_SERVICE = 'pl.eviacharge.upload.android.UploadJobService';
export const BIND_JOB_SERVICE = 'android.permission.BIND_JOB_SERVICE';
export const UPLOAD_PERMISSIONS: readonly string[] = [
  'android.permission.RUN_USER_INITIATED_JOBS',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.POST_NOTIFICATIONS',
];

/** A hostname of the part storage; the same rule as `STORAGE_HOSTNAME` of `verify`: letters, digits, dots, hyphens, a dot and a TLD. */
const STORAGE_HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_HOST_PORT = new RegExp(`^(${LOCAL_HTTP_HOSTS.map((host) => host.replaceAll('.', '\\.')).join('|')})(:[0-9]{1,5})?$`);

/**
 * `host,host` from `EVIA_STORAGE_HOSTS` -> the normalised list for the manifest; `null` when not set (no upload in this package).
 * The e2e variant (the scenario server) accepts the local hosts of the emulator with a port and, when the variable is not set, uses the
 * authority of its API address. The error never repeats the rejected value.
 */
export function parseStorageHosts(raw: string | undefined, variant: BuildVariant, apiAuthority: string): string | null {
  const text = raw?.trim() ?? '';
  if (text === '') return variant === 'e2e' ? apiAuthority.toLowerCase() : null;
  const hosts = text.split(',').map((host) => host.trim().toLowerCase());
  const allowed = (host: string): boolean => STORAGE_HOSTNAME.test(host) || (variant === 'e2e' && LOCAL_HOST_PORT.test(host));
  if (hosts.some((host) => !allowed(host))) {
    throw new Error(
      `EVIA_STORAGE_HOSTS is not allowed in the ${variant} build: a comma separated list of plain host names (no scheme, port, path or wildcard)` +
        (variant === 'e2e' ? ' or the emulator host with a port.' : '.'),
    );
  }
  return [...new Set(hosts)].join(',');
}

interface ManifestElement {
  $: Record<string, string>;
  [child: string]: unknown;
}
interface Manifest {
  manifest: { 'uses-permission'?: ManifestElement[]; application?: Application[] } & Record<string, unknown>;
}
interface Application {
  $: Record<string, string>;
  service?: ManifestElement[];
  'meta-data'?: ManifestElement[];
  [child: string]: unknown;
}

export interface UploadOptions {
  readonly variant: BuildVariant;
  /** The API address of the build (https, or the emulator host in the e2e variant) - the one the app uses. */
  readonly apiBaseUrl: string;
  /** From `parseStorageHosts`; `null` = no upload in this package. */
  readonly storageHosts: string | null;
}

const OWN_METAS = [API_BASE_URL_META, STORAGE_HOSTS_META, UPLOAD_E2E_CLEARTEXT_META];

/** Writes (or, without hosts, removes) the upload part of the merged manifest. Idempotent: a second run gives the same manifest. */
export function applyUploadManifest(modResults: Manifest, { variant, apiBaseUrl, storageHosts }: UploadOptions): Manifest {
  const { manifest } = modResults;
  const application = manifest.application?.[0];
  if (application === undefined) throw new Error('with-upload: the manifest has no application element (template changed)');
  manifest['uses-permission'] = (manifest['uses-permission'] ?? []).filter(
    (item) => !UPLOAD_PERMISSIONS.includes(item.$['android:name'] ?? ''),
  );
  application.service = (application.service ?? []).filter((item) => item.$['android:name'] !== UPLOAD_SERVICE);
  application['meta-data'] = (application['meta-data'] ?? []).filter((item) => !OWN_METAS.includes(item.$['android:name'] ?? ''));
  if (storageHosts === null) return modResults;
  manifest['uses-permission'].push(...UPLOAD_PERMISSIONS.map((name) => ({ $: { 'android:name': name } })));
  application.service.push({
    $: { 'android:name': UPLOAD_SERVICE, 'android:exported': 'false', 'android:permission': BIND_JOB_SERVICE },
  });
  application['meta-data'].push(
    { $: { 'android:name': API_BASE_URL_META, 'android:value': apiBaseUrl } },
    { $: { 'android:name': STORAGE_HOSTS_META, 'android:value': storageHosts } },
  );
  // the switch of the e2e variant only (like SCREENSHOTS_META of with-hardening): any other build never carries the entry
  if (variant === 'e2e') application['meta-data'].push({ $: { 'android:name': UPLOAD_E2E_CLEARTEXT_META, 'android:value': 'true' } });
  return modResults;
}

const withUpload: ConfigPlugin<UploadOptions> = (config, options) =>
  withAndroidManifest(config, (modConfig) => {
    applyUploadManifest(modConfig.modResults as unknown as Manifest, options);
    return modConfig;
  });

export default withUpload;
