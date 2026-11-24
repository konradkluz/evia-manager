import { buildExpoConfig } from '../plugins/expo-config';
import withVideo, { applyVideoManifest, FULLSCREEN_ACTIVITY, WAKE_LOCK_PERMISSION } from '../plugins/with-video';

type Element = { $: Record<string, string> };
interface TestManifest {
  manifest: {
    $: Record<string, string>;
    'uses-permission'?: Element[];
    application: { $: Record<string, string>; activity?: Element[] }[];
  };
}
const manifest = (): TestManifest => ({
  manifest: { $: {}, application: [{ $: {}, activity: [{ $: { 'android:name': '.MainActivity' } }] }] },
});
const apply = (base: TestManifest) => applyVideoManifest(base);

describe('film player config plugin (EVM-143 AC2, AC6; SR-MOB-14, MASVS-PLATFORM-3)', () => {
  it('EVM-143 AC2: the fullscreen activity of the library is removed from the merged manifest, the main activity stays', () => {
    const base = manifest();
    apply(base);
    expect(base.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
    expect(base.manifest.application[0]?.activity).toEqual([
      { $: { 'android:name': '.MainActivity' } },
      { $: { 'android:name': FULLSCREEN_ACTIVITY, 'tools:node': 'remove' } },
    ]);
    expect(FULLSCREEN_ACTIVITY).toBe('expo.modules.video.FullscreenPlayerActivity');
  });

  it('EVM-143 AC6: the wake lock permission that the player library declares is removed (the list of permissions of the app does not change), other permissions stay', () => {
    const base = manifest();
    base.manifest['uses-permission'] = [
      { $: { 'android:name': 'android.permission.INTERNET' } },
      { $: { 'android:name': WAKE_LOCK_PERMISSION } },
    ];
    apply(base);
    expect(base.manifest['uses-permission']).toEqual([
      { $: { 'android:name': 'android.permission.INTERNET' } },
      { $: { 'android:name': 'android.permission.WAKE_LOCK', 'tools:node': 'remove' } },
    ]);
    apply(base);
    expect(base.manifest['uses-permission']).toHaveLength(2);
    const bare = manifest();
    apply(bare);
    expect(bare.manifest['uses-permission']).toEqual([{ $: { 'android:name': 'android.permission.WAKE_LOCK', 'tools:node': 'remove' } }]);
  });

  it('EVM-143 AC2: a second run gives the same manifest and a manifest without activities works', () => {
    const base = manifest();
    apply(base);
    const once = JSON.stringify(base);
    apply(base);
    expect(JSON.stringify(base)).toBe(once);
    const bare: TestManifest = { manifest: { $: {}, application: [{ $: {} }] } };
    apply(bare);
    expect(bare.manifest.application[0]?.activity).toHaveLength(1);
  });

  it('EVM-143 AC2: a manifest without an application element is a build error', () => {
    expect(() => apply({ manifest: { $: {}, application: [] } })).toThrow(/no application element/);
  });

  it('EVM-143 AC6: the plugin is listed; the plugin of the library (background playback, picture in picture) is not', () => {
    const plugins = buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test' }).plugins ?? [];
    const names = plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
    expect(names).toContain('./plugins/with-video.ts');
    expect(names).not.toContain('expo-video');
  });

  it('EVM-143 AC2: the plugin registers one manifest mod that writes the removal', async () => {
    type Mod = (config: unknown) => Promise<{ modResults: unknown }>;
    const result = withVideo({ name: 'x', slug: 'x' });
    const mods = (result as unknown as { mods: { android: Record<string, Mod> } }).mods.android;
    expect(Object.keys(mods)).toEqual(['manifest']);
    const base = manifest();
    await mods['manifest']?.({ modResults: base, modRequest: {}, mods: {} });
    expect(base.manifest.application[0]?.activity?.at(-1)?.$['tools:node']).toBe('remove');
  });
});
