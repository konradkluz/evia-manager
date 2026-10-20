import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  adbArgs,
  airplaneArgs,
  apkPath,
  APPLICATION_ID,
  AVD_NAME,
  buildEnv,
  DEFAULT_PORT,
  EMULATOR_ABI,
  emulatorArgs,
  gradleCommand,
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
    });
    assert.equal(command, 'java');
    assert.deepEqual(args.slice(-8), ['--device', 'emulator-5554', 'test', 'f.yaml', '--format', 'JUNIT', '--output', 'f.xml']);
    assert.ok(args.includes('maestro.cli.AppKt'));
  });

  it('EVM-009 AC4: the APK of the release build and the application id are fixed', () => {
    assert.equal(apkPath('/app'), join('/app', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'));
    assert.equal(APPLICATION_ID, 'pl.eviacharge.manager');
  });
});
