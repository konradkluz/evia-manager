import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExpoConfig } from '../plugins/expo-config';
import withUpload, {
  API_BASE_URL_META,
  applyUploadManifest,
  BIND_JOB_SERVICE,
  parseStorageHosts,
  STORAGE_HOSTS_META,
  UPLOAD_E2E_CLEARTEXT_META,
  UPLOAD_PERMISSIONS,
  UPLOAD_SERVICE,
} from '../plugins/with-upload';

type Element = { $: Record<string, string> };
interface TestManifest {
  manifest: { $: Record<string, string>; 'uses-permission'?: Element[]; application: Application[] };
}
interface Application {
  $: Record<string, string>;
  service?: Element[];
  'meta-data'?: Element[];
  activity?: Element[];
}

const API = 'https://api.example.test';
const HOSTS = 'store.example.test,files.example.test';

function manifest(): TestManifest {
  return {
    manifest: {
      $: {},
      'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }],
      application: [{ $: { 'android:name': '.MainApplication' }, activity: [{ $: { 'android:name': '.MainActivity' } }] }],
    },
  };
}

function applied(variant: 'release' | 'e2e', storageHosts: string | null, apiBaseUrl = API, base: TestManifest = manifest()) {
  applyUploadManifest(base as unknown as Parameters<typeof applyUploadManifest>[0], { variant, apiBaseUrl, storageHosts });
  const application = base.manifest.application[0];
  const metas = new Map((application?.['meta-data'] ?? []).map((item) => [item.$['android:name'], item.$['android:value']]));
  return { base, application, metas, permissions: (base.manifest['uses-permission'] ?? []).map((item) => item.$['android:name']) };
}

