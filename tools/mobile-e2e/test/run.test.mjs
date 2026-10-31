import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { runE2e } from '../src/run.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';

const DEVICES_ONE = 'List of devices attached\nemulator-5554\tdevice\n';
const DEVICES_NONE = 'List of devices attached\n';
const DEVICES_TWO = 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n';
const APP = 'pl.eviacharge.manager';
/** synthetic bytes of every local APK; the device answers sha256sum with their digest unless told otherwise */
const APK_BYTES = Buffer.from('synthetic apk');
const APK_SHA = createHash('sha256').update(APK_BYTES).digest('hex');
const TEMPLATE_GRADLE =
  "signingConfigs {\n  debug {\n    storeFile file('debug.keystore')\n    storePassword 'tmpl-store-pw'\n    keyAlias 'androiddebugkey'\n    keyPassword 'tmpl-key-pw'\n  }\n}\n";
/** @param {string} name @param {string} content */
function tarEntry(name, content) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'latin1');
  header.write(content.length.toString(8).padStart(11, '0'), 124, 'latin1');
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  body.write(content, 0, 'latin1');
  return Buffer.concat([header, body]);
}
/** @param {Buffer[]} entries */
const backupArchive = (entries) =>
  Buffer.concat([Buffer.from('ANDROID BACKUP\n5\n1\nnone\n'), deflateSync(Buffer.concat([...entries, Buffer.alloc(1024)]))]);
/** the debuggable e2e build is backed up with its data (positive control), the release package is not */
const E2E_ARCHIVE = backupArchive([tarEntry(`apps/${APP}/f/SQLite/evia.db`, 'x'), tarEntry(`apps/${APP}/sp/SecureStore.xml`, 'x')]);
const RELEASE_ARCHIVE = backupArchive([]);

/**
 * A fake machine: every process is recorded, answers come from `responder`.
 * @param {{
 *   devices?: string[],
 *   failing?: (command: string, args: string[]) => boolean,
 *   exists?: (path: string) => boolean,
 *   requests?: { platform: string | undefined, version: string | undefined }[],
 *   pid?: string,
 *   longPaths?: boolean | null,
 *   env?: Record<string, string>,
 *   packageServiceAfter?: number,
 *   releaseArchive?: Buffer,
 *   installedSha?: string,
 *   gradle?: string | null,
 *   buildTools?: string[],
 * }} [options]
 */
