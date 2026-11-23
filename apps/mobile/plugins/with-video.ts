/**
 * Config plugin of the film player (EVM-143 AC2, AC6; SR-MOB-14, MASVS-PLATFORM-3):
 * - removes `expo.modules.video.FullscreenPlayerActivity` (`tools:node="remove"`): the library declares it with `supportsPictureInPicture="true"` and it
 *   would open a separate window that skips the lock overlay and FLAG_SECURE of the main window. The screen of the app never asks for it
 *   (`allowsFullscreen={false}`, `allowsPictureInPicture={false}`), the removal makes a crash of a stray call (`ActivityNotFoundException`) the worst outcome;
 * - the `expo-video` plugin of the library is NOT listed: only it would add the background playback service and the foreground service permissions.
 * The activity comes from the AAR, so only the merged manifest of the built package shows it (`tools/mobile-apk verify` asserts it is gone).
 */
import { withAndroidManifest } from 'expo/config-plugins';
import type { ConfigPlugin } from 'expo/config-plugins';

export const FULLSCREEN_ACTIVITY = 'expo.modules.video.FullscreenPlayerActivity';

interface Element {
  $: Record<string, string>;
}
interface Manifest {
  manifest: { $: Record<string, string>; application?: ({ $: Record<string, string>; activity?: Element[] } & Record<string, unknown>)[] };
}

/** Adds the removal marker for the fullscreen activity. Idempotent. */
export function applyVideoManifest(modResults: Manifest): Manifest {
  const application = modResults.manifest.application?.[0];
  if (application === undefined) throw new Error('with-video: the manifest has no application element (template changed)');
  modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  application.activity = [
    ...(application.activity ?? []).filter((item) => item.$['android:name'] !== FULLSCREEN_ACTIVITY),
    { $: { 'android:name': FULLSCREEN_ACTIVITY, 'tools:node': 'remove' } },
  ];
  return modResults;
}

const withVideo: ConfigPlugin = (config) =>
  withAndroidManifest(config, (modConfig) => {
    applyVideoManifest(modConfig.modResults as unknown as Manifest);
    return modConfig;
  });

export default withVideo;
