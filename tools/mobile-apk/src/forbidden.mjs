// @ts-check
/**
 * The groups of libraries that must not be in the package (EVM-108 AC8; SR-MOB-12, SR-SUPPLY-06, MASVS-PRIVACY-1): ML Kit, Google Play
 * services, Firebase and the transport of their telemetry. The camera of the app (CameraX through `expo-camera`) needs none of them;
 * they come only through the scanners of Google that `apps/mobile/plugins/with-camera.ts` switches off at build time. One list for every
 * check (manifest, DEX, mapping.txt, Gradle tree, META-INF markers), so that a check cannot drift from the others.
 */

/** Package prefixes (DEX, mapping.txt, manifest components, authorities, `<queries>`, `<uses-library>`). */
export const FORBIDDEN_PACKAGE_PREFIXES = Object.freeze([
  'com.google.mlkit',
  'com.google.firebase',
  'com.google.android.gms',
  'com.google.android.datatransport',
  'com.google.android.odml',
  'androidx.camera.mlkit',
]);

/** Maven groups; `androidx.camera` is not forbidden as a whole (CameraX is the camera), only its ML Kit artifact. */
export const FORBIDDEN_MAVEN_GROUPS = Object.freeze([
  'com.google.mlkit',
  'com.google.firebase',
  'com.google.android.gms',
  'com.google.android.datatransport',
  'com.google.android.odml',
]);
/** Maven coordinates (`group:artifact`) forbidden next to the groups. */
export const FORBIDDEN_MAVEN_COORDINATES = Object.freeze(['androidx.camera:camera-mlkit-vision']);

/**
 * @param {string} name a class, package, authority or component name
 * @returns {string | undefined} the forbidden prefix the name belongs to
 */
export function forbiddenPrefixOf(name) {
  return FORBIDDEN_PACKAGE_PREFIXES.find((prefix) => name === prefix || name.startsWith(`${prefix}.`));
}

/**
 * @param {string} group
 * @param {string} artifact
 * @returns {boolean} whether the Maven coordinate is forbidden
 */
export function isForbiddenCoordinate(group, artifact) {
  return FORBIDDEN_MAVEN_GROUPS.includes(group) || FORBIDDEN_MAVEN_COORDINATES.includes(`${group}:${artifact}`);
}
