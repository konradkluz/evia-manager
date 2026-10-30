import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkManifest } from '../src/manifest.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const ID = 'pl.eviacharge.manager';
/** The manifest decoded by apkanalyzer from the real package of the app (synthetic data only). */
const MANIFEST = readFileSync(join(FIXTURES, 'manifest-print.txt'), 'utf8');

/** @param {string} from @param {string} to */
const changed = (from, to) => {
  assert.ok(MANIFEST.includes(from), `fixture lacks ${from}`);
  return MANIFEST.replace(from, to);
};

describe('manifest of the built APK (EVM-009 AC6; SR-MOB-02, SR-MOB-07, SR-MOB-09, SR-COMM-04)', () => {
  it('EVM-009 AC6: the manifest of the real package of the app passes', () => {
    assert.deepEqual(checkManifest(MANIFEST, { applicationId: ID }), []);
  });

  it('EVM-009 AC6: the package must carry the application id', () => {
    assert.deepEqual(checkManifest(MANIFEST, { applicationId: 'pl.other.app' }).slice(0, 1), ['package is not pl.other.app']);
  });

  it('EVM-093 AC4: gallery, external storage, contacts and location permissions are forbidden by name (both permission tags)', () => {
    const names = [
      'READ_MEDIA_IMAGES',
      'READ_MEDIA_VIDEO',
      'READ_MEDIA_VISUAL_USER_SELECTED',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
      'MANAGE_EXTERNAL_STORAGE',
      'READ_CONTACTS',
      'WRITE_CONTACTS',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
    ];
    for (const name of names) {
      for (const tag of ['uses-permission', 'uses-permission-sdk-23']) {
        const manifest = changed('</manifest>', `<${tag} android:name="android.permission.${name}" /></manifest>`);
        assert.deepEqual(checkManifest(manifest, { applicationId: ID }), [
          `forbidden permission android.permission.${name} (gallery, storage, contacts or location)`,
        ]);
      }
    }
  });

  it('EVM-009 AC6: a permission outside the white list is reported, the missing INTERNET too', () => {
    const extra = changed('</manifest>', '<uses-permission android:name="android.permission.CAMERA" /></manifest>');
    assert.deepEqual(checkManifest(extra, { applicationId: ID }), ['unexpected permission android.permission.CAMERA']);
    const noInternet = changed('android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE');
    assert.deepEqual(checkManifest(noInternet, { applicationId: ID }), [
      'unexpected permission android.permission.ACCESS_NETWORK_STATE',
      'INTERNET permission is missing',
    ]);
  });

  it('EVM-009 AC6: backup allowed, cleartext allowed or a debuggable app are reported', () => {
    assert.deepEqual(checkManifest(changed('android:allowBackup="false"', 'android:allowBackup="true"'), { applicationId: ID }), [
      'allowBackup is not false',
    ]);
    assert.deepEqual(
      checkManifest(changed('android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"'), { applicationId: ID }),
      ['usesCleartextTraffic is not false'],
    );
    assert.deepEqual(
      checkManifest(changed('android:allowBackup="false"', 'android:allowBackup="false" android:debuggable="true"'), { applicationId: ID }),
      ['the app is debuggable'],
    );
    assert.deepEqual(
      checkManifest(changed('android:allowBackup="false"', 'android:allowBackup="false" android:debuggable="false"'), {
        applicationId: ID,
      }),
      [],
    );
  });

  it('EVM-009 AC6: the network security config and the backup rules must be referenced', () => {
    for (const name of ['networkSecurityConfig', 'dataExtractionRules', 'fullBackupContent']) {
      const without = MANIFEST.replace(new RegExp(`\\s*android:${name}="[^"]*"`), '');
      assert.deepEqual(checkManifest(without, { applicationId: ID }), [`android:${name} is missing`], name);
    }
  });

  it('EVM-009 AC6: a target SDK below the minimum is reported', () => {
    assert.deepEqual(checkManifest(changed('android:targetSdkVersion="36"', 'android:targetSdkVersion="30"'), { applicationId: ID }), [
      'targetSdkVersion is below 34',
    ]);
  });

  it('EVM-009 AC6: OTA updates (expo-updates) and developer tools are forbidden (SR-MOB-09)', () => {
    const enabled = changed(
      'android:name="expo.modules.updates.ENABLED"\n            android:value="false"',
      'android:name="expo.modules.updates.ENABLED"\n            android:value="true"',
    );
    assert.deepEqual(checkManifest(enabled, { applicationId: ID }), ['OTA updates are enabled (expo.modules.updates.ENABLED)']);
    const devMenu = changed(
      '</application>',
      '<activity android:name="expo.modules.devmenu.DevMenuActivity" android:exported="false" /></application>',
    );
    assert.deepEqual(checkManifest(devMenu, { applicationId: ID }), ['forbidden component expo.modules.devmenu.DevMenuActivity']);
  });

  it('EVM-009 AC6: only MainActivity may be exported or carry an intent filter — a receiver, a service or an alias is reported', () => {
    const receiver = changed(
      '</application>',
      '<receiver android:name="x.Receiver" android:exported="true" /><service android:name="x.Service"><intent-filter><action android:name="x.ACTION" /></intent-filter></service></application>',
    );
    assert.deepEqual(checkManifest(receiver, { applicationId: ID }), ['exported component x.Service', 'exported component x.Receiver']);
    const profile = changed(
      '</application>',
      '<receiver android:name="androidx.profileinstaller.ProfileInstallReceiver" android:permission="android.permission.DUMP" android:exported="true" /></application>',
    );
    assert.deepEqual(checkManifest(profile, { applicationId: ID }), [
      'exported component androidx.profileinstaller.ProfileInstallReceiver',
    ]);
  });

  it('EVM-009 AC6: MainActivity is exactly the launcher: one MAIN/LAUNCHER filter, no deep link, exported', () => {
    const deepLink = changed(
      'android:name="android.intent.category.LAUNCHER" />',
      'android:name="android.intent.category.LAUNCHER" /><data android:scheme="eviamanager" />',
    );
    assert.deepEqual(checkManifest(deepLink, { applicationId: ID }), ['MainActivity has a deep link (data element)']);
    const browsable = changed('android:name="android.intent.category.LAUNCHER" />', 'android:name="android.intent.category.BROWSABLE" />');
    assert.deepEqual(checkManifest(browsable, { applicationId: ID }), ['the intent filter of MainActivity is not exactly MAIN/LAUNCHER']);
    const hidden = changed(
      'android:exported="true"\n            android:launchMode="2"',
      'android:exported="false"\n            android:launchMode="2"',
    );
    assert.deepEqual(checkManifest(hidden, { applicationId: ID }), ['MainActivity is not exported (the launcher cannot start it)']);
    const second = changed('</activity>', '<intent-filter><action android:name="android.intent.action.VIEW" /></intent-filter></activity>');
    assert.deepEqual(checkManifest(second, { applicationId: ID }), ['MainActivity must have exactly one intent filter (MAIN/LAUNCHER)']);
    const none = MANIFEST.replace(
      /<intent-filter>\s*<action\s+android:name="android\.intent\.action\.MAIN" \/>[\s\S]*?<\/intent-filter>/,
      '',
    );
    assert.deepEqual(checkManifest(none, { applicationId: ID }), ['MainActivity must have exactly one intent filter (MAIN/LAUNCHER)']);
  });

  it('EVM-009 AC6: a manifest without an application element is reported', () => {
    const bare =
      '<manifest package="pl.eviacharge.manager"><uses-permission android:name="android.permission.INTERNET" /><uses-sdk android:targetSdkVersion="36" /></manifest>';
    assert.deepEqual(checkManifest(bare, { applicationId: ID }), ['no application element']);
  });
});
