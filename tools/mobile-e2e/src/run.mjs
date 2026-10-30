// @ts-check
/**
 * The smoke test of the mobile app on one Android emulator (EVM-009 AC4; ADR-0015): preflight, the e2e build, the install, the
 * scenario server, the Maestro flows, the report. Every effect goes through the `host`, so the sequence is tested with fakes.
 * Exit codes: 0 all flows passed, 1 a problem or a failed flow, 2 usage (main.mjs).
 */
import { join } from 'node:path';
import { emulatorsOf, parseAdbDevices, selectEmulator } from './adb.mjs';
import {
  adbArgs,
  airplaneArgs,
  apkPath,
  APPLICATION_ID,
  buildEnv,
  emulatorArgs,
  gradleCommand,
  PATH_LIMIT_INIT_SCRIPT,
  localProperties,
  maestroCommand,
  prebuildCommand,
  toolPaths,
} from './commands.mjs';
import { runDeviceAction } from './device.mjs';
import { checkPreflight } from './preflight.mjs';
import { buildReport, isGreen, scanLogcat } from './report.mjs';
import { BACKGROUND_WAIT_MS, NETWORK_RESTORE_WAIT_MS, SCENARIOS } from './scenarios.mjs';

const BOOT_ATTEMPTS = 90;
const BOOT_POLL_MS = 2000;

/**
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Outcome
 * @typedef {{
 *   repoRoot: string,
 *   platform: string,
 *   env: NodeJS.ProcessEnv,
 *   homedir: string,
 *   execPath: string,
 *   exists: (path: string) => boolean,
 *   writeText: (path: string, text: string) => void,
 *   readBytes: (path: string) => Buffer | null,
 *   removeFile: (path: string) => void,
 *   makeDirectory: (path: string) => void,
 *   resetDirectory: (path: string) => void,
 *   collectScreenshots: (source: string, targets: string[]) => string[],
 *   run: (command: string, args: string[], options?: { cwd?: string, env?: Record<string, string>, stream?: boolean }) => Outcome,
 *   startDetached: (command: string, args: string[], options?: { env?: Record<string, string> }) => void,
 *   sleep: (ms: number) => Promise<void>,
 *   now: () => number,
 *   longPathsEnabled: () => boolean | null,
 *   resolveExpoCli: (directory: string) => string,
 *   readAppVersion: (appDirectory: string) => string,
 *   startStub: (port: number) => Promise<import('./stub-api.mjs').StubApi>,
 *   log: (line: string) => void,
 *   today: () => string,
 * }} Host
 */

/** @param {Host} host */
function sdkDefault(host) {
  return host.platform === 'win32'
    ? join(host.env['LOCALAPPDATA'] ?? host.homedir, 'Android', 'Sdk')
    : join(host.homedir, 'Android', 'Sdk');
}

/**
 * @param {{ skipBuild: boolean, port: number }} options
 * @param {Host} host
 * @returns {Promise<number>}
 */
