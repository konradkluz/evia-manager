// @ts-check
/**
 * The smoke test of the mobile app on one Android emulator (EVM-009 AC4; ADR-0015): preflight, the e2e build, the install, the
 * scenario server, the Maestro flows, the report. Every effect goes through the `host`, so the sequence is tested with fakes.
 * Exit codes: 0 all flows passed, 1 a problem or a failed flow, 2 usage (main.mjs).
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { emulatorsOf, parseAdbDevices, selectEmulator } from './adb.mjs';
import {
  adbArgs,
  airplaneArgs,
  apkPath,
  apksignerCommand,
  APPLICATION_ID,
  buildEnv,
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
 *   readText: (path: string) => string | null,
 *   copyFile: (source: string, target: string) => void,
 *   listDirectory: (path: string) => string[],
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
  // EVM-093 AC4: the not debuggable release package of the same run, signed with the debug key (.scratch only, security K5)
  const release = releasePaths(reportDirectory);

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
    apkPresent: host.exists(apk) && host.exists(release.signed),
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

  host.makeDirectory(reportDirectory);
  /** @type {import('./report.mjs').Evidence['release']} */
  let releaseBuild;
  if (skipBuild) {
    releaseBuild = { commit: 'not built in this run (--skip-build)', localChanges: null, sha256: digestOf(host, release.signed) };
  } else {
    const built = buildAll(host, { appDirectory, androidHome, tools, env, apk, release });
    if (built === null) return 1;
    releaseBuild = built;
  }

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
    releaseApk: release.signed,
    e2eApk: apk,
  };
  // EVM-093 AC4 (security K6): once the release package went onto the device, the e2e package must come back before any later scenario
  const state = { releaseOnDevice: false, aborted: false };
  /** @param {import('./device.mjs').DeviceAction} action */
  const act = async (action) => {
    if (action === 'install-release-debugkey') state.releaseOnDevice = true;
    const result = await runDeviceAction(action, device);
    if (action === 'reinstall-e2e' && result.ok) state.releaseOnDevice = false;
    return result;
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
      if (state.aborted) {
        for (const step of scenario.steps) results.push({ scenario: scenario.name, flow: step.flow, status: 'skipped', seconds: 0 });
        continue;
      }
      let failed = false;
      for (const step of scenario.steps) {
        if (failed) {
          results.push({ scenario: scenario.name, flow: step.flow, status: 'skipped', seconds: 0 });
          continue;
        }
        stub.setMode(step.server, step.auth ?? 'ok');
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
          const check = await act(action);
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
            const check = await act(action);
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
      if (state.releaseOnDevice) {
        const restored = await act('reinstall-e2e');
        results.push({
          scenario: scenario.name,
          flow: '(restore the e2e package)',
          status: restored.ok ? 'passed' : 'failed',
          seconds: 0,
          checks: [restored],
        });
        if (!restored.ok) {
          state.aborted = true;
          host.log(
            'CLEANUP: the e2e package could not be installed again; the remaining scenarios are skipped (they would run on the release package)',
          );
        }
      }
    }
    logcat = collectLogcat(adb, serial);
  } finally {
    if (state.releaseOnDevice) await act('reinstall-e2e');
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
    release: releaseBuild,
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
 * EVM-093 AC4 (security K2, K5): the release build first (no e2e variant), its unsigned package copied into .scratch and verified at
 * once (tools/mobile-apk verify = 0, before the e2e build replaces android/), then the e2e build as before, then the copy of the release
 * package aligned and signed with the debug key of the template (the key that signed the e2e package, so `install -r` keeps the data)
 * and verified again. Both packages come from the same tree in the same run; the commit and the SHA-256 go into the report.
 * @param {Host} host
 * @param {{ appDirectory: string, androidHome: string, tools: ReturnType<typeof toolPaths>, env: Record<string, string>, apk: string,
 *   release: ReturnType<typeof releasePaths> }} context
 * @returns {NonNullable<import('./report.mjs').Evidence['release']> | null}
 */
function buildAll(host, { appDirectory, androidHome, tools, env, apk, release }) {
  const releaseEnv = releaseBuildEnv(host.env, { androidHome });
  if (!buildVariant(host, { appDirectory, androidHome, tools, env: releaseEnv, label: 'release' })) return null;
  const unsigned = unsignedReleaseApkPath(appDirectory);
  if (!host.exists(unsigned)) {
    host.log('BUILD: the release APK was not produced');
    return null;
  }
  host.copyFile(unsigned, release.unsigned);
  if (!verifyApk(host, env, release.unsigned, 'the unsigned release package')) return null;

  if (!buildVariant(host, { appDirectory, androidHome, tools, env, label: 'e2e' })) return null;
  if (!host.exists(apk)) {
    host.log('BUILD: the APK was not produced');
    return null;
  }

  const signing = parseDebugSigning(host.readText(join(appDirectory, 'android', 'app', 'build.gradle')) ?? '');
  const keystore = debugKeystorePath(appDirectory);
  if (signing === null || !host.exists(keystore)) {
    host.log('BUILD: the debug signing of the template (signingConfigs.debug, android/app/debug.keystore) was not found');
    return null;
  }
  const version = selectBuildTools(host.listDirectory(join(androidHome, 'build-tools')));
  if (version === null) {
    host.log('BUILD: no build-tools 35.0.0 or newer in ANDROID_HOME (zipalign -P 16); install them with sdkmanager');
    return null;
  }
  const buildTools = join(androidHome, 'build-tools', version);
  host.removeFile(release.aligned);
  host.removeFile(release.signed);
  const align = zipalignCommand({ buildTools, platform: host.platform, input: release.unsigned, output: release.aligned });
  if (host.run(align.command, align.args, { env }).status !== 0) {
    host.log('BUILD: zipalign of the release package failed');
    return null;
  }
  const signer = apksignerCommand({
    java: tools.java,
    buildTools,
    keystore,
    keyAlias: signing.keyAlias,
    input: release.aligned,
    output: release.signed,
  });
  // the passwords of the public template key reach apksigner only, by variable (never argv, never a log line)
  const signed = host.run(signer.command, signer.args, {
    env: { ...env, [DEBUG_KS_PASS_ENV]: signing.storePassword, [DEBUG_KEY_PASS_ENV]: signing.keyPassword },
  });
  host.removeFile(release.aligned);
  if (signed.status !== 0) {
    host.log(`BUILD: apksigner failed for the release package (exit ${String(signed.status)})`);
    return null;
  }
  if (!verifyApk(host, env, release.signed, 'the release package signed with the debug key')) return null;
  const result = { ...commitOf(host, env), sha256: digestOf(host, release.signed) };
  host.log(`BUILD: AC4 release package (not debuggable, debug key) from commit ${result.commit}, SHA-256 ${result.sha256}`);
  return result;
}

/**
 * @param {Host} host
 * @param {Record<string, string>} env
 * @param {string} file
 * @param {string} what
 */
function verifyApk(host, env, file, what) {
  const verify = verifyCommand(host.execPath, host.repoRoot, file);
  const outcome = host.run(verify.command, verify.args, { env });
  if (outcome.status === 0) return true;
  host.log(`BUILD: tools/mobile-apk verify of ${what} failed (exit ${String(outcome.status)}): ${outcome.stdout.trim().slice(0, 600)}`);
  return false;
}

/** @param {Host} host @param {string} file */
function digestOf(host, file) {
  const bytes = host.readBytes(file);
  return bytes === null ? 'missing' : createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {Host} host
 * @param {Record<string, string>} env
 * @returns {{ commit: string, localChanges: number | null }}
 */
function commitOf(host, env) {
  const git = resolveGit(host.env, host.platform, host.exists);
  if (git === null) return { commit: 'unknown (git not on PATH)', localChanges: null };
  const head = host.run(git, ['rev-parse', 'HEAD'], { cwd: host.repoRoot, env }).stdout.trim();
  const status = host.run(git, ['status', '--porcelain'], { cwd: host.repoRoot, env });
  return {
    commit: /^[0-9a-f]{40}$/.test(head) ? head : 'unknown',
    localChanges: status.status === 0 ? status.stdout.split(/\r?\n/).filter((line) => line.trim() !== '').length : null,
  };
}

/**
 * @param {Host} host
 * @param {{ appDirectory: string, androidHome: string, tools: ReturnType<typeof toolPaths>, env: Record<string, string>, label: string }} context
 * @returns {boolean}
 */
function buildVariant(host, { appDirectory, androidHome, tools, env, label }) {
  const androidDirectory = join(appDirectory, 'android');
  const prebuild = prebuildCommand(host.execPath, host.resolveExpoCli(appDirectory));
  if (host.run(prebuild.command, prebuild.args, { cwd: appDirectory, env, stream: true }).status !== 0) {
    host.log(`BUILD: expo prebuild failed (${label})`);
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
    host.log(`BUILD: Gradle assembleRelease failed (${label})`);
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
