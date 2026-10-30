/**
 * Config plugin of the Android hardening (EVM-009 AC6; SR-MOB-02, SR-MOB-07, SR-MOB-11, SR-COMM-04; MASVS-STORAGE-2, MASVS-NETWORK-1):
 * - no backup of app data (the offline queue and the tokens must not leave the phone through adb or cloud backup);
 * - network security config: no plain HTTP and only system trust anchors (a user-installed CA cannot intercept the traffic);
 *   the e2e variant adds plain HTTP for the emulator host 10.0.2.2 and localhost only;
 * - R8 minification and resource shrinking in the release build;
 * - the release variant produces an UNSIGNED APK (the Gradle template signs it with the public debug key otherwise): the key of the
 *   app lives outside the repository and the owner signs the package locally (tools/mobile-apk sign, docs/ops/dystrybucja-apk-android.md,
 *   ADR-0019); the e2e variant keeps the debug signature so that the emulator can install it;
 * - the e2e variant only is debuggable (EVM-093: `run-as` reads the app directory on the emulator, a Google Play image has no root);
 *   set in the release build type of app/build.gradle (a hardcoded manifest attribute fails lintVital); verify rejects it in release;
 * - the Gradle wrapper verifies its download: distributionSha256Sum is pinned to the published SHA-256 of the distribution;
 * - EVM-100 (decision 5, SR-MOB-08, MASVS-PLATFORM-3): FLAG_SECURE on the WHOLE window, set in MainActivity before `super.onCreate`
 *   (no screenshots, no preview in "Recent apps"). Fail closed: it is turned off only when the resource `evia_screenshots_allowed`
 *   is true, and only the e2e variant writes it (Maestro and QA screenshots); release and every other build keep the flag, and
 *   `tools/mobile-apk verify` rejects a package that carries the resource.
 */
import {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withMainActivity,
} from 'expo/config-plugins';
import type { ConfigPlugin } from 'expo/config-plugins';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_HTTP_HOSTS } from '../src/config/api-base-url.ts';
import type { BuildVariant } from '../src/config/api-base-url.ts';

const PROFILE_INSTALL_RECEIVER = 'androidx.profileinstaller.ProfileInstallReceiver';
const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>\n';

export function dataExtractionRulesXml(): string {
  return (
    `${XML_HEADER}<data-extraction-rules>\n` +
    '  <cloud-backup>\n    <exclude domain="root" />\n    <exclude domain="file" />\n    <exclude domain="database" />\n    <exclude domain="sharedpref" />\n    <exclude domain="external" />\n  </cloud-backup>\n' +
    '  <device-transfer>\n    <exclude domain="root" />\n    <exclude domain="file" />\n    <exclude domain="database" />\n    <exclude domain="sharedpref" />\n    <exclude domain="external" />\n  </device-transfer>\n' +
    '</data-extraction-rules>\n'
  );
}

export function backupRulesXml(): string {
  return (
    `${XML_HEADER}<full-backup-content>\n  <exclude domain="root" />\n  <exclude domain="file" />\n  <exclude domain="database" />\n` +
    '  <exclude domain="sharedpref" />\n  <exclude domain="external" />\n</full-backup-content>\n'
  );
}

export function networkSecurityConfigXml(variant: BuildVariant): string {
  const local =
    variant === 'e2e'
      ? `  <domain-config cleartextTrafficPermitted="true">\n${LOCAL_HTTP_HOSTS.map((host) => `    <domain includeSubdomains="false">${host}</domain>`).join('\n')}\n  </domain-config>\n`
      : '';
  return (
    `${XML_HEADER}<network-security-config>\n` +
    '  <base-config cleartextTrafficPermitted="false">\n    <trust-anchors>\n      <certificates src="system" />\n    </trust-anchors>\n  </base-config>\n' +
    `${local}</network-security-config>\n`
  );
}

/** The Gradle distribution of the Expo template and its published SHA-256 (https://gradle.org/release-checksums/, 9.4.1 -bin). */
export const GRADLE_DISTRIBUTION_URL = 'https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip';
export const GRADLE_DISTRIBUTION_SHA256 = '2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb';

/**
 * Pins the checksum of the Gradle distribution in gradle-wrapper.properties (supply chain: the wrapper verifies the download).
 * A template with another Gradle version fails the build until the checksum is updated together with the version.
 */
export function withGradleDistributionChecksum(properties: string): string {
  const lines = properties.split(/\r?\n/).filter((line) => !line.startsWith('distributionSha256Sum='));
  const at = lines.indexOf(`distributionUrl=${GRADLE_DISTRIBUTION_URL}`);
  if (at < 0)
    throw new Error(
      'with-hardening: gradle-wrapper.properties has another distributionUrl than the pinned Gradle (template changed): update GRADLE_DISTRIBUTION_SHA256 from https://gradle.org/release-checksums/',
    );
  lines.splice(at + 1, 0, `distributionSha256Sum=${GRADLE_DISTRIBUTION_SHA256}`);
  return lines.join('\n');
}

/** Removes the debug signature from the release build type (the first `signingConfig` after `release {`). */
export function withoutReleaseDebugSigning(gradle: string): string {
  const release = /(\n\s*release \{[^}]*?)\n\s*signingConfig signingConfigs\.debug/;
  if (!release.test(gradle))
    throw new Error('with-hardening: the release signingConfig line was not found in app/build.gradle (template changed)');
  return gradle.replace(release, '$1');
}

