import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  adbArgs,
  airplaneArgs,
  apksignerCommand,
  DEBUG_KEY_PASS_ENV,
  DEBUG_KS_PASS_ENV,
  debugKeystorePath,
  parseDebugSigning,
  releaseBuildEnv,
  releasePaths,
  resolveGit,
  selectBuildTools,
  unsignedReleaseApkPath,
  verifyCommand,
  zipalignCommand,
  apkPath,
  APPLICATION_ID,
  AVD_NAME,
  buildEnv,
  DEFAULT_PORT,
  EMULATOR_ABI,
  emulatorArgs,
  gradleCommand,
  PATH_LIMIT_INIT_SCRIPT,
  localProperties,
  maestroCommand,
  prebuildCommand,
  toolPaths,
} from '../src/commands.mjs';

describe('commands of the smoke test (EVM-009 AC4)', () => {
  it('EVM-009 AC4: paths of the tools follow the SDK layout, with .exe on Windows only', () => {
    const windows = toolPaths({ androidHome: 'C:/Sdk', javaHome: 'C:/jdk', maestroHome: 'C:/m', platform: 'win32' });
    assert.equal(windows.adb, join('C:/Sdk', 'platform-tools', 'adb.exe'));
    assert.equal(windows.emulator, join('C:/Sdk', 'emulator', 'emulator.exe'));
    assert.equal(windows.java, join('C:/jdk', 'bin', 'java.exe'));
    assert.equal(windows.maestroLibrary, join('C:/m', 'maestro', 'lib'));
    assert.equal(windows.maestroClasspath, join('C:/m', 'maestro', 'lib', '*'));
    const linux = toolPaths({ androidHome: '/sdk', javaHome: undefined, maestroHome: '/m', platform: 'linux' });
    assert.equal(linux.adb, join('/sdk', 'platform-tools', 'adb'));
    assert.equal(linux.java, 'java');
    assert.equal(toolPaths({ androidHome: '/sdk', javaHome: undefined, maestroHome: '/m', platform: 'win32' }).java, 'java.exe');
  });

  it('EVM-009 AC4: the environment of the build is an allow-list: no token or key of the host reaches the tools', () => {
    const env = buildEnv(
      {
        PATH: '/bin',
        JAVA_HOME: '/jdk',
        GITHUB_TOKEN: 'synthetic-token',
        ANDROID_KEYSTORE_PASSWORD: 'synthetic',
        NPM_TOKEN: 'x',
        TEMP: '/tmp',
      },
      { androidHome: '/sdk', port: 3199 },
    );
    assert.equal(env['PATH'], '/bin');
    assert.equal(env['JAVA_HOME'], '/jdk');
    assert.equal(env['TEMP'], '/tmp');
    assert.equal(env['GITHUB_TOKEN'], undefined);
    assert.equal(env['ANDROID_KEYSTORE_PASSWORD'], undefined);
    assert.equal(env['NPM_TOKEN'], undefined);
  });

  it('EVM-009 AC4: telemetry of Expo and Maestro is off, the build is the e2e variant, the API address is the emulator host', () => {
    const env = buildEnv({}, { androidHome: '/sdk', port: 3199 });
    assert.equal(env['EXPO_NO_TELEMETRY'], '1');
    assert.equal(env['MAESTRO_CLI_NO_ANALYTICS'], '1');
    assert.equal(env['EVIA_BUILD_VARIANT'], 'e2e');
    assert.equal(env['EXPO_PUBLIC_API_BASE_URL'], `http://10.0.2.2:${String(DEFAULT_PORT)}`);
    assert.equal(env['ANDROID_HOME'], '/sdk');
    assert.equal(env['ANDROID_SDK_ROOT'], '/sdk');
  });

  it('EVM-009 AC4: prebuild is clean, Android only and without installing packages', () => {
    assert.deepEqual(prebuildCommand('node', 'cli'), {
      command: 'node',
      args: ['cli', 'prebuild', '--platform', 'android', '--clean', '--no-install'],
    });
  });

  it('EVM-009 AC4: Gradle runs through java and the wrapper jar (no .bat, no shell) for the emulator ABI only', () => {
    const { command, args } = gradleCommand({ java: 'java', wrapperJar: 'wrapper.jar' });
    assert.equal(command, 'java');
    assert.ok(args.includes('org.gradle.wrapper.GradleWrapperMain'));
    assert.ok(args.includes('assembleRelease'));
    assert.ok(args.includes(`-PreactNativeArchitectures=${EMULATOR_ABI}`));
    assert.equal(args[args.indexOf('-classpath') + 1], 'wrapper.jar');
    assert.ok(!args.some((argument) => argument.startsWith('-Pandroid.cmakeVersion')));
  });

  it('EVM-009 AC4: a CMake version for long paths is passed to Gradle when configured', () => {
    assert.ok(gradleCommand({ java: 'java', wrapperJar: 'w.jar', cmakeVersion: '3.31.6' }).args.includes('-Pandroid.cmakeVersion=3.31.6'));
    assert.ok(
      !gradleCommand({ java: 'java', wrapperJar: 'w.jar', cmakeVersion: '' }).args.some((argument) => argument.includes('cmakeVersion')),
    );
  });

  it('EVM-009 AC4: an init script is passed to Gradle only when given (builds from a short clone)', () => {
    const withScript = gradleCommand({ java: 'java', wrapperJar: 'w.jar', initScript: 'C:/e/init.gradle' }).args;
    assert.equal(withScript[withScript.indexOf('-I') + 1], 'C:/e/init.gradle');
    assert.ok(!gradleCommand({ java: 'java', wrapperJar: 'w.jar' }).args.includes('-I'));
  });

  it('EVM-009 AC4: the init script lets CMake shorten object names (CMAKE_OBJECT_PATH_MAX) for applications and libraries', () => {
    assert.match(PATH_LIMIT_INIT_SCRIPT, /com.android.application/);
    assert.match(PATH_LIMIT_INIT_SCRIPT, /com.android.library/);
    assert.match(PATH_LIMIT_INIT_SCRIPT, /-DCMAKE_OBJECT_PATH_MAX=250/);
  });

  it('EVM-009 AC4: local.properties has forward slashes (backslashes are escapes in Java properties)', () => {
    assert.equal(localProperties(String.raw`C:\Users\Konrad\Sdk`), 'sdk.dir=C:/Users/Konrad/Sdk\n');
  });

  it('EVM-009 AC4: adb is always addressed to one serial', () => {
    assert.deepEqual(adbArgs('emulator-5554', 'shell', 'getprop', 'x'), ['-s', 'emulator-5554', 'shell', 'getprop', 'x']);
  });

  it('EVM-009 AC4: airplane mode is switched with the connectivity service', () => {
    assert.deepEqual(airplaneArgs(true), ['shell', 'cmd', 'connectivity', 'airplane-mode', 'enable']);
    assert.deepEqual(airplaneArgs(false), ['shell', 'cmd', 'connectivity', 'airplane-mode', 'disable']);
  });

  it('EVM-009 AC4: the emulator starts the AVD of the machine without saving a snapshot', () => {
    assert.deepEqual(emulatorArgs(), ['-avd', AVD_NAME, '-no-snapshot-save', '-no-boot-anim']);
    assert.equal(AVD_NAME, 'Medium_Phone_API_35');
  });

  it('EVM-009 AC4: Maestro runs through java for one device and writes a JUnit file', () => {
    const { command, args } = maestroCommand({
      java: 'java',
      classpath: 'lib/*',
      serial: 'emulator-5554',
      flow: 'f.yaml',
      junitFile: 'f.xml',
      outputDirectory: 'out',
    });
    assert.equal(command, 'java');
    assert.deepEqual(args.slice(-10), [
      '--device',
      'emulator-5554',
      'test',
      'f.yaml',
      '--format',
      'JUNIT',
      '--output',
      'f.xml',
      '--test-output-dir',
      'out',
    ]);
    assert.ok(args.includes('maestro.cli.AppKt'));
  });

  it('EVM-009 AC4: the APK of the release build and the application id are fixed', () => {
    assert.equal(apkPath('/app'), join('/app', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'));
    assert.equal(APPLICATION_ID, 'pl.eviacharge.manager');
  });
});

const TEMPLATE_GRADLE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'tmpl-store'
            keyAlias 'androiddebugkey'
            keyPassword 'tmpl-key'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
    }
}
`;

describe('the AC4 release package of the same run (EVM-093 AC4, security controls 2 and 5)', () => {
  it('EVM-093 AC4: the release build gets no e2e variant and a placeholder https address (the package is never started)', () => {
    const env = releaseBuildEnv({ PATH: '/bin', GITHUB_TOKEN: 'synthetic-token' }, { androidHome: '/sdk' });
    assert.equal(env['EVIA_BUILD_VARIANT'], undefined);
    assert.equal(env['EXPO_PUBLIC_API_BASE_URL'], 'https://api.example.invalid');
    assert.equal(env['GITHUB_TOKEN'], undefined);
    assert.equal(env['EXPO_NO_TELEMETRY'], '1');
    assert.equal(env['PATH'], '/bin');
  });

  it('EVM-093 AC4: the files of the release package live in .scratch/mobile-e2e, the signed one ends with -debugkey.apk', () => {
    const paths = releasePaths('/repo/.scratch/mobile-e2e');
    assert.equal(paths.unsigned, join('/repo/.scratch/mobile-e2e', 'evm093-release-unsigned.apk'));
    assert.equal(paths.aligned, join('/repo/.scratch/mobile-e2e', 'evm093-release-aligned.apk'));
    assert.match(paths.signed, /evm093-release-debugkey\.apk$/);
    assert.equal(
      unsignedReleaseApkPath('/app'),
      join('/app', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk'),
    );
    // fixed path, no parameter: the debug key of the template next to build.gradle
    assert.equal(debugKeystorePath('/app'), join('/app', 'android', 'app', 'debug.keystore'));
  });

  it('EVM-093 AC4: the debug signing values are read from the template (signingConfigs.debug), only with the fixed keystore file', () => {
    assert.deepEqual(parseDebugSigning(TEMPLATE_GRADLE), {
      storePassword: 'tmpl-store',
      keyAlias: 'androiddebugkey',
      keyPassword: 'tmpl-key',
    });
    assert.equal(parseDebugSigning(TEMPLATE_GRADLE.replace("file('debug.keystore')", "file('/elsewhere/release.jks')")), null);
    assert.equal(parseDebugSigning('android { }'), null);
    assert.equal(parseDebugSigning(TEMPLATE_GRADLE.replace("            keyAlias 'androiddebugkey'\n", '')), null);
  });

  it('EVM-093 AC4: build-tools: the highest stable version of at least 35.0.0 (zipalign -P 16), none = null', () => {
    assert.equal(selectBuildTools(['34.0.0', '35.0.0', '36.0.0-rc1', '37.0.0', '36.0.0']), '37.0.0');
    assert.equal(selectBuildTools(['36.1.0', '36.0.9', '36.1.0']), '36.1.0');
    assert.equal(selectBuildTools(['34.0.0', 'notes']), null);
    assert.equal(selectBuildTools([]), null);
  });

  it('EVM-093 AC4: zipalign and apksigner run without a shell; the passwords are passed only as env: names, never in the arguments', () => {
    const bt = '/sdk/build-tools/37.0.0';
    assert.deepEqual(zipalignCommand({ buildTools: bt, platform: 'win32', input: 'in.apk', output: 'out.apk' }), {
      command: join(bt, 'zipalign.exe'),
      args: ['-P', '16', '-f', '4', 'in.apk', 'out.apk'],
    });
    assert.equal(zipalignCommand({ buildTools: bt, platform: 'linux', input: 'a', output: 'b' }).command, join(bt, 'zipalign'));
    const signer = apksignerCommand({
      java: 'java',
      buildTools: bt,
      keystore: '/app/android/app/debug.keystore',
      keyAlias: 'k',
      input: 'a',
      output: 'b',
    });
    assert.equal(signer.command, 'java');
    assert.deepEqual(signer.args, [
      '-jar',
      join(bt, 'lib', 'apksigner.jar'),
      'sign',
      '--ks',
      '/app/android/app/debug.keystore',
      '--ks-key-alias',
      'k',
      '--ks-pass',
      `env:${DEBUG_KS_PASS_ENV}`,
      '--key-pass',
      `env:${DEBUG_KEY_PASS_ENV}`,
      '--v4-signing-enabled',
      'false',
      '--out',
      'b',
      'a',
    ]);
    assert.ok(!signer.args.some((argument) => argument.startsWith('pass:') || argument.startsWith('file:')));
  });

  it('EVM-093 AC4: verify of tools/mobile-apk runs with the same node, on the given file', () => {
    assert.deepEqual(verifyCommand('node', '/repo', 'x.apk'), {
      command: 'node',
      args: [join('/repo', 'tools', 'mobile-apk', 'cli.mjs'), 'verify', '--apk', 'x.apk'],
    });
  });

  it('EVM-093 AC4: git is taken from an absolute PATH directory only (never the current folder)', () => {
    const exists = (/** @type {string} */ path) => path === join('/usr/bin', 'git') || path === join('C:/Git/cmd', 'git.exe');
    assert.equal(resolveGit({ PATH: 'relative:/usr/bin' }, 'linux', exists), join('/usr/bin', 'git'));
    assert.equal(resolveGit({ Path: 'C:/Git/cmd' }, 'win32', exists), join('C:/Git/cmd', 'git.exe'));
    assert.equal(
      resolveGit({ PATH: 'relative' }, 'linux', () => true),
      null,
    );
    assert.equal(resolveGit({}, 'linux', exists), null);
  });
});
