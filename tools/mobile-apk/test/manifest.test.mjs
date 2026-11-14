import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { API_BASE_URL_META, checkManifest, SCREENSHOTS_META, STORAGE_HOSTS_META, UPLOAD_E2E_CLEARTEXT_META } from '../src/manifest.mjs';

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
    const noInternet = changed('android.permission.INTERNET', 'android.permission.ACCESS_WIFI_STATE');
    assert.deepEqual(checkManifest(noInternet, { applicationId: ID }), [
      'unexpected permission android.permission.ACCESS_WIFI_STATE',
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

  it('EVM-100 AC1 (SR-MOB-08): a package of the e2e variant (screenshots allowed, FLAG_SECURE off) is rejected', () => {
    const e2e = changed(
      '</application>',
      '<meta-data android:name="pl.eviacharge.SCREENSHOTS_ALLOWED" android:value="true" /></application>',
    );
    assert.deepEqual(checkManifest(e2e, { applicationId: ID }), [
      'pl.eviacharge.SCREENSHOTS_ALLOWED is in the manifest (screenshots allowed, FLAG_SECURE off — an e2e build)',
    ]);
    assert.equal(SCREENSHOTS_META, 'pl.eviacharge.SCREENSHOTS_ALLOWED');
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

/** The upload variant: the four permissions, the job service and the build-time configuration (EVM-130 AC7). */
const UPLOAD_PERMISSIONS = ['RUN_USER_INITIATED_JOBS', 'ACCESS_NETWORK_STATE', 'RECEIVE_BOOT_COMPLETED', 'POST_NOTIFICATIONS']
  .map((name) => `<uses-permission android:name="android.permission.${name}" />`)
  .join('');
const SERVICE_NAME = 'service pl.eviacharge.upload.UploadJobService';
const UPLOAD_SERVICE =
  '<service android:name="pl.eviacharge.upload.UploadJobService" android:exported="false" android:permission="android.permission.BIND_JOB_SERVICE" />';
const UPLOAD_META = `<meta-data android:name="${API_BASE_URL_META}" android:value="https://api.example.com" /><meta-data android:name="${STORAGE_HOSTS_META}" android:value="s3.example.com,files.example.org" />`;
/** @param {string} permissions @param {string} application */
const withUpload = (permissions, application) =>
  changed('</manifest>', `${permissions}</manifest>`).replace('</application>', `${application}</application>`);
/** @param {string} permissions @param {string} application */
const verdict = (permissions, application) => checkManifest(withUpload(permissions, application), { applicationId: ID });

describe('manifest of the package with the background upload (EVM-130 AC7; SR-MOB-07, SR-MOB-11)', () => {
  it('EVM-130 AC7: the four upload permissions, the job service with BIND_JOB_SERVICE and the https configuration pass', () => {
    assert.deepEqual(verdict(UPLOAD_PERMISSIONS, UPLOAD_SERVICE + UPLOAD_META), []);
  });

  it('EVM-130 AC7: a package with an additional permission is rejected (each of them separately)', () => {
    for (const name of ['CAMERA', 'RECORD_AUDIO', 'READ_PHONE_STATE', 'WAKE_LOCK', 'REQUEST_INSTALL_PACKAGES', 'SYSTEM_ALERT_WINDOW']) {
      const extra = `${UPLOAD_PERMISSIONS}<uses-permission android:name="android.permission.${name}" />`;
      assert.deepEqual(verdict(extra, UPLOAD_SERVICE + UPLOAD_META), [`unexpected permission android.permission.${name}`], name);
    }
  });

  it('EVM-130 AC7: foreground service permissions are forbidden by name', () => {
    for (const name of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_DATA_SYNC']) {
      const extra = `${UPLOAD_PERMISSIONS}<uses-permission android:name="android.permission.${name}" />`;
      assert.deepEqual(verdict(extra, UPLOAD_SERVICE + UPLOAD_META), [
        `forbidden permission android.permission.${name} (foreground service, ADR-0020a)`,
      ]);
    }
  });

  it('EVM-130 AC7: an exported component other than MainActivity is rejected, also an exported job service or an extra activity', () => {
    const exported = UPLOAD_SERVICE.replace('android:exported="false"', 'android:exported="true"');
    assert.deepEqual(verdict(UPLOAD_PERMISSIONS, exported + UPLOAD_META), [
      `${SERVICE_NAME} must have android:exported="false"`,
      'exported component pl.eviacharge.upload.UploadJobService',
    ]);
    const implicit = UPLOAD_SERVICE.replace(' android:exported="false"', '');
    assert.deepEqual(verdict(UPLOAD_PERMISSIONS, implicit + UPLOAD_META), [`${SERVICE_NAME} must have android:exported="false"`]);
    const activity = '<activity android:name="x.Second" android:exported="true" />';
    assert.deepEqual(verdict(UPLOAD_PERMISSIONS, UPLOAD_SERVICE + UPLOAD_META + activity), ['exported component x.Second']);
  });

  it('EVM-130 AC7: the job service is bound by the system only, not direct-boot aware, not in its own process, not a foreground service', () => {
    const lacks = `${SERVICE_NAME} lacks the permission android.permission.BIND_JOB_SERVICE`;
    const cases = /** @type {[string, string][]} */ ([
      [UPLOAD_SERVICE.replace(' android:permission="android.permission.BIND_JOB_SERVICE"', ''), lacks],
      [UPLOAD_SERVICE.replace('BIND_JOB_SERVICE', 'BIND_ACCESSIBILITY_SERVICE'), lacks],
      [UPLOAD_SERVICE.replace('/>', 'android:directBootAware="true" />'), `${SERVICE_NAME} is directBootAware`],
      [UPLOAD_SERVICE.replace('/>', 'android:process=":upload" />'), `${SERVICE_NAME} has android:process`],
      [UPLOAD_SERVICE.replace('/>', 'android:foregroundServiceType="dataSync" />'), `${SERVICE_NAME} is a foreground service`],
    ]);
    for (const [service, problem] of cases) {
      assert.deepEqual(verdict(UPLOAD_PERMISSIONS, service + UPLOAD_META), [problem], problem);
    }
  });

  it('EVM-130 AC7: no component listens for the boot broadcast (an own receiver is rejected even when not exported)', () => {
    const actions = [
      'android.intent.action.BOOT_COMPLETED',
      'android.intent.action.LOCKED_BOOT_COMPLETED',
      'android.intent.action.QUICKBOOT_POWERON',
    ];
    for (const action of actions) {
      const receiver = `<receiver android:name="x.Boot" android:exported="false"><intent-filter><action android:name="${action}" /></intent-filter></receiver>`;
      assert.deepEqual(verdict(UPLOAD_PERMISSIONS, UPLOAD_SERVICE + UPLOAD_META + receiver), [
        'x.Boot listens for the boot broadcast (no own boot receiver)',
      ]);
    }
  });

  it('EVM-130 AC7 (ADR-0020a): a release carrying the e2e switch (http and the scenario server host) is rejected', () => {
    const e2e = `<meta-data android:name="${UPLOAD_E2E_CLEARTEXT_META}" android:value="true" />`;
    assert.deepEqual(verdict(UPLOAD_PERMISSIONS, UPLOAD_SERVICE + UPLOAD_META + e2e), [
      'pl.eviacharge.UPLOAD_E2E_CLEARTEXT is in the manifest (http and the scenario server host allowed for the upload — an e2e build)',
    ]);
    assert.equal(UPLOAD_E2E_CLEARTEXT_META, 'pl.eviacharge.UPLOAD_E2E_CLEARTEXT');
  });

  it('EVM-130 AC7 (SR-MOB-11): the API address must be https and the storage hosts plain hostnames (no http, port, wildcard, loopback, IP)', () => {
    const check = (/** @type {string} */ api, /** @type {string} */ hosts) =>
      verdict(
        UPLOAD_PERMISSIONS,
        `${UPLOAD_SERVICE}<meta-data android:name="${API_BASE_URL_META}" android:value="${api}" /><meta-data android:name="${STORAGE_HOSTS_META}" android:value="${hosts}" />`,
      );
    for (const api of ['http://api.example.com', 'https://', 'ftp://api.example.com']) {
      assert.deepEqual(check(api, 's3.example.com'), [`${API_BASE_URL_META} is not an https address`], api);
    }
    const plain = `${STORAGE_HOSTS_META} holds something other than plain hostnames (https only)`;
    const bad = [
      'http://s3.example.com',
      '10.0.2.2',
      'localhost',
      '*.example.com',
      's3.example.com:9000',
      's3.example.com,10.0.2.2',
      '',
      's3.example.com,',
    ];
    for (const hosts of bad) {
      assert.deepEqual(check('https://api.example.com', hosts), [plain], hosts);
    }
    assert.deepEqual(check('https://api.example.com', 's3.example.com, files.example.org'), []);
  });

  it('EVM-130 AC7: a package with the job service must carry both build-time values', () => {
    const apiOnly = `<meta-data android:name="${API_BASE_URL_META}" android:value="https://api.example.com" />`;
    const hostsOnly = `<meta-data android:name="${STORAGE_HOSTS_META}" android:value="s3.example.com" />`;
    assert.deepEqual(verdict(UPLOAD_PERMISSIONS, UPLOAD_SERVICE + apiOnly), [
      `${STORAGE_HOSTS_META} is missing (the upload service needs the storage host of the build)`,
    ]);
    assert.deepEqual(verdict(UPLOAD_PERMISSIONS, UPLOAD_SERVICE + hostsOnly), [
      `${API_BASE_URL_META} is missing (the upload service needs the API address of the build)`,
    ]);
  });
});
