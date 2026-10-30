import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import withHardening, {
  backupRulesXml,
  dataExtractionRulesXml,
  GRADLE_DISTRIBUTION_SHA256,
  GRADLE_DISTRIBUTION_URL,
  networkSecurityConfigXml,
  SCREENSHOTS_RESOURCE,
  screenshotsAllowedXml,
  withE2eDebuggable,
  withGradleDistributionChecksum,
  withoutReleaseDebugSigning,
  withSecureWindow,
} from '../plugins/with-hardening';

const TEMPLATE_GRADLE = `android {
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }
}`;

const TEMPLATE_WRAPPER = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=${GRADLE_DISTRIBUTION_URL}
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;

type Mod = (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
type ModTree = { android?: Record<string, Mod> };

function plugged(variant: 'release' | 'e2e') {
  const result = withHardening({ name: 'x', slug: 'x' }, { variant });
  return (result as unknown as { mods: ModTree }).mods.android ?? {};
}

describe('Android hardening plugin (EVM-009 AC6; SR-MOB-02, SR-COMM-04, SR-MOB-11)', () => {
  it('EVM-009 AC6: data extraction rules and backup rules exclude every domain from cloud backup and device transfer', () => {
    const rules = dataExtractionRulesXml();
    expect(rules).toContain('<cloud-backup>');
    expect(rules).toContain('<device-transfer>');
    for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
      expect(rules.match(new RegExp(`<exclude domain="${domain}" />`, 'g'))).toHaveLength(2);
      expect(backupRulesXml()).toContain(`<exclude domain="${domain}" />`);
    }
    expect(rules).not.toContain('<include');
  });

  it('EVM-009 AC6: the release network security config forbids plain HTTP and trusts only the system store (no user CA)', () => {
    const xml = networkSecurityConfigXml('release');
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false">');
    expect(xml).toContain('<certificates src="system" />');
    expect(xml).not.toContain('src="user"');
    expect(xml).not.toContain('cleartextTrafficPermitted="true"');
    expect(xml).not.toContain('domain-config');
  });

  it('EVM-009 AC6: the e2e variant allows plain HTTP only for the emulator host names and still trusts the system store only', () => {
    const xml = networkSecurityConfigXml('e2e');
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false">');
    expect(xml).not.toContain('src="user"');
    const permitted = /<domain-config cleartextTrafficPermitted="true">([\s\S]*?)<\/domain-config>/.exec(xml)?.[1] ?? '';
    expect([...permitted.matchAll(/>([^<]+)<\/domain>/g)].map((match) => match[1])).toEqual(['10.0.2.2', 'localhost', '127.0.0.1']);
  });

  it('EVM-009 AC5: the release build type loses the debug signature, so the APK is unsigned until the owner signs it locally', () => {
    const patched = withoutReleaseDebugSigning(TEMPLATE_GRADLE);
    const release = patched.slice(patched.indexOf('release {'));
    expect(release).not.toContain('signingConfig');
    expect(patched.slice(0, patched.indexOf('release {'))).toContain('signingConfig signingConfigs.debug');
    expect(release).toContain('minifyEnabled true');
  });

  it('EVM-009 AC5: a changed template (no release signing line) fails the build instead of shipping a debug-signed APK', () => {
    expect(() => withoutReleaseDebugSigning('android { buildTypes { release { minifyEnabled true } } }')).toThrow('template changed');
  });

  it('EVM-009 AC6: the checksum of the Gradle distribution is pinned right after its URL, once, and the rest of the file is kept', () => {
    expect(GRADLE_DISTRIBUTION_SHA256).toMatch(/^[0-9a-f]{64}$/);
    const patched = withGradleDistributionChecksum(TEMPLATE_WRAPPER);
    const lines = patched.split('\n');
    const at = lines.indexOf(`distributionUrl=${GRADLE_DISTRIBUTION_URL}`);
    expect(lines[at + 1]).toBe(`distributionSha256Sum=${GRADLE_DISTRIBUTION_SHA256}`);
    expect(patched).toContain('validateDistributionUrl=true');
    // idempotent, also for a stale checksum and Windows line ends
    expect(withGradleDistributionChecksum(patched)).toBe(patched);
    expect(withGradleDistributionChecksum(TEMPLATE_WRAPPER.replace('networkTimeout', 'distributionSha256Sum=old\r\nnetworkTimeout'))).toBe(
      patched,
    );
  });

  it('EVM-009 AC6: another Gradle version in the template fails the build until the checksum is updated', () => {
    expect(() => withGradleDistributionChecksum(TEMPLATE_WRAPPER.replace('9.4.1', '9.5.0'))).toThrow('template changed');
  });

  it('EVM-009 AC6: the resource mod fails when the template has no gradle-wrapper.properties', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evia-plugin-'));
    try {
      await expect(plugged('e2e')['dangerous']?.({ modResults: {}, modRequest: { platformProjectRoot: root }, mods: {} })).rejects.toThrow(
        'gradle-wrapper.properties was not found',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('EVM-009 AC6: the resource mod pins the checksum of the Gradle distribution in the project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evia-plugin-'));
    try {
      mkdirSync(join(root, 'gradle', 'wrapper'), { recursive: true });
      const file = join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties');
      writeFileSync(file, TEMPLATE_WRAPPER);
      await plugged('release')['dangerous']?.({ modResults: {}, modRequest: { platformProjectRoot: root }, mods: {} });
      expect(readFileSync(file, 'utf8')).toBe(withGradleDistributionChecksum(TEMPLATE_WRAPPER));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('EVM-009 AC6, EVM-100 AC1: the plugin registers the manifest, resource, Gradle properties, build script and MainActivity mods', () => {
    const mods = ['appBuildGradle', 'dangerous', 'gradleProperties', 'mainActivity', 'manifest'];
    expect(Object.keys(plugged('release')).sort()).toEqual(mods);
    expect(Object.keys(plugged('e2e')).sort()).toEqual(mods);
  });

  const TEMPLATE_ACTIVITY = `class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }
}`;

  it('EVM-100 AC1 (decision 5, SR-MOB-08): FLAG_SECURE is set on the whole window BEFORE super.onCreate, fail closed, in every variant', async () => {
    for (const variant of ['release', 'e2e'] as const) {
      const result = (await plugged(variant)['mainActivity']?.({
        modResults: { contents: TEMPLATE_ACTIVITY, language: 'kt' },
        modRequest: {},
        mods: {},
      })) as { modResults: { contents: string } };
      const code = result.modResults.contents;
      const flag = code.indexOf('window.setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE');
      expect(flag).toBeGreaterThan(code.indexOf('setTheme'));
      expect(flag).toBeLessThan(code.indexOf('super.onCreate('));
      // the flag is turned off ONLY by a resource that exists and is true; no resource (0) keeps it
      expect(code).toContain('resources.getIdentifier("evia_screenshots_allowed", "bool", packageName)');
      expect(code).toContain('if (eviaScreenshots == 0 || !resources.getBoolean(eviaScreenshots)) window.setFlags(');
      expect(code).toMatch(/\n {4}val eviaScreenshots/);
      expect(withSecureWindow(code)).toBe(code);
    }
  });

  it('EVM-100 AC1: a MainActivity without super.onCreate or not in Kotlin fails the build instead of shipping a window without the flag', async () => {
    expect(() => withSecureWindow('class MainActivity {}')).toThrow(/super\.onCreate/);
    await expect(
      plugged('release')['mainActivity']?.({ modResults: { contents: TEMPLATE_ACTIVITY, language: 'java' }, modRequest: {}, mods: {} }),
    ).rejects.toThrow(/not Kotlin/);
  });

  it('EVM-100 AC1: only the e2e variant writes the resource that allows screenshots (kept from the shrinker); release removes it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evia-hardening-'));
    try {
      mkdirSync(join(root, 'gradle', 'wrapper'), { recursive: true });
      writeFileSync(join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties'), TEMPLATE_WRAPPER);
      const file = join(root, 'app', 'src', 'main', 'res', 'values', 'evia_screenshots.xml');
      await plugged('e2e')['dangerous']?.({ modResults: {}, modRequest: { platformProjectRoot: root }, mods: {} });
      expect(readFileSync(file, 'utf8')).toBe(screenshotsAllowedXml());
      expect(screenshotsAllowedXml()).toContain('<bool name="evia_screenshots_allowed">true</bool>');
      expect(screenshotsAllowedXml()).toContain('tools:keep="@bool/evia_screenshots_allowed"');
      await plugged('release')['dangerous']?.({ modResults: {}, modRequest: { platformProjectRoot: root }, mods: {} });
      expect(existsSync(file)).toBe(false);
      expect(SCREENSHOTS_RESOURCE).toBe('evia_screenshots_allowed');
      expect(readFileSync(join(__dirname, '..', '..', '..', 'tools', 'mobile-apk', 'src', 'verify.mjs'), 'utf8')).toContain(
        "export const SCREENSHOTS_RESOURCE = 'evia_screenshots_allowed';",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  async function patchedGradle(variant: 'release' | 'e2e'): Promise<string> {
    const mod = plugged(variant)['appBuildGradle'];
    const result = (await mod?.({ modResults: { contents: TEMPLATE_GRADLE }, modRequest: {}, mods: {} })) as {
      modResults: { contents: string };
    };
    return result.modResults.contents;
  }

  it('EVM-093 AC1: only the e2e variant is debuggable (run-as on the emulator); the release build script has no debuggable line', async () => {
    const e2e = await patchedGradle('e2e');
    expect(e2e).toMatch(/release \{\n\s*debuggable true\n/);
    expect(e2e.match(/debuggable/g)).toHaveLength(1);
    // the e2e APK keeps the debug signature: it can never be installed over a release-signed app on a field phone
    expect(e2e).toMatch(/release \{[^}]*signingConfig signingConfigs\.debug/);
    const release = await patchedGradle('release');
    expect(release).not.toContain('debuggable');
    expect(release).not.toMatch(/release \{[^}]*signingConfig/);
  });

  it('EVM-093 AC1: a template without a release build type fails the e2e build instead of producing a non-debuggable APK', () => {
    expect(() => withE2eDebuggable('android { buildTypes { debug { } } }')).toThrow(/release build type/);
  });

  it('EVM-093 AC4: the e2e manifest keeps the backup attributes of release (allowBackup=false and the same exclusion rules)', async () => {
    const attributesOf = async (variant: 'release' | 'e2e') => {
      const manifest = { manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' }, activity: [] }] } };
      const result = (await plugged(variant)['manifest']?.({ modResults: manifest, modRequest: {}, mods: {} })) as {
        modResults: typeof manifest;
      };
      return result.modResults.manifest.application[0]?.$ as Record<string, string>;
    };
    const release = await attributesOf('release');
    const e2e = await attributesOf('e2e');
    for (const name of ['android:allowBackup', 'android:dataExtractionRules', 'android:fullBackupContent'])
      expect(e2e[name]).toBe(release[name]);
    expect(e2e['android:allowBackup']).toBe('false');
    expect(e2e['android:debuggable']).toBeUndefined();
    expect(release['android:debuggable']).toBeUndefined();
  });

  it('EVM-009 AC6: the manifest mod disables backup, points to the rules and forbids cleartext in the manifest itself', async () => {
    const manifest = { manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' }, activity: [] }] } };
    const mod = plugged('release')['manifest'];
    const result = (await mod?.({ modResults: manifest, modRequest: {}, mods: {} })) as { modResults: typeof manifest };
    const attributes = result.modResults.manifest.application[0]?.$ as Record<string, string>;
    expect(attributes['android:allowBackup']).toBe('false');
    expect(attributes['android:usesCleartextTraffic']).toBe('false');
    expect(attributes['android:dataExtractionRules']).toBe('@xml/evia_data_extraction_rules');
    expect(attributes['android:fullBackupContent']).toBe('@xml/evia_backup_rules');
    expect(attributes['android:networkSecurityConfig']).toBe('@xml/evia_network_security_config');
  });

  it('EVM-009 AC6: the manifest mod removes the exported AndroidX profile installer receiver (only MainActivity stays exported; SR-MOB-07)', async () => {
    const manifest = {
      manifest: {
        $: {},
        application: [{ $: { 'android:name': '.MainApplication' }, receiver: [{ $: { 'android:name': 'other.Receiver' } }] }],
      },
    };
    const mod = plugged('release')['manifest'];
    const result = (await mod?.({ modResults: manifest, modRequest: {}, mods: {} })) as { modResults: typeof manifest };
    const receivers = (result.modResults.manifest.application[0] as { receiver: { $: Record<string, string> }[] }).receiver;
    expect(receivers.at(-1)?.$).toEqual({ 'android:name': 'androidx.profileinstaller.ProfileInstallReceiver', 'tools:node': 'remove' });
    expect(receivers[0]?.$['android:name']).toBe('other.Receiver');
    expect((result.modResults.manifest as { $: Record<string, string> }).$['xmlns:tools']).toBe('http://schemas.android.com/tools');
  });

  it('EVM-009 AC6: the resource mod writes the three XML files into res/xml of the app module', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evia-plugin-'));
    try {
      mkdirSync(join(root, 'gradle', 'wrapper'), { recursive: true });
      writeFileSync(join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties'), TEMPLATE_WRAPPER);
      await plugged('e2e')['dangerous']?.({ modResults: {}, modRequest: { platformProjectRoot: root }, mods: {} });
      const directory = join(root, 'app', 'src', 'main', 'res', 'xml');
      expect(readFileSync(join(directory, 'evia_network_security_config.xml'), 'utf8')).toBe(networkSecurityConfigXml('e2e'));
      expect(readFileSync(join(directory, 'evia_data_extraction_rules.xml'), 'utf8')).toBe(dataExtractionRulesXml());
      expect(readFileSync(join(directory, 'evia_backup_rules.xml'), 'utf8')).toBe(backupRulesXml());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('EVM-009 AC6: the Gradle properties mod turns R8 minification and resource shrinking on without duplicating keys', async () => {
    const properties = [
      { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'false' },
      { type: 'property', key: 'other', value: '1' },
    ];
    const result = (await plugged('release')['gradleProperties']?.({ modResults: properties, modRequest: {}, mods: {} })) as {
      modResults: typeof properties;
    };
    const byKey = Object.fromEntries(result.modResults.map((item) => [item.key, item.value]));
    expect(byKey).toEqual({
      other: '1',
      'android.enableMinifyInReleaseBuilds': 'true',
      'android.enableShrinkResourcesInReleaseBuilds': 'true',
    });
    expect(result.modResults.filter((item) => item.key === 'android.enableMinifyInReleaseBuilds')).toHaveLength(1);
  });

  it('EVM-009 AC5: the build script mod patches app/build.gradle of the release variant', async () => {
    const result = (await plugged('release')['appBuildGradle']?.({
      modResults: { contents: TEMPLATE_GRADLE },
      modRequest: {},
      mods: {},
    })) as {
      modResults: { contents: string };
    };
    expect(result.modResults.contents).not.toMatch(/release \{[^}]*signingConfig/);
  });
});