/** EVM-093 (e2e only): `debuggable true` in the release build type, which the e2e build assembles (assembleRelease). */
export function withE2eDebuggable(gradle: string): string {
  const release = /(\n\s*release \{)/;
  if (!release.test(gradle)) throw new Error('with-hardening: the release build type was not found in app/build.gradle (template changed)');
  return gradle.replace(release, '$1\n            debuggable true');
}

/** EVM-100: the resource of the e2e variant that turns FLAG_SECURE off (tools/mobile-apk/src/verify.mjs `SCREENSHOTS_RESOURCE`). */
export const SCREENSHOTS_RESOURCE = 'evia_screenshots_allowed';
const SCREENSHOTS_FILE = 'evia_screenshots.xml';
const SECURE_WINDOW_MARKER = 'EVM-100 secure window';

/** e2e only: screenshots allowed; `tools:keep` stops the resource shrinker from dropping a resource looked up by name. */
export function screenshotsAllowedXml(): string {
  return (
    `${XML_HEADER}<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@bool/${SCREENSHOTS_RESOURCE}">\n` +
    `  <bool name="${SCREENSHOTS_RESOURCE}">true</bool>\n</resources>\n`
  );
}

/**
 * FLAG_SECURE before `super.onCreate` of MainActivity (Kotlin template of Expo). Fail closed: without the resource (every build but
 * e2e) the flag is set. A template without `super.onCreate(` fails the build instead of shipping a window without the flag.
 */
export function withSecureWindow(mainActivity: string): string {
  if (mainActivity.includes(SECURE_WINDOW_MARKER)) return mainActivity;
  const call = /\n([ \t]*)super\.onCreate\(/;
  const match = call.exec(mainActivity);
  if (match === null) throw new Error('with-hardening: super.onCreate was not found in MainActivity (template changed)');
  const indent = match[1] ?? '';
  const flag = 'android.view.WindowManager.LayoutParams.FLAG_SECURE';
  const lines = [
    `// ${SECURE_WINDOW_MARKER} (SR-MOB-08): no screenshots and no preview in "Recent apps" unless the e2e build allows them`,
    `val eviaScreenshots = resources.getIdentifier("${SCREENSHOTS_RESOURCE}", "bool", packageName)`,
    `if (eviaScreenshots == 0 || !resources.getBoolean(eviaScreenshots)) window.setFlags(${flag}, ${flag})`,
  ];
  return mainActivity.replace(call, `\n${lines.map((line) => `${indent}${line}`).join('\n')}\n${indent}super.onCreate(`);
}

const withHardening: ConfigPlugin<{ variant: BuildVariant }> = (config, { variant }) => {
  config = withMainActivity(config, (modConfig) => {
    if (modConfig.modResults.language !== 'kt') throw new Error('with-hardening: MainActivity is not Kotlin (template changed)');
    modConfig.modResults.contents = withSecureWindow(modConfig.modResults.contents);
    return modConfig;
  });
  config = withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    application.$['android:allowBackup'] = 'false';
    application.$['android:dataExtractionRules'] = '@xml/evia_data_extraction_rules';
    application.$['android:fullBackupContent'] = '@xml/evia_backup_rules';
    application.$['android:networkSecurityConfig'] = '@xml/evia_network_security_config';
    application.$['android:usesCleartextTraffic'] = 'false';
    // The only exported component is MainActivity: the AndroidX profile installer receiver (exported, guarded by DUMP) is removed.
    modConfig.modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    application.receiver = [...(application.receiver ?? []), { $: { 'android:name': PROFILE_INSTALL_RECEIVER, 'tools:node': 'remove' } }];
    return modConfig;
  });
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const directory = join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'evia_data_extraction_rules.xml'), dataExtractionRulesXml());
      writeFileSync(join(directory, 'evia_backup_rules.xml'), backupRulesXml());
      writeFileSync(join(directory, 'evia_network_security_config.xml'), networkSecurityConfigXml(variant));
      const values = join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'values');
      if (variant === 'e2e') {
        mkdirSync(values, { recursive: true });
        writeFileSync(join(values, SCREENSHOTS_FILE), screenshotsAllowedXml());
      } else {
        // a project prebuilt for e2e before must not carry the resource into a release build
        rmSync(join(values, SCREENSHOTS_FILE), { force: true });
      }
      const wrapper = join(modConfig.modRequest.platformProjectRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties');
      if (!existsSync(wrapper)) throw new Error('with-hardening: gradle-wrapper.properties was not found (template changed)');
      writeFileSync(wrapper, withGradleDistributionChecksum(readFileSync(wrapper, 'utf8')));
      return modConfig;
    },
  ]);
  config = withGradleProperties(config, (modConfig) => {
    for (const [key, value] of [
      ['android.enableMinifyInReleaseBuilds', 'true'],
      ['android.enableShrinkResourcesInReleaseBuilds', 'true'],
    ] as const) {
      modConfig.modResults = modConfig.modResults.filter((item) => item.type !== 'property' || item.key !== key);
      modConfig.modResults.push({ type: 'property', key, value });
    }
    return modConfig;
  });
  config = withAppBuildGradle(config, (modConfig) => {
    const gradle = modConfig.modResults.contents;
    modConfig.modResults.contents = variant === 'release' ? withoutReleaseDebugSigning(gradle) : withE2eDebuggable(gradle);
    return modConfig;
  });
  return config;
};

export default withHardening;
