/**
 * Config plugin of the EVM-011 spike variant (a copy of the idea of apps/mobile/plugins/with-hardening.ts, no change there):
 * - no backup of app data: allowBackup=false + dataExtractionRules (cloud-backup and device-transfer) excluding every domain;
 * - network security config: base cleartext=false, system trust anchors only; plain HTTP ONLY for 10.0.2.2 (emulator host),
 *   127.0.0.1 and localhost (`adb reverse` on a phone). Never a global usesCleartextTraffic. THIS VARIANT IS NEVER SHIPPED.
 * - the exported AndroidX profile installer receiver is removed; the Gradle distribution checksum is pinned.
 */
import { AndroidConfig, withAndroidManifest, withDangerousMod } from 'expo/config-plugins';
import type { ConfigPlugin } from 'expo/config-plugins';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>\n';
const ALL_DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];
const exclude = (indent: string) => ALL_DOMAINS.map((d) => `${indent}<exclude domain="${d}" />`).join('\n');

export const LOCAL_HTTP_HOSTS = ['10.0.2.2', '127.0.0.1', 'localhost'] as const;

export function dataExtractionRulesXml(): string {
  return (
    `${XML_HEADER}<data-extraction-rules>\n  <cloud-backup>\n${exclude('    ')}\n  </cloud-backup>\n` +
    `  <device-transfer>\n${exclude('    ')}\n  </device-transfer>\n</data-extraction-rules>\n`
  );
}

export function backupRulesXml(): string {
  return `${XML_HEADER}<full-backup-content>\n${exclude('  ')}\n</full-backup-content>\n`;
}

export function networkSecurityConfigXml(): string {
  const hosts = LOCAL_HTTP_HOSTS.map((h) => `    <domain includeSubdomains="false">${h}</domain>`).join('\n');
  return (
    `${XML_HEADER}<network-security-config>\n` +
    '  <base-config cleartextTrafficPermitted="false">\n    <trust-anchors>\n      <certificates src="system" />\n    </trust-anchors>\n  </base-config>\n' +
    `  <domain-config cleartextTrafficPermitted="true">\n${hosts}\n  </domain-config>\n</network-security-config>\n`
  );
}

export const GRADLE_DISTRIBUTION_URL = 'https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip';
export const GRADLE_DISTRIBUTION_SHA256 = '2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb';

export function withGradleDistributionChecksum(properties: string): string {
  const lines = properties.split(/\r?\n/).filter((line) => !line.startsWith('distributionSha256Sum='));
  const at = lines.indexOf(`distributionUrl=${GRADLE_DISTRIBUTION_URL}`);
  if (at < 0) throw new Error('with-spike-hardening: another Gradle distribution than the pinned one (template changed)');
  lines.splice(at + 1, 0, `distributionSha256Sum=${GRADLE_DISTRIBUTION_SHA256}`);
  return lines.join('\n');
}

const withSpikeHardening: ConfigPlugin = (config) => {
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:allowBackup'] = 'false';
    application.$['android:dataExtractionRules'] = '@xml/evm011_data_extraction_rules';
    application.$['android:fullBackupContent'] = '@xml/evm011_backup_rules';
    application.$['android:networkSecurityConfig'] = '@xml/evm011_network_security_config';
    application.$['android:usesCleartextTraffic'] = 'false';
    mod.modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    application.receiver = [
      ...(application.receiver ?? []),
      { $: { 'android:name': 'androidx.profileinstaller.ProfileInstallReceiver', 'tools:node': 'remove' } },
    ];
    return mod;
  });
  config = withDangerousMod(config, [
    'android',
    (mod) => {
      const dir = join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'evm011_data_extraction_rules.xml'), dataExtractionRulesXml());
      writeFileSync(join(dir, 'evm011_backup_rules.xml'), backupRulesXml());
      writeFileSync(join(dir, 'evm011_network_security_config.xml'), networkSecurityConfigXml());
      const wrapper = join(mod.modRequest.platformProjectRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties');
      if (!existsSync(wrapper)) throw new Error('with-spike-hardening: gradle-wrapper.properties not found');
      writeFileSync(wrapper, withGradleDistributionChecksum(readFileSync(wrapper, 'utf8')));
      return mod;
    },
  ]);
  return config;
};

export default withSpikeHardening;