function fakeMachine({
  devices = [DEVICES_ONE],
  failing = () => false,
  exists,
  requests,
  pid = '4242',
  longPaths = true,
  env,
  packageServiceAfter = 0,
  releaseArchive = RELEASE_ARCHIVE,
  installedSha = APK_SHA,
  gradle = TEMPLATE_GRADLE,
  buildTools = ['34.0.0', '35.0.0', '37.0.0'],
} = {}) {
  /** which package is on the emulator (EVM-093 AC4): the e2e one or the release one signed with the debug key */
  let releaseOnDevice = false;
  /** @type {{ source: string, target: string }[]} */
  const copied = [];
  /** @type {{ command: string, args: string[], cwd?: string, env?: Record<string, string> }[]} */
  const processes = [];
  /** @type {string[]} */
  const resets = [];
  /** @type {{ source: string, targets: string[] }[]} */
  const collected = [];
  /** @type {string[]} */
  const logs = [];
  /** @type {Record<string, string>} */
  const written = {};
  let packagePolls = 0;
  /** @type {string[]} */
  const modes = [];
  /** @type {string[]} */
  const auths = [];
  let closed = false;
  let devicePolls = 0;
  /** @type {{ command: string, args: string[] }[]} */
  const detached = [];
  let stubPort = 0;
  const apk = join('/repo', 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  let built = false;
  let appRunning = false;
  /** @type {string[]} */
  const removed = [];

  const host = /** @type {import('../src/run.mjs').Host} */ ({
    repoRoot: '/repo',
    platform: 'win32',
    env: { ANDROID_HOME: '/sdk', JAVA_HOME: '/jdk', EVIA_MAESTRO_HOME: '/m', GITHUB_TOKEN: 'synthetic-token', PATH: '/usr/bin', ...env },
    homedir: '/home/test',
    execPath: 'node',
    exists: (path) =>
      exists === undefined ? (path !== apk && !path.endsWith('-unsigned.apk') && !path.endsWith('-debugkey.apk')) || built : exists(path),
    writeText: (path, text) => {
      written[path] = text;
    },
    readBytes: (path) => {
      if (path.endsWith('.ab')) return releaseOnDevice ? releaseArchive : E2E_ARCHIVE;
      return path.endsWith('.apk') ? APK_BYTES : null;
    },
    readText: (path) => (path.endsWith('build.gradle') ? gradle : null),
    copyFile: (source, target) => {
      copied.push({ source, target });
    },
    listDirectory: (path) => (path.endsWith('build-tools') ? buildTools : []),
    removeFile: (path) => {
      removed.push(path);
    },
    makeDirectory: () => undefined,
    resetDirectory: (path) => {
      resets.push(path);
    },
    collectScreenshots: (source, targets) => {
      collected.push({ source, targets });
      return ['s01-online.png', 'kolejka-empty.png'];
    },
    run: (command, args, options = {}) => {
      processes.push({
        command,
        args,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
      });
      const joined = args.join(' ');
      if (failing(command, args)) return { status: 1, stdout: '', stderr: 'failed' };
      if (command.includes('adb')) {
        if (joined === 'devices') {
          const answer = devices[Math.min(devicePolls, devices.length - 1)] ?? DEVICES_NONE;
          devicePolls += 1;
          return { status: 0, stdout: answer, stderr: '' };
        }
        if (joined.endsWith('sys.boot_completed')) return { status: 0, stdout: '1\n', stderr: '' };
        if (joined.endsWith('pm path android')) {
          packagePolls += 1;
          return { status: 0, stdout: packagePolls > packageServiceAfter ? 'package:/system/framework/framework-res.apk' : '', stderr: '' };
        }
        if (joined.endsWith('ro.build.version.sdk')) return { status: 0, stdout: '35\n', stderr: '' };
        if (joined.endsWith('ro.build.version.release')) return { status: 0, stdout: '15\n', stderr: '' };
        if (joined.endsWith('ro.product.model')) return { status: 0, stdout: 'sdk_gphone64_x86_64\n', stderr: '' };
        if (joined.endsWith(`pidof pl.eviacharge.manager`)) return { status: 0, stdout: appRunning ? `${pid}\n` : '', stderr: '' };
        // EVM-093 device steps (src/device.mjs)
        if (args.includes('install')) {
          releaseOnDevice = (args.at(-1) ?? '').endsWith('-debugkey.apk');
          appRunning = false;
          return { status: 0, stdout: 'Performing Streamed Install\nSuccess\n', stderr: '' };
        }
        if (joined.endsWith(`dumpsys package ${APP}`))
          return {
            status: 0,
            stdout: `  Package [${APP}] (1):\n    flags=[ ${releaseOnDevice ? '' : 'DEBUGGABLE '}HAS_CODE ALLOW_CLEAR_USER_DATA ]\n`,
            stderr: '',
          };
        if (joined.endsWith(`run-as ${APP} id`))
          return releaseOnDevice
            ? { status: 1, stdout: '', stderr: `run-as: package not debuggable: ${APP}\n` }
            : { status: 0, stdout: 'uid=10190', stderr: '' };
        if (joined.endsWith(`pm path ${APP}`)) return { status: 0, stdout: `package:/data/app/~~a==/${APP}-b==/base.apk\n`, stderr: '' };
        if (joined.includes('sha256sum')) return { status: 0, stdout: `${installedSha}  /data/app/x/base.apk\n`, stderr: '' };
        if (joined.includes('am force-stop') || joined.includes('kill -9')) appRunning = false;
        if (joined.includes(' od -A n ')) return { status: 0, stdout: ' 8a 11 52 c0 9d 3e 77 01 aa 5b 42 19 e0 33 6c 0f\n', stderr: '' };
        if (joined.includes(' stat -c ')) return { status: 0, stdout: '32768\n', stderr: '' };
        if (joined.includes('grep -r -l -a') || joined.includes('ls -d /sdcard')) return { status: 1, stdout: '', stderr: '' };
        if (joined.endsWith('bmgr enabled')) return { status: 0, stdout: 'Backup Manager currently enabled\n', stderr: '' };
        if (joined.endsWith('bmgr list transports'))
          return {
            status: 0,
            stdout: '    com.android.localtransport/.LocalTransport\n  * com.google.android.gms/.backup.BackupTransportService\n',
            stderr: '',
          };
        if (joined.endsWith('backupnow com.android.providers.settings'))
          return { status: 0, stdout: 'Package com.android.providers.settings with result: Success\n', stderr: '' };
        if (joined.endsWith('backupnow pl.eviacharge.manager'))
          return { status: 0, stdout: 'Package pl.eviacharge.manager with result: Backup is not allowed\n', stderr: '' };
        if (joined.includes('logcat')) return { status: 0, stdout: 'I/app: started\nI/app: health checked\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      }
      if (command.endsWith('git.exe') && joined === 'rev-parse HEAD') return { status: 0, stdout: `${'ab12'.repeat(10)}\n`, stderr: '' };
      if (command.endsWith('git.exe') && joined === 'status --porcelain')
        return { status: 0, stdout: ' M pnpm-workspace.yaml\n', stderr: '' };
      if (joined.includes('GradleWrapperMain')) built = true;
      if (joined.includes('maestro.cli.AppKt') && args.includes('test')) appRunning = true;
      if (joined.endsWith('--version')) return { status: 0, stdout: 'update available\n2.11.0\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    startDetached: (command, args) => {
      detached.push({ command, args });
    },
    sleep: () => Promise.resolve(),
    now: (() => {
      let tick = 0;
      return () => {
        tick += 1500;
        return tick;
      };
    })(),
    longPathsEnabled: () => longPaths,
    resolveExpoCli: () => '/expo/bin/cli',
    readAppVersion: () => '0.1.0',
    startStub: (port) => {
      stubPort = port;
      return Promise.resolve({
        port,
        setMode: (mode, auth) => {
          modes.push(mode);
          auths.push(auth ?? 'ok');
        },
        requests: () => requests ?? [{ platform: 'android', version: '0.1.0' }],
        close: () => {
          closed = true;
          return Promise.resolve();
        },
      });
    },
    log: (line) => {
      logs.push(line);
    },
    today: () => '2026-10-20',
  });
  return {
    host,
    processes,
    logs,
    written,
    modes,
    auths,
    resets,
    collected,
    detached,
    removed,
    copied,
    releaseOnDevice: () => releaseOnDevice,
    isClosed: () => closed,
    stubPort: () => stubPort,
    maestroFlows: () =>
      processes
        .filter((entry) => entry.args.includes('test'))
        .map((entry) => entry.args[entry.args.indexOf('test') + 1]?.split(/[\\/]/).at(-1)),
    airplane: () => processes.filter((entry) => entry.args.includes('airplane-mode')).map((entry) => entry.args.at(-1)),
  };
}

/**
 * @template T
 * @param {T | undefined} value
 * @returns {T}
 */
function must(value) {
  assert.ok(value !== undefined);
  return value;
}

const ALL_FLOWS = SCENARIOS.flatMap((scenario) => scenario.steps.map((step) => step.flow));

/**
 * The airplane-mode commands a sequence of steps needs: one whenever a step wants another state than the previous one (start: off).
 * @param {{ airplane: boolean }[]} steps
 */
function expectedAirplane(steps) {
  let on = false;
  /** @type {string[]} */
  const commands = [];
  for (const step of steps) {
    if (step.airplane !== on) commands.push(step.airplane ? 'enable' : 'disable');
    on = step.airplane;
  }
  return commands;
}

describe('smoke test run (EVM-009 AC4; ADR-0015)', () => {
  it('EVM-009 AC4: builds the e2e variant, installs on the emulator, runs every flow and reports green', async () => {
    const machine = fakeMachine();
    const code = await runE2e({ skipBuild: false, port: 3199 }, machine.host);
    assert.equal(code, 0, machine.logs.join('\n'));
    // EVM-093 AC4: the release build comes first; the e2e build is the last prebuild, so android/ stays in the e2e state
    const prebuild = must(machine.processes.findLast((entry) => entry.args.includes('prebuild')));
    const gradle = must(machine.processes.find((entry) => entry.args.includes('assembleRelease')));
    const install = must(machine.processes.find((entry) => entry.args.includes('install')));
    assert.deepEqual(prebuild.args.slice(0, 2), ['/expo/bin/cli', 'prebuild']);
    assert.equal(prebuild.env?.['EVIA_BUILD_VARIANT'], 'e2e');
    assert.equal(prebuild.env['EXPO_PUBLIC_API_BASE_URL'], 'http://10.0.2.2:3199');
    assert.ok(gradle.args.includes('assembleRelease'));
    assert.deepEqual(install.args.slice(0, 4), ['-s', 'emulator-5554', 'install', '-r']);
    assert.deepEqual(machine.maestroFlows(), ALL_FLOWS);
    assert.equal(machine.isClosed(), true);
    assert.equal(machine.stubPort(), 3199);
  });

  it('EVM-009 AC4: no token of the host reaches any process', async () => {
    const machine = fakeMachine();
    await runE2e({ skipBuild: false, port: 3199 }, machine.host);
    for (const entry of machine.processes) assert.equal(entry.env?.['GITHUB_TOKEN'], undefined);
    assert.ok(machine.processes.every((entry) => entry.env?.['EXPO_NO_TELEMETRY'] === '1'));
  });

  it('EVM-009 AC4: the scenario server and the airplane mode follow the scenarios', async () => {
    const machine = fakeMachine({ exists: () => true });
    await runE2e({ skipBuild: true, port: 3199 }, machine.host);
    assert.deepEqual(
      machine.modes,
      SCENARIOS.flatMap((scenario) => scenario.steps.map((step) => step.server)),
    );
    assert.deepEqual(
      machine.auths,
      SCENARIOS.flatMap((scenario) => scenario.steps.map((step) => step.auth ?? 'ok')),
    );
    // airplane mode changes exactly where two consecutive steps differ (the offline flows of EVM-009 and EVM-100), nothing else
    assert.deepEqual(machine.airplane(), expectedAirplane(SCENARIOS.flatMap((scenario) => scenario.steps)));
    const homeIndex = machine.processes.findIndex((entry) => entry.args.includes('KEYCODE_HOME'));
    assert.ok(homeIndex > 0, 'the app goes to the background before the reconnect flow');
  });

  it('EVM-009 AC4: the report is written with the emulator API level and the Maestro version', async () => {
    const machine = fakeMachine({ exists: () => true });
    await runE2e({ skipBuild: true, port: 3199 }, machine.host);
    const report = machine.written[join('/repo', '.scratch', 'mobile-e2e', 'report.md')];
    assert.match(report ?? '', /API 35/);
    assert.match(report ?? '', /Maestro: 2\.11\.0/);
    assert.match(report ?? '', new RegExp(`${String(ALL_FLOWS.length)} passed, 0 failed, 0 skipped`));
    assert.ok(machine.logs.some((line) => line.includes('Maestro smoke test')));
  });

  it('EVM-009 AC4: Maestro writes into a fresh output directory and the screenshots are gathered for the UX review, listed in the report', async () => {
    const machine = fakeMachine({ exists: () => true });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, machine.host), 0);
    const output = join('/repo', '.scratch', 'mobile-e2e', 'maestro-output');
    const screenshots = join('/repo', '.scratch', 'mobile-e2e', 'screenshots');
    assert.deepEqual(machine.resets, [output, screenshots]);
    assert.deepEqual(machine.collected, [{ source: output, targets: [screenshots, join('/repo', 'docs', 'ux', 'reviews', 'EVM-009')] }]);
    const maestro = machine.processes.filter((entry) => entry.args.includes('test'));
    assert.equal(maestro.length, ALL_FLOWS.length);
    for (const entry of maestro) assert.equal(entry.args[entry.args.indexOf('--test-output-dir') + 1], output);
    const report = machine.written[join('/repo', '.scratch', 'mobile-e2e', 'report.md')];
    assert.match(report ?? '', /Screenshots for the UX review: 2 \(s01-online\.png, kolejka-empty\.png\)/);
  });

  it('EVM-009 AC4: the screenshots of a failed run are gathered too, they show where it stopped', async () => {
    const machine = fakeMachine({ exists: () => true, failing: (_command, args) => args.some((arg) => arg.endsWith('02-offline.yaml')) });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, machine.host), 1);
    assert.equal(machine.collected.length, 1);
  });

  it('EVM-009 AC4: --skip-build uses the APK of the earlier build', async () => {
    const machine = fakeMachine({ exists: () => true });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, machine.host), 0);
    assert.ok(!machine.processes.some((entry) => entry.args.includes('prebuild') || entry.args.includes('assembleRelease')));
  });

  it('EVM-009 AC4: a missing prerequisite stops before any process starts', async () => {
    const machine = fakeMachine({ longPaths: false });
    assert.equal(await runE2e({ skipBuild: false, port: 3199 }, machine.host), 1);
    assert.deepEqual(machine.processes, []);
    assert.match(machine.logs.join('\n'), /PREFLIGHT: .*LongPathsEnabled/);
  });

  it('EVM-009 AC4: EVIA_E2E_SHORT_PATHS=1 lets the build start without long paths, any other value does not', async () => {
    const short = fakeMachine({ longPaths: false, env: { EVIA_E2E_SHORT_PATHS: '1' } });
    assert.equal(await runE2e({ skipBuild: false, port: 3199 }, short.host), 0);
    assert.ok(short.processes.some((entry) => entry.args.includes('prebuild')));
    const other = fakeMachine({ longPaths: false, env: { EVIA_E2E_SHORT_PATHS: 'yes' } });
    assert.equal(await runE2e({ skipBuild: false, port: 3199 }, other.host), 1);
  });

  it('EVM-009 AC4: a build from a short clone gives Gradle the init script that shortens CMake object paths, a normal build does not', async () => {
    const short = fakeMachine({ longPaths: false, env: { EVIA_E2E_SHORT_PATHS: '1' } });
    await runE2e({ skipBuild: false, port: 3199 }, short.host);
    const script = join('/repo', 'apps', 'mobile', 'android', 'evia-path-limit.init.gradle');
    assert.match(short.written[script] ?? '', /CMAKE_OBJECT_PATH_MAX=250/);
    const gradle = must(short.processes.find((entry) => entry.args.includes('assembleRelease')));
    assert.equal(gradle.args[gradle.args.indexOf('-I') + 1], script);
    const normal = fakeMachine();
    await runE2e({ skipBuild: false, port: 3199 }, normal.host);
    assert.equal(normal.written[script], undefined);
    assert.ok(!must(normal.processes.find((entry) => entry.args.includes('assembleRelease'))).args.includes('-I'));
  });

  it('EVM-009 AC4: a Java without JAVA_HOME is looked up on the PATH, not as a file', async () => {
    const machine = fakeMachine({ env: { JAVA_HOME: '' }, exists: (path) => !path.endsWith('app-release.apk') || true });
    machine.host.env['JAVA_HOME'] = undefined;
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, machine.host), 0);
  });

  it('EVM-009 AC4: more than one emulator is a refusal and nothing is built', async () => {
    const machine = fakeMachine({ devices: [DEVICES_TWO] });
    assert.equal(await runE2e({ skipBuild: false, port: 3199 }, machine.host), 1);
    assert.match(machine.logs.join('\n'), /more than one emulator/);
    assert.ok(!machine.processes.some((entry) => entry.args.includes('prebuild')));
  });

  it('EVM-009 AC4: without a running emulator the AVD is started and awaited, once', async () => {
    const machine = fakeMachine({ devices: [DEVICES_NONE, DEVICES_NONE, DEVICES_ONE] });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 0);
    const emulators = machine.detached.filter((entry) => entry.command.includes('emulator'));
    assert.equal(emulators.length, 1);
    assert.deepEqual(emulators[0]?.args, ['-avd', 'Medium_Phone_API_35', '-no-snapshot-save', '-no-boot-anim']);
  });

  it('EVM-009 AC4: a second emulator appearing while the first starts is a refusal', async () => {
    const machine = fakeMachine({ devices: [DEVICES_NONE, DEVICES_TWO] });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 1);
    assert.match(machine.logs.join('\n'), /second emulator/);
  });

  it('EVM-009 AC4: an emulator that never boots ends the run with a clear message', async () => {
    const machine = fakeMachine({ devices: [DEVICES_NONE] });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 1);
    assert.match(machine.logs.join('\n'), /not ready after 180 s/);
  });

  it('EVM-009 AC4: a failing prebuild, Gradle build or a missing APK ends the run before the install', async () => {
    for (const [name, failing, exists] of /** @type {const} */ ([
      ['prebuild', (/** @type {string} */ _c, /** @type {string[]} */ args) => args.includes('prebuild'), undefined],
      ['Gradle', (/** @type {string} */ _c, /** @type {string[]} */ args) => args.includes('assembleRelease'), undefined],
      ['no APK', () => false, (/** @type {string} */ path) => !path.endsWith('app-release.apk')],
    ])) {
      const machine = fakeMachine({ failing, ...(exists === undefined ? {} : { exists }) });
      assert.equal(await runE2e({ skipBuild: false, port: 3199 }, machine.host), 1, name);
      assert.match(machine.logs.join('\n'), /BUILD:/, name);
      assert.ok(!machine.processes.some((entry) => entry.args.includes('install')), name);
    }
  });

  it('EVM-009 AC4: a freshly booted emulator is used only when its package service answers (install right after the boot flag fails)', async () => {
    const machine = fakeMachine({ packageServiceAfter: 3 });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 0);
    const polls = machine.processes.filter((entry) => entry.args.join(' ').endsWith('pm path android')).length;
    assert.ok(polls >= 4, String(polls));
  });

  it('EVM-009 AC4: a failed install ends the run, switches nothing on and closes the server', async () => {
    const machine = fakeMachine({ failing: (_c, args) => args.includes('install') });
    assert.equal(await runE2e({ skipBuild: false, port: 3199 }, machine.host), 1);
    assert.match(machine.logs.join('\n'), /INSTALL:/);
    assert.equal(machine.isClosed(), true);
    assert.deepEqual(machine.maestroFlows(), []);
  });

  it('EVM-009 AC4: the first flow after a fresh start is tried once more (Maestro installs its driver and the first connection may fail)', async () => {
    let failures = 0;
    const flaky = fakeMachine({
      failing: (_c, args) => args.some((argument) => argument.endsWith('01-online.yaml')) && (failures += 1) === 1,
    });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...flaky.host, exists: () => true }), 0);
    assert.deepEqual(flaky.maestroFlows().slice(0, 2), ['01-online.yaml', '01-online.yaml']);
    assert.match(flaky.logs.join('\n'), /MAESTRO: .*01-online.*retry/);
    const flakyReport = Object.values(flaky.written).join('\n');
    assert.match(flakyReport, /\| online \| 01-online\.yaml \| passed \(retried\) \|/);
    assert.match(flakyReport, /^- Retried flows: 01-online\.yaml$/m);
    assert.match(flakyReport, /\| update-required \| 04-update-required\.yaml \| passed \|/);
    const broken = fakeMachine({ failing: (_c, args) => args.some((argument) => argument.endsWith('01-online.yaml')) });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...broken.host, exists: () => true }), 1);
    assert.equal(broken.maestroFlows().filter((flow) => flow === '01-online.yaml').length, 2);
    assert.match(Object.values(broken.written).join('\n'), /\| 01-online\.yaml \| failed \(retried\) \|/);
  });

  it('EVM-009 AC4: a failing flow skips the rest of its scenario, the other scenarios still run, and airplane mode is switched off', async () => {
    const machine = fakeMachine({ failing: (_c, args) => args.some((argument) => argument.endsWith('02-offline.yaml')) });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 1);
    assert.ok(!machine.maestroFlows().includes('03-reconnect.yaml'));
    assert.ok(machine.maestroFlows().includes('04-update-required.yaml'));
    // the failed offline flow skips its return step: the next scenario switches airplane mode off, the later ones toggle as planned
    assert.deepEqual(machine.airplane(), ['enable', 'disable', 'enable', 'disable', 'enable', 'disable']);
    const report = Object.values(machine.written).join('\n');
    assert.match(report, /\| airplane-mode-and-return \| 02-offline\.yaml \| failed \|/);
    assert.match(report, /\| airplane-mode-and-return \| 03-reconnect\.yaml \| skipped \|/);
  });

  it('EVM-009 AC4: no compatibility header on the requests makes the run red even when every flow passed', async () => {
    const machine = fakeMachine({ requests: [{ platform: undefined, version: undefined }] });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 1);
  });

  it('EVM-009 AC4: an app process that is not running leaves the log uncollected, not invented', async () => {
    const machine = fakeMachine({ pid: '' });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 0);
    assert.match(Object.values(machine.written).join('\n'), /Logcat of the app process: not collected/);
  });

  it('EVM-009 AC4: the default SDK folder is the Windows user one, or ~/Android/Sdk elsewhere', async () => {
    const windows = fakeMachine({ env: { ANDROID_HOME: '' } });
    windows.host.env['ANDROID_HOME'] = undefined;
    windows.host.env['LOCALAPPDATA'] = 'C:/Users/T/AppData/Local';
    await runE2e({ skipBuild: true, port: 3199 }, { ...windows.host, exists: () => true });
    assert.ok(windows.processes.some((entry) => entry.command.startsWith(join('C:/Users/T/AppData/Local', 'Android', 'Sdk'))));
    const noLocalAppData = fakeMachine();
    noLocalAppData.host.env['ANDROID_HOME'] = undefined;
    await runE2e({ skipBuild: true, port: 3199 }, { ...noLocalAppData.host, exists: () => true });
    assert.ok(noLocalAppData.processes.some((entry) => entry.command.startsWith(join('/home/test', 'Android', 'Sdk'))));
    const linux = fakeMachine();
    linux.host.env['ANDROID_HOME'] = undefined;
    await runE2e({ skipBuild: true, port: 3199 }, { ...linux.host, platform: 'linux', exists: () => true });
    assert.ok(linux.processes.some((entry) => entry.command.startsWith(join('/home/test', 'Android', 'Sdk'))));
  });
});

