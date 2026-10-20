import {
  ANDROID_APPLICATION_ID,
  APP_VERSION,
  BLOCKED_ANDROID_PERMISSIONS,
  IOS_BUNDLE_IDENTIFIER,
  buildExpoConfig,
  resolveVersionCode,
} from '../plugins/expo-config';

const releaseEnv = { EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test' };

describe('Expo configuration of the build (EVM-009 AC3, AC5, AC6)', () => {
  it('EVM-009 AC3: version is a semver in the single source app.config.ts and feeds the update check', () => {
    expect(buildExpoConfig(releaseEnv).version).toBe(APP_VERSION);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('EVM-009 AC5: the application id is set once for both platforms and the Android versionCode comes from the CI run number', () => {
    const config = buildExpoConfig({ ...releaseEnv, EVIA_ANDROID_VERSION_CODE: '1042' });
    expect(config.android?.package).toBe(ANDROID_APPLICATION_ID);
    expect(config.ios?.bundleIdentifier).toBe(IOS_BUNDLE_IDENTIFIER);
    expect(config.android?.versionCode).toBe(1042);
    expect(buildExpoConfig(releaseEnv).android?.versionCode).toBe(1);
  });

  it.each(['0', '-1', '1.5', 'abc', '1e3', '9999999999', '2100000001'])('EVM-009 AC5: the version code %j is rejected', (value) => {
    expect(() => resolveVersionCode(value)).toThrow('EVIA_ANDROID_VERSION_CODE');
  });

  it('EVM-009 AC5: an empty or missing version code means 1', () => {
    expect(resolveVersionCode(undefined)).toBe(1);
    expect(resolveVersionCode('  ')).toBe(1);
    expect(resolveVersionCode(' 7 ')).toBe(7);
  });

  it('EVM-009 AC6: the app asks for no permission itself and blocks the risky defaults of the template', () => {
    const config = buildExpoConfig(releaseEnv);
    expect(config.android?.permissions).toEqual([]);
    expect(config.android?.blockedPermissions).toEqual([...BLOCKED_ANDROID_PERMISSIONS]);
    expect(BLOCKED_ANDROID_PERMISSIONS).toEqual(
      expect.arrayContaining([
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.VIBRATE',
      ]),
    );
  });

  it('EVM-009 AC6: no OTA updates, no dev client, no analytics SDK among the plugins (SR-MOB-09)', () => {
    const names = (buildExpoConfig(releaseEnv).plugins ?? []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
    expect(names).toEqual(['expo-secure-store', './plugins/with-hardening.ts']);
    expect(JSON.stringify(buildExpoConfig(releaseEnv))).not.toMatch(/expo-updates|expo-dev-client|sentry|analytics/i);
  });

  it('EVM-009 AC6: a release build without an https API address fails at build time', () => {
    expect(() => buildExpoConfig({})).toThrow(/missing/);
    expect(() => buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'http://api.example.test' })).toThrow(/insecure-host/);
    expect(() => buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'http://10.0.2.2:3000' })).toThrow(/release build/);
    expect(() => buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://user:secret@api.example.test' })).toThrow(/malformed/);
  });

  it('EVM-009 AC6: the error message never repeats the rejected address', () => {
    let message = '';
    try {
      buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://user:topsecret@api.example.test' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('topsecret');
  });

  it('EVM-009 AC6: plain HTTP to the emulator host is accepted only by an explicit e2e variant, which is recorded in the config', () => {
    const e2e = buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'http://10.0.2.2:3000', EVIA_BUILD_VARIANT: 'e2e' });
    expect(e2e.extra).toMatchObject({ buildVariant: 'e2e' });
    expect(e2e.plugins).toContainEqual(['./plugins/with-hardening.ts', { variant: 'e2e' }]);
    expect(() => buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'http://api.example.test', EVIA_BUILD_VARIANT: 'e2e' })).toThrow(/e2e build/);
    expect(buildExpoConfig(releaseEnv).extra).toMatchObject({ buildVariant: 'release' });
  });
});
