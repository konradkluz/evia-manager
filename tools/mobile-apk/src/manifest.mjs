// @ts-check
/**
 * Assertions on the merged manifest of the BUILT APK (EVM-009 AC6; SR-MOB-02, SR-MOB-07, SR-MOB-09, SR-COMM-04, MASVS-STORAGE-2,
 * MASVS-PLATFORM-1, MASVS-PRIVACY-1; security-engineer B3). The source after `expo prebuild` is not enough: libraries add
 * permissions and components during the merge, so the check reads the manifest decoded from the finished package.
 */
import { forbiddenPrefixOf } from './forbidden.mjs';
import { childrenNamed, parseXml } from './xml.mjs';

/** The meta-data of the e2e variant that turns FLAG_SECURE off (apps/mobile/plugins/with-hardening.ts `SCREENSHOTS_META`). */
export const SCREENSHOTS_META = 'pl.eviacharge.SCREENSHOTS_ALLOWED';

/**
 * Build-time configuration of the upload (EVM-130 AC7; ADR-0020a, SR-MOB-11): the API address and the hosts of the part storage are written by the
 * config plugin as meta-data, JavaScript never passes them at run time. `UPLOAD_E2E_CLEARTEXT_META` is the switch of the e2e variant that
 * allows http and the host of the scenario server (10.0.2.2) — a release carrying it is refused, like `SCREENSHOTS_META`.
 */
export const API_BASE_URL_META = 'pl.eviacharge.API_BASE_URL';
export const STORAGE_HOSTS_META = 'pl.eviacharge.STORAGE_HOSTS';
export const UPLOAD_E2E_CLEARTEXT_META = 'pl.eviacharge.UPLOAD_E2E_CLEARTEXT';
/** The job service of the background upload (apps/mobile/modules/evia-upload). */
const UPLOAD_SERVICE_SUFFIX = '.UploadJobService';
const BIND_JOB_SERVICE = 'android.permission.BIND_JOB_SERVICE';
const BOOT_ACTIONS =
  /^(android\.intent\.action\.(BOOT_COMPLETED|LOCKED_BOOT_COMPLETED|QUICKBOOT_POWERON)|com\.htc\.intent\.action\.QUICKBOOT_POWERON)$/;
/** A hostname of the part storage: letters, digits, dots and hyphens; no scheme, port, wildcard, loopback or emulator alias. */
const STORAGE_HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Components that may have an intent filter or be exported: the launcher activity only. */
const LAUNCHER_ACTIVITY_SUFFIX = '.MainActivity';
const COMPONENT_TAGS = ['activity', 'activity-alias', 'service', 'receiver', 'provider'];
/** Packages of the modules that must not be in the app (OTA updates, developer tools). */
const FORBIDDEN_COMPONENT = /expo\.modules\.(updates|devlauncher|devmenu)|com\.facebook\.react\.devsupport|expo\.dev|devclient/i;
/**
 * Permissions named explicitly by EVM-093 AC4 (gallery, external storage, contacts, location; MASVS-PRIVACY-1): reported with their own
 * reason on top of the white list, so a review sees at once that the local data could leave the sandbox or that privacy is at stake.
 */
const FORBIDDEN_PERMISSION =
  /^android\.permission\.(READ_MEDIA_[A-Z_]+|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|READ_CONTACTS|WRITE_CONTACTS|GET_ACCOUNTS|ACCESS_[A-Z_]*LOCATION)$/;

/** EVM-108 AC8: the camera is the one permission let through next to the upload ones; the microphone is never requested (EVM-110: films have no sound). */
const CAMERA_PERMISSION = 'android.permission.CAMERA';
const UNLOCK_PERMISSION = 'android.permission.USE_BIOMETRIC';
const RECORD_AUDIO_PERMISSION = 'android.permission.RECORD_AUDIO';

/** EVM-130 AC7: no foreground service — Android 13 and older upload in a plain job, Android 14+ in a user-initiated one (ADR-0020a). */
const FOREGROUND_SERVICE_PERMISSION = /^android\.permission\.FOREGROUND_SERVICE[A-Z_]*$/;

