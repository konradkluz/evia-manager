/**
 * Config plugin of the camera library (EVM-108 AC8; SR-MOB-12, SR-SUPPLY-06, MASVS-PRIVACY-1). The plugin of `expo-camera` itself is NOT
 * used: it adds `RECORD_AUDIO` (the app never uses the microphone: EVM-110 films are muted) and has no switch for the document scanner.
 * - `expo-camera` ships TWO Google scanners: of codes (`expo.camera.barcode-scanner-enabled`) and of documents
 *   (`expo.camera.document-scanner-enabled`). Each, left on (the default), pulls ML Kit and Google Play services (`com.google.mlkit`,
 *   `com.google.android.gms`, with their telemetry) into the package. Both are set to `false` here, as constants and not from the
 *   environment (fail closed): the libraries become `compileOnly`, so they are NOT in the package at all. This is a removal at build time,
 *   not a switch at run time;
 * - the manifest of the library carries `com.google.mlkit.vision.DEPENDENCIES`; the entry is removed from the merged manifest
 *   (`tools:node="remove"`);
 * - no permission is added here: `CAMERA` comes from the manifest of the library during the merge (the app does not block it), the
 *   microphone, location and storage permissions stay blocked (plugins/expo-config.ts, tools/mobile-apk verify).
 * Checked statically in the built package (`tools/mobile-apk verify`) and in the Gradle tree (`tools/mobile-apk deps`).
 */
import { withAndroidManifest, withGradleProperties } from 'expo/config-plugins';
import type { ConfigPlugin } from 'expo/config-plugins';

export const ML_KIT_DEPENDENCIES_META = 'com.google.mlkit.vision.DEPENDENCIES';
/** Gradle properties read by `expo-camera/android/build.gradle`; `false` turns the dependency into `compileOnly`. */
export const CAMERA_GRADLE_PROPERTIES: readonly (readonly [string, string])[] = [
  ['expo.camera.barcode-scanner-enabled', 'false'],
  ['expo.camera.document-scanner-enabled', 'false'],
];

interface Property {
  type: string;
  key?: string;
  value?: string;
}
interface Application {
  $: Record<string, string>;
  'meta-data'?: { $: Record<string, string> }[];
  [child: string]: unknown;
}
interface Manifest {
  manifest: { $: Record<string, string>; application?: Application[] } & Record<string, unknown>;
}

/** Sets both scanner properties to `false` (replacing any earlier value). Idempotent. */
export function applyCameraProperties<T extends Property>(items: readonly T[]): (T | Property)[] {
  const keys = CAMERA_GRADLE_PROPERTIES.map(([key]) => key);
  return [
    ...items.filter((item) => item.type !== 'property' || !keys.some((key) => key === item.key)),
    ...CAMERA_GRADLE_PROPERTIES.map(([key, value]): Property => ({ type: 'property', key, value })),
  ];
}

/** Removes the ML Kit meta-data of the library from the merged manifest. Idempotent. */
export function applyCameraManifest(modResults: Manifest): Manifest {
  const application = modResults.manifest.application?.[0];
  if (application === undefined) throw new Error('with-camera: the manifest has no application element (template changed)');
  modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  application['meta-data'] = [
    ...(application['meta-data'] ?? []).filter((item) => item.$['android:name'] !== ML_KIT_DEPENDENCIES_META),
    { $: { 'android:name': ML_KIT_DEPENDENCIES_META, 'tools:node': 'remove' } },
  ];
  return modResults;
}

const withCamera: ConfigPlugin = (config) => {
  config = withGradleProperties(config, (modConfig) => {
    modConfig.modResults = applyCameraProperties(modConfig.modResults) as typeof modConfig.modResults;
    return modConfig;
  });
  return withAndroidManifest(config, (modConfig) => {
    applyCameraManifest(modConfig.modResults as unknown as Manifest);
    return modConfig;
  });
};

export default withCamera;
