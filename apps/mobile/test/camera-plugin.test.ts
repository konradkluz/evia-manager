import { buildExpoConfig } from '../plugins/expo-config';
import withCamera, {
  applyCameraManifest,
  applyCameraProperties,
  CAMERA_GRADLE_PROPERTIES,
  ML_KIT_DEPENDENCIES_META,
} from '../plugins/with-camera';

type Property = { type: 'property'; key: string; value: string } | { type: 'comment'; value: string } | { type: 'empty' };
interface TestManifest {
  manifest: { $: Record<string, string>; 'uses-permission'?: { $: Record<string, string> }[]; application: Application[] };
}
interface Application {
  $: Record<string, string>;
  'meta-data'?: { $: Record<string, string> }[];
}

function manifest(): TestManifest {
  return {
    manifest: {
      $: {},
      'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }],
      application: [{ $: { 'android:name': '.MainApplication' }, 'meta-data': [{ $: { 'android:name': 'other', 'android:value': 'x' } }] }],
    },
  };
}
const apply = (base: TestManifest) => applyCameraManifest(base as unknown as Parameters<typeof applyCameraManifest>[0]);

describe('camera config plugin (EVM-108 AC8; SR-MOB-12, SR-SUPPLY-06, MASVS-PRIVACY-1)', () => {
  it('EVM-108 AC8: both Google scanners (codes and documents) are switched off at build time, as constants', () => {
    expect(CAMERA_GRADLE_PROPERTIES).toEqual([
      ['expo.camera.barcode-scanner-enabled', 'false'],
      ['expo.camera.document-scanner-enabled', 'false'],
    ]);
    const items = applyCameraProperties([
      { type: 'property', key: 'expo.camera.barcode-scanner-enabled', value: 'true' },
      { type: 'property', key: 'other', value: '1' },
    ] satisfies Property[]);
    const keys = items.filter((item) => item.type === 'property');
    expect(keys).toEqual([
      { type: 'property', key: 'other', value: '1' },
      { type: 'property', key: 'expo.camera.barcode-scanner-enabled', value: 'false' },
      { type: 'property', key: 'expo.camera.document-scanner-enabled', value: 'false' },
    ]);
  });

  it('EVM-108 AC8: the properties are idempotent and a second run gives the same list', () => {
    const once = applyCameraProperties([]);
    expect(applyCameraProperties(once)).toEqual(once);
    expect(once).toHaveLength(2);
  });

  it('EVM-108 AC8: the ML Kit meta-data of the library is removed from the merged manifest (tools:node="remove")', () => {
    const base = manifest();
    apply(base);
    expect(base.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
    expect(ML_KIT_DEPENDENCIES_META).toBe('com.google.mlkit.vision.DEPENDENCIES');
    expect(base.manifest.application[0]?.['meta-data']).toEqual([
      { $: { 'android:name': 'other', 'android:value': 'x' } },
      { $: { 'android:name': 'com.google.mlkit.vision.DEPENDENCIES', 'tools:node': 'remove' } },
    ]);
  });

  it('EVM-108 AC8: the plugin adds no permission (CAMERA comes from the library manifest, RECORD_AUDIO is never added)', () => {
    const base = manifest();
    apply(base);
    expect(base.manifest['uses-permission']).toEqual([{ $: { 'android:name': 'android.permission.INTERNET' } }]);
  });

  it('EVM-108 AC8: the manifest change is idempotent', () => {
    const base = manifest();
    apply(base);
    const first = JSON.stringify(base);
    apply(base);
    expect(JSON.stringify(base)).toBe(first);
  });

  it('EVM-108 AC8: a manifest without the application element fails the build (template changed)', () => {
    expect(() => apply({ manifest: { $: {}, application: [] } })).toThrow(/no application element/);
  });

  it('EVM-108 AC8: the plugin is a config plugin, takes no options and is not switched by the environment (fail closed)', () => {
    expect(typeof withCamera).toBe('function');
    expect(withCamera.length).toBeLessThanOrEqual(2);
    const env = process.env as Record<string, string | undefined>;
    const before = env['EXPO_CAMERA_BARCODE_SCANNER_ENABLED'];
    env['EXPO_CAMERA_BARCODE_SCANNER_ENABLED'] = 'true';
    try {
      expect(applyCameraProperties([])).toEqual(CAMERA_GRADLE_PROPERTIES.map(([key, value]) => ({ type: 'property', key, value })));
    } finally {
      if (before === undefined) delete env['EXPO_CAMERA_BARCODE_SCANNER_ENABLED'];
      else env['EXPO_CAMERA_BARCODE_SCANNER_ENABLED'] = before;
    }
  });

  it('EVM-108 AC8: the Expo config lists the own plugin and never the plugin of expo-camera (it would add RECORD_AUDIO)', () => {
    const plugins = buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test' }).plugins ?? [];
    const names = plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
    expect(names).toContain('./plugins/with-camera.ts');
    expect(names).not.toContain('expo-camera');
  });
});

describe('camera plugin registration (EVM-108 AC8)', () => {
  type Mod = (config: unknown) => Promise<{ modResults: unknown }>;

  it('EVM-108 AC8: the plugin registers one Gradle properties mod and one manifest mod that write the scanner switch and the removal', async () => {
    const result = withCamera({ name: 'x', slug: 'x' });
    const mods = (result as unknown as { mods: { android: Record<string, Mod> } }).mods.android;
    expect(Object.keys(mods).sort()).toEqual(['gradleProperties', 'manifest']);
    const properties = await mods['gradleProperties']?.({ modResults: [{ type: 'comment', value: 'x' }], modRequest: {}, mods: {} });
    expect(properties?.modResults).toEqual([
      { type: 'comment', value: 'x' },
      { type: 'property', key: 'expo.camera.barcode-scanner-enabled', value: 'false' },
      { type: 'property', key: 'expo.camera.document-scanner-enabled', value: 'false' },
    ]);
    const base = manifest();
    await mods['manifest']?.({ modResults: base, modRequest: {}, mods: {} });
    expect(base.manifest.application[0]?.['meta-data']?.at(-1)?.$['tools:node']).toBe('remove');
  });

  it('EVM-108 AC8: an application without meta-data gets only the removal', () => {
    const base: TestManifest = { manifest: { $: {}, application: [{ $: {} }] } };
    apply(base);
    expect(base.manifest.application[0]?.['meta-data']).toEqual([
      { $: { 'android:name': ML_KIT_DEPENDENCIES_META, 'tools:node': 'remove' } },
    ]);
  });
});

describe('camera library built from source (EVM-108 AC8)', () => {
  it('EVM-108 AC8: expo-camera is built from source, otherwise the prebuilt publication brings ML Kit and Play services whatever the Gradle properties say', () => {
    const { readFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
    const { join } = jest.requireActual<typeof import('node:path')>('node:path');
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
      expo?: { autolinking?: { android?: { buildFromSource?: string[] } } };
    };
    expect(manifest.expo?.autolinking?.android?.buildFromSource).toEqual(['expo-camera']);
  });
});
