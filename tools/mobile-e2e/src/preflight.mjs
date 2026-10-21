// @ts-check
/**
 * Checks before the first expensive step (EVM-009 AC4), so a missing prerequisite is one clear message and not a failure deep in
 * Gradle. The facts are collected by the caller; this module only judges them.
 */

/**
 * @typedef {{
 *   platform: string,
 *   longPathsEnabled: boolean | null,
 *   androidHomeSet: boolean,
 *   present: { adb: boolean, emulator: boolean, java: boolean, maestro: boolean },
 *   skipBuild: boolean,
 *   apkPresent: boolean,
 *   shortPaths: boolean,
 * }} Facts
 */

export const LONG_PATHS_REMEDY =
  'Windows long paths are off (LongPathsEnabled=0). The React Native native build (CMake/Ninja) fails on the deep pnpm paths with ' +
  '"Filename longer than 260 characters". Two ways out. (A) Without administrator: build from a SHORT clone (e.g. C:\\e) with a flat ' +
  'node_modules (nodeLinker: hoisted in its pnpm-workspace.yaml, never committed; pnpm install --frozen-lockfile --filter "@evia/mobile..."; then pnpm --filter @evia/tokens run build and pnpm --filter @evia/contracts run build) ' +
  'and run with EVIA_E2E_SHORT_PATHS=1 (skips only this check; set EVIA_ANDROID_CMAKE_VERSION=3.31.6 only if CMake 3.22.1 fails). ' +
  '(B) As administrator, once: reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f — ' +
  'restart Windows, and set EVIA_ANDROID_CMAKE_VERSION=3.31.6 (install it first: sdkmanager "cmake;3.31.6"). ' +
  'See docs/ops/dystrybucja-apk-android.md.';

/**
 * @param {Facts} facts
 * @returns {string[]} problems, each with the remedy; empty when the test can start
 */
export function checkPreflight(facts) {
  /** @type {string[]} */
  const problems = [];
  if (!facts.androidHomeSet) problems.push('ANDROID_HOME is not set and the default Android SDK folder does not exist: set ANDROID_HOME.');
  if (!facts.present.adb) problems.push('adb was not found in the Android SDK (platform-tools).');
  if (!facts.present.emulator) problems.push('The Android emulator was not found in the Android SDK (emulator).');
  if (!facts.present.java) problems.push('Java was not found: set JAVA_HOME to a JDK 17.');
  if (!facts.present.maestro) {
    problems.push('Maestro CLI was not found: set EVIA_MAESTRO_HOME to the folder with the unpacked Maestro (it holds maestro/lib).');
  }
  if (facts.skipBuild && !facts.apkPresent) problems.push('--skip-build was given but there is no APK from an earlier build.');
  if (!facts.skipBuild && facts.platform === 'win32' && facts.longPathsEnabled !== true && !facts.shortPaths)
    problems.push(LONG_PATHS_REMEDY);
  return problems;
}