describe('upload config plugin (EVM-130 AC7; SR-MOB-07, SR-MOB-11)', () => {
  it('EVM-130 AC7: the release manifest gets the four permissions, the job service and the build configuration - and no e2e switch', () => {
    const { application, metas, permissions } = applied('release', HOSTS);
    expect(permissions).toEqual(['android.permission.INTERNET', ...UPLOAD_PERMISSIONS]);
    expect(UPLOAD_PERMISSIONS).toEqual([
      'android.permission.RUN_USER_INITIATED_JOBS',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.POST_NOTIFICATIONS',
    ]);
    expect(metas.get(API_BASE_URL_META)).toBe(API);
    expect(metas.get(STORAGE_HOSTS_META)).toBe(HOSTS);
    expect(metas.has(UPLOAD_E2E_CLEARTEXT_META)).toBe(false);
    expect(application?.service).toEqual([
      { $: { 'android:name': UPLOAD_SERVICE, 'android:exported': 'false', 'android:permission': BIND_JOB_SERVICE } },
    ]);
  });

  it('EVM-130 AC7: the job service is never direct-boot aware, never in its own process and never a foreground service; the manifest has no boot receiver', () => {
    const { application } = applied('e2e', '10.0.2.2:3000', 'http://10.0.2.2:3000');
    const service = application?.service?.[0]?.$ ?? {};
    expect(Object.keys(service).sort()).toEqual(['android:exported', 'android:name', 'android:permission']);
    expect(JSON.stringify(application)).not.toMatch(/directBootAware|android:process|foregroundServiceType|BOOT_COMPLETED|receiver/);
    expect(UPLOAD_PERMISSIONS.some((permission) => /FOREGROUND_SERVICE/.test(permission))).toBe(false);
  });

  it('EVM-130 AC7: only the e2e variant carries the switch that allows http and the scenario server host', () => {
    const e2e = applied('e2e', '10.0.2.2:3000', 'http://10.0.2.2:3000');
    expect(e2e.metas.get(UPLOAD_E2E_CLEARTEXT_META)).toBe('true');
    expect(e2e.metas.get(API_BASE_URL_META)).toBe('http://10.0.2.2:3000');
    expect(e2e.metas.get(STORAGE_HOSTS_META)).toBe('10.0.2.2:3000');
    expect(applied('release', HOSTS).metas.has(UPLOAD_E2E_CLEARTEXT_META)).toBe(false);
  });

  it('EVM-130 AC7: a release without storage hosts carries NO upload - no service, no permission, no configuration, never an empty value (fail closed)', () => {
    const { application, metas, permissions } = applied('release', null);
    expect(permissions).toEqual(['android.permission.INTERNET']);
    expect(application?.service).toEqual([]);
    expect([...metas.keys()]).toEqual([]);
    expect(JSON.stringify(application)).not.toContain('UploadJobService');
  });

  it('EVM-130 AC7: a run again replaces the upload part instead of duplicating it, and removes it when the hosts are gone', () => {
    const once = applied('e2e', '10.0.2.2:3000', 'http://10.0.2.2:3000').base;
    const twice = applied('e2e', '10.0.2.2:3000', 'http://10.0.2.2:3000', once).base;
    expect(twice.manifest['uses-permission']).toHaveLength(1 + UPLOAD_PERMISSIONS.length);
    expect(twice.manifest.application[0]?.service).toHaveLength(1);
    expect(twice.manifest.application[0]?.['meta-data']).toHaveLength(3);
    const released = applied('release', null, API, twice);
    expect(released.permissions).toEqual(['android.permission.INTERNET']);
    expect([...released.metas.keys()]).toEqual([]);
  });

  it('EVM-130 AC7: other meta-data, services and permissions of the manifest are kept', () => {
    const base = manifest();
    base.manifest['uses-permission']?.push({ $: { 'android:name': 'android.permission.ACCESS_NETWORK_STATE' } });
    const app = base.manifest.application[0];
    if (app === undefined) throw new Error('fixture');
    app.service = [{ $: { 'android:name': 'other.Service' } }];
    app['meta-data'] = [{ $: { 'android:name': 'other', 'android:value': 'x' } }];
    const { application, permissions, metas } = applied('release', HOSTS, API, base);
    expect(application?.service?.map((item) => item.$['android:name'])).toEqual(['other.Service', UPLOAD_SERVICE]);
    expect(metas.get('other')).toBe('x');
    expect(permissions.filter((name) => name === 'android.permission.ACCESS_NETWORK_STATE')).toHaveLength(1);
  });

  it('EVM-130 AC7: a manifest without an application element fails the build', () => {
    const empty = { manifest: { $: {} } } as unknown as Parameters<typeof applyUploadManifest>[0];
    expect(() => applyUploadManifest(empty, { variant: 'release', apiBaseUrl: API, storageHosts: HOSTS })).toThrow(
      /no application element/,
    );
  });

  it('EVM-130 AC7: the plugin registers one manifest mod that writes the upload part', async () => {
    const result = withUpload({ name: 'x', slug: 'x' }, { variant: 'release', apiBaseUrl: API, storageHosts: HOSTS });
    const mods = (result as unknown as { mods: { android: Record<string, (config: unknown) => Promise<unknown>> } }).mods.android;
    expect(Object.keys(mods)).toEqual(['manifest']);
    const base = manifest();
    await mods['manifest']?.({ modResults: base, modRequest: {}, mods: {} });
    expect(base.manifest.application[0]?.service).toHaveLength(1);
  });

  it('EVM-130 AC7: the names of the meta-data and of the service are the ones tools/mobile-apk verify checks', () => {
    const source = readFileSync(join(__dirname, '..', '..', '..', 'tools', 'mobile-apk', 'src', 'manifest.mjs'), 'utf8');
    expect(source).toContain(`export const API_BASE_URL_META = '${API_BASE_URL_META}';`);
    expect(source).toContain(`export const STORAGE_HOSTS_META = '${STORAGE_HOSTS_META}';`);
    expect(source).toContain(`export const UPLOAD_E2E_CLEARTEXT_META = '${UPLOAD_E2E_CLEARTEXT_META}';`);
    expect(source).toContain(`const UPLOAD_SERVICE_SUFFIX = '.${UPLOAD_SERVICE.split('.').at(-1) ?? ''}';`);
    expect(source).toContain(`const BIND_JOB_SERVICE = '${BIND_JOB_SERVICE}';`);
    for (const permission of UPLOAD_PERMISSIONS) expect(source).toContain(`'${permission}'`);
  });
});