export async function runE2e({ skipBuild, port }, host) {
  const appDirectory = join(host.repoRoot, 'apps', 'mobile');
  const reportDirectory = join(host.repoRoot, '.scratch', 'mobile-e2e');
  const androidHome = host.env['ANDROID_HOME'] ?? sdkDefault(host);
  const maestroHome = host.env['EVIA_MAESTRO_HOME'] ?? join(host.homedir, '.evia', 'tools', 'maestro-2.11.0');
  const tools = toolPaths({ androidHome, javaHome: host.env['JAVA_HOME'], maestroHome, platform: host.platform });
  const apk = apkPath(appDirectory);

  const problems = checkPreflight({
    platform: host.platform,
    longPathsEnabled: host.longPathsEnabled(),
    androidHomeSet: host.exists(androidHome),
    present: {
      adb: host.exists(tools.adb),
      emulator: host.exists(tools.emulator),
      java: tools.java === 'java' || tools.java === 'java.exe' ? true : host.exists(tools.java),
      maestro: host.exists(tools.maestroLibrary),
    },
    skipBuild,
    apkPresent: host.exists(apk),
    shortPaths: host.env['EVIA_E2E_SHORT_PATHS'] === '1',
  });
  if (problems.length > 0) {
    for (const problem of problems) host.log(`PREFLIGHT: ${problem}`);
    return 1;
  }

  const env = buildEnv(host.env, { androidHome, port });
  /** @param {string[]} args @returns {Outcome} */
  const adb = (...args) => host.run(tools.adb, args, { env });

  const serial = await ensureEmulator(host, tools, env, adb);
  if (serial === null) return 1;

  if (!skipBuild && !build(host, { appDirectory, androidHome, tools, env, apk })) return 1;

  host.makeDirectory(reportDirectory);
  // Maestro artifacts of this run only (a stale screenshot of an earlier run must not pass for a current one)
  const maestroOutput = join(reportDirectory, 'maestro-output');
  const screenshotsDirectory = join(reportDirectory, 'screenshots');
  host.resetDirectory(maestroOutput);
  host.resetDirectory(screenshotsDirectory);
  const stub = await host.startStub(port);
  let airplane = false;
  /** @type {import('./report.mjs').Result[]} */
  const results = [];
  /** @type {import('./device.mjs').DeviceContext} */
  const device = {
    adb: (...args) => adb(...adbArgs(serial, ...args)),
    startAdb: (...args) => {
      host.startDetached(tools.adb, adbArgs(serial, ...args), { env });
    },
    sleep: (ms) => host.sleep(ms),
    readBytes: (path) => host.readBytes(path),
    removeFile: (path) => {
      host.removeFile(path);
    },
    // the adb backup archive of EVM-093 AC4 stays in .scratch and is removed right after its check (security K7)
    backupFile: join(reportDirectory, 'evm093-backup.ab'),
  };
  /** after a restart of the emulator Maestro installs its driver again: the next flow may be retried once */
  let rebooted = false;
  /** @type {import('./report.mjs').Evidence['logcat'] | undefined} */
  let logcat;
  try {
    const installed = adb(...adbArgs(serial, 'install', '-r', apk));
    if (installed.status !== 0) {
      host.log(`INSTALL: adb install failed: ${`${installed.stderr} ${installed.stdout}`.trim().slice(0, 300)}`);
      return 1;
    }
    for (const scenario of SCENARIOS) {
      let failed = false;
      for (const step of scenario.steps) {
        if (failed) {
          results.push({ scenario: scenario.name, flow: step.flow, status: 'skipped', seconds: 0 });
          continue;
        }
        stub.setMode(step.server);
        if (step.background === true) {
          adb(...adbArgs(serial, 'shell', 'input', 'keyevent', 'KEYCODE_HOME'));
          await host.sleep(BACKGROUND_WAIT_MS);
        }
        if (step.airplane !== airplane) {
          adb(...adbArgs(serial, ...airplaneArgs(step.airplane)));
          airplane = step.airplane;
          await host.sleep(NETWORK_RESTORE_WAIT_MS);
        }
        const started = host.now();
        /** @type {import('./device.mjs').Check[]} */
        const checks = [];
        for (const action of step.before ?? []) {
          const check = await runDeviceAction(action, device);
          checks.push(check);
          if (!check.ok) break;
        }
        if (checks.some((check) => !check.ok)) {
          failed = true;
          results.push({ scenario: scenario.name, flow: step.flow, status: 'failed', seconds: (host.now() - started) / 1000, checks });
          continue;
        }
        const command = maestroCommand({
          java: tools.java,
          classpath: tools.maestroClasspath,
          serial,
          flow: join(appDirectory, 'e2e', step.flow),
          junitFile: join(reportDirectory, `${step.flow}.xml`),
          outputDirectory: maestroOutput,
        });
        let outcome = host.run(command.command, command.args, { cwd: appDirectory, env, stream: true });
        /** @type {1 | 2} */
        let attempts = 1;
        if (outcome.status !== 0 && (results.length === 0 || rebooted)) {
          // The very first Maestro connection to a fresh (or restarted) emulator installs the driver and can fail once.
          host.log(`MAESTRO: the flow ${step.flow} failed on a fresh emulator, one retry (driver installation)`);
          outcome = host.run(command.command, command.args, { cwd: appDirectory, env, stream: true });
          attempts = 2;
        }
        rebooted = false;
        let passed = outcome.status === 0;
        if (passed) {
          for (const action of step.after ?? []) {
            const check = await runDeviceAction(action, device);
            checks.push(check);
            if (action === 'reboot') {
              rebooted = true;
              airplane = false;
            }
            if (!check.ok) {
              passed = false;
              break;
            }
          }
        }
        failed = !passed;
        results.push({
          scenario: scenario.name,
          flow: step.flow,
          status: passed ? 'passed' : 'failed',
          seconds: (host.now() - started) / 1000,
          attempts,
          ...(checks.length === 0 ? {} : { checks }),
        });
      }
    }
    logcat = collectLogcat(adb, serial);
  } finally {
    if (airplane) adb(...adbArgs(serial, ...airplaneArgs(false)));
    await stub.close();
  }

  // The review screenshots (ignored by git, docs/ux/reviews/**/*.png): .scratch for the run, docs/ux/reviews/EVM-009 for the UX review
  const screenshots = host.collectScreenshots(maestroOutput, [
    screenshotsDirectory,
    join(host.repoRoot, 'docs', 'ux', 'reviews', 'EVM-009'),
  ]);
  const evidence = {
    date: host.today(),
    device: deviceInfo(adb, serial),
    maestroVersion: maestroVersion(host, tools, env),
    appVersion: host.readAppVersion(appDirectory),
    results,
    requests: stub.requests(),
    logcat: logcat ?? null,
    screenshots,
  };
  host.writeText(join(reportDirectory, 'report.md'), buildReport(evidence));
  host.log(buildReport(evidence));
  return isGreen(evidence) ? 0 : 1;
}

