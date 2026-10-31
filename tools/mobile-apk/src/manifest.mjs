// @ts-check
/**
 * Assertions on the merged manifest of the BUILT APK (EVM-009 AC6; SR-MOB-02, SR-MOB-07, SR-MOB-09, SR-COMM-04, MASVS-STORAGE-2,
 * MASVS-PLATFORM-1, MASVS-PRIVACY-1; security-engineer B3). The source after `expo prebuild` is not enough: libraries add
 * permissions and components during the merge, so the check reads the manifest decoded from the finished package.
 */
import { childrenNamed, parseXml } from './xml.mjs';

/** The meta-data of the e2e variant that turns FLAG_SECURE off (apps/mobile/plugins/with-hardening.ts `SCREENSHOTS_META`). */
export const SCREENSHOTS_META = 'pl.eviacharge.SCREENSHOTS_ALLOWED';

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
  const allowed = ['android.permission.INTERNET', `${applicationId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`];
  for (const permission of permissions) {
    if (FORBIDDEN_PERMISSION.test(permission)) problems.push(`forbidden permission ${permission} (gallery, storage, contacts or location)`);
    else if (!allowed.includes(permission)) problems.push(`unexpected permission ${permission}`);
  }
  if (!permissions.includes('android.permission.INTERNET')) problems.push('INTERNET permission is missing');

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
      if (exported && !(tag === 'activity' && name.endsWith(LAUNCHER_ACTIVITY_SUFFIX))) problems.push(`exported component ${name}`);
      if (tag === 'activity' && name.endsWith(LAUNCHER_ACTIVITY_SUFFIX)) problems.push(...launcherProblems(component, filters));
    }
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
