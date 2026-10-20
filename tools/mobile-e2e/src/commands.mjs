// @ts-check
/**
 * Pure builders of the commands, paths and environment of the smoke test (EVM-009 AC4; ADR-0015). Every process gets an array of
 * arguments and never a shell (CWE-78): Gradle and Maestro are started as `java -classpath … <main class>`, exactly what their
 * `.bat` launchers do, because Node refuses to start `.bat` files without a shell.
 */
import { join } from 'node:path';

/** Application id of the app (apps/mobile/plugins/expo-config.ts); the Maestro flows carry the same literal. */
export const APPLICATION_ID = 'pl.eviacharge.manager';
/** The only AVD of the machine (ADR-0015): Android 15, API 35. */
export const AVD_NAME = 'Medium_Phone_API_35';
/** The scenario server listens here on the host; the emulator reaches it as 10.0.2.2. */
export const DEFAULT_PORT = 3199;
/** The emulator is x86_64: building only this ABI keeps the native build short. */
export const EMULATOR_ABI = 'x86_64';

/** Variables of the host that the build tools need; nothing else (no tokens, no keys) is passed on. */
const PASSED_ENV = [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'USERPROFILE',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'JAVA_HOME',
  'GRADLE_USER_HOME',
];

/**
 * @param {{ androidHome: string, javaHome: string | undefined, maestroHome: string, platform: string }} options
 */
export function toolPaths({ androidHome, javaHome, maestroHome, platform }) {
  const exe = platform === 'win32' ? '.exe' : '';
  return {
    adb: join(androidHome, 'platform-tools', `adb${exe}`),
    emulator: join(androidHome, 'emulator', `emulator${exe}`),
    java: javaHome === undefined ? `java${exe}` : join(javaHome, 'bin', `java${exe}`),
    maestroLibrary: join(maestroHome, 'maestro', 'lib'),
    maestroClasspath: join(maestroHome, 'maestro', 'lib', '*'),
  };
}

/**
 * Environment of the build and the test processes: an allow-list of the host plus fixed values. EXPO_NO_TELEMETRY and
 * MAESTRO_CLI_NO_ANALYTICS keep the tools from sending data to third parties (CLAUDE.md: no external services without consent).
 * @param {NodeJS.ProcessEnv} base
 * @param {{ androidHome: string, port: number }} options
 * @returns {Record<string, string>}
 */
export function buildEnv(base, { androidHome, port }) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const name of PASSED_ENV) {
    const value = base[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    EXPO_NO_TELEMETRY: '1',
    MAESTRO_CLI_NO_ANALYTICS: '1',
    CI: '1',
    EVIA_BUILD_VARIANT: 'e2e',
    EXPO_PUBLIC_API_BASE_URL: `http://10.0.2.2:${String(port)}`,
  };
}

/**
 * @param {string} nodeExecutable
 * @param {string} expoCli
 */
export function prebuildCommand(nodeExecutable, expoCli) {
  return { command: nodeExecutable, args: [expoCli, 'prebuild', '--platform', 'android', '--clean', '--no-install'] };
}

/**
 * @param {{ java: string, wrapperJar: string, cmakeVersion?: string | undefined }} options
 */
export function gradleCommand({ java, wrapperJar, cmakeVersion }) {
  const args = [
    '-Xmx64m',
    '-Xms64m',
    '-Dorg.gradle.appname=gradlew',
    '-classpath',
    wrapperJar,
    'org.gradle.wrapper.GradleWrapperMain',
    'assembleRelease',
    `-PreactNativeArchitectures=${EMULATOR_ABI}`,
    '--console=plain',
  ];
  if (cmakeVersion !== undefined && cmakeVersion !== '') args.push(`-Pandroid.cmakeVersion=${cmakeVersion}`);
  return { command: java, args };
}

/**
 * Content of android/local.properties (Java properties: backslashes would be escapes).
 * @param {string} androidHome
 */
export function localProperties(androidHome) {
  return `sdk.dir=${androidHome.replaceAll('\\', '/')}\n`;
}

/**
 * @param {string} serial
 * @param {...string} rest
 */
export const adbArgs = (serial, ...rest) => ['-s', serial, ...rest];

/** @param {boolean} on */
export const airplaneArgs = (on) => ['shell', 'cmd', 'connectivity', 'airplane-mode', on ? 'enable' : 'disable'];

export const emulatorArgs = () => ['-avd', AVD_NAME, '-no-snapshot-save', '-no-boot-anim'];

/**
 * @param {{ java: string, classpath: string, serial: string, flow: string, junitFile: string }} options
 */
export function maestroCommand({ java, classpath, serial, flow, junitFile }) {
  return {
    command: java,
    args: [
      '--enable-native-access=ALL-UNNAMED',
      '-classpath',
      classpath,
      'maestro.cli.AppKt',
      '--device',
      serial,
      'test',
      flow,
      '--format',
      'JUNIT',
      '--output',
      junitFile,
    ],
  };
}

/** @param {string} appDirectory */
export const apkPath = (appDirectory) => join(appDirectory, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