/**
 * Uses the one running emulator, starts the AVD when none runs, and refuses when several run (ADR-0015: one at a time).
 * @param {Host} host
 * @param {ReturnType<typeof toolPaths>} tools
 * @param {Record<string, string>} env
 * @param {(...args: string[]) => Outcome} adb
 * @returns {Promise<string | null>} the serial, or null after a logged refusal
 */
async function ensureEmulator(host, tools, env, adb) {
  let choice = selectEmulator(parseAdbDevices(adb('devices').stdout));
  if (!choice.ok && choice.reason === 'several') {
    host.log(
      `EMULATOR: more than one emulator is running (${choice.serials.join(', ')}); stop all but one — the machine runs one at a time.`,
    );
    return null;
  }
  if (!choice.ok && choice.reason === 'none') {
    host.log('EMULATOR: none running, starting the AVD');
    host.startDetached(tools.emulator, emulatorArgs(), { env });
  }
  for (let attempt = 0; attempt < BOOT_ATTEMPTS; attempt += 1) {
    choice = selectEmulator(parseAdbDevices(adb('devices').stdout));
    if (
      choice.ok &&
      adb(...adbArgs(choice.serial, 'shell', 'getprop', 'sys.boot_completed')).stdout.trim() === '1' &&
      adb(...adbArgs(choice.serial, 'shell', 'pm', 'path', 'android')).stdout.includes('package:')
    ) {
      return choice.serial;
    }
    if (!choice.ok && choice.reason === 'several') {
      host.log('EMULATOR: a second emulator appeared; stop all but one.');
      return null;
    }
    await host.sleep(BOOT_POLL_MS);
  }
  host.log(
    `EMULATOR: not ready after ${String((BOOT_ATTEMPTS * BOOT_POLL_MS) / 1000)} s (${String(emulatorsOf(parseAdbDevices(adb('devices').stdout)).length)} seen)`,
  );
  return null;
}

/**
 * @param {Host} host
 * @param {{ appDirectory: string, androidHome: string, tools: ReturnType<typeof toolPaths>, env: Record<string, string>, apk: string }} context
 * @returns {boolean}
 */
function build(host, { appDirectory, androidHome, tools, env, apk }) {
  const androidDirectory = join(appDirectory, 'android');
  const prebuild = prebuildCommand(host.execPath, host.resolveExpoCli(appDirectory));
  if (host.run(prebuild.command, prebuild.args, { cwd: appDirectory, env, stream: true }).status !== 0) {
    host.log('BUILD: expo prebuild failed');
    return false;
  }
  host.writeText(join(androidDirectory, 'local.properties'), localProperties(androidHome));
  const wrapperJar = join(androidDirectory, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  /** @type {string | undefined} */
  let initScript;
  if (host.env['EVIA_E2E_SHORT_PATHS'] === '1') {
    initScript = join(androidDirectory, 'evia-path-limit.init.gradle');
    host.writeText(initScript, PATH_LIMIT_INIT_SCRIPT);
  }
  const gradle = gradleCommand({ java: tools.java, wrapperJar, cmakeVersion: host.env['EVIA_ANDROID_CMAKE_VERSION'], initScript });
  if (host.run(gradle.command, gradle.args, { cwd: androidDirectory, env, stream: true }).status !== 0) {
    host.log('BUILD: Gradle assembleRelease failed');
    return false;
  }
  if (!host.exists(apk)) {
    host.log('BUILD: the APK was not produced');
    return false;
  }
  return true;
}

/**
 * @param {(...args: string[]) => Outcome} adb
 * @param {string} serial
 */
function deviceInfo(adb, serial) {
  /** @param {string} property */
  const prop = (property) => adb(...adbArgs(serial, 'shell', 'getprop', property)).stdout.trim();
  return {
    serial,
    apiLevel: prop('ro.build.version.sdk'),
    androidRelease: prop('ro.build.version.release'),
    model: prop('ro.product.model'),
    buildType: prop('ro.build.type'),
  };
}

/**
 * @param {Host} host
 * @param {ReturnType<typeof toolPaths>} tools
 * @param {Record<string, string>} env
 */
function maestroVersion(host, tools, env) {
  const outcome = host.run(
    tools.java,
    ['--enable-native-access=ALL-UNNAMED', '-classpath', tools.maestroClasspath, 'maestro.cli.AppKt', '--version'],
    { env },
  );
  return outcome.stdout.trim().split(/\r?\n/).at(-1) ?? 'unknown';
}

/**
 * @param {(...args: string[]) => Outcome} adb
 * @param {string} serial
 * @returns {import('./report.mjs').Evidence['logcat']}
 */
function collectLogcat(adb, serial) {
  const pid =
    adb(...adbArgs(serial, 'shell', 'pidof', APPLICATION_ID))
      .stdout.trim()
      .split(/\s+/)[0] ?? '';
  if (!/^\d+$/.test(pid)) return null;
  return scanLogcat(adb(...adbArgs(serial, 'logcat', '-d', `--pid=${pid}`)).stdout);
}