const SCRATCH = join('/repo', '.scratch', 'mobile-e2e');
const UNSIGNED_COPY = join(SCRATCH, 'evm093-release-unsigned.apk');
const SIGNED = join(SCRATCH, 'evm093-release-debugkey.apk');
const REPORT = join(SCRATCH, 'report.md');

describe('the AC4 release package of the same run (EVM-093 AC4; security controls 2, 3, 5, 6)', () => {
  it('EVM-093 AC4: release build, its verify, then the e2e build, then align, debug-key signature and verify of the signed file', async () => {
    const machine = fakeMachine();
    assert.equal(await runE2e({ skipBuild: false, port: 3199 }, machine.host), 0, machine.logs.join('\n'));
    const index = (/** @type {(entry: { command: string, args: string[] }) => boolean} */ match) => machine.processes.findIndex(match);
    const prebuilds = machine.processes.filter((entry) => entry.args.includes('prebuild'));
    assert.equal(prebuilds.length, 2);
    assert.equal(prebuilds[0]?.env?.['EVIA_BUILD_VARIANT'], undefined);
    assert.equal(prebuilds[0]?.env?.['EXPO_PUBLIC_API_BASE_URL'], 'https://api.example.invalid');
    assert.equal(prebuilds[1]?.env?.['EVIA_BUILD_VARIANT'], 'e2e');
    const verifyUnsigned = index((entry) => entry.args.includes('verify') && entry.args.at(-1) === UNSIGNED_COPY);
    const e2ePrebuild = machine.processes.indexOf(must(prebuilds[1]));
    const zipalign = index((entry) => entry.command.endsWith('zipalign.exe'));
    const sign = index((entry) => entry.args.includes('sign'));
    const verifySigned = index((entry) => entry.args.includes('verify') && entry.args.at(-1) === SIGNED);
    const install = index((entry) => entry.args.includes('install'));
    // the unsigned package is copied and verified BEFORE the e2e build replaces android/ (security K2)
    assert.deepEqual(machine.copied, [
      {
        source: join('/repo', 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk'),
        target: UNSIGNED_COPY,
      },
    ]);
    assert.ok(verifyUnsigned >= 0 && verifyUnsigned < e2ePrebuild, 'verify of the unsigned release before the e2e build');
    assert.ok(e2ePrebuild < zipalign && zipalign < sign && sign < verifySigned && verifySigned < install);
    assert.ok(must(machine.processes[zipalign]).command.startsWith(join('/sdk', 'build-tools', '37.0.0')));
    const signer = must(machine.processes[sign]);
    assert.equal(signer.args[signer.args.indexOf('--ks') + 1], join('/repo', 'apps', 'mobile', 'android', 'app', 'debug.keystore'));
    assert.equal(signer.args[signer.args.indexOf('--out') + 1], SIGNED);
    // the passwords of the template key: only in the environment of apksigner, never in argv, a log line or the report
    assert.equal(signer.env?.['EVIA_E2E_DEBUG_KS_PASS'], 'tmpl-store-pw');
    assert.equal(signer.env['EVIA_E2E_DEBUG_KEY_PASS'], 'tmpl-key-pw');
    for (const entry of machine.processes) {
      assert.ok(!entry.args.some((argument) => argument.includes('tmpl-store-pw') || argument.includes('tmpl-key-pw')));
      if (entry !== signer) assert.equal(entry.env?.['EVIA_E2E_DEBUG_KS_PASS'], undefined);
    }
    const everything = `${machine.logs.join('\n')}\n${Object.values(machine.written).join('\n')}`;
    assert.doesNotMatch(everything, /tmpl-store-pw|tmpl-key-pw/);
    assert.ok(machine.removed.includes(join(SCRATCH, 'evm093-release-aligned.apk')));
    // the report binds the proof to the build: commit and SHA-256 of the installed release package
    assert.match(
      machine.written[REPORT] ?? '',
      new RegExp(`commit ${'ab12'.repeat(10)}, 1 local change\\(s\\) in the tree, SHA-256 ${APK_SHA}`),
    );
  });

  it('EVM-093 AC4: the backup proof runs on the release package over the e2e data, and the e2e package comes back for the next scenarios', async () => {
    const machine = fakeMachine({ exists: () => true });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, machine.host), 0, machine.logs.join('\n'));
    const installs = machine.processes.filter((entry) => entry.args.includes('install')).map((entry) => entry.args.at(-1));
    assert.equal(installs.length, 3);
    assert.equal(installs[1], SIGNED);
    assert.ok(installs[2]?.endsWith('app-release.apk'));
    assert.equal(machine.releaseOnDevice(), false);
    const report = machine.written[REPORT] ?? '';
    assert.match(report, /\| 10-backup-control\.yaml \| adb-backup-control-check \| ok \| positive control/);
    assert.match(report, /\| 10-backup-control\.yaml \| install-release-debugkey \| ok \| .*run-as refused/);
    assert.match(report, /\| 10-backup\.yaml \| adb-backup-check \| ok \| .*none from the app data/);
    assert.match(report, /\| 10-backup\.yaml \| reinstall-e2e \| ok \|/);
    assert.match(report, /\| local-store-backup \| 10-backup-after\.yaml \| passed \|/);
    assert.match(report, /release package \(not debuggable, debug key\): commit not built in this run \(--skip-build\), SHA-256 /);
  });

  it('EVM-093 AC4: app data in the archive of the release package fails AC4, and the e2e package is still put back', async () => {
    const leaked = fakeMachine({
      exists: () => true,
      releaseArchive: Buffer.concat([
        Buffer.from('ANDROID BACKUP\n5\n0\nnone\n'),
        tarEntry(`apps/${APP}/f/SQLite/evia.db`, 'x'),
        Buffer.alloc(1024),
      ]),
    });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, leaked.host), 1);
    const report = leaked.written[REPORT] ?? '';
    assert.match(report, /\| 10-backup\.yaml \| adb-backup-check \| FAILED \| 1 entries of the app data/);
    assert.match(report, /\| local-store-backup \| \(restore the e2e package\) \| passed \|/);
    assert.match(report, /\| local-store-backup \| 10-backup-after\.yaml \| skipped \|/);
    assert.equal(leaked.releaseOnDevice(), false);
    assert.ok(leaked.maestroFlows().includes('11-key-missing.yaml'));
  });

  it('EVM-093 AC4: a release package that is not the built file fails, and a failed restore of the e2e package stops all later scenarios', async () => {
    const other = fakeMachine({ exists: () => true, installedSha: '0'.repeat(64) });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, other.host), 1);
    assert.match(other.written[REPORT] ?? '', /install-release-debugkey \| FAILED \| .*not the built release file/);
    const stuck = fakeMachine({
      exists: () => true,
      installedSha: '0'.repeat(64),
      failing: (_c, args) => args.includes('install') && (args.at(-1) ?? '').endsWith('app-release.apk') && stuckInstalls++ > 0,
    });
    let stuckInstalls = 0;
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, stuck.host), 1);
    assert.match(stuck.logs.join('\n'), /CLEANUP: the e2e package could not be installed again/);
    const report = stuck.written[REPORT] ?? '';
    assert.match(report, /\| local-store-backup \| \(restore the e2e package\) \| failed \|/);
    assert.match(report, /\| local-store-key-missing \| 11-key-missing\.yaml \| skipped \|/);
    assert.match(report, /\| loading \| 07-loading\.yaml \| skipped \|/);
    assert.ok(!stuck.maestroFlows().includes('11-key-missing.yaml'));
  });

  it('EVM-093 AC4: a failing verify of the release package, a missing debug signing or no new build-tools stop before the install', async () => {
    /** @type {[string, Parameters<typeof fakeMachine>[0], RegExp][]} */
    const cases = [
      [
        'verify unsigned',
        { failing: (_c, args) => args.includes('verify') && args.at(-1) === UNSIGNED_COPY },
        /verify of the unsigned release package failed/,
      ],
      [
        'verify signed',
        { failing: (_c, args) => args.includes('verify') && args.at(-1) === SIGNED },
        /verify of the release package signed with the debug key failed/,
      ],
      ['no signing', { gradle: null }, /debug signing of the template/],
      ['old build-tools', { buildTools: ['34.0.0'] }, /no build-tools 35\.0\.0 or newer/],
      ['zipalign', { failing: (command) => command.endsWith('zipalign.exe') }, /zipalign of the release package failed/],
      ['apksigner', { failing: (_c, args) => args.includes('sign') }, /apksigner failed for the release package \(exit 1\)/],
      ['release prebuild', { failing: (_c, args) => args.includes('prebuild') }, /expo prebuild failed \(release\)/],
      ['no release APK', { exists: (path) => !path.endsWith('-unsigned.apk') }, /release APK was not produced/],
    ];
    for (const [name, options, message] of cases) {
      const machine = fakeMachine(options);
      assert.equal(await runE2e({ skipBuild: false, port: 3199 }, machine.host), 1, name);
      assert.match(machine.logs.join('\n'), message, name);
      assert.ok(!machine.processes.some((entry) => entry.args.includes('install')), name);
    }
    // verify of the unsigned release fails: the e2e build does not even start
    const early = fakeMachine({ failing: (_c, args) => args.includes('verify') });
    await runE2e({ skipBuild: false, port: 3199 }, early.host);
    assert.equal(early.processes.filter((entry) => entry.args.includes('prebuild')).length, 1);
  });

  it('EVM-093 AC4: --skip-build needs the signed release package of an earlier build; without git the commit is reported as unknown', async () => {
    const missing = fakeMachine({ exists: (path) => !path.endsWith('-debugkey.apk') });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, missing.host), 1);
    assert.match(missing.logs.join('\n'), /PREFLIGHT: --skip-build/);
    const noGit = fakeMachine({ env: { PATH: 'relative' } });
    assert.equal(await runE2e({ skipBuild: false, port: 3199 }, noGit.host), 0);
    assert.match(noGit.written[REPORT] ?? '', /commit unknown \(git not on PATH\), SHA-256/);
  });
});

describe('the Auto Backup check before the backup proof (EVM-093 AC4)', () => {
  it('EVM-093 AC4: a local transport that cannot be selected fails the step before adb backup; the release package never reaches the device', async () => {
    const machine = fakeMachine({
      exists: () => true,
      failing: (_c, args) => args.join(' ').endsWith('bmgr transport com.android.localtransport/.LocalTransport'),
    });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, machine.host), 1);
    const report = machine.written[REPORT] ?? '';
    assert.match(report, /\| local-store-backup \| 10-backup-control\.yaml \| failed \|/);
    assert.match(report, /\| local-store-backup \| 10-backup\.yaml \| skipped \|/);
    assert.ok(!machine.maestroFlows().includes('10-backup-control.yaml'));
    assert.ok(!machine.processes.some((entry) => entry.args.includes('install') && (entry.args.at(-1) ?? '').endsWith('-debugkey.apk')));
    assert.ok(machine.maestroFlows().includes('11-key-missing.yaml'));
  });
});