/**
 * @param {string} manifestText the output of `apkanalyzer manifest print`
 * @param {{ applicationId: string, minimumTargetSdk?: number }} expected
 * @returns {string[]} problems; empty when the manifest is as required
 */
export function checkManifest(manifestText, { applicationId, minimumTargetSdk = 34 }) {
  /** @type {string[]} */
  const problems = [];
  const manifest = parseXml(manifestText);
  if (manifest.attributes['package'] !== applicationId) problems.push(`package is not ${applicationId}`);

  // `uses-permission-sdk-23` grants a permission as well (Android 6+), so both tags are checked
  const permissions = [...childrenNamed(manifest, 'uses-permission'), ...childrenNamed(manifest, 'uses-permission-sdk-23')].map(
    (element) => element.attributes['android:name'] ?? '',
  );
  const sdk23Permissions = childrenNamed(manifest, 'uses-permission-sdk-23').map((element) => element.attributes['android:name'] ?? '');
  const allowed = [
    'android.permission.INTERNET',
    `${applicationId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
    // EVM-130 AC7: the background upload — the job of the system (user-initiated on Android 14+), the network state for its constraints,
    // the re-arming of persisted jobs after a restart (without an own boot receiver) and the notification of Android 13+
    'android.permission.RUN_USER_INITIATED_JOBS',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.POST_NOTIFICATIONS',
    // EVM-108 AC8: the camera of the app (CameraX through expo-camera; the library declares it, plugins/with-camera.ts adds nothing)
    CAMERA_PERMISSION,
    // EVM-101 AC3: the system unlock window (BiometricPrompt of androidx.biometric); normal permissions, no consent of the user.
    // USE_BIOMETRIC (API 28+) is REQUIRED below: without it the system refuses the window. USE_FINGERPRINT (API 24-27, where the library
    // uses FingerprintManagerCompat) is declared by the library itself: allowed, not required
    UNLOCK_PERMISSION,
    'android.permission.USE_FINGERPRINT',
  ];
  for (const permission of permissions) {
    if (permission === RECORD_AUDIO_PERMISSION)
      problems.push(
        `forbidden permission ${permission} (the microphone is never requested: films have no sound, the camera view is muted)`,
      );
    else if (FOREGROUND_SERVICE_PERMISSION.test(permission))
      problems.push(`forbidden permission ${permission} (foreground service, ADR-0020a)`);
    else if (FORBIDDEN_PERMISSION.test(permission))
      problems.push(`forbidden permission ${permission} (gallery, storage, contacts or location)`);
    else if (permission === CAMERA_PERMISSION && sdk23Permissions.includes(permission))
      problems.push(`permission ${permission} must be declared by uses-permission, not uses-permission-sdk-23`);
    else if (!allowed.includes(permission)) problems.push(`unexpected permission ${permission}`);
  }
  problems.push(...forbiddenLibraryProblems(manifest));
  if (!permissions.includes('android.permission.INTERNET')) problems.push('INTERNET permission is missing');
  if (!permissions.includes(UNLOCK_PERMISSION))
    problems.push('USE_BIOMETRIC permission is missing (the system unlock window of the app lock, EVM-101 AC3)');

  const targetSdk = Number(childrenNamed(manifest, 'uses-sdk')[0]?.attributes['android:targetSdkVersion']);
  if (!(targetSdk >= minimumTargetSdk)) problems.push(`targetSdkVersion is below ${String(minimumTargetSdk)}`);

  const application = childrenNamed(manifest, 'application')[0];
  if (application === undefined) return [...problems, 'no application element'];
  const attribute = (/** @type {string} */ name) => application.attributes[name];
  if (attribute('android:debuggable') !== undefined && attribute('android:debuggable') !== 'false') problems.push('the app is debuggable');
  if (attribute('android:allowBackup') !== 'false') problems.push('allowBackup is not false');
  if (attribute('android:usesCleartextTraffic') !== 'false') problems.push('usesCleartextTraffic is not false');
  for (const name of ['android:networkSecurityConfig', 'android:dataExtractionRules', 'android:fullBackupContent']) {
    if (attribute(name) === undefined) problems.push(`${name} is missing`);
  }

  const metas = new Map(
    childrenNamed(application, 'meta-data').map((meta) => [meta.attributes['android:name'] ?? '', meta.attributes['android:value']]),
  );
  const hasUploadService = childrenNamed(application, 'service').some((service) =>
    (service.attributes['android:name'] ?? '').endsWith(UPLOAD_SERVICE_SUFFIX),
  );
  problems.push(...uploadConfigProblems(metas, hasUploadService));
  for (const meta of childrenNamed(application, 'meta-data')) {
    // EVM-100 (SR-MOB-08, decision 5): the switch of the e2e variant; MainActivity keeps FLAG_SECURE without it (fail closed)
    if (meta.attributes['android:name'] === SCREENSHOTS_META) {
      problems.push(`${SCREENSHOTS_META} is in the manifest (screenshots allowed, FLAG_SECURE off — an e2e build)`);
    }
    if (meta.attributes['android:name'] === 'expo.modules.updates.ENABLED' && meta.attributes['android:value'] !== 'false') {
      problems.push('OTA updates are enabled (expo.modules.updates.ENABLED)');
    }
  }
  for (const tag of COMPONENT_TAGS) {
    for (const component of childrenNamed(application, tag)) {
      const name = component.attributes['android:name'] ?? '';
      const filters = childrenNamed(component, 'intent-filter');
      const exported =
        component.attributes['android:exported'] === 'true' ||
        (component.attributes['android:exported'] === undefined && filters.length > 0);
      if (FORBIDDEN_COMPONENT.test(name)) problems.push(`forbidden component ${name}`);
      problems.push(...uploadComponentProblems(tag, name, component, filters));
      if (exported && !(tag === 'activity' && name.endsWith(LAUNCHER_ACTIVITY_SUFFIX))) problems.push(`exported component ${name}`);
      if (tag === 'activity' && name.endsWith(LAUNCHER_ACTIVITY_SUFFIX)) problems.push(...launcherProblems(component, filters));
    }
  }
  return problems;
}

/**
 * EVM-108 AC8 (SR-MOB-12): no package, library or content authority of a forbidden group (ML Kit, Google Play services, Firebase,
 * datatransport, ODML, the ML Kit artifact of CameraX) in `<queries>`, `<uses-library>` or the providers. The names of the components
 * are checked by checkTelemetry.
 * @param {import('./xml.mjs').XmlElement} manifest
 * @returns {string[]}
 */
function forbiddenLibraryProblems(manifest) {
  /** @type {string[]} */
  const problems = [];
  /** @param {string} what @param {string} name */
  const check = (what, name) => {
    const prefix = forbiddenPrefixOf(name);
    if (prefix !== undefined) problems.push(`${what} ${name} belongs to a forbidden library group (${prefix})`);
  };
  /** @param {string} what @param {import('./xml.mjs').XmlElement} provider */
  const authorities = (what, provider) => {
    for (const authority of (provider.attributes['android:authorities'] ?? '').split(';')) check(`${what} authority`, authority.trim());
  };
  for (const queries of childrenNamed(manifest, 'queries')) {
    for (const element of childrenNamed(queries, 'package')) check('queries package', element.attributes['android:name'] ?? '');
    for (const provider of childrenNamed(queries, 'provider')) authorities('queries provider', provider);
  }
  for (const application of childrenNamed(manifest, 'application')) {
    for (const library of childrenNamed(application, 'uses-library')) check('uses-library', library.attributes['android:name'] ?? '');
    for (const provider of childrenNamed(application, 'provider')) authorities('provider', provider);
  }
  return problems;
}

/**
 * @param {import('./xml.mjs').XmlElement} activity
 * @param {import('./xml.mjs').XmlElement[]} filters
 * @returns {string[]}
 */
function launcherProblems(activity, filters) {
  /** @type {string[]} */
  const problems = [];
  if (activity.attributes['android:exported'] !== 'true') problems.push('MainActivity is not exported (the launcher cannot start it)');
  const [filter] = filters;
  if (filters.length !== 1 || filter === undefined)
    return [...problems, 'MainActivity must have exactly one intent filter (MAIN/LAUNCHER)'];
  const actions = childrenNamed(filter, 'action').map((element) => element.attributes['android:name']);
  const categories = childrenNamed(filter, 'category').map((element) => element.attributes['android:name']);
  if (actions.join() !== 'android.intent.action.MAIN' || categories.join() !== 'android.intent.category.LAUNCHER') {
    problems.push('the intent filter of MainActivity is not exactly MAIN/LAUNCHER');
  }
  if (childrenNamed(filter, 'data').length > 0) problems.push('MainActivity has a deep link (data element)');
  return problems;
}

/**
 * Build-time configuration of the upload (EVM-130 AC7, SR-MOB-11): the e2e switch (http and the host of the scenario server) refuses a
 * release; a package with the upload service must carry an https API address and plain storage hostnames.
 * @param {Map<string, string | undefined>} metas
 * @param {boolean} hasUploadService
 * @returns {string[]}
 */
function uploadConfigProblems(metas, hasUploadService) {
  /** @type {string[]} */
  const problems = [];
  if (metas.has(UPLOAD_E2E_CLEARTEXT_META)) {
    problems.push(
      `${UPLOAD_E2E_CLEARTEXT_META} is in the manifest (http and the scenario server host allowed for the upload — an e2e build)`,
    );
  }
  const api = metas.get(API_BASE_URL_META);
  const hosts = metas.get(STORAGE_HOSTS_META);
  if (hasUploadService && api === undefined)
    problems.push(`${API_BASE_URL_META} is missing (the upload service needs the API address of the build)`);
  if (hasUploadService && hosts === undefined)
    problems.push(`${STORAGE_HOSTS_META} is missing (the upload service needs the storage host of the build)`);
  if (api !== undefined && !/^https:\/\/[^/\s]+/.test(api)) problems.push(`${API_BASE_URL_META} is not an https address`);
  if (hosts !== undefined && hosts.split(',').some((host) => !STORAGE_HOSTNAME.test(host.trim()))) {
    problems.push(`${STORAGE_HOSTS_META} holds something other than plain hostnames (https only)`);
  }
  return problems;
}

/**
 * The components of the upload (EVM-130 AC7): a service is never direct-boot aware, never in its own process, never a foreground service;
 * the job service is not exported and is bound by the system only (`BIND_JOB_SERVICE`); nothing listens for the boot broadcast (the system
 * re-arms persisted jobs itself, RECEIVE_BOOT_COMPLETED is not for an own receiver).
 * @param {string} tag
 * @param {string} name
 * @param {import('./xml.mjs').XmlElement} component
 * @param {import('./xml.mjs').XmlElement[]} filters
 * @returns {string[]}
 */
function uploadComponentProblems(tag, name, component, filters) {
  /** @type {string[]} */
  const problems = [];
  for (const filter of filters) {
    if (childrenNamed(filter, 'action').some((action) => BOOT_ACTIONS.test(action.attributes['android:name'] ?? ''))) {
      problems.push(`${name} listens for the boot broadcast (no own boot receiver)`);
    }
  }
  if (tag !== 'service') return problems;
  if (component.attributes['android:directBootAware'] === 'true') problems.push(`service ${name} is directBootAware`);
  if (component.attributes['android:process'] !== undefined) problems.push(`service ${name} has android:process`);
  if (component.attributes['android:foregroundServiceType'] !== undefined) problems.push(`service ${name} is a foreground service`);
  if (name.endsWith(UPLOAD_SERVICE_SUFFIX)) {
    if (component.attributes['android:exported'] !== 'false') problems.push(`service ${name} must have android:exported="false"`);
    if (component.attributes['android:permission'] !== BIND_JOB_SERVICE)
      problems.push(`service ${name} lacks the permission ${BIND_JOB_SERVICE}`);
  }
  return problems;
}