describe('storage hosts of the build (EVM-130 AC7)', () => {
  it('EVM-130 AC7: a release accepts plain host names, normalises them and removes duplicates', () => {
    expect(parseStorageHosts(' Store.Example.test , files.example.test,store.example.test ', 'release', 'api.example.test')).toBe(
      'store.example.test,files.example.test',
    );
  });

  it('EVM-130 AC7: a release without the variable has no upload (null); an empty value is the same', () => {
    expect(parseStorageHosts(undefined, 'release', 'api.example.test')).toBeNull();
    expect(parseStorageHosts('  ', 'release', 'api.example.test')).toBeNull();
  });

  it.each([
    'https://store.example.test',
    'store.example.test:8443',
    'store.example.test/path',
    '*.example.test',
    'localhost',
    '10.0.2.2',
    '10.0.2.2:3000',
    'store',
    'a b.example.test',
    'store.example.test,',
  ])('EVM-130 AC7: the release build fails on the host list %j, and the message does not repeat it', (value) => {
    let message = '';
    try {
      parseStorageHosts(value, 'release', 'api.example.test');
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toMatch(/EVIA_STORAGE_HOSTS is not allowed in the release build/);
    expect(message).not.toContain(value);
  });

  it('EVM-130 AC7: the e2e variant takes the emulator host with a port, and the authority of its API address when nothing is set', () => {
    expect(parseStorageHosts('10.0.2.2:3000,localhost:9000', 'e2e', '10.0.2.2:3000')).toBe('10.0.2.2:3000,localhost:9000');
    expect(parseStorageHosts(undefined, 'e2e', '10.0.2.2:3000')).toBe('10.0.2.2:3000');
    expect(() => parseStorageHosts('evil.example.test:99999999', 'e2e', '10.0.2.2:3000')).toThrow(/e2e build/);
    expect(() => parseStorageHosts('http://10.0.2.2:3000', 'e2e', '10.0.2.2:3000')).toThrow(/emulator host/);
  });

  it('EVM-130 AC7: the app configuration passes the API address and the hosts to the plugin, from the same source as the app address', () => {
    const release = buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://API.example.test/', EVIA_STORAGE_HOSTS: HOSTS });
    expect(release.plugins).toContainEqual([
      './plugins/with-upload.ts',
      { variant: 'release', apiBaseUrl: 'https://api.example.test', storageHosts: HOSTS },
    ]);
    const bare = buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test' });
    expect(bare.plugins).toContainEqual([
      './plugins/with-upload.ts',
      { variant: 'release', apiBaseUrl: 'https://api.example.test', storageHosts: null },
    ]);
    const e2e = buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'http://10.0.2.2:3000', EVIA_BUILD_VARIANT: 'e2e' });
    expect(e2e.plugins).toContainEqual([
      './plugins/with-upload.ts',
      { variant: 'e2e', apiBaseUrl: 'http://10.0.2.2:3000', storageHosts: '10.0.2.2:3000' },
    ]);
  });

  it('EVM-130 AC7: an API address with a path cannot carry the upload (the client builds /api/v1 itself); without hosts it is not a problem', () => {
    expect(() => buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test/api', EVIA_STORAGE_HOSTS: HOSTS })).toThrow(
      /with a path is not supported/,
    );
    expect(() => buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test/api' })).not.toThrow();
  });

  it('EVM-130 AC7: the hosts are not a public variable - the bundle never sees them, and the app still asks for no permission itself', () => {
    const config = buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test', EVIA_STORAGE_HOSTS: HOSTS });
    expect(config.android?.permissions).toEqual([]);
    expect(() => buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test', EXPO_PUBLIC_EVIA_STORAGE_HOSTS: HOSTS })).toThrow(
      /not allowed/,
    );
  });
});
